import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type DrawerMode = 'add-team' | 'invite-worker';

const lightEventsLogoSource = { uri: 'https://www.figma.com/api/mcp/asset/ea1f259a-1993-4a31-b5d3-e13b530af9e6' };
const darkEventsLogoSource = { uri: 'https://www.figma.com/api/mcp/asset/416530cf-9e8d-49e3-9fe0-7ad6bee3db76' };

export default function TeamsScreen() {
  const { profile } = useSession();
  const router = useRouter();
  const { resolvedThemeMode } = useThemeMode();
  const insets = useSafeAreaInsets();
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
      <View style={[styles.topHeader, isDarkMode ? styles.topHeaderDark : styles.topHeaderLight, { paddingTop: insets.top + 16 }]}>
        <Image source={isDarkMode ? darkEventsLogoSource : lightEventsLogoSource} style={isDarkMode ? styles.darkLogo : styles.lightLogo} resizeMode="cover" />
        {profile?.role === 'manager' ? (
          <Pressable style={isDarkMode ? styles.eventsDarkAddButton : styles.eventsLightAddButton} onPress={openDrawer}>
            <Text style={isDarkMode ? styles.eventsDarkAddButtonIcon : styles.eventsLightAddButtonIcon}>+</Text>
          </Pressable>
        ) : <View style={styles.headerSpacer} />}
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
              <View style={[styles.avatar, isDarkMode ? styles.avatarDark : styles.avatarLight]}><Text style={styles.avatarText}>{(memberInfoById[workerId]?.displayName || workerId).slice(0, 1).toUpperCase()}</Text></View>
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
              <View style={[styles.avatar, isDarkMode ? styles.avatarDark : styles.avatarLight]}><Text style={styles.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text></View>
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
              <Pressable
                style={[
                  styles.modeButton,
                  isDarkMode ? styles.modeButtonDark : styles.modeButtonLight,
                  drawerMode === 'add-team' && styles.modeButtonSelected,
                ]}
                onPress={() => { setDrawerMode('add-team'); setDrawerMessage(null); setDrawerMessageTone('info'); }}>
                <Text style={[styles.modeText, drawerMode === 'add-team' && styles.modeTextSelected]}>Add Team</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modeButton,
                  isDarkMode ? styles.modeButtonDark : styles.modeButtonLight,
                  drawerMode === 'invite-worker' && styles.modeButtonSelected,
                ]}
                onPress={() => { setDrawerMode('invite-worker'); setDrawerMessage(null); setDrawerMessageTone('info'); }}>
                <Text style={[styles.modeText, drawerMode === 'invite-worker' && styles.modeTextSelected]}>Invite Worker</Text>
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

            <Pressable
              style={[
                styles.drawerSave,
                drawerMode === 'invite-worker'
                  ? styles.drawerSaveInviteWorker
                  : isDarkMode
                    ? styles.drawerSaveDark
                    : styles.drawerSaveLight,
                saving && styles.drawerSaveDisabled,
              ]}
              onPress={handleSubmitDrawer}
              disabled={saving}>
              <Text
                style={[
                  styles.drawerSaveText,
                  drawerMode === 'invite-worker'
                    ? styles.drawerSaveTextInviteWorker
                    : isDarkMode
                      ? styles.drawerSaveTextDark
                      : styles.drawerSaveTextLight,
                ]}>
                {saving ? 'Saving...' : drawerMode === 'add-team' ? 'Create Team' : 'Invite Worker'}
              </Text>
            </Pressable>

            <Pressable style={[styles.drawerClose, isDarkMode ? styles.drawerCloseDark : styles.drawerCloseLight]} onPress={() => setDrawerOpen(false)}>
              <Text style={[styles.drawerCloseText, isDarkMode ? styles.drawerCloseTextDark : styles.drawerCloseTextLight]}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingBottom: 16 },
  containerLight: { backgroundColor: '#DBE2F9' },
  containerDark: { backgroundColor: '#061229' },
  topHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16 },
  topHeaderLight: { backgroundColor: '#DBE2F9' },
  topHeaderDark: { backgroundColor: '#061229' },
  headerSpacer: { width: 34, height: 34 },
  lightLogo: { width: 64, height: 64 },
  darkLogo: { width: 64, height: 64 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  subhead: { fontWeight: '600' },
  subheadLight: { color: '#334155' },
  subheadDark: { color: '#F4F8FF' },
  createButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1d4ed8', alignItems: 'center', justifyContent: 'center' },
  createButtonText: { color: '#fff', fontSize: 24, lineHeight: 24, fontWeight: '500', marginTop: -1 },
  eventsLightAddButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#0EC3C9', alignItems: 'center', justifyContent: 'center' },
  eventsLightAddButtonIcon: { color: '#F7F7F7', fontSize: 26, lineHeight: 28, fontWeight: '400', marginTop: -2 },
  eventsDarkAddButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#0EC3C9', alignItems: 'center', justifyContent: 'center' },
  eventsDarkAddButtonIcon: { color: '#F7F7F7', fontSize: 26, lineHeight: 28, fontWeight: '400', marginTop: -2 },
  empty: { marginTop: 20 },
  emptyLight: { color: '#64748b' },
  emptyDark: { color: '#F4F8FF' },
  card: { borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardLight: { backgroundColor: '#F7F7F7', borderColor: '#F7F7F7' },
  cardDark: { backgroundColor: '#12274D', borderColor: '#12274D' },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#F98D2F' },
  avatarLight: { backgroundColor: '#F7F7F7' },
  avatarDark: { backgroundColor: '#12274D' },
  avatarText: { fontWeight: '700', color: '#F98D2F' },
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
  hintLight: { color: '#F98D2F' },
  hintDark: { color: '#F98D2F' },
  unreadBadge: { marginTop: 6, backgroundColor: '#dc2626', borderRadius: 999, minWidth: 20, paddingHorizontal: 6, height: 20, alignItems: 'center', justifyContent: 'center' },
  unreadBadgeText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  inviteStatusCard: { borderWidth: 1, borderRadius: 10, padding: 16, marginBottom: 16, gap: 8 },
  inviteStatusCardLight: { borderColor: '#F7F7F7', backgroundColor: '#F7F7F7' },
  inviteStatusCardDark: { borderColor: '#12274D', backgroundColor: '#12274D' },
  inviteStatusHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  inviteStatusTitle: { fontWeight: '700', fontSize: 13 },
  inviteStatusTitleLight: { color: '#232832' },
  inviteStatusTitleDark: { color: '#F4F8FF' },
  clearAllButton: { borderRadius: 8, borderWidth: 1, borderColor: '#F98D2F', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#DBE2F9' },
  clearAllButtonText: { color: '#F98D2F', fontSize: 12, fontWeight: '700' },
  inviteStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: 'rgba(249,141,47,0.25)', paddingTop: 8 },
  inviteStatusActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  soloSection: { borderWidth: 1, borderRadius: 10, padding: 16, marginBottom: 16, gap: 8 },
  soloSectionLight: { borderColor: '#F7F7F7', backgroundColor: '#F7F7F7' },
  soloSectionDark: { borderColor: '#12274D', backgroundColor: '#12274D' },
  soloSectionTitle: { fontWeight: '700', fontSize: 13 },
  soloWorkerRow: { borderRadius: 10, borderWidth: 1, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  inviteEmail: { fontWeight: '600', fontSize: 13 },
  inviteMeta: { marginTop: 2, fontSize: 11 },
  retryButton: { borderRadius: 8, backgroundColor: '#0EC3C9', paddingHorizontal: 10, paddingVertical: 6 },
  clearInviteButton: { borderRadius: 8, borderWidth: 1, borderColor: '#F98D2F', backgroundColor: '#DBE2F9', paddingHorizontal: 10, paddingVertical: 6 },
  clearInviteButtonText: { color: '#F98D2F', fontSize: 12, fontWeight: '700' },
  retryButtonDisabled: { opacity: 0.6 },
  retryButtonText: { color: '#061229', fontSize: 12, fontWeight: '700' },
  addBtn: { backgroundColor: '#0EC3C9', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
  addText: { color: '#061229', fontWeight: '700' },
  drawerBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.35)', justifyContent: 'flex-end' },
  drawer: { borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16, maxHeight: '89%' },
  drawerLight: { backgroundColor: '#F7F7F7' },
  drawerDark: { backgroundColor: '#12274D' },
  drawerTitle: { fontWeight: '700', fontSize: 16 },
  drawerTitleLight: { color: '#121212' },
  drawerTitleDark: { color: '#F7F7F7' },
  drawerSub: { fontSize: 12, marginTop: 8, fontWeight: '300' },
  drawerSubLight: { color: '#121212', opacity: 0.8 },
  drawerSubDark: { color: '#F7F7F7', opacity: 0.8 },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modeButton: { flex: 1, borderRadius: 8, borderWidth: 1, paddingVertical: 10, alignItems: 'center' },
  modeButtonLight: { backgroundColor: '#F7F7F7', borderColor: 'rgba(6,18,41,0.1)' },
  modeButtonDark: { backgroundColor: '#12274D', borderColor: 'rgba(6,18,41,0.1)' },
  modeButtonSelected: { borderColor: '#F98D2F' },
  modeButtonActive: { borderColor: '#0EC3C9', backgroundColor: '#DBE2F9' },
  modeText: { color: '#121212', fontWeight: '600' },
  modeTextSelected: { color: '#F98D2F' },
  fieldLabel: { marginTop: 14, fontSize: 12, fontWeight: '700' },
  fieldLabelLight: { color: '#334155' },
  fieldLabelDark: { color: '#F4F8FF' },
  input: { marginTop: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, fontSize: 12, fontWeight: '700' },
  inputLight: { borderColor: 'rgba(6,18,41,0.1)', color: '#121212', backgroundColor: '#EDF0FC' },
  inputDark: { borderColor: 'rgba(6,18,41,0.1)', color: '#F7F7F7', backgroundColor: '#203E75' },
  teamChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  teamChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  teamChipLight: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#EDF0FC' },
  teamChipDark: { borderColor: 'rgba(6,18,41,0.1)', backgroundColor: '#203E75' },
  teamChipActive: { borderColor: '#F98D2F' },
  teamChipText: { fontSize: 12, fontWeight: '600' },
  teamChipTextLight: { color: '#475569' },
  teamChipTextDark: { color: '#F4F8FF' },
  teamChipTextActive: { color: '#F98D2F' },
  emptyHint: { color: '#64748b', fontSize: 12, marginTop: 4 },
  helperText: { marginTop: 6, fontSize: 11 },
  helperTextLight: { color: '#64748b' },
  helperTextDark: { color: '#F4F8FF' },
  message: { marginTop: 12, fontSize: 12, fontWeight: '600' },
  messageInfo: { color: '#1e40af' },
  messageSuccess: { color: '#15803d' },
  messageError: { color: '#b91c1c' },
  drawerSave: { marginTop: 12, borderRadius: 8, alignItems: 'center', paddingVertical: 10, width: '100%', borderWidth: 1 },
  drawerSaveLight: { backgroundColor: '#F7F7F7', borderColor: 'rgba(6,18,41,0.1)' },
  drawerSaveDark: { backgroundColor: '#12274D', borderColor: 'rgba(6,18,41,0.1)' },
  drawerSaveInviteWorker: { backgroundColor: '#0EC3C9', borderColor: '#0EC3C9' },
  drawerSaveDisabled: { opacity: 0.7 },
  drawerSaveText: { fontWeight: '700' },
  drawerSaveTextLight: { color: '#121212' },
  drawerSaveTextDark: { color: '#F7F7F7' },
  drawerSaveTextInviteWorker: { color: '#F7F7F7' },
  drawerClose: { marginTop: 8, borderRadius: 8, alignItems: 'center', paddingVertical: 10, width: '100%', borderWidth: 1 },
  drawerCloseLight: { backgroundColor: '#F7F7F7', borderColor: 'rgba(6,18,41,0.1)' },
  drawerCloseDark: { backgroundColor: '#12274D', borderColor: 'rgba(6,18,41,0.1)' },
  drawerCloseText: { fontWeight: '700' },
  drawerCloseTextLight: { color: '#121212' },
  drawerCloseTextDark: { color: '#F7F7F7' },
});
