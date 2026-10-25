import { describe, expect, it } from 'vitest';
import { getInviteBillingAlert } from '../lib/invite-billing-alert';

const context = { currentUserId: 'manager', billingManagerId: 'manager' };
const full = {
  code: 'functions/resource-exhausted',
  details: { reason: 'capacity-exceeded', planId: 'free', memberCap: 5, seatUsage: 5 },
};

describe('invitation billing alerts', () => {
  it('gives the Billing Manager an upgrade action and explains reserved seats', () => {
    expect(getInviteBillingAlert(full, context)).toMatchObject({ title: 'No seats remaining', actionLabel: 'Upgrade' });
    expect(getInviteBillingAlert(full, context)?.message).toContain('5 of 5 member seats');
    expect(getInviteBillingAlert(full, context)?.message).toContain('pending invitations both count');
  });

  it('directs other Managers to view billing and ask their Billing Manager', () => {
    const alert = getInviteBillingAlert(full, { ...context, currentUserId: 'other-manager' });
    expect(alert?.actionLabel).toBe('View billing');
    expect(alert?.message).toContain('Ask your Billing Manager');
  });

  it('uses the server role after a Billing Manager handoff', () => {
    const error = { ...full, details: { ...full.details, billingManagerId: 'new-manager' } };
    expect(getInviteBillingAlert(error, context)?.actionLabel).toBe('View billing');
    expect(getInviteBillingAlert(error, { ...context, currentUserId: 'new-manager' })?.actionLabel).toBe('Upgrade');
  });

  it('explains a pending downgrade using the server cap rather than the current plan cap', () => {
    const error = { ...full, details: { ...full.details, planId: 'production', pendingPlanId: 'crew', memberCap: 20, seatUsage: 20 } };
    expect(getInviteBillingAlert(error, context)?.message).toContain('20 of 20 member seats');
    expect(getInviteBillingAlert(error, context)?.message).toContain('scheduled Crew downgrade');
  });

  it('directs read-only recovery to billing without treating it as a seat-only failure', () => {
    const alert = getInviteBillingAlert({
      code: 'functions/failed-precondition',
      details: { reason: 'organization-read-only', memberCap: 20, seatUsage: 3 },
    }, context);
    expect(alert).toMatchObject({ title: 'Organization is read-only', actionLabel: 'View billing' });
    expect(alert?.message).toContain('resolve your subscription');
    expect(alert?.message).not.toContain('No seats remaining');
  });

  it.each([
    null,
    new Error('No seats remaining'),
    { code: 'functions/unavailable', details: full.details },
    { code: 'functions/permission-denied', details: full.details },
    { code: 'functions/unauthenticated', details: full.details },
    { code: 'functions/resource-exhausted', message: 'Rate limit exceeded' },
    { code: 'functions/resource-exhausted', details: { reason: 'rate-limit' } },
    { code: 'functions/failed-precondition', message: 'Verify your email' },
    { code: 'functions/failed-precondition', details: full.details },
  ])('does not turn unrelated errors into upgrade prompts: %o', (error) => {
    expect(getInviteBillingAlert(error, context)).toBeNull();
  });

  it('handles older structured errors without optional details', () => {
    expect(getInviteBillingAlert({ code: 'resource-exhausted', details: { reason: 'capacity-exceeded' } }, context))
      .toMatchObject({ title: 'No seats remaining', actionLabel: 'Upgrade' });
  });
});
