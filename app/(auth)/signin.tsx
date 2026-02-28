import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSession } from '@/context/session';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSignIn = async () => {
    if (!email.trim() || !password) return Alert.alert('Missing fields', 'Enter email and password.');
    setLoading(true);
    try {
      await signIn(email, password);
      router.replace('/(tabs)');
    } catch (error) {
      Alert.alert('Sign in failed', error instanceof Error ? error.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign In</Text>
      <Text style={styles.subtitle}>Use your Dispatch account.</Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="Email"
        placeholderTextColor="#8c9ac8"
        style={styles.input}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
        placeholderTextColor="#8c9ac8"
        style={styles.input}
      />

      <Pressable style={[styles.btn, loading && { opacity: 0.65 }]} onPress={onSignIn} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
      </Pressable>

      <Link href="/(auth)/signup" style={styles.link}>Create an account</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#0b1020' },
  title: { color: 'white', fontSize: 36, fontWeight: '700' },
  subtitle: { color: '#aab3d4', marginBottom: 20 },
  input: { backgroundColor: '#151c33', color: 'white', padding: 14, borderRadius: 12, marginBottom: 12 },
  btn: { backgroundColor: '#21c67a', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 6 },
  btnText: { color: '#07130d', fontWeight: '700' },
  link: { color: '#7da2ff', marginTop: 14, fontWeight: '600' },
});
