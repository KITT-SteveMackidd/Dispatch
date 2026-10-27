import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useThemeMode } from '@/context/theme';
import { useSession } from '@/context/session';
import { useChatSafety } from '@/hooks/useChatSafety';
import { CHAT_REPORT_REASONS, CHAT_RULES, CHAT_RULES_VERSION, listMyChatReports, type ChatReportSummary, type ChatReportStatus } from '@/services/chat-safety';
import { DISPATCH_PRIVACY_URL, DISPATCH_SUPPORT_URL } from '@/constants/legal';

export default function ChatSafetyScreen() {
  const safety = useChatSafety();
  const router = useRouter();
  const { profile } = useSession();
  const { resolvedThemeMode } = useThemeMode();
  const insets = useSafeAreaInsets();
  const dark = resolvedThemeMode === 'dark';
  const colors = { background: dark ? '#061229' : '#EEF2FF', card: dark ? '#12274D' : '#FFFFFF', text: dark ? '#F4F8FF' : '#172033', muted: dark ? '#B7C7DD' : '#53627A', border: dark ? '#38517E' : '#CBD5E1' };
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const reportScope = `${profile?.uid || ''}|${profile?.organizationId || ''}`;
  const currentReportScope = useRef(reportScope);
  currentReportScope.current = reportScope;
  const reportGeneration = useRef(0);
  const [reportState, setReportState] = useState<{ scope: string; items: ChatReportSummary[]; nextCursor: string | null; loading: boolean; error: string | null }>({ scope: '', items: [], nextCursor: null, loading: false, error: null });
  const reports = reportState.scope === reportScope ? reportState : { scope: reportScope, items: [], nextCursor: null, loading: false, error: null };
  const loadReports = useCallback(async (cursor?: string) => {
    if (!safety.enabled || !profile?.uid) return;
    const generation = ++reportGeneration.current;
    setReportState((previous) => ({ scope: reportScope, items: previous.scope === reportScope && cursor ? previous.items : [], nextCursor: cursor || null, loading: true, error: null }));
    try {
      const result = await listMyChatReports({ limit: 20, ...(cursor ? { cursor } : {}) });
      if (generation !== reportGeneration.current || currentReportScope.current !== reportScope) return;
      setReportState((previous) => ({ scope: reportScope, items: [...new Map([...(cursor ? previous.items : []), ...result.reports].map((report) => [report.id, report])).values()], nextCursor: result.nextCursor || null, loading: false, error: null }));
    } catch {
      if (generation !== reportGeneration.current || currentReportScope.current !== reportScope) return;
      setReportState((previous) => ({ ...previous, loading: false, error: 'Your reports could not be loaded. Please try again.' }));
    }
  }, [safety.enabled, profile?.uid, reportScope]);
  useEffect(() => {
    if (!safety.enabled) {
      ++reportGeneration.current;
      setReportState({ scope: reportScope, items: [], nextCursor: null, loading: false, error: null });
      return;
    }
    // The private safety signal changes after submission and moderation, and
    // useChatSafety refreshes its state when this screen regains focus.
    void loadReports();
  }, [loadReports, safety.enabled, safety.state, reportScope]);
  useEffect(() => () => { ++reportGeneration.current; }, []);
  const run = async (key: string, action: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    setActionError(null);
    try { await action(); setNotice(success); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to save your change. Please try again.'); }
    finally { setBusy(null); }
  };
  const openPage = async (url: string) => {
    try { await Linking.openURL(url); }
    catch { setActionError('This page could not be opened. Please try again.'); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Chat safety</Text>
      <Text style={[styles.body, { color: colors.muted }]}>Manage who can contact you and review the rules for Dispatch conversations.</Text>
      {safety.loading ? <ActivityIndicator accessibilityLabel="Checking chat safety" color="#0B7D82" /> : null}
      {safety.error || actionError ? <Text accessibilityRole="alert" style={styles.error}>{actionError || safety.error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
      {safety.error ? (
        <Pressable accessibilityRole="button" onPress={() => void safety.refresh()} style={styles.button}>
          <Text style={styles.buttonText}>Refresh chat safety</Text>
        </Pressable>
      ) : null}
      {safety.rolloutReady && !safety.enabled && !safety.error ? <Text style={[styles.body, { color: colors.muted }]}>Chat safety is not enabled for this organization yet.</Text> : null}
      {safety.enabled ? (
        <>
          {!safety.loading && !safety.error && safety.state?.canModerate ? <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>Review chat reports</Text>
            <Text style={[styles.body, { color: colors.muted }]}>Review reported messages and people in your organization and take action when needed.</Text>
            <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.push('/chat-moderation')}><Text style={styles.buttonText}>Open report queue</Text></Pressable>
          </View> : null}
          {safety.state?.suspension?.active !== false && safety.state?.suspension ? <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}><Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>Chat access restricted</Text><Text style={[styles.body, { color: colors.muted }]}>{safety.state.suspension.reason}</Text></View> : null}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>Blocked people</Text>
            <Text style={[styles.body, { color: colors.muted }]}>Blocking stops direct chat and hides that person’s messages in shared conversations. Your work assignments stay available.</Text>
            {safety.state ? safety.state.blockedUsers.length ? safety.state.blockedUsers.map((person) => (
              <View key={person.uid} style={[styles.personRow, { borderColor: colors.border }]}>
                <Text style={[styles.personName, { color: colors.text }]}>{person.displayName || 'Dispatch member'}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Unblock ${person.displayName || 'Dispatch member'}`} accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void run(person.uid, () => safety.setUserBlocked(person.uid, false), `${person.displayName || 'This person'} is unblocked.`)} style={[styles.smallButton, busy ? styles.disabled : null]}>
                  <Text style={styles.buttonText}>{busy === person.uid ? 'Unblocking…' : 'Unblock'}</Text>
                </Pressable>
              </View>
            )) : <Text style={[styles.body, { color: colors.muted }]}>You have not blocked anyone.</Text> : null}
          </View>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>Your reports</Text>
            <Text style={[styles.body, { color: colors.muted }]}>Reports about messages and people you submitted appear here. Use Report in a conversation to raise a concern.</Text>
            {reports.loading ? <ActivityIndicator accessibilityLabel="Loading your reports" color="#0B7D82" /> : null}
            {reports.error ? <Text accessibilityRole="alert" style={styles.error}>{reports.error}</Text> : null}
            {!reports.loading && !reports.error && reports.items.length === 0 ? <Text style={[styles.body, { color: colors.muted }]}>You have not submitted any reports.</Text> : null}
            {reports.items.map((report) => <View key={report.id} style={[styles.report, { borderColor: colors.border }]}>
              <Text style={[styles.ruleTitle, { color: colors.text }]}>{report.kind === 'message' ? 'Message' : 'Person'} reported{report.targetDisplayName ? ` · ${report.targetDisplayName}` : ''}</Text>
              <Text style={[styles.body, { color: colors.muted }]}>{CHAT_REPORT_REASONS.find((reason) => reason.value === report.reason)?.label || 'Reported concern'}</Text>
              <Text style={[styles.reportStatus, { color: colors.text }]}>{REPORT_STATUS_LABELS[report.status] || 'Submitted'}</Text>
              <Text style={[styles.body, { color: colors.muted }]}>{formatReportDate(report.createdAt)}</Text>
              {report.resolutionSummary ? <Text style={[styles.body, { color: colors.text }]}>{report.resolutionSummary}</Text> : null}
            </View>)}
            {reports.nextCursor ? <Pressable accessibilityRole="button" disabled={reports.loading} accessibilityState={{ disabled: reports.loading }} style={[styles.button, reports.loading ? styles.disabled : null]} onPress={() => void loadReports(reports.nextCursor || undefined)}><Text style={styles.buttonText}>Load more reports</Text></Pressable> : null}
            <Pressable accessibilityRole="button" disabled={reports.loading} accessibilityState={{ disabled: reports.loading }} style={styles.linkButton} onPress={() => void loadReports()}><Text style={styles.link}>Refresh reports</Text></Pressable>
          </View>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>Chat rules</Text>
            <Text style={[styles.body, { color: colors.muted }]}>Version {CHAT_RULES_VERSION}. Please read and accept these rules before sending messages or uploading attachments.</Text>
            {CHAT_RULES.map((rule) => <View key={rule.title} style={styles.rule}><Text style={[styles.ruleTitle, { color: colors.text }]}>{rule.title}</Text><Text style={[styles.body, { color: colors.muted }]}>{rule.text}</Text></View>)}
            {safety.state?.acceptedTerms ? <Text style={styles.notice}>You have accepted the current chat rules.</Text> : (
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) || safety.loading || !safety.state }} disabled={Boolean(busy) || safety.loading || !safety.state} onPress={() => void run('rules', safety.acceptRules, 'Chat rules accepted.')} style={[styles.button, busy || safety.loading || !safety.state ? styles.disabled : null]}>
                <Text style={styles.buttonText}>{busy === 'rules' ? 'Saving…' : 'I agree to the chat rules'}</Text>
              </Pressable>
            )}
          </View>
        </>
      ) : null}
      <View style={styles.links}>
        <Pressable accessibilityRole="link" onPress={() => void openPage(DISPATCH_SUPPORT_URL)} style={styles.linkButton}><Text style={styles.link}>Help & support</Text></Pressable>
        <Pressable accessibilityRole="link" onPress={() => void openPage(DISPATCH_PRIVACY_URL)} style={styles.linkButton}><Text style={styles.link}>Privacy Policy</Text></Pressable>
      </View>
    </ScrollView>
  );
}

const REPORT_STATUS_LABELS: Record<ChatReportStatus, string> = { submitted: 'Submitted', under_review: 'Under review', resolved: 'Resolved', dismissed: 'Closed without action' };
function formatReportDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
  title: { fontSize: 30, fontWeight: '800' },
  heading: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24 },
  card: { padding: 20, borderRadius: 16, borderWidth: 1, gap: 14 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, borderTopWidth: 1 },
  personName: { flex: 1, fontSize: 16, fontWeight: '600' },
  rule: { gap: 5 },
  ruleTitle: { fontSize: 17, fontWeight: '700' },
  report: { paddingTop: 14, borderTopWidth: 1, gap: 5 },
  reportStatus: { fontSize: 15, fontWeight: '700' },
  button: { minHeight: 48, borderRadius: 10, backgroundColor: '#0EC3C9', justifyContent: 'center', alignItems: 'center', padding: 12 },
  smallButton: { minHeight: 44, borderRadius: 9, backgroundColor: '#0EC3C9', justifyContent: 'center', paddingHorizontal: 14 },
  buttonText: { color: '#061229', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.5 },
  error: { color: '#B42318', backgroundColor: '#FFF1F2', padding: 14, borderRadius: 10, lineHeight: 22 },
  notice: { color: '#166534', backgroundColor: '#DCFCE7', padding: 12, borderRadius: 10, lineHeight: 22 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  linkButton: { minHeight: 44, justifyContent: 'center' },
  link: { color: '#0B7D82', fontSize: 16, fontWeight: '600', textDecorationLine: 'underline' },
});
