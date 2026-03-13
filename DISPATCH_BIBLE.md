# DISPATCH_BIBLE.md

## Clean Up

- (new) When a Worker looks at their Event tasks on the Today screen, it should only show the tasks assigned to the role they accepted.
- (new) If a role has not been filled for an event, exclude those tasks from the progress bar the Manager sees on the Today screen

## Today Screen

- A Manager should see all the events that they have delegated out to Freelancers or Volunteers (Worker)
- On each event there should be the title, location and time, a progress bar or pomodoro graph for how many tasks have been achieved out of the total tasks
- When the Manager clicks on the event, a hidden card appears that shows an overview of each Worker (phone number, role) and their task progress and how much time is left to complete their next task (optional if Manager assigned time limits to tasks). A click on the Worker Avatar will take the Manager to the chat screen with that Avatar.
- A Worker should see their event, which includes title, a location and time, details of Manager who assigned the event (phone), next task and how much time is left to complete the task (optional).
- When the worker clicks on the event, a hidden card opens up that shows a checklist of tasks to complete for the event.
- Only Events that occur on Today’s date should be shown on the Today screen.
- An Event that occurs Today should contain a countdown clock to the time to expected to complete the next task.
- A Worker can check off a task.
- Checked tasks advance the progress bar on the Manager’s screen
- When tasks go behind schedule, a notification is sent to the Manager with a number chip on the event on the Manager’s Today screen.
- Clicking the avatar on the Today screen Event Role card should navigate to the Chat Conversation already in progress on the Team screen
- A Worker’s Event card on the Today screen should show the Manager’s avatar instead of Assigned by. Clicking the avatar should navigate to the Chat Conversation already in progress on the Team screen

## Events Screen

- A Manager can see all the events they have assigned to workers.
- On each event there should be a title, location and time, how many workers have signed up out of how many roles available.
- When the Manager clicks on the Event card, a hidden card opens up to show an overview of the roles for the event.
- Each role will show how many tasks are needed to complete, which worker has been assigned (avatar), the option to replace the worker by opening an invite drawer. If the role is empty, the option to invite new workers to take that role by opening an invite drawer.
- At the top of the screen, There should be a + button to add a new event which opens up a drawer.
- Create Event screen should have a dropdown list of event templates to choose from.
- The Create Event screen should have a + button to create a new template.
- The Create Event screen should allow the manager to edit or delete a template permanently
- The Create Event screen should allow a Manager to input the Date/time, location and description of an event.
- Once a template is added, a Manager should be able to see the empty roles needed for the Event.
- a Role in the Create Event, should contain an empty avatar button to see a list of Workers that a Manager can assign to that role. Once selected, the Worker will be added to that role and their avatar will fill the avatar button
- Assigning or removing a Worker from a role will send a notification to that Worker where they can accept or decline the role.
- The Manager can expand the role to see the tasks assigned.
- The Manager can hit the avatar button to re-assign the role or delete the Worker from the role.
- A template should contain the number of workers and their roles, and the tasks that need to be assigned to each role and how long from the start of the event it should take to complete the task. The create/edit template screen should be a new drawer and accessible from the Create Event screen or the Profile screen
- When creating or editing a template, the Manager should be able to add, update or delete roles.
- When creating or editing a template, the Manager should be able to click on a role and add, update or delete tasks.
- A Manager can optionally add a location, time or description to a template which will autofill the fields in the Event when a template is assigned to that event.
- An Event can be deleted by swiping left on the event
- Event Templates should be stored in the database.
- Events should be sorted by date and time.
- (new) A Manager can invite as many Workers to a role as they want. The Invite drawer should show a list of all teams.
- (new) When a Manager clicks on a team in the Invite Drawer, it expands so show every team member with a checkbox beside it. There will also be an ‘All’ option. A manager can check one, many or all checkboxes.
- The team card in the Invite Drawer should show how many members from the team have been selected out of all members.
- After the manager finishes selecting Workers from the checkboxes, when he clicks the Invite button, a notification is sent to all Workers who were selected.
- As Workers accept invites that are sent to them, notifications that were sent to other workers for the same role will be removed.
- A Worker will see all the events they have been assigned
- On each event there should be a title, location and time and the Manager that assigned the event to the Worker.
- The Worker can expand the card by clicking on it to see a list of tasks they will need to complete for the event.

## Team Screen

- Workers and Managers should be able to see a list of teams.
- When the user clicks on the team, if more than one member in that team other than the user, navigate to a list of members is shown and an additional member called ‘All’. The user can click on a member to see the chat. All will send a message to all members of the team. If there is only on member on that team besides the user, instead of seeing a list of users, navigate directly to the chat with that user.
- A Manager can see a + button at the top to open a drawer to add teams or invite new Workers to the app.
- chat screen should resemble a whatsapp or telegram chat screen with an input box at the bottom and chat bubbles
- notification system should be implemented when new chats are received. A number showing waiting chat messages should appear on the Teams title in the bottom tab navigator and if the chat is in a team a number should be shown on the team card
- the Add Member drawer should allow a manager to put in an email instead of a phone number.
- When the manager clicks the invite button, an email should be sent to that address with a link to download the app and when the new user signs in to the app, they should be automatically connected to the manager on the chat screen.
- Chat options should include all the options available in WhatsApp, including attachments, emojis and talk-to-text

## Profile Screen

- The Manager should receive a notification in their Notifications screen (with a notifications number chip on the Profile icon) when a Worker accepts/declines an invite
- Notifications should be pushed to a user’s phone if they receive a new message or new notification anywhere on the app. Clicking the phone notification should take them to the app and the appropriate screen

## Engineering Workflow Rules

- For each task: branch -> code -> test -> merge to `master` -> push.
- Do not open PRs unless Steve explicitly asks; default is direct merge to `master` after tests pass.
- Agent orchestration default: use non-threaded subagent runs on Telegram (`thread:false`), since thread-bound spawn hooks are unavailable in this channel runtime.
