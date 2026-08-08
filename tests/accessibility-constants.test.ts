import { describe, expect, it } from 'vitest';
import { ACCESSIBLE_TEXT_MAX_MULTIPLIER, MINIMUM_TOUCH_TARGET } from '../constants/accessibility';

describe('accessibility layout limits', () => {
  it('allows substantially larger system text and standard mobile touch targets', () => {
    expect(ACCESSIBLE_TEXT_MAX_MULTIPLIER).toBeGreaterThanOrEqual(2);
    expect(MINIMUM_TOUCH_TARGET).toBeGreaterThanOrEqual(44);
  });
});
