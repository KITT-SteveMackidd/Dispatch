// These runtime registrations are required by Expo Go as well as native builds.
// Keep the family names in sync with components/auth/authStyles.ts.
export async function loadStartupFonts() {
  const { loadAsync } = require('expo-font') as typeof import('expo-font');

  await loadAsync({
    Inter: require('../../assets/fonts/Inter-Regular.ttf'),
    'Inter-SemiBold': require('../../assets/fonts/Inter-SemiBold.ttf'),
    'Inter-Bold': require('../../assets/fonts/Inter-Bold.ttf'),
    'Inter-ExtraBold': require('../../assets/fonts/Inter-ExtraBold.ttf'),
    SpaceMono: require('../../assets/fonts/SpaceMono-Regular.ttf'),
  });
}
