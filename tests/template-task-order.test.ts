import { describe, expect, it } from 'vitest';
import { preserveTemplateTaskOrder } from '../lib/template-task-order';

describe('preserveTemplateTaskOrder', () => {
  it('keeps the exact order authored by the Manager regardless of countdown offset', () => {
    const tasks = [
      { id: 'untimed-a' },
      { id: 'late', expectedOffsetMinutes: 90 },
      { id: 'untimed-b' },
      { id: 'early', expectedOffsetMinutes: 15 },
      { id: 'same-a', expectedOffsetMinutes: 30 },
      { id: 'same-b', expectedOffsetMinutes: 30 },
    ];

    expect(preserveTemplateTaskOrder(tasks).map((task) => task.id)).toEqual([
      'untimed-a',
      'late',
      'untimed-b',
      'early',
      'same-a',
      'same-b',
    ]);
  });

  it('returns a new array without mutating the original task order', () => {
    const tasks = [{ id: 'late', expectedOffsetMinutes: 20 }, { id: 'early', expectedOffsetMinutes: 5 }];
    const sorted = preserveTemplateTaskOrder(tasks);
    expect(sorted.map((task) => task.id)).toEqual(['late', 'early']);
    expect(tasks.map((task) => task.id)).toEqual(['late', 'early']);
  });
});
