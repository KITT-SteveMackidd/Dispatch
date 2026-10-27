import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/context/session';
import { useThemeMode } from '@/context/theme';
import { useChatSafety } from '@/hooks/useChatSafety';
import { KeyboardAwareDrawer, KeyboardAwareDrawerScrollView, KeyboardAwareDrawerTextInput } from '@/components/KeyboardAwareDrawer';
import { CHAT_REPORT_REASONS, type ChatModerationAction, type ChatModerationReport } from '@/services/chat-safety';
import { createChatModerationSession, EMPTY_MODERATION_SESSION, type ChatModerationSessionState } from '@/services/chat-moderation-session';

const ACTIONS: Record<ChatModerationAction, { label: string; explanation: string }> = {
  dismiss: { label: 'Dismiss report', explanation: 'Close this report without removing content or changing chat access.' },
  remove_message: { label: 'Remove message', explanation: 'Remove the reported message and its attachments from chat. Attachment cleanup must finish before the action is complete.' },
  suspend_user: { label: 'Restrict chat access', explanation: 'Prevent this person from sending messages or uploading chat attachments. Their work assignments, existing conversations, and reporting tools remain available.' },
  restore_user: { label: 'Restore chat access', explanation: 'Remove this person’s chat restriction. They must still accept the current chat rules before sending messages.' },
};
const STATUSES = { submitted: 'Submitted', under_review: 'Under review', resolved: 'Resolved', dismissed: 'Closed without action' };
type Colors = { background: string; card: string; text: string; muted: string; border: string };

export default function ChatModerationScreen() {
  const { authUser, profile } = useSession();
  const safety = useChatSafety();
  const insets = useSafeAreaInsets();
  const { resolvedThemeMode } = useThemeMode();
  const dark = resolvedThemeMode === 'dark';
  const colors: Colors = { background: dark ? '#061229' : '#EEF2FF', card: dark ? '#12274D' : '#FFFFFF', text: dark ? '#F4F8FF' : '#172033', muted: dark ? '#B7C7DD' : '#53627A', border: dark ? '#38517E' : '#CBD5E1' };
  const allowed = Boolean(authUser?.uid && authUser.uid === profile?.uid && profile.organizationId && safety.rolloutReady && safety.enabled && !safety.loading && !safety.error && safety.state?.canModerate);
  const scopeKey = `${authUser?.uid || ''}|${profile?.uid || ''}|${profile?.organizationId || ''}|${profile?.role || ''}|${allowed}`;
  const scopeEpoch = useRef({ key: scopeKey, version: 0 });
  if (scopeEpoch.current.key !== scopeKey) scopeEpoch.current = { key: scopeKey, version: scopeEpoch.current.version + 1 };
  const scope = `${scopeKey}|${scopeEpoch.current.version}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const session = useRef<ReturnType<typeof createChatModerationSession> | null>(null);
  const [result, setResult] = useState<{ scope: string; state: ChatModerationSessionState }>({ scope: '', state: EMPTY_MODERATION_SESSION });
  const [selection, setSelection] = useState<{ scope: string; id: string } | null>(null);
  const state = allowed && result.scope === scope ? result.state : EMPTY_MODERATION_SESSION;
  const selectedId = allowed && selection?.scope === scope ? selection.id : null;
  const currentSelection = useRef(selectedId);
  currentSelection.current = selectedId;
  const selected = state.reports.find((report) => report.id === selectedId) || null;

  useEffect(() => {
    if (!allowed) return;
    const next = createChatModerationSession((value) => {
      if (currentScope.current === scope) setResult({ scope, state: value });
    });
    session.current = next;
    void next.load();
    return () => {
      next.dispose();
      if (session.current === next) session.current = null;
    };
  }, [allowed, scope]);

  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Chat reports</Text>
      <Text style={[styles.body, { color: colors.muted }]}>Review concerns from your organization. Reports involving you are handled by another authorized reviewer.</Text>
      {safety.loading ? <ActivityIndicator accessibilityLabel="Checking reviewer access" color="#0B7D82" /> : null}
      {safety.error ? <><Text accessibilityRole="alert" style={styles.error}>{safety.error}</Text><Pressable accessibilityRole="button" style={styles.button} onPress={() => void safety.refresh()}><Text style={styles.buttonText}>Check access again</Text></Pressable></> : null}
      {!allowed && !safety.loading && !safety.error ? <Text style={[styles.body, { color: colors.muted }]}>Report review is not available for this account in the current organization.</Text> : null}
      {allowed ? <>
        {state.loading ? <ActivityIndicator accessibilityLabel="Loading report queue" color="#0B7D82" /> : null}
        {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
        {state.notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text> : null}
        {!state.loading && !state.error && state.reports.length === 0 ? <Text style={[styles.body, { color: colors.muted }]}>There are no reports available for you to review.</Text> : null}
        {state.reports.map((report) => <View key={report.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.heading, { color: colors.text }]}>{report.kind === 'message' ? 'Message' : 'Person'} reported · {report.targetDisplayName || 'Dispatch member'}</Text>
          <Text style={[styles.body, { color: colors.muted }]}>{reasonLabel(report.reason)}</Text>
          <Text style={[styles.body, { color: colors.text }]}>{report.actionState?.status === 'cleanup_pending' ? 'Attachment cleanup pending' : STATUSES[report.status] || 'Submitted'}</Text>
          <Text style={[styles.body, { color: colors.muted }]}>{formatDate(report.createdAt)}</Text>
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => setSelection({ scope, id: report.id })}><Text style={styles.buttonText}>Review report</Text></Pressable>
        </View>)}
        {state.nextCursor ? <Pressable accessibilityRole="button" disabled={state.loading || state.acting} accessibilityState={{ disabled: state.loading || state.acting }} style={[styles.button, state.loading || state.acting ? styles.disabled : null]} onPress={() => void session.current?.load(state.nextCursor || undefined)}><Text style={styles.buttonText}>Load more reports</Text></Pressable> : null}
        <Pressable accessibilityRole="button" disabled={state.loading || state.acting} accessibilityState={{ disabled: state.loading || state.acting }} style={styles.secondaryButton} onPress={() => void session.current?.load()}><Text style={[styles.secondaryText, { color: colors.text }]}>Refresh queue</Text></Pressable>
      </> : null}
    </ScrollView>
    {allowed && selectedId ? <ReviewDrawer key={`${scope}|${selectedId}`} report={selected} state={state} colors={colors} onClose={() => setSelection(null)} onAction={(action, note) => {
      if (currentScope.current === scope) void session.current?.act(selectedId, action, note);
    }} onPreview={(index) => session.current?.previewAttachment(selectedId, index, () => currentScope.current === scope && currentSelection.current === selectedId, (url) => Linking.openURL(url)) || Promise.resolve()} /> : null}
  </View>;
}

function ReviewDrawer({ report, state, colors, onClose, onAction, onPreview }: {
  report: ChatModerationReport | null;
  state: ChatModerationSessionState;
  colors: Colors;
  onClose: () => void;
  onAction: (action: ChatModerationAction, note: string) => void;
  onPreview: (index: number) => Promise<void>;
}) {
  const [action, setAction] = useState<ChatModerationAction | null>(null);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const openAttachment = async (index: number) => {
    if (previewing !== null) return;
    setPreviewing(index); setPreviewError(null);
    try { await onPreview(index); }
    catch (error) { if (mounted.current) setPreviewError(error instanceof Error ? error.message : 'This attachment could not be opened. Please try again.'); }
    finally { if (mounted.current) setPreviewing(null); }
  };
  const available = action && report?.availableActions.includes(action);
  const busy = state.acting || state.loading || previewing !== null;
  const confirmReady = Boolean(available && note.trim() && !busy);
  return <KeyboardAwareDrawer visible onClose={() => { if (!state.acting) onClose(); }} backgroundColor={colors.card} surfaceStyle={[styles.drawer, { backgroundColor: colors.card }]} accessibilityLabel="Close report review">
    <KeyboardAwareDrawerScrollView contentContainerStyle={styles.drawerContent}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Review report</Text>
      {busy ? <ActivityIndicator accessibilityLabel={state.acting ? 'Applying review action' : previewing !== null ? 'Checking attachment access' : 'Refreshing report'} color="#0B7D82" /> : null}
      {state.error ? <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text> : null}
      {state.notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text> : null}
      {report ? <>
        <Text style={[styles.heading, { color: colors.text }]}>{reasonLabel(report.reason)}</Text>
        <Text style={[styles.body, { color: colors.muted }]}>Reported person: {report.targetDisplayName || 'Dispatch member'}{ '\n' }Reported by: {report.reporterDisplayName || 'Dispatch member'}{ '\n' }Conversation: {report.evidence.thread.title || 'Conversation'}</Text>
        <Text style={[styles.label, { color: colors.text }]}>Report details</Text>
        <Text selectable style={[styles.body, { color: colors.text }]}>{report.details || 'No additional details were provided.'}</Text>
        {report.evidence.message ? <View style={[styles.evidence, { borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text }]}>Reported message</Text>
          <Text selectable style={[styles.body, { color: colors.text }]}>{report.evidence.message.text || 'This message has no text.'}</Text>
          {report.evidence.message.attachments.map((attachment, index) => <View key={`${attachment.name}:${index}`} style={styles.options}>
            <Text selectable style={[styles.body, { color: colors.muted }]}>Attachment: {attachment.name || 'Unnamed attachment'} · {attachment.mimeType || attachment.kind}{typeof attachment.size === 'number' ? ` · ${Math.ceil(attachment.size / 1024)} KB` : ''}</Text>
            {report.availableActions.includes('remove_message') && report.actionState?.action !== 'remove_message' ? <Pressable accessibilityRole="button" accessibilityLabel={`Open reported attachment ${attachment.name || index + 1}`} disabled={busy || previewing !== null} accessibilityState={{ disabled: busy || previewing !== null }} style={[styles.secondaryButton, busy || previewing !== null ? styles.disabled : null]} onPress={() => void openAttachment(index)}><Text style={[styles.secondaryText, { color: colors.text }]}>{previewing === index ? 'Checking attachment access…' : 'Open reported attachment'}</Text></Pressable> : null}
          </View>)}
          {report.evidence.message.attachments.length ? <Text style={[styles.body, { color: colors.muted }]}>Open an attachment only when you need to review its content. Access is checked again before it opens.</Text> : null}
          {previewError ? <Text accessibilityRole="alert" style={styles.error}>{previewError}</Text> : null}
        </View> : null}
        {report.actionState?.status === 'cleanup_pending' ? <Text style={styles.notice}>{report.actionState.message || 'Attachment cleanup is still pending. Retry Remove message with the same review note to finish.'}</Text> : null}
        {report.availableActions.length ? <>
          <Text style={[styles.label, { color: colors.text }]}>Review action</Text>
          <View accessibilityRole="radiogroup" style={styles.options}>
            {report.availableActions.filter((item) => Boolean(ACTIONS[item])).map((item) => <Pressable key={item} accessibilityRole="radio" accessibilityState={{ checked: item === action, disabled: busy }} disabled={busy} style={[styles.option, { borderColor: item === action ? '#0B7D82' : colors.border }]} onPress={() => { setAction(item); setConfirming(false); }}><Text style={[styles.body, { color: colors.text }]}>{item === action ? '● ' : '○ '}{ACTIONS[item].label}</Text></Pressable>)}
          </View>
          <Text style={[styles.label, { color: colors.text }]}>Review note (required)</Text>
          <Text style={[styles.body, { color: colors.muted }]}>Record the reason for your decision. This note stays in the private review record.</Text>
          <KeyboardAwareDrawerTextInput accessibilityLabel="Review note, required" value={note} onChangeText={(value) => { setNote(value); setConfirming(false); }} editable={!busy} multiline maxLength={2000} style={[styles.input, { color: colors.text, borderColor: colors.border }]} placeholder="Explain your decision" placeholderTextColor={colors.muted} />
          {confirming && action && available ? <View style={[styles.evidence, { borderColor: colors.border }]}>
            <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>Confirm {ACTIONS[action].label.toLowerCase()}</Text>
            <Text style={[styles.body, { color: colors.muted }]}>{ACTIONS[action].explanation}</Text>
            <Pressable accessibilityRole="button" disabled={!confirmReady} accessibilityState={{ disabled: !confirmReady }} style={[styles.button, !confirmReady ? styles.disabled : null]} onPress={() => { setConfirming(false); onAction(action, note); }}><Text style={styles.buttonText}>Confirm action</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} style={styles.secondaryButton} onPress={() => setConfirming(false)}><Text style={[styles.secondaryText, { color: colors.text }]}>Keep reviewing</Text></Pressable>
          </View> : <Pressable accessibilityRole="button" disabled={!confirmReady} accessibilityState={{ disabled: !confirmReady }} style={[styles.button, !confirmReady ? styles.disabled : null]} onPress={() => setConfirming(true)}><Text style={styles.buttonText}>Review action before applying</Text></Pressable>}
        </> : <Text style={[styles.body, { color: colors.muted }]}>No review actions are currently available for this report.</Text>}
      </> : !busy ? <Text style={[styles.body, { color: colors.muted }]}>This report is no longer available in the current queue. Close this view and refresh the queue.</Text> : null}
      <Pressable accessibilityRole="button" disabled={state.acting} accessibilityState={{ disabled: state.acting }} style={styles.secondaryButton} onPress={onClose}><Text style={[styles.secondaryText, { color: colors.text }]}>Close review</Text></Pressable>
    </KeyboardAwareDrawerScrollView>
  </KeyboardAwareDrawer>;
}

function reasonLabel(reason: string) { return CHAT_REPORT_REASONS.find((item) => item.value === reason)?.label || 'Reported concern'; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, width: '100%', maxWidth: 760, alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '800' },
  heading: { fontSize: 19, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 23 },
  label: { fontSize: 16, fontWeight: '700', marginTop: 5 },
  card: { padding: 18, gap: 10, borderRadius: 16, borderWidth: 1 },
  button: { minHeight: 48, padding: 12, justifyContent: 'center', borderRadius: 10, backgroundColor: '#0EC3C9' },
  buttonText: { color: '#061229', fontWeight: '700', fontSize: 16, textAlign: 'center' },
  secondaryButton: { minHeight: 44, padding: 10, justifyContent: 'center' },
  secondaryText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.5 },
  drawer: { width: '100%', maxWidth: 720, alignSelf: 'center', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  drawerContent: { padding: 20, gap: 12 },
  evidence: { padding: 14, gap: 10, borderRadius: 10, borderWidth: 1 },
  options: { gap: 8 },
  option: { minHeight: 44, padding: 12, borderRadius: 10, borderWidth: 1 },
  input: { minHeight: 110, padding: 12, borderRadius: 10, borderWidth: 1, textAlignVertical: 'top', fontSize: 16 },
  error: { color: '#991B1B', backgroundColor: '#FFF1F2', borderRadius: 8, padding: 12, lineHeight: 21 },
  notice: { color: '#075E62', backgroundColor: '#D8F9F7', borderRadius: 8, padding: 12, lineHeight: 21 },
});
