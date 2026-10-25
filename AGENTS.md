# Dispatch mobile local testing

Follow the parent Dispatch workspace's local Expo Go compatibility rules. Steve's physical iPhone was confirmed to require Expo SDK 58 on 2026-10-24.

Before every local update handoff:

1. Verify this checkout and branch; preserve existing changes.
2. Run `npm run expo:compatibility`, `npx expo install --check`, `npm run typecheck`, and tests relevant to the change.
3. Restart this checkout's Metro with `npm run billing:test:expo` after native dependency updates. Keep `demo-dispatch-billing` emulators and RevenueCat sandbox isolation.
4. Run `npm run expo:verify` against the live port, then request the iOS bundle and confirm HTTP 200. Only then provide the local QR/URL. Distinguish these checks from the user's physical phone acceptance.

Do not lower `config/expo-go-compatibility.json` to fit an incompatible checkout. If Expo Go updates again, verify the device requirement and upgrade the app's supported dependency set. Never fake `sdkVersion` to bypass Expo Go's runtime validation. Do not deploy or publish as part of this workflow.
