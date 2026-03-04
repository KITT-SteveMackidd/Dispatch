import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { AppRole } from '@/types/dispatch';

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp } = useSession();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AppRole>('manager');
  const [loading, setLoading] = useState(false);

  const onSignUp = async () => {
    if (!displayName.trim() || !email.trim() || !password) {
      return Alert.alert('Missing fields', 'Enter name, email, and password.');
    }

    setLoading(true);
    try {
      await signUp({ displayName: displayName.trim(), email, password, role });
      router.replace('/(tabs)');
    } catch (error) {
      Alert.alert('Sign up failed', error instanceof Error ? error.message : 'Unable to create account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>Set up your Dispatch access.</Text>

        <TextInput value={displayName} onChangeText={setDisplayName} placeholder="Full name" placeholderTextColor="#94a3b8" style={styles.input} />
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor="#94a3b8" style={styles.input} />
        <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" placeholderTextColor="#94a3b8" style={styles.input} />

        <View style={styles.row}>
          {(['manager', 'worker'] as AppRole[]).map((r) => (
            <Pressable key={r} onPress={() => setRole(r)} style={[styles.pill, role === r && styles.pillActive]}>
              <Text style={[styles.pillText, role === r && styles.pillTextActive]}>{r.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={[styles.btn, loading && { opacity: 0.65 }]} onPress={onSignUp} disabled={loading}>
          <Text style={styles.btnText}>{loading ? 'Creating...' : 'Create Account'}</Text>
        </Pressable>

        <Link href="/(auth)/signin" style={styles.link}>Already have an account? Sign in</Link>
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
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  pill: { padding: 11, borderRadius: 10, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  pillActive: { backgroundColor: '#dbeafe', borderColor: '#93c5fd' },
  pillText: { color: '#334155', fontWeight: '700' },
  pillTextActive: { color: '#1d4ed8' },
  btn: { backgroundColor: '#2563eb', borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 6 },
  btnText: { color: 'white', fontWeight: '700' },
  link: { color: '#2563eb', marginTop: 12, fontWeight: '600' },
});
