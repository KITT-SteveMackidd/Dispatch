import { describe, expect, it } from 'vitest';
import {
  DRAWER_KEYBOARD_CONTENT_GAP,
  EVENT_ROLE_DRAWER_KEYBOARD_BEHAVIOR,
  EVENT_ROLE_EDITOR_KEYBOARD_VERTICAL_OFFSET,
  getEventRoleEditorKeyboardBehavior,
  getTemplateEditorReturnOffset,
} from '../lib/keyboard-layout';

describe('keyboard-aware template editor layout', () => {
  it('shrinks the event editor viewport instead of translating the full drawer above the keyboard', () => {
    expect(EVENT_ROLE_DRAWER_KEYBOARD_BEHAVIOR).toBe('height');
  });

  it('moves the role editor above the iOS keyboard without enabling duplicate scroll insets', () => {
    expect(getEventRoleEditorKeyboardBehavior('ios')).toBe('padding');
    expect(getEventRoleEditorKeyboardBehavior('android')).toBe('height');
    expect(EVENT_ROLE_EDITOR_KEYBOARD_VERTICAL_OFFSET).toBe(-16);
  });

  it('returns to the exact scroll position where the task editor opened', () => {
    expect(DRAWER_KEYBOARD_CONTENT_GAP).toBe(16);
    expect(getTemplateEditorReturnOffset(620, 240)).toBe(240);
  });

  it('never returns a negative offset', () => {
    expect(getTemplateEditorReturnOffset(undefined, 240)).toBe(240);
    expect(getTemplateEditorReturnOffset(8, -4)).toBe(0);
  });
});
