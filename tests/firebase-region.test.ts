import { describe, expect, it } from 'vitest';
import { firebaseFunctionsRegion } from '../lib/firebase-region';

describe('Firebase callable routing', () => {
  it('routes the dedicated customer backend to Montreal', () => {
    expect(firebaseFunctionsRegion('dispatch-customer-beta')).toBe('northamerica-northeast1');
  });
  it.each(['dispatch-eb63a', 'demo-dispatch-billing', 'dispatch-billing-qa', undefined])('preserves the existing region for %s', project => {
    expect(firebaseFunctionsRegion(project)).toBe('us-central1');
  });
});
