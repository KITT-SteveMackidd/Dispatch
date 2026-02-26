import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/context/session';
import { watchTeams } from '@/services/dispatch';
import { Team } from '@/types/dispatch';

export default function TeamsScreen() {
  const { profile } = useSession();
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    if (!profile || profile.role !== 'manager') return;
    return watchTeams(profile.uid, setTeams);
  }, [profile]);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Teams & Chat</Text>
      {profile?.role === 'worker' ? <Text style={styles.info}>Workers will see assigned teams and event chats here.</Text> : null}
      <FlatList
        data={teams}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Text style={styles.empty}>No teams yet. Create teams from manager tools next.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.card}>
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.meta}>{item.workerIds.length} workers</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b1020', padding: 16 },
  header: { color: 'white', fontSize: 24, fontWeight: '700', marginBottom: 12 },
  info: { color: '#9aa7d1', marginBottom: 10 },
  empty: { color: '#9aa7d1', paddingTop: 24 },
  card: { backgroundColor: '#131c37', padding: 14, borderRadius: 14, marginBottom: 10 },
  title: { color: 'white', fontWeight: '700', fontSize: 16 },
  meta: { color: '#9aa7d1', marginTop: 3 },
});
