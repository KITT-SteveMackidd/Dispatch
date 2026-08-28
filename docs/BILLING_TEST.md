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

## Optional webhook connection

The first successful purchase can be verified through the explicit refresh callable without a webhook. Durable DSP-072 synchronization and authoritative DSP-074 `PRODUCT_CHANGE` delivery require:

- RevenueCat Pro webhook access.
- A public HTTPS tunnel to the local Functions emulator.
- A sandbox-only RevenueCat webhook pointed at the tunneled `demo-dispatch-billing/us-central1/revenueCatWebhook` path.
- A configured Authorization value, HMAC signing secret, and Test Store app ID allowlist in `functions/.secret.local`.

Do not expose the emulator or mutate the RevenueCat webhook dashboard without explicit approval. The local webhook handler already rejects missing authorization, invalid raw-body HMAC signatures, stale timestamps, wrong app IDs, unsupported products, and non-sandbox events.

## Remaining native-store boundary

Expo Go plus Test Store does not validate Apple/Google purchase sheets, real payment methods, receipts, platform account restoration, proration, grace/billing-retry behavior, store-management URLs, refunds, or store server notifications. Those scenarios remain DSP-076 and require explicitly authorized native Apple and Google sandbox builds.
