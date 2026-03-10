# Firebase session revocation runbook

Use this when an account is compromised or a user must be forced to re-authenticate on all devices.

## Preconditions

- Firebase project access with Admin SDK credentials.
- Target user's Firebase UID.

## Emergency revoke (all devices)

Run from a trusted admin machine:

```bash
node -e "
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const uid = process.argv[1];
admin.auth().revokeRefreshTokens(uid)
  .then(async () => {
    const user = await admin.auth().getUser(uid);
    console.log(JSON.stringify({ uid, tokensValidAfterTime: user.tokensValidAfterTime }, null, 2));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
" <FIREBASE_UID>
```

## Verification

1. Confirm `tokensValidAfterTime` was updated.
2. Ask user to re-open app: prior sessions should be rejected and app should route to sign-in.
3. Review auth logs for suspicious sign-ins and rotate account password.

## Client behavior in Dispatch

- Unverified users are gated to `/(auth)/verify-email`.
- Password reset flow is available from `/(auth)/signin`.
- Local session revocation path is available in Account Settings (`Revoke this session now`).
