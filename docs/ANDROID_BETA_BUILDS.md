# Android customer beta and subscription QA

Current approved scope: build the customer Android beta against its new hosted Firebase project. **Subscription QA stays local in Expo Go with Test Store and isolated emulators.** The future Android QA profile is prepared but is not provisioned, built or uploaded. Both Android profiles use package `com.smackidd.dispatch`, current SDK 58 source and disabled OTA updates.

| Purpose | EAS build/submit profile | Firebase project | Play track | Payment behavior |
| --- | --- | --- | --- | --- |
| Prospective customers | `android-customer-beta` | `dispatch-customer-beta` | Closed testing (`alpha`), initially draft | Complimentary access; no RevenueCat initialization, checkout, restore, billing transfers or subscription seat limits |
| Internal payment QA now | Local Expo Go billing harness | `demo-dispatch-billing` emulators | None | RevenueCat Test Store; no Apple/Google billing |
| Future native payment QA (deferred) | `android-billing-qa` | `dispatch-billing-qa` (not created) | Internal testing, initially draft | Native Google Play sandbox purchases through RevenueCat; every tester must be a license tester |

`dispatch-customer-beta` (project number `1092767164671`) was created October 26, 2026 with the user's approval and linked to the existing Dispatch billing account ending AF9103. Firestore, Storage and Functions use Montréal (`northamerica-northeast1`). Email/password authentication is enabled. Do not substitute the existing `dispatch-landing-beta`: it contains the landing-site waitlist. Do not overwrite the shared EAS preview environment's existing production Firebase variables.

Customer verification emails use Firebase Authentication's default project-hosted action handler, not the production website. Managers create invitations and use **Share invitation** or copy the code; no invitation emails are sent. Customer email reminders are disabled until a dedicated sender is configured. These limitations are explicit in the app. Push notifications need a matching FCM credential before device delivery can be verified.

The customer profile uses a separate Expo project, `@smackidd/dispatch-customer-beta` (`8ecbfda3-7884-434d-815a-90c8ca5dc253`), with the existing Android upload signing key. This isolates FCM credentials from production's `@smackidd/dispatch`. The first customer version code starts at least at 4, above the existing package's code 3; later releases must keep codes increasing across both Expo projects. The Android display name is **Dispatch Customer Beta**. Production website app links are excluded; beta invitations use the native `dispatch://invite/…` link or a pasted code.

## Customer access authority

Only trusted provisioning may write `dispatchConfig/billing` in `dispatch-customer-beta`:

```json
{ "mode": "customer_beta", "projectId": "dispatch-customer-beta" }
```

Clients cannot read or change this policy. Functions validate the runtime project and policy. Firestore and Storage validate the authenticated token audience and trusted policy. Missing or mismatched policy fails closed. The customer UI flag controls presentation only; it cannot grant backend access. Organization membership, manager permissions, deletion locks and tenant boundaries remain enforced.

The customer environment creates no paid entitlements. Its payment endpoints and RevenueCat webhook reject calls. Native payment secrets are unnecessary there. No subscription seat cap applies during this complimentary beta. Billing QA uses normal subscription capacity and sandbox receipt verification, with no customer policy document.

If the last Manager deletes their account, the organization remains read-only, including uploads. Account deletion writes trusted recovery markers to the organization, surviving profiles and chat threads. Support-led recovery must assign a valid Manager and clear those markers together; clients cannot clear them. Existing history and attachments remain readable.

## Hosted prerequisites

1. Customer provisioning is complete. A future hosted billing QA project requires renewed authorization; do not create it under the current scope. Never copy production users or customer data.
2. Register a Web Firebase app for the JavaScript SDK and an Android app with package `com.smackidd.dispatch` in each project. Configure the intended authentication providers. Register the Play App Signing certificate SHA fingerprints for Google sign-in; EAS upload-key fingerprints alone are not sufficient for a Play-installed app.
3. Deploy the matching Functions, Firestore/Storage rules and indexes only to the customer project. Do not deploy the production email extension configuration. Activate the trusted complimentary policy only in the customer project. Verify auth, invitation creation/acceptance, events, teams, attachments and account deletion against the hosted backend.
4. Replace `CONFIGURE_AFTER_PROVISIONING` placeholders in each `eas.json` profile with that project's authoritative **public** Firebase Web app configuration. Placeholders intentionally block builds; EAS does not accept empty environment strings. Optional Google sign-in and Places variables explicitly use `disabled` to prevent inheriting production credentials. Configure both Web and Android OAuth client IDs from the corresponding project to enable Google sign-in. Email/password sign-in and manual venue entry remain available while these integrations are disabled. Do not put server secrets into `eas.json` or `EXPO_PUBLIC_*`.
5. Add separate EAS file variables `CUSTOMER_BETA_GOOGLE_SERVICES_JSON` and `BILLING_QA_GOOGLE_SERVICES_JSON` to the preview environment. Secret file variables are unavailable during local app-config evaluation: also save the corresponding files under ignored `.local-data/android-beta/` and set the same named process variables to their absolute local paths before running the checks or `eas build`. On the worker, EAS supplies its own downloaded-file paths. The build must read the profile's named file; it never falls back to the production services file. Check project ID, project number and Android package.
6. For billing QA only, connect the Google Play app to RevenueCat, configure the six products/base plans from `APP_STORE_METADATA.md`, and fill its `goog_` public key in the QA profile. Set server `REVENUECAT_EXPECTED_ENVIRONMENT=sandbox`, the correct RevenueCat project, native app allowlist, required server API secrets and authenticated sandbox webhook. Verify webhook delivery. Do not use the local Test Store key in either store build.

The profile-level public variables override shared EAS values. The build policy independently rejects production/demo projects, mismatched services files, local emulator connections, missing Firebase configuration and payment credentials in the customer profile. A valid local configuration does not prove the hosted backend is ready.

## Local checks

Run from this exact subscription checkout, not the stale OneDrive mobile copy:

```powershell
Set-Location 'C:\Users\steve\OneDrive\Documents\My Projects\Codex Projects\Dispatch\worktrees\organization-subscriptions-revenuecat'
npm run check
npm --prefix functions run check
npm run test:android-beta-rules
npm run android:customer:check
npm run android:billing:check
```

The customer check passes with its provisioned values and local services-file variable. The future QA check intentionally fails while hosted configuration is deferred. The rule tests use isolated ports 18180, 19299, 14500 and 14501, leaving the existing Expo Go billing harness untouched. The dedicated suite exercises both customer and ordinary subscription authorization; it is separate from the older pre-subscription Firestore suite. Set `GCLOUD_PROJECT` to the exact target during Firebase deployment discovery so customer deployments omit RevenueCat parameter declarations as well as endpoint secret bindings; manifest tests verify that QA and production retain their parameters.

`firebase.json` explicitly excludes `.env`, `.env.*`, `.secret*`, dependencies and backend tests from Functions archives. The backend regression suite exercises Firebase CLI's actual file enumerator. Never deploy relying only on Git ignore or EAS ignore: Firebase packaging has separate rules.

Local verification on October 26: 312 mobile tests, 203 backend tests, 10 dedicated Firestore/Storage cases, TypeScript, dependency and SDK checks passed. Android Hermes export passed with actual customer Firebase/Expo configuration. The existing local Expo server served SDK58 and built its iOS bundle successfully. These checks do not replace signed-artifact installation or physical-device testing.

## Build and upload after hosted verification

Use a current EAS CLI. Set `EXPO_NO_DOTENV=1` so local emulator/Test Store credentials never enter an artifact. Build only the customer candidate now; record its build ID, commit, version code, Firebase project and mode. The profiles share one package and globally increasing version codes.

```powershell
$env:EXPO_NO_DOTENV = '1'
$env:CUSTOMER_BETA_GOOGLE_SERVICES_JSON = (Resolve-Path '.local-data/android-beta/customer-google-services.json').Path
npx eas-cli@latest build --platform android --profile android-customer-beta
```

Before uploading, complete Play developer verification, create the Dispatch app and its closed track, configure Play App Signing, and complete the required listing/policy declarations. Verify that the closed-track API identifier is `alpha`; update the submit profile if the created closed track uses another identifier. A manual Console upload is also possible. EAS Submit requires a scoped Google service-account credential authorized for this app.

Submit each **specific verified build ID**, never `--latest` across these two modes:

```powershell
npx eas-cli@latest submit --platform android --profile android-customer-beta --id CUSTOMER_BUILD_ID
```

Both submissions remain drafts. Validate installed artifacts on a physical Android device before rolling out to the intended groups. Confirm the customer artifact shows complimentary access and no purchase UI; test creating an organization, accepting more than five members, event/team edits, chat/template uploads, member removal and account deletion. Verify unauthorized users/other organizations remain denied. For QA, verify the Google purchase sheet indicates a test payment method and check purchase, expiry, restore, upgrade and webhook behavior.

Use separate Google tester accounts/groups and separate Dispatch accounts for the two backends. Internal-track opt-in takes precedence over closed/open testing; anyone moving to the customer track must opt out of internal testing first. Do not promote the QA artifact to closed or production. No automatic payment or subscription conversion is promised to customer beta testers.

References: [EAS profiles](https://docs.expo.dev/build/eas-json/), [Android submission](https://docs.expo.dev/submit/android/), [Google test tracks](https://support.google.com/googleplay/android-developer/answer/9845334), [Google license testing](https://developer.android.com/google/play/billing/test), [RevenueCat Test Store restrictions](https://www.revenuecat.com/docs/getting-started/configuring-sdk).
