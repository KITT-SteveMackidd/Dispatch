import { describe, expect, it } from 'vitest';
import { canResetDispatchDatabase } from '../lib/admin-database-reset';

describe('canResetDispatchDatabase', () => {
  it('only permits the configured admin email in local test builds', () => {
    expect(canResetDispatchDatabase('stevemackidd@gmail.com', true)).toBe(true);
    expect(canResetDispatchDatabase(' STEVEMACKIDD@GMAIL.COM ', true)).toBe(true);
    expect(canResetDispatchDatabase('stevemackidd+dispatch@gmail.com', true)).toBe(false);
    expect(canResetDispatchDatabase('someone@example.com', true)).toBe(false);
    expect(canResetDispatchDatabase(null, true)).toBe(false);
  });

  it('hides the reset control from release builds', () => {
    expect(canResetDispatchDatabase('stevemackidd@gmail.com', false)).toBe(false);
  });
});
