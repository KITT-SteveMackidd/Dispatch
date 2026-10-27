const crypto = require('node:crypto');
const { rolloutEnabled } = require('./chat-safety');

const REVIEW_NOTIFICATION_KIND = 'chat_safety_report';
const REVIEW_NOTIFICATION_TITLE = 'Chat report needs review';
const REVIEW_NOTIFICATION_BODY = 'A chat safety report is ready for review.';
const PENDING_STATUSES = ['submitted', 'under_review'];
const pending = report => PENDING_STATUSES.includes(report?.status);
const conflict = (report, uid) => report?.reporterUserId === uid || report?.targetUserId === uid;
const manager = profile => String(profile?.role).trim().toLowerCase() === 'manager';
const ids = values => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value))];
const notificationIdFor = (reportId, uid) => `chat-review-${crypto.createHash('sha256').update(JSON.stringify([reportId, uid])).digest('hex')}`;

function createChatReviewNotificationService({ getDb, getFieldValue, projectId, assertMutationAllowed = async () => {} }) {
  const signal = (tx, uid) => tx.set(getDb().collection('users').doc(uid).collection('chatSafetyState').doc('current'), {
    version: getFieldValue().increment(1), updatedAt: getFieldValue().serverTimestamp(),
  }, { merge: true });

  async function organization(tx, organizationId) {
    if (typeof organizationId !== 'string' || !organizationId) return null;
    const [org, billing] = await tx.getAll(getDb().collection('organizations').doc(organizationId), getDb().collection('organizationBilling').doc(organizationId));
    try {
      return org.exists && rolloutEnabled(org.data(), billing.data(), projectId()) ? org.data() : null;
    } catch { return null; }
  }

  async function reviewers(tx, report) {
    const org = await organization(tx, report?.organizationId);
    if (!org) return [];
    const candidates = ids(org.managerIds).filter(uid => !conflict(report, uid));
    const profiles = candidates.length ? await tx.getAll(...candidates.map(uid => getDb().collection('users').doc(uid))) : [];
    return profiles.filter(profile => profile.exists && manager(profile.data())
      && profile.data().organizationId === report.organizationId && !profile.data().accountDeletionStartedAt).map(profile => profile.id);
  }

  async function pendingReviewCount(tx, { uid, profile, organizationId, isOperator = false, enabled }) {
    if (!enabled || profile?.accountDeletionStartedAt || (!isOperator && !manager(profile))) return 0;
    const org = await organization(tx, organizationId);
    if (!org || (!isOperator && !ids(org.managerIds).includes(uid))) return 0;
    let query = getDb().collection('chatSafetyReports').where('status', 'in', PENDING_STATUSES);
    if (!isOperator) query = query.where('organizationId', '==', organizationId);
    const reports = await tx.get(query);
    const scopes = new Map([[organizationId, org]]);
    let count = 0;
    for (const snapshot of reports.docs) {
      const report = snapshot.data();
      if (conflict(report, uid)) continue;
      if (!scopes.has(report.organizationId)) scopes.set(report.organizationId, await organization(tx, report.organizationId));
      if (scopes.get(report.organizationId)) count++;
    }
    return count;
  }

  async function handleReportWrite({ reportId, before = null, after = null }) {
    return getDb().runTransaction(async tx => {
      // Retry after privacy cleanup rather than creating identity-bearing
      // source markers behind the deletion transaction's collection snapshot.
      await assertMutationAllowed(tx);
      const current = await tx.get(getDb().collection('chatSafetyReports').doc(reportId));
      const currentReport = current.exists ? current.data() : null;
      const reports = [before, after, currentReport].filter(Boolean);
      const signals = new Set();
      for (const report of reports) (await reviewers(tx, report)).forEach(uid => signals.add(uid));
      // A delayed creation event must not notify after a report is resolved or
      // deleted. The durable marker also prevents recreating a user-dismissed
      // generic notification when an event is retried.
      const recipients = !before && after && pending(currentReport) ? await reviewers(tx, currentReport) : [];
      const refs = recipients.map(uid => getDb().collection('chatReviewNotificationSources').doc(notificationIdFor(reportId, uid)));
      const markers = refs.length ? await tx.getAll(...refs) : [];
      let created = 0;
      recipients.forEach((uid, index) => {
        if (markers[index].exists) return;
        const id = refs[index].id;
        tx.create(refs[index], { reportId, organizationId: currentReport.organizationId, recipientUserId: uid,
          reporterUserId: currentReport.reporterUserId || null, targetUserId: currentReport.targetUserId,
          createdAt: getFieldValue().serverTimestamp() });
        tx.set(getDb().collection('userNotifications').doc(id), {
          userId: uid, organizationId: currentReport.organizationId, kind: REVIEW_NOTIFICATION_KIND,
          title: REVIEW_NOTIFICATION_TITLE, body: REVIEW_NOTIFICATION_BODY,
          read: false, pushAuthorized: true, createdAt: getFieldValue().serverTimestamp(),
        });
        created++;
      });
      signals.forEach(uid => signal(tx, uid));
      return { created };
    });
  }

  async function canDeliver({ notificationId, recipientId }) {
    if (typeof notificationId !== 'string' || typeof recipientId !== 'string') return false;
    return getDb().runTransaction(async tx => {
      const [marker, notification] = await tx.getAll(
        getDb().collection('chatReviewNotificationSources').doc(notificationId),
        getDb().collection('userNotifications').doc(notificationId));
      if (!marker.exists || marker.data().recipientUserId !== recipientId || !notification.exists
        || notification.data().userId !== recipientId || notification.data().kind !== REVIEW_NOTIFICATION_KIND
        || notification.data().pushAuthorized !== true || notification.data().organizationId !== marker.data().organizationId) return false;
      const report = await tx.get(getDb().collection('chatSafetyReports').doc(marker.data().reportId));
      if (!report.exists || !pending(report.data()) || report.data().organizationId !== marker.data().organizationId) return false;
      return (await reviewers(tx, report.data())).includes(recipientId);
    });
  }

  async function handleUserAuthorityChange({ uid, before, after }) {
    if (!after || (before?.role === after.role && before?.organizationId === after.organizationId
      && Boolean(before?.accountDeletionStartedAt) === Boolean(after.accountDeletionStartedAt))) return;
    return getDb().runTransaction(async tx => {
      const user = await tx.get(getDb().collection('users').doc(uid));
      if (user.exists) signal(tx, uid);
    });
  }

  async function handleOrganizationAuthorityChange({ before, after }) {
    const oldIds = ids(before?.managerIds), newIds = ids(after?.managerIds);
    if (JSON.stringify(oldIds.slice().sort()) === JSON.stringify(newIds.slice().sort()) && before?.chatSafetyEnabled === after?.chatSafetyEnabled) return;
    return getDb().runTransaction(async tx => {
      const candidates = ids([...oldIds, ...newIds]);
      const profiles = candidates.length ? await tx.getAll(...candidates.map(uid => getDb().collection('users').doc(uid))) : [];
      profiles.filter(profile => profile.exists).forEach(profile => signal(tx, profile.id));
    });
  }

  return { pendingReviewCount, handleReportWrite, canDeliver, handleUserAuthorityChange, handleOrganizationAuthorityChange };
}

module.exports = { createChatReviewNotificationService, notificationIdFor, REVIEW_NOTIFICATION_KIND, REVIEW_NOTIFICATION_TITLE, REVIEW_NOTIFICATION_BODY };
