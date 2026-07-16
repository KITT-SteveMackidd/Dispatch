import { Redirect } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';
import { useSession } from '@/context/session';

export default function Index() {
  const { authUser, loading, needsProfile, profile, requiresEmailVerification } = useSession();

  if (loading) {
    return (
      <View style={styles.screen}>
        <Image
          source={require('../assets/images/dispatch-splash-full.png')}
          style={styles.splashImage}
          resizeMode="contain"
        />
      </View>
    );
  }

  if (authUser && requiresEmailVerification) {
    return <Redirect href="/(auth)/verify-email" />;
  }

  if (authUser && needsProfile && !profile) {
    return <Redirect href="/(auth)/setup" />;
  }

  if (authUser) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/signin" />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#06132a',
  },
  splashImage: {
    width: '100%',
    maxWidth: 402,
    aspectRatio: 402 / 310,
  },
});
