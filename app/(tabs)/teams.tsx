import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import {
  createTeam,
  inviteWorkerByEmailToTeam,
  loadUserProfilesByIds,
  loadWorkerTeams,
  seedDemoData,
  watchManagerEvents,
  watchManagerTeams,
  watchUserTeamUnreadCounts,
  watchWorkerEvents,
} from '@/services/dispatch';
import { DispatchEvent, Team, UserProfile } from '@/types/dispatch';
import { useThemeMode } from '@/context/theme';

type DrawerMode = 'add-team' | 'invite-worker';

export default function TeamsScreen() {
  const { profile } = useSession();
  const router = useRouter();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const [teams, setTeams] = useState<Team[]>([]);
  const [events, setEvents] = useState<DispatchEvent[]>([]);
  const [seeding, setSeeding] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('add-team');
  const [teamName, setTeamName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteTeamId, setInviteTeamId] = useState('');
  const [saving, setSaving] = useState(false);
  const [drawerMessage, setDrawerMessage] = useState<string | null>(null);
  const [drawerMessageTone, setDrawerMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [memberInfoById, setMemberInfoById] = useState<Record<string, Pick<UserProfile, 'displayName' | 'phoneNumber'>>>({});
  const [unreadCountByTeamId, setUnreadCountByTeamId] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!profile) return;
    if (profile.role === 'manager') {
      const unsubTeams = watchManagerTeams(profile.uid, setTeams);
      const unsubEvents = watchManagerEvents(profile.uid, setEvents);
      return () => {
        unsubTeams();
        unsubEvents();
      };
    }

    const unsubEvents = watchWorkerEvents(profile.uid, setEvents);
    loadWorkerTeams(profile.uid).then(setTeams).catch(() => setTeams([]));
    return unsubEvents;
  }, [profile]);

  useEffect(() => {
    if (!inviteTeamId && teams.length) setInviteTeamId(teams[0].id);
  }, [teams, inviteTeamId]);

  useEffect(() => {
    if (!profile) {
      setUnreadCountByTeamId({});
      return;
    }

    return watchUserTeamUnreadCounts(profile.uid, (items) => {
      const next = items.reduce<Record<string, number>>((acc, item) => {
        acc[item.teamId] = item.unreadCount;
        return acc;
      }, {});
      setUnreadCountByTeamId(next);
    });
  }, [profile]);

  useEffect(() => {
    if (!profile || !teams.length) {
      setMemberInfoById({});
      return;
    }

    const ids = [...new Set(teams.flatMap((team) => [team.managerId, ...team.workerIds]).filter((id) => id && id !== profile.uid))];

    if (!ids.length) {
      setMemberInfoById({});
      return;
    }

    let active = true;
    loadUserProfilesByIds(ids)
      .then((members) => {
        if (!active) return;
        const next = members.reduce<Record<string, Pick<UserProfile, 'displayName' | 'phoneNumber'>>>((acc, member) => {
          acc[member.uid] = {
            displayName: member.displayName || 'Dispatch User',
            phoneNumber: member.phoneNumber,
          };
          return acc;
        }, {});
        setMemberInfoById(next);
      })
      .catch(() => {
        if (!active) return;
        setMemberInfoById({});
      });

    return () => {
      active = false;
    };
  }, [teams, profile]);

  const eventCountsByTeam = useMemo(() => {
    const counts = new Map<string, number>();
    events.forEach((event) => {
      event.teamIds.forEach((teamId) => {
        counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
      });
    });
    return counts;
  }, [events]);

  const getOtherMemberIds = (team: Team) => {
    if (!profile) return [];
    return [...new Set([team.managerId, ...team.workerIds].filter((memberId) => memberId && memberId !== profile.uid))];
  };

  const handleTeamPress = (team: Team) => {
    if (!profile) return;

    const otherMemberIds = getOtherMemberIds(team);
    if (!otherMemberIds.length) return;

    if (otherMemberIds.length === 1) {
      const memberId = otherMemberIds[0];
      router.push({
        pathname: '/chat/[workerId]',
        params: {
          workerId: memberId,
          workerLabel: memberInfoById[memberId]?.displayName || memberId,
          teamId: team.id,
          teamName: team.name,
        },
      });
      return;
    }

    router.push({
      pathname: '/team/[teamId]',
      params: {
        teamId: team.id,
        teamName: team.name,
        memberIds: otherMemberIds.join(','),
      },
    });
  };

  const handleSeedDemo = async () => {
    if (!profile) return;
    setSeeding(true);
    try {
      await seedDemoData(profile);
    } finally {
      setSeeding(false);
    }
  };

  const openDrawer = () => {
    setDrawerMode('add-team');
    setDrawerMessage(null);
    setDrawerMessageTone('info');
    setTeamName('');
    setInviteEmail('');
    setDrawerOpen(true);
  };

  const handleSubmitDrawer = async () => {
    if (!profile || profile.role !== 'manager') return;
    setSaving(true);
    setDrawerMessage(null);
    setDrawerMessageTone('info');

    try {
      if (drawerMode === 'add-team') {
        await createTeam(profile.uid, teamName);
        setTeamName('');
        setDrawerMessageTone('success');
        setDrawerMessage('Team created.');
      } else {
        if (!inviteTeamId) {
          setDrawerMessageTone('error');
          setDrawerMessage('Choose a team first.');
          return;
        }
        const result = await inviteWorkerByEmailToTeam({ managerId: profile.uid, teamId: inviteTeamId, email: inviteEmail });
        setInviteEmail('');
        setDrawerMessageTone('success');
        setDrawerMessage(
          result.linked
            ? 'Worker account found and linked to the team.'
            : 'Invite sent. Worker will link automatically after they sign in with this email.'
        );
      }
    } catch (error) {
      setDrawerMessageTone('error');
      setDrawerMessage(error instanceof Error ? error.message : 'Unable to complete this action.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}>
      <View style={styles.headerRow}>
        <Text style={[styles.subhead, isDarkMode ? styles.subheadDark : styles.subheadLight]}>Manage Your Team</Text>
        {profile?.role === 'manager' ? (
          <Pressable style={styles.createButton} onPress={openDrawer}>
            <Text style={styles.createButtonText}>+</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={teams}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Text style={[styles.empty, isDarkMode ? styles.emptyDark : styles.emptyLight]}>No teams found yet. Tap Add Demo Team Data.</Text>}
        renderItem={({ item }) => {
          const otherCount = getOtherMemberIds(item).length;
          const unreadCount = unreadCountByTeamId[item.id] ?? 0;
          return (
            <Pressable style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]} onPress={() => handleTeamPress(item)}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>{item.name}</Text>
                <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>{item.workerIds.length} workers</Text>
              </View>
              <View style={styles.rightSide}>
                <Text style={[styles.status, isDarkMode ? styles.statusDark : styles.statusLight]}>{eventCountsByTeam.get(item.id) ?? 0} events</Text>
                {unreadCount > 0 ? (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                  </View>
                ) : null}
                <Text style={[styles.hint, isDarkMode ? styles.hintDark : styles.hintLight]}>{otherCount > 1 ? 'Choose member' : otherCount === 1 ? 'Open chat' : 'No members'}</Text>
              </View>
            </Pressable>
          );
        }}
      />

      <Pressable style={styles.addBtn} onPress={handleSeedDemo} disabled={seeding || !profile}>
        {seeding ? <ActivityIndicator color="white" /> : <Text style={styles.addText}>+ Add Demo Team Data</Text>}
      </Pressable>

      <Modal visible={drawerOpen} animationType="slide" transparent onRequestClose={() => setDrawerOpen(false)}>
        <Pressable style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)}>
          <Pressable style={[styles.drawer, isDarkMode ? styles.drawerDark : styles.drawerLight]} onPress={() => null}>
            <Text style={[styles.drawerTitle, isDarkMode ? styles.drawerTitleDark : styles.drawerTitleLight]}>Team Actions</Text>
            <Text style={[styles.drawerSub, isDarkMode ? styles.drawerSubDark : styles.drawerSubLight]}>Add teams or invite workers to your app.</Text>

            <View style={styles.modeRow}>
              <Pressable style={[styles.modeButton, drawerMode === 'add-team' && styles.modeButtonActive]} onPress={() => { setDrawerMode('add-team'); setDrawerMessage(null); setDrawerMessageTone('info'); }}>
                <Text style={[styles.modeText, drawerMode === 'add-team' && styles.modeTextActive]}>Add Team</Text>
              </Pressable>
              <Pressable style={[styles.modeButton, drawerMode === 'invite-worker' && styles.modeButtonActive]} onPress={() => { setDrawerMode('invite-worker'); setDrawerMessage(null); setDrawerMessageTone('info'); }}>
                <Text style={[styles.modeText, drawerMode === 'invite-worker' && styles.modeTextActive]}>Invite Worker</Text>
              </Pressable>
            </View>

            {drawerMode === 'add-team' ? (
              <>
                <Text style={[styles.fieldLabel, isDarkMode ? styles.fieldLabelDark : styles.fieldLabelLight]}>Team name</Text>
                <TextInput value={teamName} onChangeText={setTeamName} placeholder="Example: Night Shift Crew" placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'} style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]} />
              </>
            ) : (
              <>
                <Text style={[styles.fieldLabel, isDarkMode ? styles.fieldLabelDark : styles.fieldLabelLight]}>Choose team</Text>
                <View style={styles.teamChipWrap}>
                  {teams.length ? teams.map((team) => (
                    <Pressable key={team.id} style={[styles.teamChip, isDarkMode ? styles.teamChipDark : styles.teamChipLight, inviteTeamId === team.id && styles.teamChipActive]} onPress={() => setInviteTeamId(team.id)}>
                      <Text style={[styles.teamChipText, isDarkMode ? styles.teamChipTextDark : styles.teamChipTextLight, inviteTeamId === team.id && styles.teamChipTextActive]}>{team.name}</Text>
                    </Pressable>
                  )) : <Text style={styles.emptyHint}>Create a team first.</Text>}
                </View>

                <Text style={[styles.fieldLabel, isDarkMode ? styles.fieldLabelDark : styles.fieldLabelLight]}>Worker email</Text>
                <TextInput value={inviteEmail} onChangeText={setInviteEmail} placeholder="worker@example.com" placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'} style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]} autoCapitalize="none" keyboardType="email-address" />
                <Text style={[styles.helperText, isDarkMode ? styles.helperTextDark : styles.helperTextLight]}>
                  Invite keeps this worker unlinked until they sign in with that email.
                </Text>
              </>
            )}

            {drawerMessage ? (
              <Text style={[styles.message, drawerMessageTone === 'error' ? styles.messageError : drawerMessageTone === 'success' ? styles.messageSuccess : styles.messageInfo]}>
                {drawerMessage}
              </Text>
            ) : null}

            <Pressable style={[styles.drawerSave, saving && styles.drawerSaveDisabled]} onPress={handleSubmitDrawer} disabled={saving}>
              <Text style={styles.drawerSaveText}>{saving ? 'Saving...' : drawerMode === 'add-team' ? 'Create Team' : 'Invite Worker'}</Text>
            </Pressable>

            <Pressable style={styles.drawerClose} onPress={() => setDrawerOpen(false)}>
              <Text style={styles.drawerCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#181B24' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  subhead: { fontWeight: '600' },
  subheadLight: { color: '#334155' },
  subheadDark: { color: '#cbd5e1' },
  createButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1d4ed8', alignItems: 'center', justifyContent: 'center' },
  createButtonText: { color: '#fff', fontSize: 24, lineHeight: 24, fontWeight: '500', marginTop: -1 },
  empty: { marginTop: 20 },
  emptyLight: { color: '#64748b' },
  emptyDark: { color: '#94a3b8' },
  card: { borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#232832', borderColor: '#1e293b' },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700', color: '#1d4ed8' },
  title: { fontWeight: '700', fontSize: 16 },
  titleLight: { color: '#232832' },
  titleDark: { color: '#f8fafc' },
  meta: { marginTop: 2, fontSize: 12 },
  metaLight: { color: '#64748b' },
  metaDark: { color: '#94a3b8' },
  rightSide: { alignItems: 'flex-end' },
  status: { fontSize: 12, fontWeight: '600' },
  statusLight: { color: '#475569' },
  statusDark: { color: '#cbd5e1' },
  hint: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  hintLight: { color: '#2563eb' },
  hintDark: { color: '#93c5fd' },
  unreadBadge: { marginTop: 6, backgroundColor: '#dc2626', borderRadius: 999, minWidth: 20, paddingHorizontal: 6, height: 20, alignItems: 'center', justifyContent: 'center' },
  unreadBadgeText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  addBtn: { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  addText: { color: 'white', fontWeight: '700' },
  drawerBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.35)', justifyContent: 'flex-end' },
  drawer: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '76%' },
  drawerLight: { backgroundColor: '#fff' },
  drawerDark: { backgroundColor: '#232832' },
  drawerTitle: { fontWeight: '700', fontSize: 18 },
  drawerTitleLight: { color: '#232832' },
  drawerTitleDark: { color: '#f8fafc' },
  drawerSub: { fontSize: 12, marginTop: 4 },
  drawerSubLight: { color: '#64748b' },
  drawerSubDark: { color: '#94a3b8' },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modeButton: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', paddingVertical: 10, alignItems: 'center', backgroundColor: '#f8fafc' },
  modeButtonActive: { borderColor: '#1d4ed8', backgroundColor: '#dbeafe' },
  modeText: { color: '#334155', fontWeight: '600' },
  modeTextActive: { color: '#1e40af' },
  fieldLabel: { marginTop: 14, fontSize: 12, fontWeight: '700' },
  fieldLabelLight: { color: '#334155' },
  fieldLabelDark: { color: '#cbd5e1' },
  input: { marginTop: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  inputLight: { borderColor: '#cbd5e1', color: '#232832', backgroundColor: '#fff' },
  inputDark: { borderColor: '#334155', color: '#e2e8f0', backgroundColor: '#232832' },
  teamChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  teamChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  teamChipLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  teamChipDark: { borderColor: '#334155', backgroundColor: '#232832' },
  teamChipActive: { borderColor: '#1d4ed8', backgroundColor: '#dbeafe' },
  teamChipText: { fontSize: 12, fontWeight: '600' },
  teamChipTextLight: { color: '#475569' },
  teamChipTextDark: { color: '#cbd5e1' },
  teamChipTextActive: { color: '#1e3a8a' },
  emptyHint: { color: '#64748b', fontSize: 12, marginTop: 4 },
  helperText: { marginTop: 6, fontSize: 11 },
  helperTextLight: { color: '#64748b' },
  helperTextDark: { color: '#94a3b8' },
  message: { marginTop: 12, fontSize: 12, fontWeight: '600' },
  messageInfo: { color: '#1e40af' },
  messageSuccess: { color: '#15803d' },
  messageError: { color: '#b91c1c' },
  drawerSave: { marginTop: 14, backgroundColor: '#1d4ed8', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  drawerSaveDisabled: { opacity: 0.7 },
  drawerSaveText: { color: '#fff', fontWeight: '700' },
  drawerClose: { marginTop: 8, backgroundColor: '#e2e8f0', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  drawerCloseText: { color: '#334155', fontWeight: '700' },
});
