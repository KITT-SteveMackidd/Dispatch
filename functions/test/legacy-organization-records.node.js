const test = require('node:test');
const assert = require('node:assert/strict');
const { legacyOrganizationRecordUpdate } = require('../lib/legacy-organization-records');

test('adopts only manager-owned legacy teams and events into the current organization', () => {
  assert.deepEqual(legacyOrganizationRecordUpdate({
    kind: 'team',
    record: { managerId: 'manager-1', managerIds: ['manager-2', 'manager-1'] },
    managerId: 'manager-1',
    organizationId: 'org-1',
    organizationName: 'Venue Crew',
  }), {
    organizationId: 'org-1',
    organizationName: 'Venue Crew',
    managerIds: ['manager-1'],
  });
  assert.deepEqual(legacyOrganizationRecordUpdate({
    kind: 'event',
    record: { managerId: 'manager-1', organizationId: null },
    managerId: 'manager-1',
    organizationId: 'org-1',
  }), { organizationId: 'org-1' });
});

test('skips legacy records with live members or teams outside the destination organization', () => {
  assert.equal(legacyOrganizationRecordUpdate({
    kind: 'team',
    record: { managerId: 'manager-1', workerIds: ['worker-outside'] },
    managerId: 'manager-1',
    organizationId: 'org-1',
    allowedMemberIds: ['manager-1', 'worker-inside'],
  }), null);
  assert.equal(legacyOrganizationRecordUpdate({
    kind: 'event',
    record: {
      managerId: 'manager-1',
      teamIds: ['team-outside'],
      roles: [{ assignedWorkerIds: ['worker-inside'] }],
    },
    managerId: 'manager-1',
    organizationId: 'org-1',
    allowedMemberIds: ['manager-1', 'worker-inside'],
    allowedTeamIds: ['team-inside'],
  }), null);
});

test('allows valid current-member and current-team references while remaining idempotent', () => {
  assert.deepEqual(legacyOrganizationRecordUpdate({
    kind: 'event',
    record: {
      managerId: 'manager-1',
      teamIds: ['team-inside'],
      roles: [{ assignedWorkerIds: ['worker-inside'], waitlistWorkerIds: [] }],
    },
    managerId: 'manager-1',
    organizationId: 'org-1',
    allowedMemberIds: ['manager-1', 'worker-inside'],
    allowedTeamIds: ['team-inside'],
  }), { organizationId: 'org-1' });
  assert.equal(legacyOrganizationRecordUpdate({
    kind: 'event',
    record: { managerId: 'manager-1', organizationId: 'org-1' },
    managerId: 'manager-1',
    organizationId: 'org-1',
    allowedMemberIds: ['manager-1'],
    allowedTeamIds: [],
  }), null);
});

test('never moves records already assigned to an organization or owned by another manager', () => {
  assert.equal(legacyOrganizationRecordUpdate({
    kind: 'event',
    record: { managerId: 'manager-1', organizationId: 'org-2' },
    managerId: 'manager-1',
    organizationId: 'org-1',
  }), null);
  assert.equal(legacyOrganizationRecordUpdate({
    kind: 'team',
    record: { managerId: 'manager-2' },
    managerId: 'manager-1',
    organizationId: 'org-1',
  }), null);
});
