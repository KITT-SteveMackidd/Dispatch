import { describe, expect, it } from 'vitest';
import {
  SUBSCRIPTION_PLANS,
  canDowngradeToPlan,
  evaluateSubscriptionCapacity,
  defaultOrganizationBilling,
  getAnnualSavingsPercent,
  getSubscriptionAccessMode,
  getSubscriptionPlan,
  getSubscriptionPlanChange,
  getOrganizationSeatUsage,
} from '../lib/subscriptions';
import { isOrganizationBillingManager, resolveBillingManagerId } from '../lib/billing-manager';

describe('Dispatch subscription catalog', () => {
  it('locks the approved member caps and Canadian prices', () => {
    expect(SUBSCRIPTION_PLANS.map(({ id, memberCap, monthlyCadCents, annualCadCents }) => ({
      id,
      memberCap,
      monthlyCadCents,
      annualCadCents,
    }))).toEqual([
      { id: 'free', memberCap: 5, monthlyCadCents: 0, annualCadCents: 0 },
      { id: 'crew', memberCap: 20, monthlyCadCents: 1_999, annualCadCents: 19_999 },
      { id: 'production', memberCap: 50, monthlyCadCents: 3_999, annualCadCents: 39_999 },
      { id: 'organization', memberCap: 100, monthlyCadCents: 7_999, annualCadCents: 79_999 },
      { id: 'enterprise', memberCap: null, monthlyCadCents: null, annualCadCents: null },
    ]);

    expect(getAnnualSavingsPercent('crew')).toBeCloseTo(16.6, 1);
    expect(getAnnualSavingsPercent('production')).toBeCloseTo(16.6, 1);
    expect(getAnnualSavingsPercent('organization')).toBeCloseTo(16.7, 1);
  });

  it('uses stable store products for every self-serve paid plan', () => {
    for (const planId of ['crew', 'production', 'organization'] as const) {
      const plan = getSubscriptionPlan(planId);
      expect(plan.storePurchasable).toBe(true);
      expect(plan.appleProductIds.monthly).toBeTruthy();
      expect(plan.appleProductIds.annual).toBeTruthy();
      expect(plan.googleProductId).toBeTruthy();
      expect(plan.googleBasePlanIds).toEqual({ monthly: 'monthly', annual: 'annual' });
    }
  });
});

describe('Dispatch subscription lifecycle rules', () => {
  it('applies upgrades immediately and downgrades at renewal', () => {
    expect(getSubscriptionPlanChange('free', 'crew')).toBe('immediate');
    expect(getSubscriptionPlanChange('crew', 'organization')).toBe('immediate');
    expect(getSubscriptionPlanChange('organization', 'production')).toBe('next_renewal');
    expect(getSubscriptionPlanChange('crew', 'crew')).toBe('none');
    expect(getSubscriptionPlanChange('crew', 'crew', 'monthly', 'annual')).toBe('next_renewal');
    expect(getSubscriptionPlanChange('crew', 'crew', 'annual', 'annual')).toBe('none');
    expect(getSubscriptionPlanChange('organization', 'enterprise')).toBe('contact_sales');
    expect(getSubscriptionPlanChange('crew', 'crew', 'monthly', 'monthly', 'expired')).toBe('immediate');
    expect(getSubscriptionPlanChange('production', 'crew', 'annual', 'monthly', 'revoked')).toBe('immediate');
  });

  it('keeps active and grace-period organizations fully available', () => {
    expect(getSubscriptionAccessMode({ planId: 'crew', status: 'active', seatUsage: 20 })).toBe('full');
    expect(getSubscriptionAccessMode({ planId: 'crew', status: 'grace', seatUsage: 20 })).toBe('full');
    expect(getSubscriptionAccessMode({ planId: 'crew', status: 'active', seatUsage: 21 })).toBe('read_only');
  });

  it('preserves expired and revoked organizations in read-only mode', () => {
    expect(getSubscriptionAccessMode({ planId: 'crew', status: 'expired', seatUsage: 12 })).toBe('read_only');
    expect(getSubscriptionAccessMode({ planId: 'crew', status: 'revoked', seatUsage: 12 })).toBe('read_only');
    expect(getSubscriptionAccessMode({ planId: 'free', status: 'free', seatUsage: 6 })).toBe('read_only');
    expect(getSubscriptionAccessMode({ planId: 'free', status: 'free', seatUsage: 5 })).toBe('full');
  });
});

describe('Dispatch subscription capacity rules', () => {
  it('never auto-expands a fixed member band', () => {
    expect(evaluateSubscriptionCapacity('crew', 19)).toMatchObject({ remainingSeats: 1, canReserveSeat: true });
    expect(evaluateSubscriptionCapacity('crew', 20)).toMatchObject({ remainingSeats: 0, isAtLimit: true, canReserveSeat: false });
    expect(evaluateSubscriptionCapacity('crew', 21)).toMatchObject({ remainingSeats: 0, isOverLimit: true, canReserveSeat: false });
  });

  it('blocks a downgrade until the accepted and reserved seat usage fits', () => {
    expect(canDowngradeToPlan('crew', 21)).toBe(false);
    expect(canDowngradeToPlan('crew', 20)).toBe(true);
    expect(canDowngradeToPlan('production', 50)).toBe(true);
  });

  it('counts unique organization members plus unexpired invite reservations', () => {
    const billing = defaultOrganizationBilling();
    billing.seatReservations = {
      active: {
        inviteHash: 'active',
        sourceInviteId: 'source-active',
        inviteKind: 'worker',
        expiresAtMs: 2_000,
      },
      expired: {
        inviteHash: 'expired',
        sourceInviteId: 'source-expired',
        inviteKind: 'manager',
        expiresAtMs: 500,
      },
    };

    expect(getOrganizationSeatUsage({
      managerIds: ['manager', 'shared'],
      workerIds: ['worker', 'shared'],
      billing,
      nowMs: 1_000,
    })).toMatchObject({ acceptedSeats: 3, reservedSeats: 1, seatUsage: 4, remainingSeats: 1 });
  });

  it('locks seat growth to a scheduled lower plan before renewal', () => {
    const billing = defaultOrganizationBilling();
    billing.planId = 'production';
    billing.status = 'active';
    billing.seatLimit = 50;
    billing.pendingPlanId = 'crew';

    expect(getOrganizationSeatUsage({
      managerIds: ['manager'],
      workerIds: Array.from({ length: 19 }, (_, index) => `worker-${index}`),
      billing,
    })).toMatchObject({ memberCap: 20, seatUsage: 20, isAtLimit: true, canReserveSeat: false });
  });
});

describe('Dispatch Billing Manager ownership', () => {
  it('uses the explicitly assigned active Manager', () => {
    const organization = {
      managerIds: ['creator', 'billing-manager'],
      createdBy: 'creator',
      billingManagerId: 'billing-manager',
    };

    expect(resolveBillingManagerId(organization)).toBe('billing-manager');
    expect(isOrganizationBillingManager(organization, 'billing-manager')).toBe(true);
    expect(isOrganizationBillingManager(organization, 'creator')).toBe(false);
  });

  it('defaults legacy organizations to their active creator', () => {
    expect(resolveBillingManagerId({
      managerIds: ['another-manager', 'creator'],
      createdBy: 'creator',
    })).toBe('creator');
  });

  it('uses a deterministic active Manager when the creator is no longer active', () => {
    expect(resolveBillingManagerId({
      managerIds: ['manager-z', 'manager-a'],
      createdBy: 'former-manager',
      billingManagerId: 'former-manager',
    })).toBe('manager-a');
  });
});
