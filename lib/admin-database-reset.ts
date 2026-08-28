import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export const DATABASE_RESET_ADMIN_EMAIL = 'stevemackidd@gmail.com';

export function canResetDispatchDatabase(
  email?: string | null,
  isLocalTestBuild = typeof __DEV__ !== 'undefined' && __DEV__
) {
  return isLocalTestBuild && email?.trim().toLowerCase() === DATABASE_RESET_ADMIN_EMAIL;
}

type ResetDispatchDatabaseResult = {
  firestoreCollectionsDeleted: number;
  authUsersDeleted: number;
};

export async function resetDispatchDatabase(): Promise<ResetDispatchDatabaseResult> {
  const callable = httpsCallable<void, ResetDispatchDatabaseResult>(
    functions,
    'resetDispatchDatabase'
  );
  const result = await callable();
  return result.data;
}
