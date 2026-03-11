import { useEffect, useMemo, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { loadUserProfilesByIds } from '@/services/dispatch';
import { UserProfile } from '@/types/dispatch';
import { useThemeMode } from '@/context/theme';

type MemberInfo = Pick<UserProfile, 'uid' | 'displayName' | 'phoneNumber'>;

export default function TeamMemberListScreen() {
  const router = useRouter();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
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
        teamId,
        teamName,
        teamMemberIds: memberIds.join(','),
        isTeamAll: isTeamAll ? '1' : '0',
        teamThreadPath: isTeamAll ? `teams/${teamId}/all` : undefined,
      },
    });
  };

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <Stack.Screen options={{ title: `${teamName} Members` }} />

      <Text style={[styles.subhead, isDarkMode ? styles.subheadDark : styles.subheadLight]}>Choose who to message in {teamName}.</Text>

      <FlatList
        contentContainerStyle={styles.listContent}
        data={[{ uid: `all:${teamId}`, displayName: 'All', phoneNumber: 'Send to the full team' }, ...members]}
        keyExtractor={(item) => item.uid}
        renderItem={({ item }) => {
          const isAll = item.displayName === 'All';
          return (
            <Pressable
              style={[
                styles.card,
                isDarkMode ? styles.cardDark : styles.cardLight,
                isAll && (isDarkMode ? styles.allCardDark : styles.allCardLight),
              ]}
              onPress={() => openChat(item.uid, item.displayName, isAll)}
            >
              <View style={[styles.avatar, isAll && styles.allAvatar]}>
                <Text style={[styles.avatarText, isAll && styles.allAvatarText]}>{isAll ? 'All' : item.displayName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>{item.displayName}</Text>
                <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>{isAll ? 'Broadcast to everyone on this team' : item.phoneNumber || 'Phone not available'}</Text>
              </View>
              <Text style={[styles.openLabel, isDarkMode ? styles.openLabelDark : styles.openLabelLight]}>Open</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#101A2F' },
  subhead: { fontWeight: '500' },
  subheadLight: { color: '#475569' },
  subheadDark: { color: '#F4F8FF' },
  listContent: { paddingTop: 10, paddingBottom: 12, gap: 10 },
  card: { borderRadius: 12, padding: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#1A2540', borderColor: '#001A4D' },
  allCardLight: { borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  allCardDark: { borderColor: '#001A4D', backgroundColor: '#001A4D' },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  allAvatar: { backgroundColor: '#2563eb' },
  avatarText: { fontWeight: '700', color: '#1d4ed8' },
  allAvatarText: { color: '#fff', fontSize: 11 },
  title: { fontWeight: '700', fontSize: 16 },
  titleLight: { color: '#232832' },
  titleDark: { color: '#F4F8FF' },
  meta: { marginTop: 2, fontSize: 12 },
  metaLight: { color: '#64748b' },
  metaDark: { color: '#F4F8FF' },
  openLabel: { fontSize: 12, fontWeight: '700' },
  openLabelLight: { color: '#2563eb' },
  openLabelDark: { color: '#0EC3C9' },
});