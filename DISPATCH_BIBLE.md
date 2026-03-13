# DISPATCH_BIBLE.md

## Clean Up

- (new) Adding a task to an Event Template: time offset should be a time picker (hhmmss).
- (new) Selecting a date or time in the date/time picker should close the picker.
- (new) Create Template default time should be a time picker.
- (new) Keyboard aware behavior for Create Template and Create Event pushes the form too high / leaves too much margin above keyboard.
- (new) Create Template photo/document attachments should open photo library or upload attachments (not URLs).
- (new) Worker Today tasks should show task description; if photos/attachments exist, show icons and open asset on click. Remove “Not Completed Yet”, “Assigned To You”, and “Tap to Check off”.

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

## Team Screen

- Workers and Managers should see list of teams.
- Team tap behavior: if team has >1 other member, open member list + “All”; if only one other member, open direct chat immediately.
- Manager sees + button to open drawer for add teams/invite workers.
- Chat screen should resemble WhatsApp/Telegram (bottom input + chat bubbles).
- New chat notifications should show unread count on Teams tab title and per-team card.
- Add Member drawer should allow invite by email.
- Invite button should send email with app download link; after signup/sign-in user auto-connects to manager chat.
- Chat options should include attachments, emojis, talk-to-text.
- (new) Inviting a Worker should support Solo option (no team). Solo workers appear outside teams on Teams screen; tapping name opens direct manager-worker chat.

## Profile Screen

- Manager should get notification (and Profile chip count) when Worker accepts/declines invite.
- Push notifications for new messages/notifications should deep-link to appropriate screen.

## Engineering Workflow Rules

- For each task: branch -> code -> test -> merge to `master` -> push.
- Do not open PRs unless Steve explicitly asks; default is direct merge to `master` after tests pass.
- Agent orchestration default: use non-threaded subagent runs on Telegram (`thread:false`), since thread-bound spawn hooks are unavailable in this channel runtime.
