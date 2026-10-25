# Local subscription test harness

Status: locally prepared on 2026-08-27. This harness never deploys Firebase, creates an EAS build, or contacts Apple or Google billing. RevenueCat Test Store is an external sandbox connection and uses simulated transactions.

## Safety boundary

- The mobile app connects to Firebase emulators only when `EXPO_PUBLIC_USE_FIREBASE_EMULATORS=true`, the runtime is a development build, and the configured project ID starts with `demo-`.
- This harness fixes the project to `demo-dispatch-billing`; every Firebase CLI command passes that project explicitly instead of using `.firebaserc`'s live default.
- Test Store offering access, checkout, restore, and verification are rejected unless the isolated Firebase emulator mode is active. The Functions backend also rejects a `test_store` request when configured for a production RevenueCat environment.
- Auth, Firestore, Functions, and Storage bind to all workstation network interfaces so Expo Go on a physical phone can reach them. That can include Ethernet and Tailscale. Run the harness only with trusted/scoped firewall access, never expose these ports through a public tunnel, and stop the emulator terminal when testing is finished.
- The RevenueCat `test_` key is public client configuration. The RevenueCat `sk_` key is server-only and belongs only in ignored `functions/.secret.local`.
- Populated `.env.local`, `functions/.env.local`, and `functions/.secret.local` files are ignored by Git.

## RevenueCat dashboard contract

Create or select a RevenueCat Test Store and reproduce this catalog exactly:

- Entitlement: `organization_access`
- Offering: `dispatch_organization_plans_v1`
- Products:
  - `dispatch_crew_20_monthly`
  - `dispatch_crew_20_annual`
  - `dispatch_production_50_monthly`
  - `dispatch_production_50_annual`
  - `dispatch_organization_100_monthly`
  - `dispatch_organization_100_annual`
- Offering packages:
  - `crew_monthly` -> `dispatch_crew_20_monthly`
  - `crew_annual` -> `dispatch_crew_20_annual`
  - `production_monthly` -> `dispatch_production_50_monthly`
  - `production_annual` -> `dispatch_production_50_annual`
  - `organization_monthly` -> `dispatch_organization_100_monthly`
  - `organization_annual` -> `dispatch_organization_100_annual`

Attach all six products to `organization_access`. Use the locked CAD prices from `docs/SUBSCRIPTIONS.md`. Copy the Test Store public SDK key (`test_...`), project ID, and a least-privilege server secret key (`sk_...`) into the ignored local files. Never put the secret key in an `EXPO_PUBLIC_` variable.

## Local configuration

The repository includes safe templates:

- `config/billing-test.app.env.example` -> `.env.local`
- `config/billing-test.functions.env.example` -> `functions/.env.local`
- `config/billing-test.functions.secrets.example` -> `functions/.secret.local`

Set `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST` to the workstation's LAN address when testing on a physical phone. Use `10.0.2.2` for an Android emulator and `127.0.0.1` for a browser on the workstation.

On a physical phone, Windows Firewall must allow the trusted local network to reach ports `5001`, `8080`, `9099`, and `9199`. If the workstation's LAN address changes, update `.env.local` and fully restart Expo before testing.

Firestore runs in Java, while Auth, Functions, and Storage run in Node. If sign-in succeeds but the profile times out, open `http://<workstation-LAN-address>:8080` in the phone's browser. A timeout can indicate a Java firewall block even when the Node ports work. On Windows, an explicit block takes precedence over an allow rule. The scoped helper below exempts only TCP 8080 from existing Private-profile Java block rules, then allows that port only at the configured LAN address and from its IPv4 subnet. Run it in **PowerShell as administrator** only when this is the diagnosed blocker:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/allow-billing-test-firestore.ps1
```

The helper records its result in ignored `.expo/billing-firestore-firewall.log`. It leaves UDP and every other blocked Java port unchanged.

Set `BILLING_TEST_RUN_ID` to a new short identifier before each clean payment-connected acceptance run, then stop and restart the emulators before seeding. The run ID is included in the Firebase UIDs and RevenueCat App User ID so a reset emulator does not accidentally reuse subscription state from an earlier RevenueCat Test Store customer.

Run the configuration check before starting anything:

```powershell
npm run billing:test:check
```

The checker reports only whether keys exist; it never prints their values. Optional webhook and API v2 values may remain unavailable for the first purchase-plus-explicit-refresh run.

To verify the Firebase side of the harness without leaving services running, use:

```powershell
npm run billing:test:rules
npm run billing:test:harness
```

The first command compiles the Firestore and Storage rules in emulators. The second starts Auth, Firestore, Functions, and Storage against `demo-dispatch-billing`, loads all Functions, seeds the deterministic organization, and shuts the emulators down.

## Start the test version

This branch targets Expo SDK 57 and React Native 0.86, matching an Expo Go client that supports SDK 57. If the phone reports an SDK mismatch, check the project and client versions first: `--clear` resets Metro's cache but does not upgrade the SDK. After dependency changes, stop the old Metro process with Ctrl+C and start it again from this worktree.

Use separate PowerShell terminals from this feature worktree.

Terminal 1:

```powershell
npm run billing:test:emulators
```

Terminal 2, after the emulator UI is ready:

```powershell
npm run billing:test:seed
```

Terminal 3:

```powershell
npm run billing:test:expo
```

The emulator UI is at `http://127.0.0.1:4000`. The deterministic local sign-ins all use password `DispatchLocal123!`:

- Billing Manager: `billing.manager@example.test`
- Second Manager: `second.manager@example.test`
- Worker: `worker@example.test`

The seed command prints the initial payer's RevenueCat App User ID. It is the Firebase UID `billing-manager-<BILLING_TEST_RUN_ID>`.

## DSP-067 through DSP-075 test sequence

1. DSP-067: confirm six RevenueCat packages and localized prices load and the Free/20/50/100 capacity catalog remains unchanged.
2. DSP-068: confirm the organization creator appears as Billing Manager and other members have read-only billing visibility.
3. DSP-069: while Free, transfer Billing Manager to the second Manager and back. Confirm Workers and non-current Managers cannot transfer it.
4. DSP-070: create and cancel an invite, verify its reserved seat, fill the Free plan, and confirm another invite is rejected without an automatic charge.
5. DSP-071: from the Billing Manager account, run Test Store success, failure, and cancellation outcomes. Confirm the Firebase UID is the RevenueCat customer identity.
6. DSP-072: after a successful simulated purchase, tap **Verify current subscription**. Confirm the Functions emulator reads RevenueCat independently and writes `organizationBilling` in the emulator only.
7. DSP-073: upgrade Free -> Crew -> Production and exercise the explicit restore/retry controls. Expo Go restore validates only the Test Store customer flow, not Apple or Google receipts.
8. DSP-074: test seat-fit downgrade rejection, remove members/invites, and exercise Test Store renewal/expiration. A webhook-confirmed `PRODUCT_CHANGE` needs the optional tunnel setup below.
9. DSP-075: record pass/fail evidence, emulator documents, RevenueCat sandbox customer state, and the boundaries that remain native-store-only.

## Purchase succeeds but the organization stays Free

A successful Test Store checkout does not itself grant organization seats. The server requires the `organization_access` entitlement in the RevenueCat customer record. An entry under `subscriptions` alone is insufficient.

1. In RevenueCat **Product catalog > Entitlements > organization_access**, attach all six **Test Store** products listed above. Attaching products only to an offering makes them purchasable but does not grant the entitlement. Check the store as well as the product identifier.
2. Check the project's **Sandbox Testing Access** settings if the products are already attached. Allow the seeded Firebase UID to receive sandbox entitlements.
3. Open the RevenueCat sandbox customer whose App User ID matches the seeded Firebase UID. Confirm `organization_access` is present and active for the purchased product.
4. On the phone, tap **Verify current subscription**. For Crew, expect the current plan to become Crew and the seat limit to become 20. Retry an invitation while accepted members plus pending invite reservations are below 20.

Test Store subscriptions expire on an accelerated schedule. If the purchase has expired, make another simulated purchase after correcting the configuration. Do not manually edit `organizationBilling` to bypass entitlement verification. Missing webhook configuration does not prevent this explicit verification flow.

The billing screen reports an immediate upgrade as verified only when the server returns the requested plan and period with active, trial, or grace access. A successful refresh that still returns Free shows a verification retry message instead.

## Optional webhook connection

The first successful purchase can be verified through the explicit refresh callable without a webhook. Durable DSP-072 synchronization and authoritative DSP-074 `PRODUCT_CHANGE` delivery require:

- RevenueCat Pro webhook access.
- A public HTTPS tunnel to the local Functions emulator.
- A sandbox-only RevenueCat webhook pointed at the tunneled `demo-dispatch-billing/us-central1/revenueCatWebhook` path.
- A configured Authorization value, HMAC signing secret, and Test Store app ID allowlist in `functions/.secret.local`.

Do not expose the emulator or mutate the RevenueCat webhook dashboard without explicit approval. The local webhook handler already rejects missing authorization, invalid raw-body HMAC signatures, stale timestamps, wrong app IDs, unsupported products, and non-sandbox events.

## Remaining native-store boundary

Expo Go plus Test Store does not validate Apple/Google purchase sheets, real payment methods, receipts, platform account restoration, proration, grace/billing-retry behavior, store-management URLs, refunds, or store server notifications. Those scenarios remain DSP-076 and require explicitly authorized native Apple and Google sandbox builds.
# DSP-116 web/mobile compatibility test — 2026-10-24

## Required Expo Go compatibility gate

The first phone attempt was blocked: the installed iPhone Expo Go requires SDK 58 while the server served SDK 57. The earlier successful SDK 57 bundle check did not establish physical-device compatibility. Use the SDK 58 dependency graph and runtime in this checkout for further testing.

Every local mobile update must follow `AGENTS.md`. `config/expo-go-compatibility.json` records the phone's confirmed SDK. The startup guard compares installed/declared Expo versions with that target and checks published iOS availability. Device evidence remains authoritative when Expo's metadata lags. A newly advertised SDK blocks handoff until the phone requirement is reconfirmed.

Before starting, run `npm run expo:compatibility`, `npx expo install --check`, `npm run typecheck`, and relevant tests. Start with `npm run billing:test:expo`. Then run `npm run expo:verify` to check the actual iOS manifest and checkout and compile its iOS bundle before providing the QR. Standard `start`, `ios`, and `android` scripts also run the startup guard; `npm run check` includes SDK and dependency validation. Never lower the recorded requirement or fake `sdkVersion` to pass these checks.

The local address remains `exp://192.168.1.45:8083`. Fully close Expo Go and scan the QR again after an SDK change. A server check cannot establish successful rendering on the physical phone; record that acceptance separately.

**SDK 58 verification (2026-10-24):** Expo 58.0.19, React Native 0.88.0 and React 19.3.0 installed with a regenerated lockfile and normal peer validation. React Native instance types and Gesture Handler's supported Reanimated Swipeable replace removed APIs. Dependency compatibility passed, Expo Doctor passed 20/20, typecheck passed, and 205 mobile tests passed (including six guard regressions); 17 keyboard/event/guard tests were rerun after component migration. The live LAN manifest returned HTTP 200 with SDK 58.0.0 and this exact worktree. `expo:verify` compiled 2,132 iOS modules and fetched a 16,356,248-byte bundle with HTTP 200. OTA updates remain disabled. The shared sandbox still verified Production / 50 seats, allowed another Manager's read, and rejected unauthorized refresh and duplicate mobile purchase. Physical phone acceptance remains pending; nothing was deployed.

The local mobile branch now recognizes all six RevenueCat Web Billing products and the `rc_billing` store. Web and mobile use the same organization billing record and `revenueCatCustomers` ownership mapping. Mobile server verification works across stores; purchasing/restoring remains restricted to the original store. Browser subscriptions display web management guidance.

The running shared test suite uses `demo-dispatch-billing` Auth/Firestore/Functions/Storage and Expo Go on port 8083. Use the project-local Firebase CLI; global CLI 14.17.0 is incompatible with firebase-functions v7. Do not start another emulator suite on these ports.

**Phone acceptance:** connect to the computer's network, open `exp://192.168.1.45:8083` in Expo Go, then sign in with `billing.cross-oct24a@example.test` / `DispatchLocal123!`. These are public synthetic emulator credentials. Open Profile → Organization Billing and tap **Verify current subscription**. The sandbox account was Production annual / 50 seats, but its accelerated subscription expired later on October 24. It now correctly shows Free / 5 seats / three members with organization changes enabled. Paid cross-store checks require another sandbox checkout. Web payments are managed in the local web app; mobile purchase/restore must be blocked while that web subscription is active.

Actual sandbox Crew annual purchase and Production annual upgrade passed through the mobile callable with authenticated Firestore reads. Another Manager could read shared access but could not verify/change it. Duplicate mobile purchases and restores were rejected. 172 backend tests, 41 focused mobile tests, 55 focused web tests, both TypeScript checks and iOS Expo Go bundle compilation passed. Physical phone interaction is pending. Provider-delivered webhooks and native Apple/Google store payments were not exercised.

Annual sandbox periods renew every hour and stop after six renewals. This is accelerated test behavior; an expired account can correctly return to Free after verification.

Run the local API smoke check while the shared emulators are running:

```powershell
Set-Location 'C:\Users\steve\OneDrive\Documents\My Projects\Codex Projects\Dispatch\worktrees\organization-subscriptions-revenuecat'
node scripts/check-web-mobile-billing.mjs cross-oct24a free
```

No deployment or live payment occurred. Earlier run details below are historical; use the account above for DSP-116.

## Repeated expiry verification regression — 2026-10-24

**Acceptance recorded:** the user supplied a corrected Free / 3-of-5 / writable phone screenshot, then confirmed that a new web purchase and mobile cross-test work. DSP-116 local cross-platform acceptance is complete. Native store testing is the next separate release gate; see `APP_STORE_METADATA.md`.

The phone successfully opened SDK 58 and exposed a backend expiry bug: RevenueCat retains historical expired entitlements, so verifying a second time after moving to Free incorrectly restored the old Production label and 50-seat limit with `status: free` and read-only access. Expired entitlement history now stays expired regardless of the previous plan, and the lifecycle policy normalizes both expired and Free projections to Free / 5 seats, clearing obsolete paid fields. Free access is writable at five or fewer occupied seats and read-only above five.

Two regression tests reproduced the failure before the fix and pass afterward, including four consecutive verifications for Apple, Google Play, Test Store and RevenueCat Web Billing at 3, 5 and 6 seats. All 174 backend tests, 45 focused mobile tests, typecheck and SDK 58 manifest/bundle checks passed. Three actual server verifications of the affected sandbox account consistently returned and persisted Free / 5 seats / full access. No manual entitlement grant or replacement payment was used. Reload Expo Go and verify again to confirm the corrected phone display.
