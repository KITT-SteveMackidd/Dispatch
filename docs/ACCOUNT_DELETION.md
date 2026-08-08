# Dispatch account deletion

Dispatch deletes accounts through the `deleteDispatchAccount` callable Cloud Function. The mobile app never deletes Firestore or Firebase Auth records directly.

## Deletion order

1. Require a Firebase sign-in no more than five minutes old.
2. For an Apple-linked user, send the fresh Apple authorization code and current Firebase ID token to Firebase Authentication's token-revocation endpoint.
3. Delete or de-identify Firestore records and Firebase Storage objects.
4. Delete the Firestore user profile.
5. Delete the Firebase Auth user last.

If Apple revocation fails, no Dispatch data is changed. If a later cleanup step fails, Firebase Auth remains active so the user can retry the idempotent cleanup.

## Data covered

- User profile, push tokens, and beta checklist state
- Organization and team memberships, including manager ownership transfer
- Events, role assignments, task completions, and event templates
- Worker and manager invitations plus invite-token records
- Role, user, unread, delivery, and push-ticket notification records
- Chat threads, messages, active-viewer state, and unread counters
- Email extension documents associated with the user or deleted records
- Chat attachments, template/event attachments, and a Firebase Storage avatar path when present
- Presented and scheduled Dispatch notifications on the device that performs the deletion

Organization data is transferred to another organization manager when one exists. Data that is intrinsically keyed to the deleting user, including direct/custom chat IDs and authored messages, is deleted.

After the primary writes finish, the function rechecks invites, notification records, unread state, email jobs, and push records. This catches residual records created by a notification or delivery worker while deletion was running.

## Apple provider requirement

No additional Apple private key is stored in the Dispatch repository, EAS, or a separate function secret. The callable uses Firebase Authentication's supported `accounts:revokeToken` flow, which relies on the Sign in with Apple provider configuration already stored in Firebase Authentication.

Before release, confirm that the Apple provider remains enabled for `dispatch-eb63a` and that its Team ID, Key ID, private key, and bundle ID configuration are current. Deploy the callable with:

```powershell
firebase deploy --only functions:deleteDispatchAccount --project dispatch-eb63a
```

## Release verification

Use fresh disposable Manager and Worker accounts. Test email/password, Google, and Apple-linked accounts in a physical-iPhone preview or TestFlight build.

For each account, create representative events, invites, notifications, chats, unread state, and uploads before deletion. After deletion, verify the app returns to sign-in, Firebase Authentication no longer lists the user, no user UID/email remains in the covered Firestore collections, and the user's Storage objects are gone. For Apple, signing in again must start a new Apple authorization rather than silently retaining the prior grant.
