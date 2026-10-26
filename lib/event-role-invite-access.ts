import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

type PrepareEventRoleInviteResponseResult = {
  eventId: string;
  repaired: boolean;
};

export async function prepareEventRoleInviteResponse(notificationId: string) {
  const callable = httpsCallable<
    { notificationId: string },
    PrepareEventRoleInviteResponseResult
  >(functions, 'prepareEventRoleInviteResponse');
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
  >(functions, 'respondToEventRoleInvite');
  const result = await callable({ notificationId, response });
  return result.data;
}
