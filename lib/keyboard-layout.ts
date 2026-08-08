export const DRAWER_KEYBOARD_CONTENT_GAP = 16;
export const EVENT_ROLE_DRAWER_KEYBOARD_BEHAVIOR = 'height' as const;
export const EVENT_ROLE_EDITOR_KEYBOARD_VERTICAL_OFFSET = -DRAWER_KEYBOARD_CONTENT_GAP;

export function getEventRoleEditorKeyboardBehavior(platform: string) {
  return platform === 'ios' ? 'padding' as const : 'height' as const;
}

export function getTemplateEditorReturnOffset(roleY: number | undefined, currentOffsetY: number) {
  if (Number.isFinite(currentOffsetY)) return Math.max(0, currentOffsetY);
  return Math.max(0, (Number.isFinite(roleY) ? roleY as number : 0) - DRAWER_KEYBOARD_CONTENT_GAP);
}
