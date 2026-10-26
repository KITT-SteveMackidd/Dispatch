# Dispatch store metadata

Use these public URLs for App Store Connect and Google Play Console:

- Privacy Policy URL: https://dispatchcrewmanager.com/privacy
- Support URL: https://dispatchcrewmanager.com/support
- Support email: support@krestlabssoftware.com

These URLs are also linked from the in-app Profile screen and exposed in the Expo configuration under `extra.privacyPolicyUrl` and `extra.supportUrl`.

## Subscription beta candidate — October 24, 2026

For the two Android tracks requested October 26, use [ANDROID_BETA_BUILDS.md](./ANDROID_BETA_BUILDS.md): `android-customer-beta` is complimentary Closed testing, and `android-billing-qa` is Internal subscription testing. These profiles supersede the older shared `beta` profile for this Android rollout. Hosted provisioning and signed AABs remain pending; local synthetic bundle exports are not store builds.

The user confirmed the local web-to-mobile subscription cross-test works. The candidate includes fetched `origin/master` at `606ca7f55275170a4216056692c0398a850573d9`, Expo SDK 58, shared organization entitlements, duplicate-purchase protection and stable expiry-to-Free handling.

`eas.json` now has a dedicated `beta` store profile using the `beta` channel, SDK 58 build images and Android AAB output. The App Store destination is existing app `6799206233`; Android submission is explicitly `internal` / `draft` until tester access and license testing are verified. Beta does not enable production OTA updates. `.easignore` excludes local dotenv credentials and backend/emulator data. The app-config beta gate rejects production/demo Firebase, emulator connections, missing or incorrect native RevenueCat keys, and mismatched Android services configuration.

### Native catalog prepared for configuration — October 26, 2026

Use the identifiers already recognized by the app and server. Add native products to the existing `dispatch_organization_plans_v1` offering and `organization_access` entitlement without replacing web/Test Store package mappings.

| Apple product ID | Duration | USD base price | RevenueCat package |
| --- | --- | --- | --- |
| `dispatch_crew_20_monthly` | 1 month | 14.99 | `crew_monthly` |
| `dispatch_crew_20_annual` | 1 year | 149.99 | `crew_annual` |
| `dispatch_production_50_monthly` | 1 month | 29.99 | `production_monthly` |
| `dispatch_production_50_annual` | 1 year | 299.99 | `production_annual` |
| `dispatch_organization_100_monthly` | 1 month | 59.99 | `organization_monthly` |
| `dispatch_organization_100_annual` | 1 year | 599.99 | `organization_annual` |

Apple subscription-group reference name: `dispatch_organization_access`. Rank Organization at level 1, Production at level 2 and Crew at level 3, with monthly/annual variants sharing their tier's level. Keep Family Sharing disabled. Google uses products `dispatch_crew_20`, `dispatch_production_50`, and `dispatch_organization_100`, each with `monthly` and `annual` base plans. Free and Enterprise have no store products.

The USD prices match the web catalog; mobile uses RevenueCat's localized `priceString` when loaded. Its older CAD fallback references and tests still require a consistency review before final store acceptance. The three-day trial request applied to Test Store testing; do not silently replace the documented one-month native trial policy with that test-only duration. No native products or introductory offers were created in this preparation pass.

### Remaining store release gates

- EAS preview currently points to production Firebase `dispatch-eb63a`. Select a dedicated hosted Dispatch beta backend and deploy the matching Functions, rules and indexes there. Set `REVENUECAT_EXPECTED_ENVIRONMENT=sandbox` on that backend, with server verification and sandbox webhook credentials. Do not change the receipt environment on the shared production backend. The separate project `dispatch-landing-beta` exists but was not verified or repurposed for this use.
- The RevenueCat project currently has Test Store and Web Billing products, with no Apple/Google app connections. Connect the native apps, configure their six subscriptions/base plans, attach them to `organization_access`, and map the packages in `dispatch_organization_plans_v1`. Store betas require `appl_` / `goog_` public SDK keys; Test Store keys must not be used in release builds. Both native keys are absent from the inspected EAS preview and production environments.
- Configure the beta environment's matching Firebase client values, Google authentication clients and Android services file (`GOOGLE_SERVICES_JSON` file variable). Keep the existing store identifier `com.smackidd.dispatch` to update the existing listing; use the beta backend configuration for this app identifier. Do not include a local emulator host.
- App Store Connect sign-in was verified October 25. Existing Dispatch app `6799206233` / `com.smackidd.dispatch` has TestFlight builds 30, 29 and 28 marked Testing. On October 26, the user completed the updated developer agreement and Business now shows the Free Apps Agreement Active (effective October 26, 2026); the prior update warning is gone. The separate Paid Apps Agreement is New with a Sign the Paid Apps Agreement action and must be reviewed/accepted by the Account Holder. Apple currently identifies the account as Stephen Mackidd / Individual. At the October 25 inspection, native subscription groups/products and notification URLs were absent. No new native build has been uploaded.
- Google Play account `4921056077696530114` is now verified: on October 26 the Home page no longer displays identity, website or phone verification warnings. The Dispatch Crew Manager app creation form is prepared with available package `com.smackidd.dispatch`, English (US), App, Free. The policy, Play App Signing and export-law declarations remain unchecked for the Account Holder; creation has not been submitted. Then configure submission service-account access or upload manually. Every payment tester must also be a Google license tester; test-track membership alone can still permit real charges.

After the gates are resolved, use a current EAS CLI, disable local dotenv loading (`EXPO_NO_DOTENV=1`) and build with `--profile beta`. Validate both native binaries before their intended beta rollout. Submit with `--profile beta`; do not merge to master merely to publish this branch because `.github/workflows/eas-update.yml` automatically publishes a production OTA update on master pushes. No store build or submission was started during this readiness pass.

References: [RevenueCat release/Test Store restrictions](https://www.revenuecat.com/docs/test-and-launch/sandbox/test-store), [TestFlight sandbox behavior](https://www.revenuecat.com/docs/test-and-launch/sandbox/apple-app-store), [Google license testing](https://developer.android.com/google/play/billing/test), [EAS build infrastructure](https://docs.expo.dev/build-reference/infrastructure/), [Android beta submission](https://docs.expo.dev/submit/android/).
