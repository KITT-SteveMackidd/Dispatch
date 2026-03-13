# Dispatch OAuth Setup (Google + Apple)

Use this checklist to enable OAuth end-to-end for Expo + Firebase Auth.

## 1) Firebase Auth provider setup

### Google
1. Firebase Console -> Authentication -> Sign-in method -> Google -> Enable.
2. Set project support email.
3. Save.

### Apple
1. Firebase Console -> Authentication -> Sign-in method -> Apple -> Enable.
2. You will need Apple Developer credentials:
   - Services ID
   - Apple Team ID
   - Key ID
   - Private key (.p8)
3. Save.

---

## 2) Google OAuth client IDs

Create OAuth client IDs in Google Cloud Console (same project linked to Firebase):

- Web client ID
- iOS client ID (bundle ID must match app)
- Android client ID (package + SHA-1)

Put them in `.env`:

```bash
EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID=...
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...
```

---

## 3) Apple Developer setup

In Apple Developer account:
1. Create/confirm App ID with Sign in with Apple enabled.
2. Create Services ID for web-style OAuth callback.
3. Create Sign in with Apple key (download .p8 once).
4. In Firebase Apple provider config, enter Team ID, Key ID, Services ID, and .p8 key.

---

## 4) Expo app config sanity check

Ensure bundle/package identifiers are stable and match OAuth clients:

- `ios.bundleIdentifier`
- `android.package`

If using EAS builds, confirm project ID is set and consistent.

---

## 5) Test matrix

## Sign Up (OAuth)
- Google signup as Manager -> lands in app with `users.role=manager`
- Google signup as Worker -> lands in app with `users.role=worker`
- Apple signup as Manager -> lands in app with `users.role=manager`
- Apple signup as Worker -> lands in app with `users.role=worker`

## Sign In (OAuth)
- Existing Google user signs in -> existing role preserved
- Existing Apple user signs in -> existing role preserved

## Edge cases
- OAuth user exists in Auth but no Firestore profile -> setup flow forces role selection
- Worker invite auto-link still works when OAuth account email matches invite email

---

## 6) Release readiness notes

Before release:
- Validate on physical iOS + Android devices
- Validate TestFlight build for Apple sign-in
- Confirm all client IDs are for production app identifiers (not debug-only)
