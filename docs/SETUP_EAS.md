# Expo / EAS setup for Dispatch

This repo is now set up for:

- **EAS Update on every push to `master`** for JS/assets changes
- **Manual GitHub Actions development builds** for Android or iOS
- **Expo development client** builds that can be installed on your phone

## What was added

- `app.config.js` for dynamic Expo owner/project metadata
- `eas.json` with `development`, `preview`, and `production` profiles
- `.github/workflows/eas-update.yml` to publish updates on `master`
- `.github/workflows/eas-build-development.yml` to trigger dev builds manually
- `expo-updates` dependency

## One-time manual setup

### 1) Log in to Expo and link/create the EAS project

From the repo root:

```bash
npx expo login
npx eas login
npx eas project:init
```

If the project already exists in Expo, link to it instead of creating a new one.

After that, note these values:

- **Expo account/owner**
- **EAS project ID**

You can confirm them with:

```bash
npx eas project:info
```

## 2) Add GitHub repository secrets

In GitHub -> **Settings -> Secrets and variables -> Actions**, add:

- `EXPO_TOKEN`
  - Create at: https://expo.dev/accounts/[your-account]/settings/access-tokens
- `EXPO_PUBLIC_EXPO_OWNER`
  - Your Expo account or organization name
- `EXPO_PUBLIC_EAS_PROJECT_ID`
  - The UUID from `eas project:info`

## 3) Create the first standalone preview build

For an installable app that opens **without a local dev server** and can receive OTA updates from `master`:

From GitHub:

- Open **Actions**
- Run **Build preview app**
- Choose `ios`, `android`, or `all`

Or locally:

```bash
npx eas build --profile preview --platform ios
npx eas build --profile preview --platform android
```

## 4) Install the preview build on your phone

When the build finishes, Expo/EAS will provide an install page / QR code.

- **Android:** open the install link or scan the QR code on the device, then install the APK
- **iPhone:** install through the EAS device install flow / ad hoc install prompted by Expo

This preview build opens as a normal standalone app and does **not** require `npx expo start --dev-client`.

## 5) Use remote updates from `master`

After the preview build is installed:

- push JS/assets changes to `master`
- GitHub Actions publishes an **EAS Update** to the `production` branch
- the installed preview app will fetch that update on launch because the preview profile is pinned to the same update channel

## Optional: keep the development client too

The **Build development client** workflow still exists for debugging and local dev-server work:

```bash
npx expo start --dev-client
```

Use that only when you specifically want live local development.

## Important note about native changes

**EAS Update only delivers JS, images, fonts, and other bundled assets.**

If you change native dependencies, config plugins, permissions, app icons/splash, or anything requiring a native rebuild, run the **Build preview app** workflow again.

## Optional local commands

```bash
# Validate Expo config
npx expo config --type public

# Publish an update manually
npx eas update --branch production --message "Manual update"
```
