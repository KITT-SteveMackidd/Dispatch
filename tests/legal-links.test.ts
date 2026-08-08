import { describe, expect, it } from 'vitest';
import { DISPATCH_PRIVACY_URL, DISPATCH_SUPPORT_EMAIL, DISPATCH_SUPPORT_URL } from '../constants/legal';

describe('public release links', () => {
  it('uses HTTPS website URLs and a working support address', () => {
    expect(DISPATCH_PRIVACY_URL).toBe('https://dispatchcrewmanager.com/privacy');
    expect(DISPATCH_SUPPORT_URL).toBe('https://dispatchcrewmanager.com/support');
    expect(DISPATCH_SUPPORT_EMAIL).toContain('@');
  });
});
