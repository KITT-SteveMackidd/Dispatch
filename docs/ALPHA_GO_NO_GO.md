# Dispatch Alpha Go/No-Go Checklist

Last updated: 2026-03-13

## P0 Blockers (must-have before Alpha)

- [~] **Push notifications (device-level) fully validated**
  - [x] Permission prompt + denied-state warning UX added
  - [x] Push token registration persisted to user profile
  - [x] Chat push deep-link routing upgraded (thread-aware)
  - [x] Role/task notification route mapping in place (event/profile)
  - [ ] Device QA for badge count behavior on iOS/Android

- [~] **Chat media + voice are functional (not placeholder text)**
  - [x] Image attachment upload + send
  - [x] File attachment upload + send
  - [x] Voice note capture + send
  - [x] Composer UX for upload errors/retry
  - [ ] Cross-device attachment rendering QA

- [~] **Invite flow reliability + observability**
  - [x] Invite delivery states visible in Teams screen
  - [x] Retry action added for failed invites
  - [ ] Sign-in auto-link flow verified across edge cases

- [~] **Test/quality safety net in place**
  - [x] Typecheck script
  - [x] Unit tests for critical event/task logic
  - [x] CI command for local pre-release checks

- [~] **Role assignment acceptance edge cases validated**
  - [x] Competing invites race handling implemented + covered in QA script
  - [ ] Multi-device stale state behavior (manual device QA required)
  - [ ] Role removal/decline reconciliation (manual device QA required)

## P1 (strongly recommended for Alpha)

- [ ] Deep links from notifications for all relevant destinations
- [ ] Basic analytics events for activation funnel
- [ ] Error logging baseline (Sentry or equivalent)
- [ ] Seeded QA test accounts and test script

## Exit Criteria

Alpha is **GO** when all P0 checkboxes are complete and pass manual QA on at least one iOS and one Android device.
