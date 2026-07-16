# Dispatch iPhone Push Notification Test Plan

## Test setup

1. Install the latest EAS iOS build on two physical iPhones. Do not use Expo Go or a simulator.
2. Sign in on iPhone A as a Manager and iPhone B as a Worker in the same organization and team.
3. In iOS Settings > Notifications > Dispatch, turn on Allow Notifications, Sounds, Badges, Lock Screen, Notification Centre, and Banners.
4. Open Dispatch once on each phone and accept the notification permission prompt.
5. Keep a results note with columns for test, foreground, background, force-quit, notification text, tap destination, badge, and pass/fail.
6. Repeat each delivery test in three states: app open, app in the background, and app force-quit.

## Baseline permission and delivery

1. Delete and reinstall Dispatch on both phones so the first-run permission flow is clean.
2. Sign in as the Manager and allow notifications. Confirm no disabled-notifications warning appears.
3. Repeat for the Worker.
4. Deny permission on one reinstall. Confirm Dispatch explains that notifications are disabled and the app remains usable.
5. Re-enable notifications in iOS Settings and reopen Dispatch. Confirm alerts can be received without reinstalling again.
6. Confirm each account stores an iOS push token and a granted permission status in its Firebase user record.

## Worker notification tests

1. From the Manager phone, invite the Worker to a team. Confirm the Worker receives the team name and manager context.
2. Tap the team-invite notification. Confirm Dispatch opens to the pending team invite, not a blank or unrelated screen.
3. Accept the team invite. Confirm the Manager receives a notification naming the Worker and team.
4. Repeat the team invite and decline it. Confirm the Manager receives the decline notification.
5. Create an event with a role and assign the Worker. Confirm the Worker notification identifies the event and role.
6. Tap the role notification. Confirm Dispatch opens the correct event.
7. Accept the role. Confirm the Manager receives a notification naming the Worker, event, and role.
8. Repeat with a second role and decline it. Confirm the Manager receives the correct decline notification.
9. Fill a role, have the Worker join its waitlist, then make the role available. Confirm the Worker receives the role-available notification and tapping it opens the correct event.
10. Remove the Worker from an assigned role. Confirm the Worker receives a removed-from-role notification with the event and role.
11. Assign the Worker to an event starting slightly more than two hours ahead. Keep the build installed until the two-hour point and confirm the reminder includes event, role, and location.
12. Send the Worker a direct or group chat message from the Manager. Confirm title/body are correct and tapping opens the exact chat thread.

## Manager notification tests

1. Have the Worker accept a role invitation. Confirm the Manager notification names the Worker, event, and role and opens the event.
2. Have the Worker decline a role invitation. Confirm the Manager notification names the Worker, event, and role and opens the event.
3. Have the Worker accept and decline team invitations. Confirm both Manager notifications contain the correct Worker and team.
4. Have an assigned Worker cancel a role. Confirm the Manager receives a worker-cancelled notification and tapping it opens the affected event.
5. Put a Worker on a waitlist, offer the available role, and have the Worker accept. Confirm the Manager receives the waitlist-accepted notification with the correct names.
6. Trigger a behind-schedule task alert. Confirm the Manager notification identifies the event, role, and task and opens the event.
7. Send the Manager a direct or group chat message from the Worker. Confirm tapping opens the exact chat thread.

## Routing, badge, and duplicate checks

1. Tap every notification type from the lock screen, Notification Centre, and a banner.
2. Confirm event notifications open the correct event and chat notifications open the correct thread.
3. Confirm a cold-start tap works when Dispatch was force-quit.
4. Confirm opening or reading an alert clears its app badge and removes the scheduled notification where expected.
5. Confirm marking an in-app notification read does not produce it again.
6. Confirm the same Firestore notification creates at most one iOS alert per device.
7. Sign out and sign in as the other role. Confirm notifications from the previous account no longer appear.

## Release pass criteria

1. All critical Manager and Worker tests pass with the app open and backgrounded.
2. Remote alerts that are expected while force-quit arrive and route correctly.
3. Notification text never exposes the wrong organization, event, role, Worker, or chat.
4. No duplicate alerts occur, and badges clear consistently.
5. Denied permission and later re-enablement behave cleanly.

## Known implementation check

Dispatch currently registers and stores Expo push tokens, but this repository does not contain a server-side Expo Push sender. Firestore listeners schedule several alerts locally after the app receives data. If background or force-quit delivery fails, implement or verify a trusted backend sender that sends through Expo Push using the saved tokens; do not treat foreground-only local delivery as a completed push setup.
