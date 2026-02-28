import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { AppRole } from '@/types/dispatch';

export default function SetupScreen() {
  const router = useRouter();
  const { authUser, saveProfile } = useSession();
  const [name, setName] = useState(authUser?.displayName || '');
  const [role, setRole] = useState<AppRole>('manager');
  const [saving, setSaving] = useState(false);

  const completeSetup = async () => {
    if (!authUser) return router.replace('/(auth)/signin');
    if (!name.trim()) return Alert.alert('Missing name', 'Please enter your name.');
    setSaving(true);
    try {
      await saveProfile({ displayName: name.trim(), role });
      router.replace('/(tabs)');
    } catch (error) {
      Alert.alert('Setup failed', error instanceof Error ? error.message : 'Unable to save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Complete Profile</Text>
      <Text style={styles.subtitle}>One-time role setup for Dispatch access.</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Your name" style={styles.input} placeholderTextColor="#8c9ac8" />
      <View style={styles.row}>
        {(['manager', 'worker'] as AppRole[]).map((r) => (
          <Pressable key={r} onPress={() => setRole(r)} style={[styles.pill, role === r && styles.pillActive]}>
            <Text style={styles.pillText}>{r.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={[styles.btn, saving && { opacity: 0.65 }]} onPress={completeSetup} disabled={saving}>
        <Text style={styles.btnText}>{saving ? 'Saving...' : 'Continue'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#0b1020' },
  title: { color: 'white', fontSize: 36, fontWeight: '700' },
  subtitle: { color: '#aab3d4', marginBottom: 20 },
  input: { backgroundColor: '#151c33', color: 'white', padding: 14, borderRadius: 12, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  pill: { padding: 12, borderRadius: 10, backgroundColor: '#151c33' },
  pillActive: { backgroundColor: '#3559ff' },
  pillText: { color: 'white', fontWeight: '600' },
  btn: { backgroundColor: '#21c67a', borderRadius: 12, padding: 14, alignItems: 'center' },
  btnText: { color: '#07130d', fontWeight: '700' },
});
