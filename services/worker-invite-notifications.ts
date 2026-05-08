import { doc, getDoc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { WorkerInvite } from '@/types/dispatch';

export async function clearWorkerInviteNotification(params: { managerId: string; inviteId: string }) {
  const inviteRef = doc(db, 'workerInvites', params.inviteId);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) return;

  const invite = inviteSnap.data() as WorkerInvite;
  if (invite.managerId !== params.managerId) throw new Error('You can only clear your own invites');

  await updateDoc(inviteRef, {
    managerClearedAt: serverTimestamp(),
    statusReason: 'Cleared from Recent Worker Invites by manager.',
    updatedAt: serverTimestamp(),
  });
}

export async function clearAllWorkerInviteNotifications(params: { managerId: string; inviteIds: string[] }) {
  const ids = [...new Set(params.inviteIds.filter(Boolean))];
  if (!ids.length) return;

  const batch = writeBatch(db);
  for (const id of ids) {
    const inviteRef = doc(db, 'workerInvites', id);
    const inviteSnap = await getDoc(inviteRef);
    if (!inviteSnap.exists()) continue;

    const invite = inviteSnap.data() as WorkerInvite;
    if (invite.managerId !== params.managerId) continue;

    batch.update(inviteRef, {
      managerClearedAt: serverTimestamp(),
      statusReason: 'Cleared from Recent Worker Invites by manager.',
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
}
