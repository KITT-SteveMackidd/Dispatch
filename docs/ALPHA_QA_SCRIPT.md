# Dispatch Alpha QA Script (P0 Focus)

## 1) Push notification routing

### Chat routing
1. User A sends DM to User B.
2. On User B device, tap push notification.
3. Verify app opens to the correct chat thread.

### Team broadcast routing
1. Send team broadcast message (`All`) to a team.
2. Tap push notification on recipient device.
3. Verify app opens team broadcast chat (`All`) not DM.

### Role/task notification routing
1. Trigger role invite response or behind-schedule notification.
2. Tap push notification.
3. Verify route:
   - event-linked notification -> event details
   - generic user notification -> profile notifications screen

## 2) Invite reliability + retry

1. Send invite using invalid delivery endpoint config (or force failure).
2. Verify invite appears in Teams > Recent Worker Invites with `send_failed`.
3. Press Retry.
4. Verify status changes to `sent` or `queued` and reason updates.

## 3) Role assignment race conditions

1. Manager invites two workers to same role.
2. Worker A accepts first.
3. Verify competing pending invite for Worker B is auto-declined.
4. Verify manager today/events UI reflects accepted assignee only.

## 4) Stale-state behavior

1. Keep manager and worker on separate devices open to event view.
2. Worker completes task and toggles back/unback quickly.
3. Verify manager progress and worker checklist converge consistently.

## 5) Chat attachments

1. Send image, file, and voice note in DM and team broadcast.
2. Verify recipients can tap and open all attachment links.
3. Verify failed upload shows error and does not create blank message.
