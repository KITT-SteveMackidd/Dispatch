import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/context/session';

export default function Index() {
  const { authUser, loading, needsProfile, profile, requiresEmailVerification } = useSession();

  if (loading) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Dispatch</Text>
        <Text style={styles.text}>Loading account...</Text>
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
    backgroundColor: '#061229',
    padding: 24,
  },
  title: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 8,
  },
  text: {
    color: '#dbeafe',
    fontSize: 16,
    fontWeight: '700',
  },
});
