export const DRAWER_KEYBOARD_CONTENT_GAP = 16;

type KeyboardAwareDrawerScrollParams = {
  currentOffset: number;
  inputTop: number;
  inputHeight: number;
  viewportTop: number;
  viewportHeight: number;
  keyboardTop?: number;
  gap?: number;
};

export function getKeyboardAwareDrawerScrollOffset({
  currentOffset,
  inputTop,
  inputHeight,
  viewportTop,
  viewportHeight,
  keyboardTop,
  gap = DRAWER_KEYBOARD_CONTENT_GAP,
}: KeyboardAwareDrawerScrollParams) {
  const safeCurrentOffset = Math.max(0, Number.isFinite(currentOffset) ? currentOffset : 0);
  const viewportBottom = viewportTop + Math.max(0, viewportHeight);
  const visibleBottom = Math.min(viewportBottom, Number.isFinite(keyboardTop) ? keyboardTop as number : viewportBottom) - gap;
  const visibleTop = viewportTop + gap;
  const inputBottom = inputTop + Math.max(0, inputHeight);

  if (inputBottom > visibleBottom) {
    return Math.max(0, safeCurrentOffset + inputBottom - visibleBottom);
  }
  if (inputTop < visibleTop) {
    return Math.max(0, safeCurrentOffset - (visibleTop - inputTop));
  }
  return safeCurrentOffset;
}

export function getTemplateEditorReturnOffset(roleY: number | undefined, currentOffsetY: number) {
  if (Number.isFinite(currentOffsetY)) return Math.max(0, currentOffsetY);
  return Math.max(0, (Number.isFinite(roleY) ? roleY as number : 0) - DRAWER_KEYBOARD_CONTENT_GAP);
}
