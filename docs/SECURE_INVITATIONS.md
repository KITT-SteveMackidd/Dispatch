# Secure Dispatch Invitations

Dispatch invitations use a server-generated, one-time token. The delivery email is not used as the recipient's account identity. After opening an invitation, the recipient may authenticate with Apple, Google, or email and explicitly claim the invitation for that Firebase UID.

## Firebase deployment

Deploy the callable Functions and Firestore rules together:

```powershell
firebase deploy --project dispatch-eb63a --only functions:createDispatchInvite,functions:getDispatchInvite,functions:claimDispatchInvite,firestore:rules
```

The Functions default invitation URL is:

```text
https://dispatchcrewmanager.com/invite/<one-time-token>
```

To use another HTTPS base URL, configure `DISPATCH_INVITE_BASE_URL` for the Functions runtime before deployment. Do not put the raw invitation token in an environment variable or Firestore document field.

## Website association

The native app declares `dispatchcrewmanager.com` for iOS Universal Links and Android App Links. The website must also serve both association files without redirects.

### iOS

Serve this JSON at:

```text
https://dispatchcrewmanager.com/.well-known/apple-app-site-association
```

Replace `APPLE_TEAM_ID` with the Apple Developer Team ID:

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["APPLE_TEAM_ID.com.smackidd.dispatch"],
        "components": [
          { "/": "/invite/*" }
        ]
      }
    ]
  }
}
```

Serve it as `application/json` with no filename extension.

### Android

Serve this JSON at:

```text
https://dispatchcrewmanager.com/.well-known/assetlinks.json
```

Replace `ANDROID_SIGNING_SHA256` with the SHA-256 fingerprint of the Android production signing certificate:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.smackidd.dispatch",
      "sha256_cert_fingerprints": ["ANDROID_SIGNING_SHA256"]
    }
  }
]
```

The website `/invite/<token>` route should preserve the token, offer the App Store/Google Play download when Dispatch is not installed, and provide the fallback invitation code. The email also includes `dispatch://invite/<token>` for an already-installed app.

## Testing

Incoming Universal Links require a development, preview, TestFlight, or store build. Expo Go has limited incoming-link support. The fallback code can be tested in Expo Go through **Sign In > Use Invitation Code** or **Profile > Use Invitation Code**.
