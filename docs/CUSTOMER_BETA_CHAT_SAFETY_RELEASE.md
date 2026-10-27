# Android and iOS chat-safety beta candidate

Requested October 27, 2026, after the owner confirmed the local flow works.

## Source and release boundary

Release branch: `release/customer-beta-chat-safety`, based on customer-beta commit `7254161`. Freshly fetched `origin/master` (`606ca7f`) is already an ancestor. Do not push master: its GitHub workflow publishes production OTA updates.

This candidate includes chat blocking, private reporting, human moderation, Manager review alerts and pending-count chips, the universal three-dot chat menu, restored auth fonts/Google artwork, and the event-card styling fix. Android and iOS customer profiles must both use the existing `dispatch-eb63a` backend and `@smackidd/dispatch` project, with payments and OTA disabled. Local RevenueCat/emulator credentials must stay excluded from EAS archives.

An EAS artifact is a draft candidate, not proof that hosted safety is active. The old Android version-code-4 artifact does not contain these changes. Do not submit or distribute a replacement as safety-enabled until the hosted gates below pass.

## Hosted gates

1. Deploy a separately reviewed compatibility rollout for the existing Dispatch backend. Its current backend predates subscriptions and safety. The branch's full Functions/Firestore rules would introduce billing requirements for ordinary users and must not be deployed wholesale.
2. Route enabled organizations' web chat through the same consent, block, suspension, upload and moderation checks. The existing web REST client forwards the user's Firebase token and obeys rules, but writes messages directly; enabling the new rules would block those sends until the web workflow is migrated or explicitly gated.
3. Confirm events have valid `organizationId` references; the corrected mobile queries require organization-scoped records. Read-only October 27 inventory passed: all 57 events reference existing organizations, with zero records requiring migration. No hosted records were changed.
4. Verify supported clients, compatible Functions, Firestore/Storage rules and indexes together, then atomically enable both server-owned organization safety projections for the intended beta organizations. Old direct-write clients are incompatible with enabled safety.
5. Verify Manager and Worker store installs, review alerts and real-device push; identify a human escalation reviewer and confirm privacy/help disclosures. Local emulator tests deliberately do not send external pushes.

Read-only hosted audit on October 27 found 23 existing Functions, no new safety endpoints, and unchanged prebilling Firestore/Storage rules. All 11 existing organizations have safety disabled; nine teams exist. The compatibility rollout also needs prebilling account-deletion cleanup (without requiring RevenueCat) and trusted team-chat synchronization: both clients currently write team chat membership directly, which enabled safety rules reject. These are real release gates, not checks satisfied by producing a binary. A subsequent compatibility fix that changes the client will require replacement artifacts.

No production backend, safety flag, web deployment or store distribution is part of the source integration itself.

## Build and validation

`npm run check` passes SDK58/dependency checks, TypeScript and all 374 mobile tests. `npm --prefix functions run check` passes all 250 backend tests. The isolated existing-backend worker suite passes 9 scenarios. Both `npm run android:customer:check` and `npm run ios:customer:check` validate the payment-free configuration. Local safety emulator evidence is recorded in `CHAT_SAFETY.md`; it is not hosted acceptance.

The iOS profile is `ios-customer-beta`, with store distribution and App Store Connect ID `6799206233`. The generic `beta` profile has different payment/backend requirements and must not be used for this customer release.

Run from this checkout, setting the selected profile before EAS resolves Expo configuration:

```powershell
$candidateProfile = 'ios-customer-beta' # or android-customer-beta
$candidatePlatform = 'ios' # or android
$candidateEnvironment = (Get-Content eas.json -Raw | ConvertFrom-Json).build.$candidateProfile.env
$candidateEnvironment.PSObject.Properties | ForEach-Object { [Environment]::SetEnvironmentVariable($_.Name, $_.Value, 'Process') }
$env:EAS_BUILD_PROFILE = $candidateProfile
$env:EAS_BUILD_PLATFORM = $candidatePlatform
eas build --platform $candidatePlatform --profile $candidateProfile --non-interactive --no-wait
```

Do not add `--auto-submit`. Record each artifact's commit, version, build ID and validation before any later store submission.

## Candidate artifacts

Both builds use source commit `e8532202975433e6cba832863fdae94d95085fd0`, pushed to the dedicated release branch. Any subsequent documentation-only commit does not change that artifact source.

| Platform | Version | Build | Result |
| --- | --- | --- | --- |
| Android | 1.0.0 / code 5 | `ab956a03-94db-4f33-b95b-66f729d1e86e` | Finished; package inspected; hold distribution |
| iOS | 1.0.0 / build 31 | `fef2178d-2586-406c-a293-59430c7da555` | Finished; package inspected; hold distribution |

Android SHA256: `ec65afb07b50de80b5921e0ddc2f9a47be675739ef941ffc22fefe47608f3362`. Bundletool validation and JAR signature verification pass; the upload certificate matches the previous verified customer artifact (`B7:2E:7A:C3:88:53:3D:F3:4E:A6:0E:F2:01:EF:38:D6:C3:76:29:C6:06:09:2F:91:B5:04:29:95:53:A9:1A:CA`). Native Firebase resources match the existing Dispatch Android application. Manifest version/package, native and embedded OTA disabled, SDK58, customer mode, original Expo identity and compiled Firebase values pass; neither actual local emulator-host/Test Store-key value appears in the inspected compiled payload/config. Google Play acceptance and installation remain untested.

iOS SHA256: `5084662bf2afbdb51461588fbdd584d250b6350e4f0ca78992f064205c671eff`. The IPA identifies `com.smackidd.dispatch`, SDK58, customer mode, existing Dispatch backend and Expo project, native and embedded OTA disabled. The compiled bundle contains the expected hosted Firebase configuration and neither of the actual local emulator-host/Test Store-key values. Its provisioning CMS signature verifies; the store profile has push and Sign in with Apple entitlements, no device allowlist and no debugging entitlement. Windows inspection does not verify the complete Apple Mach-O code signature. TestFlight acceptance and installation are still untested.

Both EAS uploads excluded local credentials/data and backend sources. No backend deployment, feature-flag activation, store submission or production OTA occurred.

## Google Play questionnaire for the enabled replacement beta

| Question | Answer | Reason |
| --- | --- | --- |
| Shared user-generated content is the primary source of content | Yes | Shared events, messages and attachments are created by organization members; they are not a publisher-supplied content catalogue. |
| Permits public sharing of nudity | No | No public content-sharing feed; the chat rules prohibit sexual content. |
| Permits public sharing of real-world graphic violence outside news | No | Dispatch has no public content-sharing feed; conversations are restricted to authorized participants. |
| Ability to block users or user-generated content | Yes | Private block/unblock, reciprocal direct-contact restrictions and hidden shared-chat content. |
| Ability to report users or user-generated content | Yes | Person and message reports with private evidence and status. |
| Includes chat moderation | Yes | Authorized humans can review, remove content, restrict/restore chat, or dismiss reports. This is not automatic content detection. |
| Interactions can be limited to invited friends only | Yes | Interactions are restricted to invited organization members and authorized conversation participants; there is no public stranger chat. |

The preceding question about native user interaction is also **Yes**. These are recommendations for the replacement build with hosted safety enabled, not a claim about the previous artifact or flags-off hosted app. Do not submit the three safety answers as present functionality until the release gates pass.

Google's definition includes content created by one user and shared with others, while excluding private notes created only for oneself: [Focus on User-Generated Content Sharing](https://support.google.com/googleplay/android-developer/answer/12994051?hl=en). Also see [User Content](https://support.google.com/googleplay/android-developer/answer/11070862?hl=en) and [UGC moderation requirements](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en).
