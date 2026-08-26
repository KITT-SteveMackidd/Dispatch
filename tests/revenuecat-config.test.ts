import { describe, expect, it } from 'vitest';
import { selectRevenueCatConfiguration } from '../lib/revenuecat-config';
import { getSubscriptionPlan } from '../lib/subscriptions';

describe('RevenueCat runtime configuration', () => {
  it('stays safely unconfigured in Expo Go without a Test Store key', () => {
    expect(selectRevenueCatConfiguration({
      runtime: 'expo_go',
      keys: {},
      isDevelopment: true,
    })).toMatchObject({ configured: false, preview: true, reason: 'missing_key' });
  });

  it('accepts only a test_ public key in Expo Go', () => {
    expect(selectRevenueCatConfiguration({
      runtime: 'expo_go',
      keys: { test: 'test_dispatch_public_key' },
      isDevelopment: true,
    })).toMatchObject({ configured: true, preview: true, runtime: 'expo_go' });
    expect(selectRevenueCatConfiguration({
      runtime: 'expo_go',
      keys: { test: 'appl_wrong_store_key' },
      isDevelopment: true,
    })).toMatchObject({ configured: false, reason: 'invalid_key' });
  });

  it('selects platform public keys and never accepts a server secret', () => {
    expect(selectRevenueCatConfiguration({
      runtime: 'ios',
      keys: { apple: 'appl_dispatch_public_key' },
      isDevelopment: true,
    })).toMatchObject({ configured: true, runtime: 'ios' });
    expect(selectRevenueCatConfiguration({
      runtime: 'android',
      keys: { google: 'sk_server_secret' },
      isDevelopment: true,
    })).toMatchObject({ configured: false, reason: 'invalid_key' });
  });
});

describe('RevenueCat Dispatch catalog mapping', () => {
  it('uses one offering and six stable custom package identifiers', () => {
    expect(['crew', 'production', 'organization'].flatMap((planId) => {
      const plan = getSubscriptionPlan(planId as 'crew' | 'production' | 'organization');
      expect(plan.revenueCatOfferingId).toBe('dispatch_organization_plans_v1');
      return [plan.revenueCatPackageIds.monthly, plan.revenueCatPackageIds.annual];
    })).toEqual([
      'crew_monthly',
      'crew_annual',
      'production_monthly',
      'production_annual',
      'organization_monthly',
      'organization_annual',
    ]);
  });
});
