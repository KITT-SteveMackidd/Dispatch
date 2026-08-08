import { getFunctions, httpsCallable } from 'firebase/functions';

type DeleteDispatchAccountInput = {
  appleAuthorizationCode?: string;
  firebaseApiKey?: string;
};

export type DeleteDispatchAccountResult = {
  deleted: true;
  appleAuthorizationRevoked: boolean;
  firestoreDocumentsDeleted: number;
  firestoreDocumentsUpdated: number;
  recursiveRootsDeleted: number;
  residualDocumentsDeleted: number;
  storageObjectsDeleted: number;
  organizationsDeleted: number;
  eventsDeleted: number;
  chatsDeleted: number;
};

export async function requestDispatchAccountDeletion(
  input: DeleteDispatchAccountInput = {}
): Promise<DeleteDispatchAccountResult> {
  const callable = httpsCallable<DeleteDispatchAccountInput, DeleteDispatchAccountResult>(
    getFunctions(undefined, 'us-central1'),
    'deleteDispatchAccount'
  );
  const result = await callable(input);
  return result.data;
}
