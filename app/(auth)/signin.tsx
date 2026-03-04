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
      <View style={styles.card}>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to continue managing your Dispatch events.</Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="Email"
          placeholderTextColor="#94a3b8"
          style={styles.input}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password"
          placeholderTextColor="#94a3b8"
          style={styles.input}
        />

        <Pressable style={[styles.btn, loading && { opacity: 0.65 }]} onPress={onSignIn} disabled={loading}>
          <Text style={styles.btnText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
        </Pressable>

        <Link href="/(auth)/signup" style={styles.link}>Create an account</Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center', backgroundColor: '#eef2ff' },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', padding: 18 },
  title: { color: '#0f172a', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#64748b', marginBottom: 16, marginTop: 4 },
  input: { backgroundColor: '#f8fafc', color: '#0f172a', padding: 13, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  btn: { backgroundColor: '#2563eb', borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 6 },
  btnText: { color: 'white', fontWeight: '700' },
  link: { color: '#2563eb', marginTop: 12, fontWeight: '600' },
});
