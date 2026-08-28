# Dispatch organization subscriptions

Status: local implementation only. No App Store, Google Play, RevenueCat production, Firebase deployment, Preview build, or Production build is authorized by this initiative.

## Product model

One designated Billing Manager purchases access for one Dispatch organization. The store transaction remains owned by that Manager's Apple or Google account, while Dispatch maps its verified entitlement to the organization. Other Managers and Workers inherit organization access and must never purchase separately.

| Plan | Unique accepted and reserved people | Monthly CAD | Annual CAD |
| --- | ---: | ---: | ---: |
| Free | 5 | $0 | $0 |
| Crew | 20 | $19.99 | $199.99 |
| Production | 50 | $39.99 | $399.99 |
| Organization | 100 | $79.99 | $799.99 |
| Enterprise | More than 100 | Custom | Annual agreement |

All paid tiers include the same core product features. The paid distinction is organization capacity. Annual self-serve plans provide approximately two months free, and the intended introductory trial is one month.

## Locked rules

1. The organization creator is the default Billing Manager.
2. Billing Manager is an organization responsibility, not a third app role; the user remains a Manager.
3. Only the current Billing Manager can start, restore, upgrade, downgrade, or manage the organization subscription.
4. The Billing Manager can transfer the responsibility only to another active Manager in the same organization. While a paid entitlement is live, the verified Apple or Google payer must retain the role; a mismatched legacy handoff may transfer the role back to that payer. A different Manager can take over after paid access ends.
5. Every unique accepted Manager and Worker counts once at organization level, including the Billing Manager. Membership in multiple teams never consumes another seat.
6. Each active pending Manager or Worker invitation reserves one seat. Cancellation, revocation, decline, acceptance, or expiry releases the reservation or converts it into accepted membership without double counting.
7. Dispatch never automatically charges for an overage. When no capacity remains, new invitations and member acceptance are blocked with an upgrade-required result.
8. Upgrades take effect immediately after verified store entitlement. Downgrades take effect at the next renewal and cannot target a tier below current accepted-plus-reserved usage. Once scheduled, the lower target cap immediately blocks new seat growth while existing accepted members retain paid access through renewal.
9. Only one store subscription can be linked to an organization. Other Managers must see who manages billing instead of a second checkout.
10. `trialing`, `active`, and `grace` retain full access only while verified usage fits the active tier. Any organization over its verified cap, and every `billing_retry`, `expired`, or `revoked` organization, preserves data in read-only mode until billing or capacity is resolved.
11. Cancellation does not remove paid access before the verified entitlement expiry date. Refund or revocation events can end the paid entitlement immediately.
12. No subscription state or capacity check may depend only on client UI. Trusted server state and Firestore rules must enforce the same policy.
13. Apple Family Sharing is not used for workplace access.
14. Store purchase ownership cannot be transferred between Apple or Google accounts. A purchaser deleting their Dispatch account receives a clear warning that deletion does not cancel store renewal, but immediate deletion remains available. Dispatch releases the linked organization entitlement, automatically passes Billing Manager responsibility to an active surviving Manager when one exists, preserves a worker-only organization as orphaned read-only pending Manager recovery, removes empty organizations, and leaves store cancellation with the paying Apple or Google account. Dispatch never deletes a RevenueCat customer automatically: it records API v2's complete paginated alias evidence when available and always leaves a fenced manual-review record after Firebase Auth deletion and signed-in device drain, avoiding customer recreation or deletion of a shared payer identity.

## Store catalog

Apple uses one subscription group (`dispatch_organization_access`) with a monthly and annual product at the same subscription level for each paid capacity band. Google uses one subscription product per band with `monthly` and `annual` base plans. Product identifiers live in `lib/subscriptions.ts` and must be reproduced exactly when the catalogs are configured later.

## Expo Go boundary

RevenueCat's React Native SDK can expose Preview API behavior in Expo Go so the app can render offerings and exercise local workflow state. Expo Go cannot perform or validate real StoreKit or Google Play Billing transactions. Real purchase, renewal, refund, restore, billing-grace, and server-notification validation remains blocked until a native development/store build and sandbox catalogs are explicitly authorized.

## Trusted subscription synchronization

The mobile app can request a purchase or restore, but it never grants seats directly. A Billing Manager first requests a server preflight, completes the RevenueCat package or restore flow, and then asks the server to refresh the organization. Both purchase and restore preflights create a short-lived, server-fenced store intent so account deletion cannot race a native Apple or Google operation on another device. The server independently fetches both the incumbent payer and requesting Billing Manager when they differ, then transactionally verifies that the full billing snapshot and every customer mapping stayed unchanged during that external request. Cross-organization reuse is permitted only for an explicitly released, authoritatively non-live customer. Quarantined, alias, or transferred mappings cannot be rebound through checkout or laundered through Refresh. The server then writes the authoritative `organizationBilling/{organizationId}` projection from RevenueCat REST API v1.

RevenueCat webhooks provide the durable synchronization path. The HTTPS handler requires both the configured authorization header and RevenueCat's timestamped raw-body HMAC, rejects signatures outside a five-minute window, allowlists the RevenueCat app, entitlement, product, and configured sandbox/production environment, hashes its customer lookup document IDs, and records event IDs for idempotency. It re-fetches subscriber state instead of trusting entitlement fields in the webhook body and accepts a normal event only when its active mapping matches the current payer or purchase intent. `PRODUCT_CHANGE` records pending tier or billing-period changes, but capacity changes only when RevenueCat's verified subscriber state changes. `TRANSFER` changes the ledger, source/destination billing, and customer mappings in one Firestore transaction. Ambiguous aliases, a still-live source, a non-live destination, or a conflicting destination payer are quarantined without granting a second organization.

These Firebase Secret Manager values are required before a future deployment:

- `REVENUECAT_WEBHOOK_AUTHORIZATION`: the exact private Authorization header configured in RevenueCat.
- `REVENUECAT_WEBHOOK_SIGNING_SECRET`: the HMAC signing secret configured in RevenueCat.
- `REVENUECAT_SECRET_API_KEY`: a RevenueCat API v1 secret with subscriber-read access; never expose it to Expo.
- `REVENUECAT_V2_SECRET_API_KEY`: a separate API v2 secret with read-only customer-information access, used only to collect complete paginated alias evidence for manual review. Dispatch never issues a RevenueCat customer DELETE.
- `REVENUECAT_ALLOWED_APP_IDS`: comma-separated RevenueCat app IDs accepted by this project.

The non-secret Firebase parameters `REVENUECAT_EXPECTED_ENVIRONMENT` and `REVENUECAT_PROJECT_ID` are also mandatory. Use `sandbox` only for an isolated test Firebase project/emulator and `production` for the production project. Subscriber refreshes and webhook events fail closed when their environment does not match. The production RevenueCat webhook must also be configured to send production events only.

None of those secrets has been created or configured in this local-only phase. The webhook and callable functions have not been deployed, and the RevenueCat dashboard has not been changed.

## In-app upgrade and restore workflow

Every organization member can open **Profile > Organization Billing** to see the current tier, accepted and reserved seats, renewal state, and Billing Manager. Only the Billing Manager receives store controls. If the organization still has a paid entitlement owned by a previous payer, duplicate checkout is disabled until that entitlement ends.

An upgrade follows this sequence:

1. The Billing Manager chooses monthly or annual capacity and reviews RevenueCat's localized price when available.
2. Dispatch runs the trusted server preflight to re-fetch any existing payer from RevenueCat, re-check role and purchaser ownership, enforce the original Apple/Google store, validate the environment and product allowlist, and check plan eligibility.
3. RevenueCat presents the selected package. Expo Go uses Test Store simulation when a real `test_` public key is configured.
4. The app shows a verifying state and asks the server to re-fetch RevenueCat subscriber state.
5. Organization capacity changes only after the server writes the verified billing projection.

Restore Purchases is an explicit Billing Manager action. It first records a trusted restore intent under the same deletion, role, organization, payer-mapping, and transfer fences as checkout. It then restores only the current RevenueCat customer and runs the same server verification; it never grants seats from client `CustomerInfo` alone. A separate retry action re-verifies a purchase if the store succeeded but the first server refresh was interrupted.

## Downgrade, cancellation, and access workflow

- A paid-plan downgrade or monthly/annual period change runs the same server preflight and RevenueCat package flow, but is labelled for the next renewal. Preflight records only checkout intent; it never creates a pending lower tier. Existing accepted members retain access until the verified renewed product takes effect, and new invitations are limited to the lower cap only after an authenticated RevenueCat `PRODUCT_CHANGE` confirms the schedule. A canceled or failed checkout is re-verified and cannot create a phantom downgrade. To reverse or replace a confirmed change, the Billing Manager uses the paying store account and then re-verifies in Dispatch. A `PRODUCT_CHANGE` that names the verified current product clears the old target, and any newly verified current paid product supersedes the stale pending cap.
- Dispatch disables a downgrade when accepted members plus live invitation reservations exceed the target tier. The Billing screen includes a Billing Manager-only seat-management workflow to remove accepted members or cancel active invitations, and the server recalculates capacity after each change.
- Moving to Free requires five or fewer occupied seats. Dispatch opens the paying account's Apple or Google subscription settings; it never treats returning from that screen as proof of cancellation.
- RevenueCat subscriber state with `willRenew: false` schedules Free at the verified paid expiry. An uncancellation clears that pending change. Once expiry is verified, the organization becomes Free; if more than five seats remain because state changed elsewhere, it stays read-only.
- `trialing`, `active`, and `grace` keep full access while usage fits the verified tier. Grace displays its verified deadline and a payment-method prompt. A server-owned `read_only` access mode keeps all data readable while Firestore rules block writes to teams, events, templates, roles, and chat content. Secure invitation creation and claiming are also blocked, while invitation cancellation remains available to reduce reserved seats.
- Every signed-in organization member sees a persistent read-only banner linking to Billing. Billing Manager transfer and subscription recovery remain server-callable so the organization can resolve the condition.
- Newly created organizations receive a Free billing document from a server trigger. A callable bootstrap creates/reconciles it for legacy organizations, and Firestore fails closed when that authoritative document is missing. Only an organization creator who is still its Billing Manager can transactionally attach compatible, still-org-less legacy teams/events; records with outside live members or teams are skipped. Pre-secure invitations are adopted through a capacity-checked server migration callable rather than client writes.

## Account deletion with billing

Account deletion is immediate even when the account owns a live subscription; expiry is never mandatory. The confirmation warns that deleting Dispatch does not cancel Apple or Google renewal. Shared organization data passes only to an active surviving Manager. If accepted Workers remain but no Manager does, the organization and its work are preserved in an explicit orphaned read-only recovery state; an empty organization is deleted. Every billing record paid by the deleted account becomes Free and read-only. RevenueCat identity operations are serialized in the client, the deleting UID is blocklisted, and the SDK logs out before the deletion request to reduce customer recreation from a retained App User ID. Because another signed-in device can recreate that identity later, RevenueCat deletion always remains a manual operation after device drain.

Before irreversible callable cleanup begins, the server acquires a short global deletion lease so two Manager deletions cannot choose one another as stale successors. Under that lease it re-reads the profile and complete billing snapshot, rejects billing drift or a recent purchase/restore intent, reads every RevenueCat API v2 alias page it can obtain, and writes a private `accountDeletionTombstones/{uid}` fence. A retry-enabled Firebase Auth deletion trigger writes the same fence as its first durable action, covering direct or administrative single-user Auth deletion outside the callable. Firestore Rules, Storage Rules, and every authenticated mutating callable reject a fenced UID, blocking old Firebase ID tokens from recreating profile, organization, billing, chat, or upload data. Interrupted local cleanup is resumable; Firebase Auth deletion is retried independently; and a retry-enabled Storage finalizer removes uploads that finish after their owner, thread, or thread participation is gone. No automatic RevenueCat DELETE is issued, including for a v2 404 or apparent sole alias. Alias evidence, API mismatches, and unavailable proof remain in durable manual review until an operator confirms device drain and resolves the customer safely. Passive Firebase sign-out on other devices also logs the RevenueCat SDK out.

Organization member removal also revokes chat access atomically: the server removes the former member from every cached thread participant list, unread record, and active-viewer record in the same transaction as organization membership. Firestore requires both active organization membership and current thread participation, message recipients must be current participants, and message sends cannot rebuild thread membership from stale route state. Legacy template attachment paths permit owner-only creation but no client replacement or deletion. Chat Storage mutation uses the two cross-service documents Firebase permits—the explicit thread participant list and authoritative billing record—while the retrying finalizer removes account-deletion races and legacy owner/thread organization mismatches. Object listing is denied.

## Local verification boundary

TypeScript tests and Firebase Functions unit tests cover catalog mapping, signature verification and replay tolerance, subscription lifecycle projection, Billing Manager authority, invitation seat reservations, chat revocation, account-deletion safeguards, and the demo-project emulator fence. The local harness uses Android Studio's bundled Java runtime to compile Firestore and Storage rules and to start the Auth, Firestore, Functions, and Storage emulators against `demo-dispatch-billing`. Nothing in this workflow deploys Firebase resources.

### 2026-08-25 verification record

- Local branch: `feature/organization-subscriptions-revenuecat`.
- `npm run check`: 31 test files and 138 app tests passed, including TypeScript.
- `functions/npm run check`: Functions syntax check and 119 unit tests passed.
- `mission-control/npm run typecheck`: passed with DSP-067 through DSP-076 represented on the Kanban board.
- `npx expo install --check`: all Expo dependencies are compatible.
- Expo Go Metro started locally and remains available at `exp://192.168.1.45:8083`; fresh Android and iOS bundles completed successfully.
- The local environment contains the required Firebase public configuration but no `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY`. The Billing screen therefore intentionally presents the safe Test Store-not-configured state.
- Firestore emulator rule compilation was attempted but could not start because Java is not installed. No rule, Function, app, or RevenueCat configuration was deployed as a workaround.

### 2026-08-27 local billing-harness verification

- `npm run typecheck`: passed.
- `npm test`: 32 test files and 144 app tests passed.
- `functions/npm run check`: Functions syntax check and 120 unit tests passed.
- `npx expo install --check`: all Expo dependencies are compatible.
- `npm run billing:test:rules`: Firestore and Storage rules compiled successfully in the isolated demo project.
- `npm run billing:test:harness`: Auth, Firestore, Functions, and Storage emulators started; all 28 Functions definitions loaded; the deterministic organization and three test users were seeded; `initializeOrganizationBillingOnCreate` completed; and the emulators shut down successfully.
- The harness is ready for Expo Go, but no payment-connected acceptance was run because the RevenueCat Test Store public key, project ID, server API key, and dashboard catalog are not configured locally.

No Preview build, Production build, EAS Update, Firebase deployment, RevenueCat dashboard mutation, Test Store transaction, Apple sandbox transaction, or Google Play test transaction occurred. Test Store purchase simulation still requires an actual `test_` public key and trusted callable/webhook verification still requires an authorized local emulator or later deployment. Real StoreKit and Google Play Billing validation remains DSP-076 and is intentionally blocked.
