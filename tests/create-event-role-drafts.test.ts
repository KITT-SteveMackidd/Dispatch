import { describe, expect, it } from 'vitest';
import { buildCreateEventRoleDrafts } from '../lib/create-event-role-drafts';

describe('buildCreateEventRoleDrafts', () => {
  it('deep-clones template roles and tasks for safe event-only editing', () => {
    const template = {
      roles: [{
        id: 'role-1',
        name: 'Crew',
        tasks: [{ id: 'task-1', name: 'Briefing', attachments: [{ id: 'a', name: 'Guide', url: 'https://example.com', kind: 'document' as const }] }],
      }],
    };
    const drafts = buildCreateEventRoleDrafts(template);

    drafts[0].name = 'Updated Crew';
    drafts[0].tasks[0].name = 'Updated Briefing';
    drafts[0].tasks[0].attachments![0].name = 'Updated Guide';

    expect(template.roles[0].name).toBe('Crew');
    expect(template.roles[0].tasks[0].name).toBe('Briefing');
    expect(template.roles[0].tasks[0].attachments[0].name).toBe('Guide');
  });
});
