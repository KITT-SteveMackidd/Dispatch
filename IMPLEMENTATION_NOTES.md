# Implementation Notes (Foundation Pass)

## Deferred / Follow-up

### Today screen (`dispatch/app/(tabs)/today.tsx`)
- Complete dark-mode tokenization for all nested card internals (worker cards, progress labels, checklist chip states) to eliminate remaining hardcoded light colors.
- Consider extracting reusable status/badge token helpers to avoid duplicated color logic.

### Teams screen (`dispatch/app/(tabs)/teams.tsx`)
- Finish dark-mode pass for drawer mode buttons, success/error messages, and secondary action button variants.
- Normalize chip active-state colors for dark mode for better contrast consistency.

### Events tab screen (`dispatch/app/(tabs)/index.tsx`)
- Further refactor style definitions to shared theme tokens/components (current pass fixes obvious readability issues; still has mixed inline + per-screen styles).
- Add interaction states (pressed/disabled) that are fully theme-aware.

### Global
- Migrate repeated palette literals into shared theme tokens for all screens to reduce drift.
