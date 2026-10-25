import { describe, expect, it } from 'vitest';
import { compatibilityErrors } from '../scripts/check-expo-go-compatibility.mjs';

const valid = { deviceSdk: 58, installedExpo: '58.0.19', declaredExpo: '~58.0.19', publishedSdk: '58.0.0', manifestSdk: '58.0.0' };
describe('physical iPhone Expo Go compatibility gate', () => {
  it('accepts the current matching SDK', () => expect(compatibilityErrors(valid)).toEqual([]));
  it('rejects the SDK 57 checkout that failed on the phone', () => expect(compatibilityErrors({ ...valid, installedExpo: '57.0.30' })).not.toEqual([]));
  it('rejects stale Metro even after dependencies were upgraded', () => expect(compatibilityErrors({ ...valid, manifestSdk: '57.0.0' })).not.toEqual([]));
  it('never lowers the target to stale public metadata', () => expect(compatibilityErrors({ ...valid, publishedSdk: '57.0.0' })).toEqual([]));
  it('blocks handoff after a newly published Expo Go SDK', () => expect(compatibilityErrors({ ...valid, publishedSdk: '59.0.0' })).not.toEqual([]));
  it('rejects a missing manifest SDK', () => expect(compatibilityErrors({ ...valid, manifestSdk: '' })).not.toEqual([]));
});
