# Android Google sign-in internal beta (DSP-133)

Requested October 28, 2026. Continue on `release/customer-beta-chat-safety`, using the existing Firebase `dispatch-eb63a`, Expo `@smackidd/dispatch`, and package `com.smackidd.dispatch`. Do not push master or publish an OTA update.

## Verified configuration

- Firebase Authentication already has Google enabled; no provider change was needed.
- Google Play App signing supplied `deployment_cert.der`; its SHA-256 matches the console's Digital Asset Links value `35:B0:A8:4C:03:E6:00:9E:AB:10:25:3F:E6:C4:60:23:5C:CB:92:2F:4E:29:BD:8E:CE:00:33:76:6E:F1:FD:54`.
- Registered its SHA-1 `B3:46:A7:E4:58:D6:BA:3F:37:53:CA:02:2D:EE:7F:54:7F:B3:39:B3` on Firebase Android app `1:94634534771:android:7a0833a638f1523cb64706` using the Firebase CLI. This is the Play distribution certificate, not the EAS upload certificate.
- Play supplied two additional quantum-ready certificates. Their SHA-1 values are `BB6AF83AC23B303286C70BE757E9C07F92501275` (hybrid classical) and `4DF08C2435E9F114319438E3D767148E07EF1866` (PQC); all three are required by [Google's API-provider registration guidance](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en). The build checks those additional registrations too.
- Firebase generated Android OAuth client `94634534771-0n2cvhu76ohjqmiodne6c4qnk72a9lor.apps.googleusercontent.com` for that package/certificate. The Firebase Web token audience remains `94634534771-karkfl9acls7c7gal71qpfh2cb6qtlau.apps.googleusercontent.com`.
- Downloaded the official refreshed Android services configuration. Enabled those public client IDs only in `android-customer-beta`; iOS Google sign-in and Places stay disabled.
- The build guard checks project/client/package/certificate agreement in whichever services file EAS actually selects. Missing or stale data blocks the build.
- Customer submission now targets an internal draft. Billing QA remains local; payments, emulators and OTA remain disabled in the store customer build.

## Device acceptance still required

Install from Google Play Internal testing, not Expo Go or an EAS-signed sideload (the upload certificate is intentionally not registered by this task). Test:

1. New Google user: Create Account, Google, select account, complete Manager or Worker onboarding.
2. Existing Google user: Sign In, Google; verify original organization and role.
3. Existing email/password user with the same email: verify Firebase retains the original UID/organization; if Firebase reports another provider, use the existing method. This change does not introduce account merging.
4. Cancel Google account selection; confirm no error or unintended session remains.
5. New Google user on Sign In instead of Create Account: show the specific Create Account instruction.
6. Sign out, relaunch, and sign in again; confirm email/password still works.

Google sign-in configuration and automated checks cannot substitute for a real Google account on a Play-installed Android device. Record device outcome before marking DSP-133 complete. The separate hosted chat-safety rollout remains gated by DSP-132; this authentication change does not enable safety flags or deploy backend changes.

## Build record

Local validation passed: SDK58/Expo58.0.21 and current compatible dependency patches, TypeScript, all 406 tests, and Android/iOS customer profile checks. Android's validated target is an internal draft. Pending the replacement build and artifact verification.
