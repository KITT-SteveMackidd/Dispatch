# Dispatch store metadata

Use these public URLs for App Store Connect and Google Play Console:

- Privacy Policy URL: https://dispatchcrewmanager.com/privacy
- Support URL: https://dispatchcrewmanager.com/support
- Support email: support@krestlabssoftware.com

These URLs are also linked from the in-app Profile screen and exposed in the Expo configuration under `extra.privacyPolicyUrl` and `extra.supportUrl`.

## Subscription beta candidate — October 24, 2026

The user confirmed the local web-to-mobile subscription cross-test works. The candidate includes fetched `origin/master` at `606ca7f55275170a4216056692c0398a850573d9`, Expo SDK 58, shared organization entitlements, duplicate-purchase protection and stable expiry-to-Free handling.

`eas.json` now has a dedicated `beta` store profile using the `beta` channel, SDK 58 build images and Android AAB output. The App Store destination is existing app `6799206233`; Android submission is explicitly `internal` / `draft` until tester access and license testing are verified. Beta does not enable production OTA updates. `.easignore` excludes local dotenv credentials and backend/emulator data. The app-config beta gate rejects production/demo Firebase, emulator connections, missing or incorrect native RevenueCat keys, and mismatched Android services configuration.

### Remaining store release gates

- EAS preview currently points to production Firebase `dispatch-eb63a`. Select a dedicated hosted Dispatch beta backend and deploy the matching Functions, rules and indexes there. Set `REVENUECAT_EXPECTED_ENVIRONMENT=sandbox` on that backend, with server verification and sandbox webhook credentials. Do not change the receipt environment on the shared production backend. The separate project `dispatch-landing-beta` exists but was not verified or repurposed for this use.
- The RevenueCat project currently has Test Store and Web Billing products, with no Apple/Google app connections. Connect the native apps, configure their six subscriptions/base plans, attach them to `organization_access`, and map the packages in `dispatch_organization_plans_v1`. Store betas require `appl_` / `goog_` public SDK keys; Test Store keys must not be used in release builds. Both native keys are absent from the inspected EAS preview and production environments.
- Configure the beta environment's matching Firebase client values, Google authentication clients and Android services file (`GOOGLE_SERVICES_JSON` file variable). Keep the existing store identifier `com.smackidd.dispatch` to update the existing listing; use the beta backend configuration for this app identifier. Do not include a local emulator host.
- App Store Connect requires renewed browser sign-in before inspecting current subscription products, agreements, TestFlight groups and review status. Latest visible EAS iOS store artifact is build 30, SDK 54, from September 18; this does not establish current TestFlight distribution status.
- Google Play Console for `stevemackidd@gmail.com` currently opens developer-account signup. Switch to the existing developer-account login if one exists, otherwise complete organization enrollment and verification. Create/verify the Dispatch listing and submission service-account access. Every payment tester must also be a Google license tester; test-track membership alone can still permit real charges.

After the gates are resolved, use a current EAS CLI, disable local dotenv loading (`EXPO_NO_DOTENV=1`) and build with `--profile beta`. Validate both native binaries before their intended beta rollout. Submit with `--profile beta`; do not merge to master merely to publish this branch because `.github/workflows/eas-update.yml` automatically publishes a production OTA update on master pushes. No store build or submission was started during this readiness pass.

References: [RevenueCat release/Test Store restrictions](https://www.revenuecat.com/docs/test-and-launch/sandbox/test-store), [TestFlight sandbox behavior](https://www.revenuecat.com/docs/test-and-launch/sandbox/apple-app-store), [Google license testing](https://developer.android.com/google/play/billing/test), [EAS build infrastructure](https://docs.expo.dev/build-reference/infrastructure/), [Android beta submission](https://docs.expo.dev/submit/android/).
