export function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() || '';
}

// Firebase Auth treats plus-addressed emails as distinct account identifiers.
// Preserve the complete local part so invites link only to the intended account.
export function canonicalizeEmail(email?: string | null) {
  return normalizeEmail(email);
}
