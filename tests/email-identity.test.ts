import { describe, expect, it } from 'vitest';
import { canonicalizeEmail, normalizeEmail } from '../lib/email-identity';

describe('email identity', () => {
  it('normalizes case and surrounding whitespace', () => {
    expect(normalizeEmail('  Worker@Example.COM ')).toBe('worker@example.com');
  });

  it('preserves plus aliases as distinct Firebase account identities', () => {
    expect(canonicalizeEmail('smackamaz1+rrv1@gmail.com')).toBe('smackamaz1+rrv1@gmail.com');
    expect(canonicalizeEmail('smackamaz1+rrv2@gmail.com')).toBe('smackamaz1+rrv2@gmail.com');
    expect(canonicalizeEmail('smackamaz1+rrv1@gmail.com')).not.toBe(
      canonicalizeEmail('smackamaz1+rrv2@gmail.com')
    );
  });
});
