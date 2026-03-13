import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/context/session';
import {
  createTeam,
  inviteWorkerByEmailToTeam,
  loadUserProfilesByIds,
  loadWorkerTeams,
  retryWorkerInviteDelivery,
  seedDemoData,
  watchManagerEvents,
  watchManagerTeams,
  watchManagerWorkerInvites,
  watchUserTeamUnreadCounts,
  watchWorkerEvents,
  WorkerInvite,
} from '@/services/dispatch';
import { clearAllWorkerInviteNotifications, clearWorkerInviteNotification } from '@/services/worker-invite-notifications';
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
  const [inviteTeamId, setInviteTeamId] = useState<'solo' | string>('solo');
  const [saving, setSaving] = useState(false);
  const [drawerMessage, setDrawerMessage] = useState<string | null>(null);
  const [drawerMessageTone, setDrawerMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [memberInfoById, setMemberInfoById] = useState<Record<string, Pick<UserProfile, 'displayName' | 'phoneNumber'>>>({});
  const [unreadCountByTeamId, setUnreadCountByTeamId] = useState<Record<string, number>>({});
  const [invites, setInvites] = useState<WorkerInvite[]>([]);
  const [retryingInviteId, setRetryingInviteId] = useState<string | null>(null);
  const [clearingInviteId, setClearingInviteId] = useState<string | null>(null);
  const [clearingAllInvites, setClearingAllInvites] = useState(false);

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
    if (inviteTeamId === 'solo') return;
    if (!teams.some((team) => team.id === inviteTeamId)) {
      setInviteTeamId(teams[0]?.id || 'solo');
    }
  }, [teams, inviteTeamId]);

  useEffect(() => {
    if (!profile || profile.role !== 'manager') {
      setInvites([]);
      return;
    }

    return watchManagerWorkerInvites(profile.uid, setInvites);
  }, [profile]);

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

    const ids = [...new Set([
      ...teams.flatMap((team) => [team.managerId, ...team.workerIds]),
      ...invites.map((invite) => invite.workerId).filter(Boolean) as string[],
    ].filter((id) => id && id !== profile.uid))];

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
  }, [invites, teams, profile]);

  const eventCountsByTeam = useMemo(() => {
    const counts = new Map<string, number>();
    events.forEach((event) => {
      event.teamIds.forEach((teamId) => {
        counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
      });
    });
    return counts;
  }, [events]);

  const visibleInvites = useMemo(
    () => invites.filter((invite) => !(invite as WorkerInvite & { managerClearedAt?: unknown }).managerClearedAt),
    [invites]
  );

  const soloWorkerIds = useMemo(() => {
    const teamWorkerIds = new Set(teams.flatMap((team) => team.workerIds || []));
    return [...new Set(
      invites
        .filter((invite) => invite.workerId && !invite.teamId)
        .map((invite) => invite.workerId as string)
        .filter((workerId) => !teamWorkerIds.has(workerId))
    )];
  }, [invites, teams]);

  const getOtherMemberIds = (team: Team) => {
    if (!profile) return [];
    return [...new Set([team.managerId, ...team.workerIds].filter((memberId) => memberId && memberId !== profile.uid))];
  };

  const openDirectChat = (workerId: string, team?: Team) => {
    router.push({
      pathname: '/chat/[workerId]',
      params: {
        workerId,
        workerLabel: memberInfoById[workerId]?.displayName || workerId,
        teamId: team?.id,
        teamName: team?.name,
      },
    });
  };

  const handleTeamPress = (team: Team) => {
    if (!profile) return;

    const otherMemberIds = getOtherMemberIds(team);
    if (!otherMemberIds.length) return;

    if (otherMemberIds.length === 1) {
      openDirectChat(otherMemberIds[0], team);
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
        const teamId = inviteTeamId === 'solo' ? undefined : inviteTeamId;
        const result = await inviteWorkerByEmailToTeam({ managerId: profile.uid, teamId, email: inviteEmail });
        setInviteEmail('');
        setDrawerMessageTone('success');
        setDrawerMessage(
          result.linked
            ? (teamId ? 'Worker account found and linked to the team.' : 'Worker account found and linked as a solo worker.')
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

  const handleRetryInvite = async (inviteId: string) => {
    if (!profile || profile.role !== 'manager') return;
    if (retryingInviteId === inviteId) return;

    try {
      setRetryingInviteId(inviteId);
      await retryWorkerInviteDelivery({ managerId: profile.uid, inviteId });
      setDrawerMessageTone('success');
      setDrawerMessage('Invite retry sent successfully.');
    } catch (error) {
      setDrawerMessageTone('error');
      setDrawerMessage(error instanceof Error ? error.message : 'Invite retry failed.');
    } finally {
      setRetryingInviteId(null);
    }
  };

  const handleClearInvite = async (inviteId: string) => {
    if (!profile || profile.role !== 'manager') return;
    if (clearingInviteId === inviteId || clearingAllInvites) return;

    try {
      setClearingInviteId(inviteId);
      await clearWorkerInviteNotification({ managerId: profile.uid, inviteId });
      setDrawerMessageTone('success');
      setDrawerMessage('Invite notification cleared.');
    } catch (error) {
      setDrawerMessageTone('error');
      setDrawerMessage(error instanceof Error ? error.message : 'Unable to clear invite notification.');
    } finally {
      setClearingInviteId(null);
    }
  };

  const handleClearAllInvites = async () => {
    if (!profile || profile.role !== 'manager' || !visibleInvites.length) return;
    if (clearingAllInvites) return;

    try {
      setClearingAllInvites(true);
      await clearAllWorkerInviteNotifications({
        managerId: profile.uid,
        inviteIds: visibleInvites.map((invite) => invite.id),
      });
      setDrawerMessageTone('success');
      setDrawerMessage('Cleared all recent worker invite notifications.');
    } catch (error) {
      setDrawerMessageTone('error');
      setDrawerMessage(error instanceof Error ? error.message : 'Unable to clear invite notifications.');
    } finally {
      setClearingAllInvites(false);
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

      {profile?.role === 'manager' && visibleInvites.length ? (
        <View style={[styles.inviteStatusCard, isDarkMode ? styles.inviteStatusCardDark : styles.inviteStatusCardLight]}>
          <View style={styles.inviteStatusHeaderRow}>
            <Text style={[styles.inviteStatusTitle, isDarkMode ? styles.inviteStatusTitleDark : styles.inviteStatusTitleLight]}>Recent Worker Invites</Text>
            <Pressable style={[styles.clearAllButton, clearingAllInvites && styles.retryButtonDisabled]} onPress={handleClearAllInvites} disabled={clearingAllInvites}>
              <Text style={styles.clearAllButtonText}>{clearingAllInvites ? 'Clearing…' : 'Clear all'}</Text>
            </Pressable>
          </View>
          {visibleInvites.slice(0, 5).map((invite) => {
            const canRetry = invite.status === 'send_failed';
            const isClearingThisInvite = clearingInviteId === invite.id;
            return (
              <View key={invite.id} style={styles.inviteStatusRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inviteEmail, isDarkMode ? styles.titleDark : styles.titleLight]}>{invite.email}</Text>
                  <Text style={[styles.inviteMeta, isDarkMode ? styles.metaDark : styles.metaLight]}>{invite.status}{invite.statusReason ? ` · ${invite.statusReason}` : ''}</Text>
                </View>
                <View style={styles.inviteStatusActions}>
                  {canRetry ? (
                    <Pressable
                      style={[styles.retryButton, retryingInviteId === invite.id && styles.retryButtonDisabled]}
                      disabled={retryingInviteId === invite.id}
                      onPress={() => handleRetryInvite(invite.id)}>
                      <Text style={styles.retryButtonText}>{retryingInviteId === invite.id ? 'Retrying…' : 'Retry'}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={[styles.clearInviteButton, (isClearingThisInvite || clearingAllInvites) && styles.retryButtonDisabled]}
                    disabled={isClearingThisInvite || clearingAllInvites}
                    onPress={() => handleClearInvite(invite.id)}>
                    <Text style={styles.clearInviteButtonText}>{isClearingThisInvite ? 'Clearing…' : 'Clear'}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {soloWorkerIds.length ? (
        <View style={[styles.soloSection, isDarkMode ? styles.soloSectionDark : styles.soloSectionLight]}>
          <Text style={[styles.soloSectionTitle, isDarkMode ? styles.titleDark : styles.titleLight]}>Solo Workers</Text>
          {soloWorkerIds.map((workerId) => (
            <Pressable key={`solo-${workerId}`} style={[styles.soloWorkerRow, isDarkMode ? styles.cardDark : styles.cardLight]} onPress={() => openDirectChat(workerId)}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(memberInfoById[workerId]?.displayName || workerId).slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>{memberInfoById[workerId]?.displayName || workerId}</Text>
                <Text style={[styles.meta, isDarkMode ? styles.metaDark : styles.metaLight]}>Not assigned to a team</Text>
              </View>
              <Text style={[styles.hint, isDarkMode ? styles.hintDark : styles.hintLight]}>Open chat</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

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
                <TextInput value={teamName} onChangeText={setTeamName} placeholder="Example: Night Shift Crew" placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'} style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]} />
              </>
            ) : (
              <>
                <Text style={[styles.fieldLabel, isDarkMode ? styles.fieldLabelDark : styles.fieldLabelLight]}>Choose team (or solo)</Text>
                <View style={styles.teamChipWrap}>
                  <Pressable key="solo" style={[styles.teamChip, isDarkMode ? styles.teamChipDark : styles.teamChipLight, inviteTeamId === 'solo' && styles.teamChipActive]} onPress={() => setInviteTeamId('solo')}>
                    <Text style={[styles.teamChipText, isDarkMode ? styles.teamChipTextDark : styles.teamChipTextLight, inviteTeamId === 'solo' && styles.teamChipTextActive]}>Solo worker</Text>
                  </Pressable>
                  {teams.length ? teams.map((team) => (
                    <Pressable key={team.id} style={[styles.teamChip, isDarkMode ? styles.teamChipDark : styles.teamChipLight, inviteTeamId === team.id && styles.teamChipActive]} onPress={() => setInviteTeamId(team.id)}>
                      <Text style={[styles.teamChipText, isDarkMode ? styles.teamChipTextDark : styles.teamChipTextLight, inviteTeamId === team.id && styles.teamChipTextActive]}>{team.name}</Text>
                    </Pressable>
                  )) : <Text style={styles.emptyHint}>No teams yet. You can still invite as solo.</Text>}
                </View>

                <Text style={[styles.fieldLabel, isDarkMode ? styles.fieldLabelDark : styles.fieldLabelLight]}>Worker email</Text>
                <TextInput value={inviteEmail} onChangeText={setInviteEmail} placeholder="worker@example.com" placeholderTextColor={isDarkMode ? '#F4F8FF' : '#94a3b8'} style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]} autoCapitalize="none" keyboardType="email-address" />
                <Text style={[styles.helperText, isDarkMode ? styles.helperTextDark : styles.helperTextLight]}>
                  Invite keeps this worker unlinked until they sign in with that email. Solo workers appear in their own section with direct chat.
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
  containerDark: { backgroundColor: '#101A2F' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  subhead: { fontWeight: '600' },
  subheadLight: { color: '#334155' },
  subheadDark: { color: '#F4F8FF' },
  createButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1d4ed8', alignItems: 'center', justifyContent: 'center' },
  createButtonText: { color: '#fff', fontSize: 24, lineHeight: 24, fontWeight: '500', marginTop: -1 },
  empty: { marginTop: 20 },
  emptyLight: { color: '#64748b' },
  emptyDark: { color: '#F4F8FF' },
  card: { borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardLight: { backgroundColor: '#fff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#1A2540', borderColor: '#001A4D' },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700', color: '#1d4ed8' },
  title: { fontWeight: '700', fontSize: 16 },
  titleLight: { color: '#232832' },
  titleDark: { color: '#F4F8FF' },
  meta: { marginTop: 2, fontSize: 12 },
  metaLight: { color: '#64748b' },
  metaDark: { color: '#F4F8FF' },
  rightSide: { alignItems: 'flex-end' },
  status: { fontSize: 12, fontWeight: '600' },
  statusLight: { color: '#475569' },
  statusDark: { color: '#F4F8FF' },
  hint: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  hintLight: { color: '#2563eb' },
  hintDark: { color: '#0EC3C9' },
  unreadBadge: { marginTop: 6, backgroundColor: '#dc2626', borderRadius: 999, minWidth: 20, paddingHorizontal: 6, height: 20, alignItems: 'center', justifyContent: 'center' },
  unreadBadgeText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  inviteStatusCard: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 10, gap: 8 },
  inviteStatusCardLight: { borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  inviteStatusCardDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  inviteStatusHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  inviteStatusTitle: { fontWeight: '700', fontSize: 13 },
  inviteStatusTitleLight: { color: '#1e3a8a' },
  inviteStatusTitleDark: { color: '#F4F8FF' },
  clearAllButton: { borderRadius: 8, borderWidth: 1, borderColor: '#1d4ed8', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff' },
  clearAllButtonText: { color: '#1d4ed8', fontSize: 12, fontWeight: '700' },
  inviteStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#93c5fd', paddingTop: 8 },
  inviteStatusActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  soloSection: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 10, gap: 8 },
  soloSectionLight: { borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  soloSectionDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  soloSectionTitle: { fontWeight: '700', fontSize: 13 },
  soloWorkerRow: { borderRadius: 10, borderWidth: 1, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  inviteEmail: { fontWeight: '600', fontSize: 13 },
  inviteMeta: { marginTop: 2, fontSize: 11 },
  retryButton: { borderRadius: 8, backgroundColor: '#1d4ed8', paddingHorizontal: 10, paddingVertical: 6 },
  clearInviteButton: { borderRadius: 8, borderWidth: 1, borderColor: '#94a3b8', backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6 },
  clearInviteButtonText: { color: '#334155', fontSize: 12, fontWeight: '700' },
  retryButtonDisabled: { opacity: 0.6 },
  retryButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  addBtn: { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  addText: { color: 'white', fontWeight: '700' },
  drawerBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.35)', justifyContent: 'flex-end' },
  drawer: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '76%' },
  drawerLight: { backgroundColor: '#fff' },
  drawerDark: { backgroundColor: '#1A2540' },
  drawerTitle: { fontWeight: '700', fontSize: 18 },
  drawerTitleLight: { color: '#232832' },
  drawerTitleDark: { color: '#F4F8FF' },
  drawerSub: { fontSize: 12, marginTop: 4 },
  drawerSubLight: { color: '#64748b' },
  drawerSubDark: { color: '#F4F8FF' },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modeButton: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', paddingVertical: 10, alignItems: 'center', backgroundColor: '#f8fafc' },
  modeButtonActive: { borderColor: '#1d4ed8', backgroundColor: '#dbeafe' },
  modeText: { color: '#334155', fontWeight: '600' },
  modeTextActive: { color: '#1e40af' },
  fieldLabel: { marginTop: 14, fontSize: 12, fontWeight: '700' },
  fieldLabelLight: { color: '#334155' },
  fieldLabelDark: { color: '#F4F8FF' },
  input: { marginTop: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  inputLight: { borderColor: '#cbd5e1', color: '#232832', backgroundColor: '#fff' },
  inputDark: { borderColor: '#001A4D', color: '#F4F8FF', backgroundColor: '#1A2540' },
  teamChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  teamChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  teamChipLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  teamChipDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  teamChipActive: { borderColor: '#1d4ed8', backgroundColor: '#dbeafe' },
  teamChipText: { fontSize: 12, fontWeight: '600' },
  teamChipTextLight: { color: '#475569' },
  teamChipTextDark: { color: '#F4F8FF' },
  teamChipTextActive: { color: '#1e3a8a' },
  emptyHint: { color: '#64748b', fontSize: 12, marginTop: 4 },
  helperText: { marginTop: 6, fontSize: 11 },
  helperTextLight: { color: '#64748b' },
  helperTextDark: { color: '#F4F8FF' },
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
