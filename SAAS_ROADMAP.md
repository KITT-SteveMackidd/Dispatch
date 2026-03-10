# Dispatch SaaS Roadmap

## Audit Summary (Current Gaps)

Dispatch has strong core workflow coverage (auth, events, templates, team chat, notifications in-app), but key SaaS operating layers are missing or partial:

- **Auth hardening**: no email verification gate, no password reset UX, no explicit token/session revocation runbook.
- **Authorization depth**: service-layer ownership/membership checks are not uniformly codified for every mutating write.
- **Onboarding maturity**: no measurable first-run activation checklist for manager setup milestones.
- **Billing readiness**: no subscription model, entitlement abstraction, Stripe webhook processing, or plan-based feature limits.
- **Analytics**: no event instrumentation for activation/retention funnels.
- **Reliability/observability**: no centralized crash/error reporting, no release health telemetry, no on-call playbook.
- **Release readiness**: no CI quality gates or repeatable release validation pipeline.
- **Notifications at scale**: in-app badges exist, but push delivery + deep-link flows are not productionized.
- **Retention engine**: no inactive-user nudges, lifecycle messaging, or experiments.
- **Admin/support ops**: no internal support console or audited admin actions.
- **Content lifecycle controls**: no soft delete/archive/restore policy for templates/events.

## Phased Plan

### Now (0-4 weeks)
1. DSP-048 Auth hardening baseline.
2. DSP-049 Service-layer authorization guardrails.
3. DSP-050 First-session onboarding checklist + persistence.
4. DSP-053 Product analytics event instrumentation + funnel dashboard.
5. DSP-054 Centralized crash/error monitoring.
6. DSP-055 CI quality gates + release preflight.

### Next (4-8 weeks)
1. DSP-051 Billing model + entitlement abstraction.
2. DSP-052 Stripe webhook ingestion + idempotent sync.
3. DSP-056 Push notifications + deep links.
4. DSP-058 Admin/support console MVP.

### Later (8-12+ weeks)
1. DSP-057 Retention nudges + experiment loop.
2. DSP-059 Soft delete/archive/restore + retention purge policy.

## Success Metrics

### Product & Revenue
- Activation rate (manager completes onboarding checklist within 24h): **target >= 60%**.
- Invite acceptance rate (sent -> accepted within 7 days): **target >= 45%**.
- Week-1 team retention (at least one event action in week 1): **target >= 35%**.
- Trial-to-paid conversion (post-billing launch): **target >= 15%** in initial cohorts.

### Reliability & Operations
- Crash-free sessions: **>= 99.5%**.
- P95 critical write latency (event/template mutation): **< 500ms** (excluding network extremes).
- Failed invite delivery rate: **< 2%**.
- Change failure rate (releases causing rollback/hotfix in 24h): **< 10%**.

### Support & Quality
- Mean time to detect critical production issue: **< 15 min**.
- Mean time to resolve high-severity support issue: **< 24h**.
- Unauthorized write incidents: **0**.

## Dependency Map

- **DSP-051 (entitlements)** depends on DSP-053 analytics taxonomy (for billing funnel metrics).
- **DSP-052 (Stripe webhooks)** depends on DSP-051 entitlement model.
- **DSP-056 (push delivery)** depends on DSP-054 observability for deliverability monitoring.
- **DSP-057 (retention nudges)** depends on DSP-053 analytics instrumentation and DSP-056 push channel readiness.
- **DSP-058 (admin/support)** depends on DSP-049 authorization policy and DSP-054 error telemetry.
- **DSP-059 (content lifecycle)** depends on DSP-049 authorization guardrails and should be validated under DSP-055 CI gates.

## Notes
- This pass intentionally avoids large code refactors and focuses on planning artifacts/backlog acceleration.
- Existing feature work can proceed in parallel while these SaaS foundations are sequenced by dependency.
