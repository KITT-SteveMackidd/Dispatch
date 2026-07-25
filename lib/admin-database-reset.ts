import { getFunctions, httpsCallable } from 'firebase/functions';

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
    getFunctions(undefined, 'us-central1'),
    'resetDispatchDatabase'
  );
  const result = await callable();
  return result.data;
}
