# DISPATCH_BIBLE.md

## Clean Up

Team invites needs your response Accept / Decline buttons. Decline should have the same white background as the card it sits on. The Accept button should be the same default orange as on the Events invite notification card.

(new) When push notifications are seen, then the app should stop pushing the notifications

## Today Screen

- A Manager should see all the events delegated to Freelancers/Volunteers (Workers).

- Each event should show title, location, time, and a progress bar/pomodoro graph for completed tasks out of total.

- Manager event expand should show each Worker (phone, role), task progress, and optional time left for next task; tapping Worker avatar opens chat with that Worker.

- A Worker should see event title, location, time, Manager details (phone), next task, and optional time left.

- Worker event expand should show checklist of event tasks.

- Only events occurring on today’s date should be shown on Today screen.

- Events occurring today should show a countdown clock to expected completion of the next task.

- A Worker can check off a task.

- Checked tasks should advance Manager progress bar.

- When tasks are behind schedule, notify Manager and show number chip on Manager Today event.

- Tapping avatar on Today Event Role card should navigate to existing Team-screen chat conversation.

- Worker Today event card should show Manager avatar instead of “Assigned by”; tapping avatar opens existing Team-screen chat.

(new) On an Event card on the Today screen, there should be a map icon beside the Location that brings up a popup of mapping apps to select from

## Events Screen

- A Manager can see all assigned events.

- Each event should show title, location, time, and worker signup ratio (# signed up / # roles).

- Manager event expand should show role overview.

- Each role should show task count, assigned worker avatar, and replace/invite options; empty roles should allow invite.

- Top-level + button should open create-event drawer.

- Create Event should have template dropdown.

- Create Event should have + button to create a new template.

- Create Event should allow manager to edit/delete template permanently.

- Create Event should allow date/time, location, description input.

- Once template is added, manager should see empty roles needed for event.

- Role row should include empty avatar button to assign worker; selected worker fills avatar.

- Assign/remove worker from role should notify worker to accept/decline.

- Manager can expand role to view tasks.

- Manager can use avatar button to reassign/remove worker.

- Template model should include worker count, roles, tasks, and expected completion offset from event start. Template create/edit should be in a drawer accessible from Create Event or Profile.

- Template editor should allow add/update/delete roles.

- Template editor should allow add/update/delete tasks per role.

- Template may include optional location/time/description defaults that autofill Event fields.

- Event can be deleted by swipe-left.

- Event templates should be stored in DB.

- Events should be sorted by date/time.

- Manager can invite many workers to a role; invite drawer should list all teams.

- Team expansion in invite drawer shows member checkboxes + “All” option.

- Team card in invite drawer should show selected/total count.

- Invite action should notify all selected workers.

- When one worker accepts a role, competing role invites for others should be removed.

- Worker should see all assigned events.

- Worker event cards should show title/location/time and assigning Manager.

- Worker can expand event to see task list.

Worker Events screen invite card, the default border should be around the Accept button instead of the Decline button.

when a worker is removed from an invite, an invite notification is sent to the worker to accept or decline. Instead, a notification should be sent to their notifications in their profile that just says you have been removed from a role.

a worker should be able to uninvite themselves from an event, sending a notification to the manager.

worker can add themselves to a role in a queue as a backup.

(new) In Create Template and Create Event drawers, the Location field should have an autocomplete dropdown of Locations from Google.

(new) On the Event card, there should be a map Icon beside the Location that bring up a poppup to select mapping apps that are located on the user's phone.

(new) When a role has been taken by another worker, change the invite card from Cancel / Accept to Cancel / Waitlist which gives other workers the option to join a waitlist for the role with a queue based on first come-first serve clicks of the Waitlist button.

(new) Give a worker the option to cancel their role.

(new) When a worker cancels their role, invite the next worker on the waitlist to take the role over.

(new) each role in an event card on the Managers side should have a trash can icon that gives the Manager the ability to delete a role

(new) each role in an event card on the Managers side should have an edit icon that opens up the role in a drawer to edit the role.

(new) When an Event is added to a user's Event screen, add a popup that prompts the user to add the event date / time / location to a calendar on their device.

## Team Screen

- Workers and Managers should see list of teams.

- Team tap behavior: if team has >1 other member, open member list + “All”; if only one other member, open direct chat immediately.

- Manager sees + button to open drawer for add teams/invite workers.

- Chat screen should resemble WhatsApp/Telegram (bottom input + chat bubbles).

- New chat notifications should show unread count on Teams tab title and per-team card.

- Add Member drawer should allow invite by email.

- Invite button should send email with app download link; after signup/sign-in user auto-connects to manager chat.

- Chat options should include attachments, emojis, talk-to-text.

- Inviting a Worker should support Solo option (no team). Solo workers appear outside teams on Teams screen; tapping name opens direct manager-worker chat.

chat bubble needs name of sender if in the Team chat rather than the individual chat.

invite flow, if the worker bypasses, accepting the invite through email and just downloads the app and creates an account on their own, they should receive a notifications saying they have been invited by the manager when they first enter the app after account creation.

 the email request that the worker receives should include wording that invites the user to download the Dispatch app from the Apple Store or Google Play if they don't have the app yet.

-Workers should be able to add individual team members to a separate chat.

(new) when you click on a Team to show the multiple Chat cards, each card should show the latest message that was sent, who sent it and what time it was sent. Remove the phone number from the card.

(new) When a user sends a message in a group chat, Their name should appear at the top. If the bubble is Teal, the Name should be black. If the bubble is grey, then the Name should be Teal.

(new) When a team is clicked, the Members screen should have a + button at the top which opens up a drawer to create a new chat. The drawer should have a Chat name and a list of team members (with Avatars) with select boxes where multiple members can be selected to be added to the chat. A select all option should also be listed in the members list.

## Profile Screen

- Manager should get notification (and Profile chip count) when Worker accepts/declines invite.

- Push notifications for new messages/notifications should deep-link to appropriate screen.

Add update profile with option to add phone number and select between Manager or Worker
