import { getFunctions, httpsCallable } from 'firebase/functions';

type PrepareEventRoleInviteResponseResult = {
  eventId: string;
  repaired: boolean;
};

export async function prepareEventRoleInviteResponse(notificationId: string) {
  const callable = httpsCallable<
    { notificationId: string },
    PrepareEventRoleInviteResponseResult
  >(getFunctions(undefined, 'us-central1'), 'prepareEventRoleInviteResponse');
  const result = await callable({ notificationId });
  return result.data;
}

type RespondToEventRoleInviteResult = {
  eventId: string;
  roleId: string;
  shouldQueueReminder: boolean;
  alreadyHandled: boolean;
};

export async function respondToEventRoleInvite(
  notificationId: string,
  response: 'accept' | 'decline'
) {
  const callable = httpsCallable<
    { notificationId: string; response: 'accept' | 'decline' },
    RespondToEventRoleInviteResult
  >(getFunctions(undefined, 'us-central1'), 'respondToEventRoleInvite');
  const result = await callable({ notificationId, response });
  return result.data;
}
