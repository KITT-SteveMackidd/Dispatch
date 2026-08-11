import { describe, expect, it } from 'vitest';
import { resolveNativePickerChangeAction } from '../lib/native-picker';

describe('native date and time picker behavior', () => {
  it('commits and closes an Android picker when OK returns a value', () => {
    expect(resolveNativePickerChangeAction('android', 'set', true)).toBe('commit');
  });

  it('closes an Android picker without changing the value when dismissed', () => {
    expect(resolveNativePickerChangeAction('android', 'dismissed', false)).toBe('dismiss');
  });

  it('stages iOS changes until the in-app Select button is pressed', () => {
    expect(resolveNativePickerChangeAction('ios', 'set', true)).toBe('stage');
    expect(resolveNativePickerChangeAction('ios', 'dismissed', false)).toBe('ignore');
  });
});
