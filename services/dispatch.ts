import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DispatchEvent, Team } from '@/types/dispatch';

export function watchManagerEvents(managerId: string, cb: (items: DispatchEvent[]) => void) {
  const q = query(collection(db, 'events'), where('managerId', '==', managerId));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DispatchEvent, 'id'>) }))));
}

export function watchWorkerEvents(workerId: string, cb: (items: DispatchEvent[]) => void) {
  const q = query(collection(db, 'events'), where('workerIds', 'array-contains', workerId));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DispatchEvent, 'id'>) }))));
}

export function watchTeams(managerId: string, cb: (items: Team[]) => void) {
  const q = query(collection(db, 'teams'), where('managerId', '==', managerId));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Team, 'id'>) }))));
}
