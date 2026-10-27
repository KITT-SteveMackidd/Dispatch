# Local chat safety

Work items: DSP-127 (blocking and rules), DSP-128 (reporting), DSP-129 (moderation), DSP-130 (review notifications and conversation menus).

This work is local. It has not changed the hosted customer beta, Google Play, Apple, or production. Use only the synthetic accounts in the Firebase emulators when evaluating it.

## Intended workflow

- Open the three-dot menu > Chat safety in any conversation to block or report a participant. The shield appears inside that menu for both Workers and Managers; custom-chat rename/leave controls remain in the same menu. Blocking is private: direct messages stop in both directions, and the blocking person no longer sees that participant's shared-chat messages or notifications. It does not remove either person from an organization, team, event, or assignment. Unblock from the conversation or Profile > Chat safety.
- Read and explicitly accept the versioned chat rules before sending a message or uploading a chat attachment. Reading conversations and using safety controls do not require accepting the rules.
- Report a message or participant with a reason and optional context. Reports are private to their author and authorized reviewers; the reported person cannot access the report.
- Authorized Managers review their organization's reports. A reviewer cannot handle a report about themselves or their own report. A Dispatch moderator can handle conflicted or escalated cases. Reviewers can remove inappropriate content, restrict chat access, restore access, or dismiss a report. Every decision is recorded.
- A new report creates a generic in-app notification for each eligible, unconflicted organization Manager. The Profile Chat safety card shows the number of reports still awaiting action (zero is hidden; values above 99 display as `99+`). Reading an alert does not clear that count. Resolving or dismissing a report reduces it; unfinished attachment cleanup remains pending. Notification taps open the authorized review queue, and alerts contain no reporter names, reported-person names, message text, or private report IDs.
- Moderation is a human review process. These controls do not claim automatic detection of harmful content. A real reviewer, response process, support contact and current privacy disclosures are required before release.
- Chat restrictions belong to the organization in the report. Moving to another organization does not carry that organization's restriction into the new one; returning to the original organization re-applies its still-active restriction. Each organization keeps its own review authority and restoration record.

## Local preview

The preview uses the existing `demo-dispatch-billing` Auth, Firestore, Functions and Storage emulators. The safety fixture is additive and create-only; it never resets billing fixtures or writes to a hosted Firebase project. The customer preview on port 8085 uses a different backend and must not be used for these mutations.

Review alerts use the existing in-app notification and native push pipeline. In this emulator preview, in-app alerts and badges are testable, while outbound Expo push is deliberately skipped. Lock-screen delivery must be checked separately in an installed test build with real device registration after an authorized hosted rollout.

Run `scripts/seed-chat-safety-test.ps1` with a new run ID, then `scripts/start-chat-safety-expo.ps1`. The preview listens on port 8086. Private local fixture credentials are written under the ignored `.local-data/chat-safety/` folder. Do not publish that folder.

The phone-review launcher defaults to Expo CI mode, which disables Metro file watching and Fast Refresh. This prevents the Windows/OneDrive `EMFILE` crash that stopped port 8086 after the first handoff. Restart this launcher after local source changes and rerun `expo:compatibility` against the served manifest/bundle before handing over an updated preview. Use `-Watch` only for an intentional live-edit session; it opts back into file watching. This setting is process-local and does not affect other preview servers.

`scripts/check-chat-safety-local.ps1` runs authenticated server and rules checks against a dedicated local fixture. Use a separate fixture for manual review so automated blocking and moderation changes do not disturb an open test session.

## Activation boundary

The server-owned `chatSafetyEnabled` flag on an organization and its matching `organizationBilling` document must be changed atomically in the same batch. The server rejects inconsistent projections. Clients cannot set either flag. This projection lets Storage rules enforce the legacy-upload restriction within Firebase's document-access limits.

The existing dedicated `dispatch-customer-beta` project is deliberately unsupported by this activation path; its Storage policy would need a separate reviewed projection before enabling safety there. This does not affect the requested existing Dispatch backend.

Do not enable the feature on a hosted organization until its callable functions, Firestore and Storage rules, web chat send path, and updated mobile app have been deployed and verified together. Old direct Firestore chat writes are denied for enabled organizations. The Google Play questionnaire must describe the uploaded build, not these local files.

## Rules and evidence

Rules version: `2026-10-27`. Consent, blocks, suspensions, upload grants and report evidence are server-owned. Direct message writes and forged previews cannot bypass the enabled safety workflow. Secure uploads require current consent and a short-lived grant tied to the sender, thread, filename, MIME type and size. Sending validates the stored object and download token.

Policy references: [Google Play user-generated content](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en) and [implementation guidance](https://support.google.com/googleplay/android-developer/answer/12923286?hl=en).

## Reviewer workflow

1. An authorized Manager taps the review notification, or opens Profile > Chat safety > Review chat reports. The numbered Profile chip reflects pending review work. A report involving that reviewer is excluded. Another unconflicted Manager or a separately authorized Dispatch moderator must handle it.
2. Open a report and read its reason, the reporter's explanation and the server-captured evidence. Open an attachment only when needed to assess it; media does not load automatically in the queue.
3. Select an available action, enter a private review note and confirm. Dismissal closes the concern without a penalty. Removing a message clears its public text, attachment references and affected chat preview. Chat restriction prevents posting/uploading and other chat authoring, while retaining work access and reporting.
4. If attachment cleanup is pending, retry removal. A report is not resolved until app-owned attachment cleanup succeeds. The server verifies both object absence and loss of access through its old download URL. External references are removed from the conversation without claiming deletion of someone else's hosted file; unverifiable potentially owned files remain pending. Restoring access must refer to the current restriction; an old report cannot replace or undo a newer restriction.
5. The reporter sees a status and a generic outcome in Your reports. The target does not receive the report or the reviewer's private note. Account deletion cleans up ordinary reports and safety records. A minimal anonymized record remains while an enforcement action or attachment cleanup is active, so deleting a reporter cannot strand another person's restriction. Deleting the target clears their restriction records. This local implementation does not retain binary copies of removed attachments.

Before hosted activation, name the people responsible for checking the queue and handling escalations, set a response schedule and retention policy, and update the privacy/help information. The local operator fixture demonstrates privileged review; it does not grant any real account that permission.

## Verification recorded during implementation

- DSP-130: 360 mobile tests, 250 backend tests, 14 notification/count/fence/cleanup emulator scenarios and independent review passed. Browser confirmed live badge creation, generic alert, notification-to-queue routing, unchanged count after reading, count clearing after dismissal, and three-dot safety menus across chat kinds and roles. Final served SDK 58 iOS bundle passed at 16,829,967 bytes on port 8086. The automated fixture is `notify-oct27a`; browser fixture is `ui-notify-oct27a`; neither changes the phone fixture.
- DSP-127: 218 backend tests and 26 emulator scenarios covering blocks, consent, secure uploads, queries and authoring guards passed. Browser acceptance and blocked-message hiding passed.
- DSP-128: 227 backend tests and 15 reporting scenarios passed. Browser verified a report while blocked, confirmation and private status history.
- A real worker session exposed older event-query authorization problems. Current event listeners now use the organization scope; four dedicated emulator query tests passed. Legacy records missing an organization need migration before appearing in those lists. No hosted records were migrated.
- DSP-129: the final backend suite passed 240 tests, including independent organization restrictions, conflict checks, evidence access, private audit records, deletion retention and restoration. Its final 25 emulator scenarios passed: 12 moderation, 6 organization-scope/real-Storage and 7 account-data-cleanup scenarios. Final evidence files are `.local-data/chat-safety/safety-mod-oct27d-moderation-results.json`, `safety-scope-oct27b-scope-results.json` and `safety-mod-oct27d-moderation-cleanup-results.json`. Earlier exploratory failures are preserved separately and are not counted as passing evidence. Across the three work items, 66 selected emulator scenarios and 4 harness-isolation checks passed.
- Browser review confirmed rules acceptance, block/unblock, person and message reporting, detail persistence, reviewer evidence, chat restriction/restoration, message removal visible to the participant, and dismissal without a penalty.
- The mobile suite passed all 352 tests, TypeScript and Expo dependency validation. The exact local server on port 8086 passed its SDK 58 manifest and iOS bundle check (16,821,722-byte bundle) after excluding backend dependencies, ignored local files and emulator exports from Metro. Physical iPhone interaction and native notification delivery remain unverified.

The public account-deletion callable includes RevenueCat verification. Local safety tests exercise the deletion library against synthetic emulator data; they do not contact RevenueCat or establish provider-connected account deletion.

Fresh physical-device test instructions and synthetic credentials are in the ignored `.local-data/chat-safety/START_HERE.md`; the untouched `phone-oct27` fixture is separate from automated and browser fixtures. The verified local URL is `exp://192.168.1.45:8086` on the same trusted Wi-Fi. Google Play's currently uploaded build has not changed.
