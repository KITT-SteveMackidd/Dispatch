import { useEffect, useMemo, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { loadUserProfilesByIds } from '@/services/dispatch';
import { UserProfile } from '@/types/dispatch';

type MemberInfo = Pick<UserProfile, 'uid' | 'displayName' | 'phoneNumber'>;

export default function TeamMemberListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ teamId?: string; teamName?: string; memberIds?: string }>();

  const teamId = params.teamId ?? 'team';
  const teamName = params.teamName ?? 'Team';
  const memberIds = useMemo(() => (params.memberIds || '').split(',').map((id) => id.trim()).filter(Boolean), [params.memberIds]);
  const [members, setMembers] = useState<MemberInfo[]>([]);

  useEffect(() => {
    if (!memberIds.length) {
      setMembers([]);
      return;
    }

    let active = true;
    loadUserProfilesByIds(memberIds)
      .then((profiles) => {
        if (!active) return;
        const byId = new Map(profiles.map((profile) => [profile.uid, profile]));
        const orderedMembers = memberIds.map((memberId) => {
          const profile = byId.get(memberId);
          return {
            uid: memberId,
            displayName: profile?.displayName || 'Dispatch User',
            phoneNumber: profile?.phoneNumber,
          };
        });
        setMembers(orderedMembers);
      })
      .catch(() => {
        if (!active) return;
        setMembers(memberIds.map((memberId) => ({ uid: memberId, displayName: memberId })));
      });

    return () => {
      active = false;
    };
  }, [memberIds]);

  const openChat = (workerId: string, workerLabel: string, isTeamAll = false) => {
    router.push({
      pathname: '/chat/[workerId]',
      params: {
        workerId,
        workerLabel,
        teamName,
        teamMemberIds: memberIds.join(','),
        isTeamAll: isTeamAll ? '1' : '0',
      },
    });
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `${teamName} Members` }} />

      <Text style={styles.subhead}>Choose who to message in {teamName}.</Text>

      <FlatList
        contentContainerStyle={styles.listContent}
        data={[{ uid: `team:${teamId}:all`, displayName: 'All', phoneNumber: 'Send to the full team' }, ...members]}
        keyExtractor={(item) => item.uid}
        renderItem={({ item }) => {
          const isAll = item.displayName === 'All';
          return (
            <Pressable
              style={[styles.card, isAll && styles.allCard]}
              onPress={() => openChat(item.uid, item.displayName, isAll)}
            >
              <View style={[styles.avatar, isAll && styles.allAvatar]}>
                <Text style={[styles.avatarText, isAll && styles.allAvatarText]}>{isAll ? 'All' : item.displayName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.displayName}</Text>
                <Text style={styles.meta}>{isAll ? 'Broadcast to everyone on this team' : item.phoneNumber || 'Phone not available'}</Text>
              </View>
              <Text style={styles.openLabel}>Open</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eef2ff', padding: 16 },
  subhead: { color: '#475569', fontWeight: '500' },
  listContent: { paddingTop: 10, paddingBottom: 12, gap: 10 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center', gap: 10 },
  allCard: { borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  allAvatar: { backgroundColor: '#2563eb' },
  avatarText: { fontWeight: '700', color: '#1d4ed8' },
  allAvatarText: { color: '#fff', fontSize: 11 },
  title: { color: '#0f172a', fontWeight: '700', fontSize: 16 },
  meta: { color: '#64748b', marginTop: 2, fontSize: 12 },
  openLabel: { color: '#2563eb', fontSize: 12, fontWeight: '700' },
});
