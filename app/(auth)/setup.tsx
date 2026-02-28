import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import { AppRole } from '@/types/dispatch';

export default function SetupScreen() {
  const router = useRouter();
  const { setProfile } = useSession();
  const [name, setName] = useState('');
  const [role, setRole] = useState<AppRole>('manager');

  const createAccount = async () => {
    if (!name.trim()) return;
    await setProfile({ uid: `local-${Date.now()}`, displayName: name.trim(), role });
    router.replace('/(tabs)');
  };

  const quickDemoLogin = async (demoRole: AppRole) => {
    await setProfile({
      uid: demoRole === 'manager' ? 'demo-manager-001' : 'demo-worker-001',
      displayName: demoRole === 'manager' ? 'Demo Manager' : 'Demo Worker',
      role: demoRole,
    });
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Dispatch</Text>
      <Text style={styles.subtitle}>Manager/Worker event operations in one app.</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Your name" style={styles.input} />
      <View style={styles.row}>
        {(['manager', 'worker'] as AppRole[]).map((r) => (
          <Pressable key={r} onPress={() => setRole(r)} style={[styles.pill, role === r && styles.pillActive]}>
            <Text style={styles.pillText}>{r.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={styles.btn} onPress={createAccount}>
        <Text style={styles.btnText}>Continue</Text>
      </Pressable>

      <View style={styles.demoWrap}>
        <Text style={styles.demoLabel}>Quick demo login</Text>
        <View style={styles.row}>
          <Pressable style={[styles.pill, styles.demoPill]} onPress={() => quickDemoLogin('manager')}>
            <Text style={styles.pillText}>Demo Manager</Text>
          </Pressable>
          <Pressable style={[styles.pill, styles.demoPill]} onPress={() => quickDemoLogin('worker')}>
            <Text style={styles.pillText}>Demo Worker</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#0b1020' },
  title: { color: 'white', fontSize: 40, fontWeight: '700' },
  subtitle: { color: '#aab3d4', marginBottom: 20 },
  input: { backgroundColor: '#151c33', color: 'white', padding: 14, borderRadius: 12, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  pill: { padding: 12, borderRadius: 10, backgroundColor: '#151c33' },
  pillActive: { backgroundColor: '#3559ff' },
  pillText: { color: 'white', fontWeight: '600' },
  btn: { backgroundColor: '#21c67a', borderRadius: 12, padding: 14, alignItems: 'center' },
  btnText: { color: '#07130d', fontWeight: '700' },
  demoWrap: { marginTop: 20 },
  demoLabel: { color: '#9fb0df', marginBottom: 8, fontWeight: '600' },
  demoPill: { backgroundColor: '#22305d' },
});
