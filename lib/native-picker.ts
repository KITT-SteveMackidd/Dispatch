export type NativePickerChangeAction = 'ignore' | 'stage' | 'commit' | 'dismiss';

export function resolveNativePickerChangeAction(
  platform: string,
  eventType: string,
  hasSelectedValue: boolean
): NativePickerChangeAction {
  if (platform === 'android') {
    return eventType === 'dismissed' || !hasSelectedValue ? 'dismiss' : 'commit';
  }

  return eventType === 'dismissed' || !hasSelectedValue ? 'ignore' : 'stage';
}
