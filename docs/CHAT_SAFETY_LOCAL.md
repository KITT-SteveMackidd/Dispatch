# Chat safety rollout and local checks

DSP-127 is local only. Existing organizations retain their existing chat behavior unless the trusted rollout is enabled. Do not enable this feature on a hosted organization or deploy these changes as part of local QA.

## Trusted activation

The Admin SDK seed/provisioner must write the following **in one Firestore batch**:

```js
batch.update(db.doc(`organizations/${organizationId}`), { chatSafetyEnabled: true });
batch.set(db.doc(`organizationBilling/${organizationId}`), { chatSafetyEnabled: true }, { merge: true });
await batch.commit();
```

Disable using the same paired batch with both values `false`. Never write the two flags separately. The organization document controls client rollout; the billing document is the server-owned projection needed to respect Storage Rules' two-document lookup limit. Client writes to either flag are denied. Get-state, send and upload-grant callables reject mismatched flags. Direct Firestore message writes reject either true flag. The dedicated `dispatch-customer-beta` policy backend is unsupported for enabled chat safety and fails closed in the callables; local QA uses `demo-dispatch-billing`.

Activation must use a writable billing projection already established for that organization; the flag does not create an entitlement or bypass ordinary write authorization. Block/unblock and rules acceptance remain available when billing is read-only. Event/task permissions are unaffected.

## Consent, blocks and uploads

The current rules version is `2026-10-27`. Only trusted callables write `users/{uid}.chatRulesVersion`, `chatRulesAcceptedAt`, or `chatSuspension`. Private blocks are `users/{uid}/chatBlocks/{targetUid}`. Each affected user receives an own-readable, server-written `users/{uid}/chatSafetyState/current` signal so active clients refresh state.

Blocking applies in either direction to every two-participant thread, including custom groups. Larger shared groups remain available, excluding blocked pairs from recipients, unread increments and push delivery. Push authorization is checked again immediately before delivery. An explicitly empty recipient list remains empty. The Functions emulator never contacts Expo push/receipt endpoints.

Secure uploads require `createChatUpload({threadId,name,mimeType,size})`. Grants last five minutes, are create-only, limited to 20 MB, and use `chatSafetyAttachments/{grantId}/{filename}`. Storage checks grant plus current owner profile (two reads). Send validates the exact grant owner/thread/path, filename, MIME type, size, uploaded metadata, URL bucket/path and download token, then consumes the grant with the message transaction. Old `chatAttachments` uploads are disabled for enabled organizations. Production attachment URLs require Firebase HTTPS; only the demo Functions emulator accepts its configured Storage origin and this machine's local private IPv4 interface origins. Account deletion removes owned grants, secure objects (including late uploads), outgoing and incoming blocks, and private safety state.

## Local evidence

Run the synthetic fixture and checks with `scripts/seed-chat-safety-test.ps1` and `scripts/check-chat-safety-local.ps1` using a fresh run ID. They must target the existing demo emulator ports and must never reset an unrelated fixture. Backend regression tests are `node --test test/*.node.js` from `functions/`. Successful automated checks do not establish physical-device behavior or hosted release readiness.

## Private reporting (DSP-128)

`submitChatReport` accepts a thread, either a message ID or member ID, one enumerated reason, optional details up to 2,000 characters, and a client request identifier. It derives all identities and evidence from authorized server documents. Extra client evidence/identity fields are rejected. A member can report without accepting chat rules, while blocked or chat-suspended, and while organization billing is read-only. Current organization and thread access remain required for a new submission.

Reports are confidential server-only documents in `chatSafetyReports`; even reporters, organization Managers, reported members and operator-claim clients cannot read this collection directly. `listMyChatReports` returns only the caller's report ID, kind, target display name, reason, status, ISO timestamps and a reporter-safe resolution summary. Details, evidence, reporter identity, target UID, organization and thread identifiers are omitted. Current statuses are `submitted`, `under_review`, `resolved`, and `dismissed`; this stage only writes `submitted`. Moderator actions are a separate stage.

Exact retries reuse the original report without another quota increment. Reusing the same request ID for different content fails. Server transactions limit new submissions to five per UTC clock hour and twenty per UTC day; counters live in the private `users/{uid}/chatReportLimits/current` document. Pagination cursors are canonical opaque encodings anchored to an existing report owned by the caller. `firestore.indexes.json` includes the reporter/time/document-ID index required before any future hosted rollout; no index was deployed by this local work.

Account deletion removes ordinary reports where the deleted user is reporter or target, redacts their authoritative identity from bystander prose in retained reports, and erases their private counters. The moderation-stage enforcement exception is described below. Own report history remains readable through the callable after leaving an organization, until the profile is deleted. Reporting does not send email or contact an external service.

## Moderator actions (DSP-129)

`listModerationReports` and `moderateChatReport` authorize current organization Managers (role, profile organization and trusted Manager roster) or an authenticated `dispatchModerator: true` operator claim. Reports involving the reviewer as reporter or target are hidden and every action is denied, including for operators. Current target organization/membership is checked again before suspension or restoration. These safety actions bypass billing restrictions, without changing event/task permissions.

Actions are `dismiss`, `remove_message`, `suspend_user`, and `restore_user`. Each request requires a private review note and idempotency ID; `expectedRevision` optionally rejects stale decisions. An exact retry reuses its original action even if its original revision is old. Private operations live in `chatModerationOperations`; audit records are append-only under each report's `moderationAudit` subcollection. Notes never enter the reporter's summary or a shared user profile. Queue cursors are random server-stored tokens bound to the reviewer and current scope, with a 30-minute expiry.

Suspension correlation is private in `chatUserModerationState/{uid}.organizations`, keyed by organization. The shared user profile's `chatOrganizationSuspensions` map contains only organization scope, generic active state/reason and time; the single `chatSuspension` field remains a compatible last-action projection. Moving from organization A to B does not apply A's restriction to B, while returning to A restores its still-active restriction. Independent A/B restrictions survive each other's actions. State reads, sends, thread creation/rename, upload grants, Storage uploads and push checks use the same current-organization selection. A new suspension cannot replace an active restriction in that organization, preventing a reviewer from bypassing a conflict by replacing and restoring an older report. Restoration must match this report's current private restriction; it cannot clear a newer independent restriction or an uncorrelated profile restriction.

Unknown active legacy restrictions without an organization scope remain deliberately fail-closed. Only in a demo project, an immediately prior local unscoped restriction can be restored when its exact private completed suspension operation and timestamp prove the organization/report correlation; it is not reset or silently migrated. There is no automatic hosted migration or generic override.

Message removal first clears stored text/attachments, marks `moderationStatus: removed`, and replaces current and legacy thread previews with generic text. Pending pushes recheck the current message removal state immediately before delivery. Managed attachments are revoked and deleted, then verified absent with an Admin Storage metadata 404 **and** inaccessible with their former download URL returning 403 or 404. Public 403 alone never establishes deletion; 200, unexpected responses, or cleanup failure leave the report `under_review` with `cleanup_pending` and a retry action. A subsequent authorized reviewer can retry the same cleanup. The report only becomes resolved after all verified owned objects are absent. No binary evidence copy is retained; private text and safe attachment metadata remain.

Historical external links are removed from the app without fetching or attempting to delete the external resource; the result makes no remote-deletion claim. Potentially app-owned attachments whose ownership cannot be verified are also hidden immediately, but remain pending with an operator-review explanation and are never fetched/deleted speculatively. This is a deliberate unresolved-cleanup state, not a successful deletion claim.

Attachment content is available only on explicit moderator request through `getChatReportAttachmentPreview`. It repeats current reviewer/conflict checks and validates the exact owned object, bucket, allowed MIME type, size and live download token before returning a trusted Firebase URL. List responses contain metadata only. Removed or pending-removal attachments cannot be previewed; arbitrary legacy external URLs are never returned.

### Account deletion and active enforcement

Target deletion removes the report and its audit subcollection, operations and private suspension state. Ordinary reporter-owned reports are removed too. If a reporter deletes their account while a report carries active enforcement in any organization entry or pending cleanup, only a minimal anonymized record remains so a surviving authorized reviewer can restore access or finish cleanup: reporter UID is null, name becomes “Former member,” details and evidence text/attachments are cleared, and the thread label is generic. Enforcement is never silently cleared by reporter deletion. Deleted moderator IDs are removed from surviving action/audit records and their private notes are cleared. Owned cursor and rate-limit state is deleted. This privacy cleanup is the explicit exception to append-only audit history; it does not preserve a deleted person's private notes.

All implementation and evidence in this document remain local. The new Functions, rules and indexes have not been deployed by this work, and no hosted organization has been opted into the rollout.

## Manager review alerts and pending counts

`getChatSafetyState.pendingReviewCount` counts `submitted` and `under_review` reports the current reviewer can handle. It excludes reports they submitted and reports about themselves. Pending attachment cleanup remains counted; resolving or dismissing removes the count. Reading or deleting an alert does not alter it. Managers are scoped to their current organization and trusted Manager roster; operators retain their existing global queue scope, with conflicts excluded. Flag-disabled, deleted or deletion-fenced profiles receive no pending count. The organization/status compound index is included locally for a future hosted rollout.

The report write trigger creates a deterministic `userNotifications` entry for each currently eligible organization Manager on first submission. The notice and push contain only generic review text, recipient, organization and notification identity; no reporter, target, evidence or report ID appears. `chatReviewNotificationSources` is a server-only registry linking the deterministic notice to its report for retries and fresh delivery authorization. Keeping this marker prevents duplicate alerts even if a Manager deletes the generic notice. Global operators do not receive organization push fan-out.

Report changes refresh current reviewers' private safety signals; role, organization, deletion-fence and Manager-roster changes refresh affected users too. Immediately before push delivery, authorization rechecks the report's pending status, both rollout flags, current profile/roster/org and conflicts. Old generic notices may remain in notification history after resolution or a role change, but cannot grant report access. The existing Functions emulator suppression still prevents all Expo push and receipt network requests.

Account deletion removes linked registry markers, generic notices and push delivery/ticket records when the recipient, target, report or organization is removed. If an active enforcement report must survive reporter deletion, its marker retains only a null reporter identity so retries remain deduplicated. Report-trigger writes respect the account-maintenance lease and retry after cleanup, preventing new private markers from racing the deletion snapshot. Moderation list, actions and attachment previews independently reject a deletion-fenced reviewer, including operators.
