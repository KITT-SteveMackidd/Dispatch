import { describe, expect, it } from 'vitest';
import {
  DRAWER_KEYBOARD_CONTENT_GAP,
  getKeyboardAwareDrawerScrollOffset,
  getTemplateEditorReturnOffset,
} from '../lib/keyboard-layout';

describe('keyboard-aware template editor layout', () => {
  it('returns to the exact scroll position where the task editor opened', () => {
    expect(DRAWER_KEYBOARD_CONTENT_GAP).toBe(16);
    expect(getTemplateEditorReturnOffset(620, 240)).toBe(240);
  });

  it('never returns a negative offset', () => {
    expect(getTemplateEditorReturnOffset(undefined, 240)).toBe(240);
    expect(getTemplateEditorReturnOffset(8, -4)).toBe(0);
  });

  it('scrolls a focused drawer input to 16px above the keyboard', () => {
    expect(getKeyboardAwareDrawerScrollOffset({
      currentOffset: 120,
      inputTop: 610,
      inputHeight: 44,
      viewportTop: 120,
      viewportHeight: 620,
      keyboardTop: 620,
    })).toBe(170);
  });

  it('does not move a focused drawer input that is already visible', () => {
    expect(getKeyboardAwareDrawerScrollOffset({
      currentOffset: 120,
      inputTop: 420,
      inputHeight: 44,
      viewportTop: 120,
      viewportHeight: 620,
      keyboardTop: 620,
    })).toBe(120);
  });

  it('scrolls back toward a focused drawer input above the viewport', () => {
    expect(getKeyboardAwareDrawerScrollOffset({
      currentOffset: 120,
      inputTop: 90,
      inputHeight: 44,
      viewportTop: 120,
      viewportHeight: 620,
      keyboardTop: 620,
    })).toBe(74);
  });
});
