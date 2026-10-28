# Android customer beta using existing Dispatch

Current owner direction (October 26, 2026): **use the existing Firebase project `dispatch-eb63a` and existing Expo project `@smackidd/dispatch`**. Customer beta users share accounts and organizations with the web app. Subscription QA stays local in Expo Go with RevenueCat Test Store and `demo-dispatch-billing` emulators.

| Build | Backend | Payments | Distribution |
| --- | --- | --- | --- |
| `android-customer-beta` | Existing `dispatch-eb63a`; Functions in `us-central1` | Checkout, restore and billing controls disabled | Google Play Internal testing (`internal`), initially draft |
| Local subscription QA | Existing isolated emulators | RevenueCat Test Store | Expo Go only |
| `android-billing-qa` | Future dedicated backend, not provisioned | Native sandbox prerequisites still missing | Prepared profile only; do not build/upload now |

The customer profile uses `com.smackidd.dispatch`, SDK58, the existing Android signing key and FCM credentials. OTA updates are disabled. No new service-account key or push credential upload is needed. The profile explicitly supplies the verified Firebase Web configuration; the shared EAS preview environment has an outdated Web App ID and must not be relied upon for that value.

## Existing backend compatibility

Read-only inspection on October 26 confirmed the existing backend predates subscription enforcement. Its Firestore rules match `origin/master` at `606ca7f`; no billing/seat restrictions or RevenueCat endpoints are deployed. Do not deploy the subscription branch's Functions or rules wholesale to this project: doing so would change access for existing organizations.

The customer app sets `dispatchBetaMode=customer_beta` and `dispatchBetaBackend=existing_dispatch`. These select compatible client behavior and hide payments; they do not grant server permissions. Ordinary organization and role rules remain authoritative.

- Worker actions use the retained Firestore transaction workflows supported by the existing rules, with caller, organization and role checks.
- Verification emails and secure invitation create/get/claim use existing Dispatch endpoints and email delivery.
- Organization member removal, pending-invitation list/cancel, and automatic legacy invitation adoption are unavailable in this build because those endpoints are not deployed. Unsupported controls are not mounted and helper calls fail locally. Secure invitation links and codes remain supported.
- Account deletion uses the existing endpoint and its existing behavior. Do not promise the newer orphaned-organization recovery behavior without a separately reviewed backend rollout.
- Google sign-in is configured for Android starting with the October 28 replacement candidate. The existing Firebase Google provider is enabled; the verified Play app-signing SHA-1 is registered on `com.smackidd.dispatch`. The selected services file must contain the matching Android and Web OAuth clients, or the build fails. Google Places and iOS Google sign-in remain disabled. Expo Go continues to show the native-sign-in explanation; use a Play-installed Android build for Google authentication testing.
- The October 27 local auth restoration loads bundled Inter fonts before rendering, with timeout/retry recovery. It also restores the SDK 58 script/style injection required by the Expo browser preview. The previously built version-code-4 AAB does not contain these changes; build and verify a new artifact before uploading this candidate.
- The October 27 local event-card fix hides Edit/Delete action backgrounds at zero swipe progress on Events and Today, restoring the prior rounded-card appearance while retaining swipe actions. Expo's required SDK 58 patch versions are installed (Expo58.0.20, AuthSession58.0.15, FileSystem58.0.12, Router58.0.27, WebBrowser58.0.7); the confirmed device requirement remains SDK58.

Local emulator/Test Store QA keeps the newer subscription workflows. The shared Firebase project must never receive Test Store keys, emulator hosts, or a sandbox receipt environment.

## Validate and build

Run from the subscription worktree:

```powershell
Set-Location 'C:\Users\steve\OneDrive\Documents\My Projects\Codex Projects\Dispatch\worktrees\organization-subscriptions-revenuecat'
npm run check
npm --prefix functions run check
npm run android:customer:check
npm run test:existing-customer-workers
```

The existing-backend worker integration suite uses a snapshot of the live rules and isolated local emulator ports. Physical-device checks and actual email delivery remain separate from automated tests. Preserve the installed physical-iPhone Expo Go SDK58 check for local QA.

```powershell
$env:EXPO_NO_DOTENV = '1'
$env:EAS_BUILD_PROFILE = 'android-customer-beta'
$customerProfile = (Get-Content eas.json -Raw | ConvertFrom-Json).build.'android-customer-beta'.env
$customerProfile.PSObject.Properties | ForEach-Object { [Environment]::SetEnvironmentVariable($_.Name, $_.Value, 'Process') }
npx eas-cli@latest build --platform android --profile android-customer-beta
```

The profile uses the repository's refreshed `google-services.json` unless `GOOGLE_SERVICES_JSON` explicitly selects an EAS file. October 28 inspection found no project-scoped preview variable with that name. Any override must pass the same Google client and Play certificate checks. Build guards also check Firebase project number, Android package, no RevenueCat keys, disabled emulators, and disabled dotenv loading. Record the exact commit, build ID, version code and signing certificate.

The owner requested internal testing on October 28; the customer submit profile now targets `internal` with draft status. Upload only the specific verified build, not `--latest`. EAS Submit requires an app-authorized service account, or use a manual Console upload. Do not change signing keys or promote this candidate to closed/production testing as part of the Google sign-in task.

```powershell
npx eas-cli@latest submit --platform android --profile android-customer-beta --id VERIFIED_BUILD_ID
```

Keep the release as a draft until installation, sign-in, invitations, worker actions, chat/attachments and push notifications are checked on an Android device. Do not merge to master for release: master pushes automatically publish production OTA updates.

## Superseded setup

Under earlier approval, `dispatch-customer-beta` and `@smackidd/dispatch-customer-beta` were created. After the owner chose the existing project instead, build `b790c923-d2c0-4eef-a361-6a965c4602c9` was cancelled and all nine synthetic accounts and their recorded data were removed. No AAB was uploaded to Google Play. Those unused cloud projects/resources have not been deleted; cleanup requires the owner's explicit approval.

Firebase source packaging has separate exclusions from Git/EAS. `firebase.json` now excludes `.env`, `.env.*`, `.secret*`, dependencies and tests; a backend regression test checks the CLI's actual file enumerator. These protections apply to any later authorized backend deployment.
