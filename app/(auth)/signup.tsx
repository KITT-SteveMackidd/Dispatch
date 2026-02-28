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
      <Text style={styles.title}>Sign Up</Text>
      <Text style={styles.subtitle}>Create your Dispatch account.</Text>

      <TextInput value={displayName} onChangeText={setDisplayName} placeholder="Full name" placeholderTextColor="#8c9ac8" style={styles.input} />
      <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor="#8c9ac8" style={styles.input} />
      <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" placeholderTextColor="#8c9ac8" style={styles.input} />

      <View style={styles.row}>
        {(['manager', 'worker'] as AppRole[]).map((r) => (
          <Pressable key={r} onPress={() => setRole(r)} style={[styles.pill, role === r && styles.pillActive]}>
            <Text style={styles.pillText}>{r.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={[styles.btn, loading && { opacity: 0.65 }]} onPress={onSignUp} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Creating...' : 'Create Account'}</Text>
      </Pressable>

      <Link href="/(auth)/signin" style={styles.link}>Already have an account? Sign in</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#0b1020' },
  title: { color: 'white', fontSize: 36, fontWeight: '700' },
  subtitle: { color: '#aab3d4', marginBottom: 20 },
  input: { backgroundColor: '#151c33', color: 'white', padding: 14, borderRadius: 12, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  pill: { padding: 12, borderRadius: 10, backgroundColor: '#151c33' },
  pillActive: { backgroundColor: '#3559ff' },
  pillText: { color: 'white', fontWeight: '600' },
  btn: { backgroundColor: '#21c67a', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 6 },
  btnText: { color: '#07130d', fontWeight: '700' },
  link: { color: '#7da2ff', marginTop: 14, fontWeight: '600' },
});
