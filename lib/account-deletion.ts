import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

type DeleteDispatchAccountInput = {
  appleAuthorizationCode?: string;
  firebaseApiKey?: string;
  confirmActiveSubscriptionDeletion?: boolean;
};

export type DeleteDispatchAccountResult = {
  deleted: true;
  appleAuthorizationRevoked: boolean;
  revenueCatCustomerDeleted: boolean;
  revenueCatStatusVerified: boolean;
  revenueCatDeletionPending: boolean;
  revenueCatManualReviewRequired: boolean;
  activeSubscriberDeletedImmediately: boolean;
  authDeletionPending: boolean;
  remoteCleanupPending: boolean;
  firestoreDocumentsDeleted: number;
  firestoreDocumentsUpdated: number;
  recursiveRootsDeleted: number;
  residualDocumentsDeleted: number;
  storageObjectsDeleted: number;
  organizationsDeleted: number;
  orphanedOrganizations: number;
  eventsDeleted: number;
  chatsDeleted: number;
};

export async function requestDispatchAccountDeletion(
  input: DeleteDispatchAccountInput = {}
): Promise<DeleteDispatchAccountResult> {
  const callable = httpsCallable<DeleteDispatchAccountInput, DeleteDispatchAccountResult>(
    functions,
    'deleteDispatchAccount'
  );
  const result = await callable(input);
  return result.data;
}
