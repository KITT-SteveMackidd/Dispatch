import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/context/session';
import { loadUserProfilesByIds } from '@/services/dispatch';
import { UserProfile } from '@/types/dispatch';

type TeamMember = {
  id: string;
  label: string;
  isAll?: boolean;
};

export default function TeamMembersScreen() {
  const router = useRouter();
  const { profile } = useSession();
  const params = useLocalSearchParams<{ teamId?: string; teamName?: string; memberIds?: string }>();

  const teamId = params.teamId ?? 'team';
  const teamName = params.teamName ?? 'Team';
  const [profilesById, setProfilesById] = useState<Record<string, UserProfile>>({});

  const memberIds = useMemo(() => (
    (params.memberIds || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  ), [params.memberIds]);

  useEffect(() => {
    if (!memberIds.length) {
      setProfilesById({});
      return;
    }

    loadUserProfilesByIds(memberIds)
      .then((items) => {
        const map: Record<string, UserProfile> = {};
        items.forEach((item) => {
          map[item.uid] = item;
        });
        setProfilesById(map);
      })
      .catch(() => setProfilesById({}));
  }, [memberIds]);

  const members = useMemo<TeamMember[]>(() => {
    const uniqueIds = [...new Set(memberIds)];
    const items: TeamMember[] = [{ id: `all:${teamId}`, label: 'All', isAll: true }];

    uniqueIds.forEach((id) => {
      items.push({ id, label: profilesById[id]?.displayName || id });
    });

    return items;
  }, [memberIds, profilesById, teamId]);

  const openChat = (member: TeamMember) => {
    router.push({
      pathname: '/chat/[workerId]',
      params: {
        workerId: member.id,
        workerLabel: member.label,
        teamName,
        teamId,
        teamMemberIds: (params.memberIds || ''),
        senderId: profile?.uid,
      },
    });
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `${teamName} Members` }} />

      <Text style={styles.subhead}>Choose a member to open chat</Text>

      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable style={[styles.card, item.isAll && styles.allCard]} onPress={() => openChat(item)}>
            <View style={[styles.avatar, item.isAll && styles.allAvatar]}>
              <Text style={[styles.avatarText, item.isAll && styles.allAvatarText]}>
                {item.isAll ? 'ALL' : item.label.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.label}</Text>
              <Text style={styles.meta}>{item.isAll ? 'Broadcast to team members' : 'Direct message'}</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eef2ff', padding: 16 },
  subhead: { color: '#334155', fontWeight: '600', marginBottom: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  allCard: {
    borderColor: '#93c5fd',
    backgroundColor: '#eff6ff',
  },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  allAvatar: { backgroundColor: '#2563eb' },
  avatarText: { fontWeight: '700', color: '#1d4ed8' },
  allAvatarText: { color: '#fff', fontSize: 10 },
  title: { color: '#0f172a', fontWeight: '700', fontSize: 16 },
  meta: { color: '#64748b', marginTop: 2, fontSize: 12 },
});