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
  watchWorkerEvents,
} from '@/services/dispatch';
import { DispatchEvent, Team, UserProfile } from '@/types/dispatch';

type DrawerMode = 'add-team' | 'invite-worker';

export default function TeamsScreen() {
  const { profile } = useSession();
  const router = useRouter();
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
  const [memberInfoById, setMemberInfoById] = useState<Record<string, Pick<UserProfile, 'displayName' | 'phoneNumber'>>>({});

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
    setTeamName('');
    setInviteEmail('');
    setDrawerOpen(true);
  };

  const handleSubmitDrawer = async () => {
    if (!profile || profile.role !== 'manager') return;
    setSaving(true);
    setDrawerMessage(null);

    try {
      if (drawerMode === 'add-team') {
        await createTeam(profile.uid, teamName);
        setTeamName('');
        setDrawerMessage('Team created.');
      } else {
        if (!inviteTeamId) {
          setDrawerMessage('Choose a team first.');
          return;
        }
        const result = await inviteWorkerByEmailToTeam({
          managerId: profile.uid,
          teamId: inviteTeamId,
          email: inviteEmail,
          managerName: profile.displayName,
        });
        setInviteEmail('');
        setDrawerMessage(result.linked ? 'Worker added to team and invite email sent.' : 'Invite email sent.');
      }
    } catch (error) {
      setDrawerMessage(error instanceof Error ? error.message : 'Unable to complete this action.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.subhead}>Manage Your Team</Text>
        {profile?.role === 'manager' ? (
          <Pressable style={styles.createButton} onPress={openDrawer}>
            <Text style={styles.createButtonText}>+</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={teams}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Text style={styles.empty}>No teams found yet. Tap Add Demo Team Data.</Text>}
        renderItem={({ item }) => {
          const otherCount = getOtherMemberIds(item).length;
          return (
            <Pressable style={styles.card} onPress={() => handleTeamPress(item)}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.name}</Text>
                <Text style={styles.meta}>{item.workerIds.length} workers</Text>
              </View>
              <View style={styles.rightSide}>
                <Text style={styles.status}>{eventCountsByTeam.get(item.id) ?? 0} events</Text>
                <Text style={styles.hint}>{otherCount > 1 ? 'Choose member' : otherCount === 1 ? 'Open chat' : 'No members'}</Text>
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
          <Pressable style={styles.drawer} onPress={() => null}>
            <Text style={styles.drawerTitle}>Team Actions</Text>
            <Text style={styles.drawerSub}>Add teams or invite workers to your app.</Text>

            <View style={styles.modeRow}>
              <Pressable style={[styles.modeButton, drawerMode === 'add-team' && styles.modeButtonActive]} onPress={() => { setDrawerMode('add-team'); setDrawerMessage(null); }}>
                <Text style={[styles.modeText, drawerMode === 'add-team' && styles.modeTextActive]}>Add Team</Text>
              </Pressable>
              <Pressable style={[styles.modeButton, drawerMode === 'invite-worker' && styles.modeButtonActive]} onPress={() => { setDrawerMode('invite-worker'); setDrawerMessage(null); }}>
                <Text style={[styles.modeText, drawerMode === 'invite-worker' && styles.modeTextActive]}>Invite Worker</Text>
              </Pressable>
            </View>

            {drawerMode === 'add-team' ? (
              <>
                <Text style={styles.fieldLabel}>Team name</Text>
                <TextInput value={teamName} onChangeText={setTeamName} placeholder="Example: Night Shift Crew" placeholderTextColor="#94a3b8" style={styles.input} />
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Choose team</Text>
                <View style={styles.teamChipWrap}>
                  {teams.length ? teams.map((team) => (
                    <Pressable key={team.id} style={[styles.teamChip, inviteTeamId === team.id && styles.teamChipActive]} onPress={() => setInviteTeamId(team.id)}>
                      <Text style={[styles.teamChipText, inviteTeamId === team.id && styles.teamChipTextActive]}>{team.name}</Text>
                    </Pressable>
                  )) : <Text style={styles.emptyHint}>Create a team first.</Text>}
                </View>

                <Text style={styles.fieldLabel}>Worker email</Text>
                <TextInput
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  placeholder="worker@example.com"
                  placeholderTextColor="#94a3b8"
                  style={styles.input}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </>
            )}

            {drawerMessage ? <Text style={styles.message}>{drawerMessage}</Text> : null}

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
  container: { flex: 1, backgroundColor: '#eef2ff', padding: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  subhead: { color: '#334155', fontWeight: '600' },
  createButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1d4ed8', alignItems: 'center', justifyContent: 'center' },
  createButtonText: { color: '#fff', fontSize: 24, lineHeight: 24, fontWeight: '500', marginTop: -1 },
  empty: { marginTop: 20, color: '#64748b' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700', color: '#1d4ed8' },
  title: { color: '#0f172a', fontWeight: '700', fontSize: 16 },
  meta: { color: '#64748b', marginTop: 2, fontSize: 12 },
  rightSide: { alignItems: 'flex-end' },
  status: { color: '#475569', fontSize: 12, fontWeight: '600' },
  hint: { color: '#2563eb', fontSize: 11, fontWeight: '600', marginTop: 4 },
  addBtn: { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  addText: { color: 'white', fontWeight: '700' },
  drawerBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.35)', justifyContent: 'flex-end' },
  drawer: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '76%' },
  drawerTitle: { color: '#0f172a', fontWeight: '700', fontSize: 18 },
  drawerSub: { color: '#64748b', fontSize: 12, marginTop: 4 },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modeButton: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', paddingVertical: 10, alignItems: 'center', backgroundColor: '#f8fafc' },
  modeButtonActive: { borderColor: '#1d4ed8', backgroundColor: '#dbeafe' },
  modeText: { color: '#334155', fontWeight: '600' },
  modeTextActive: { color: '#1e40af' },
  fieldLabel: { marginTop: 14, color: '#334155', fontSize: 12, fontWeight: '700' },
  input: { marginTop: 6, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#0f172a' },
  teamChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  teamChip: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#f8fafc' },
  teamChipActive: { borderColor: '#1d4ed8', backgroundColor: '#dbeafe' },
  teamChipText: { color: '#475569', fontSize: 12, fontWeight: '600' },
  teamChipTextActive: { color: '#1e3a8a' },
  emptyHint: { color: '#64748b', fontSize: 12, marginTop: 4 },
  message: { marginTop: 12, color: '#1e40af', fontSize: 12, fontWeight: '600' },
  drawerSave: { marginTop: 14, backgroundColor: '#1d4ed8', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  drawerSaveDisabled: { opacity: 0.7 },
  drawerSaveText: { color: '#fff', fontWeight: '700' },
  drawerClose: { marginTop: 8, backgroundColor: '#e2e8f0', borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  drawerCloseText: { color: '#334155', fontWeight: '700' },
});
