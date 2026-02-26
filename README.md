# Dispatch (Expo + Firebase)

Dispatch helps **Managers** assign event roles/tasks to **Workers**, track progress during events, and coordinate through teams/chats.

## Implemented foundation

- Role-based onboarding (`Manager` or `Worker`)
- Upcoming Events screen (vertical list)
- Today's Events screen with expandable task checklist
- Teams & Chat placeholder screen wired for team data
- Event detail modal (roles, assignments, tasks)
- Firebase integration scaffolding (Auth + Firestore)
- Real-time listeners for events/teams via Firestore snapshots

## Stack

- Expo Router (React Native / Expo Go)
- TypeScript
- Firebase
  - Firestore (events, teams, templates, invitations)
  - Auth (ready; currently local role profile bootstrap)

## Run

1. Copy `.env.example` to `.env`
2. Fill Firebase values
3. Install and run:

```bash
npm install
npx expo start
```

## Suggested Firestore collections

- `users/{uid}`
- `teams/{teamId}`
- `events/{eventId}`
- `roleTemplates/{templateId}`
- `taskTemplates/{templateId}`
- `invitations/{inviteId}`
- `eventChats/{eventId}/messages/{messageId}`

## Next build steps

1. Manager event creation/edit flow
2. Team invite flow (email/invite code)
3. Role + Task templates editor
4. Open role self-assignment by workers
5. Task completion persistence + manager real-time alerts
6. Push notifications for event start / behind-schedule tasks
7. In-app team/event chat
