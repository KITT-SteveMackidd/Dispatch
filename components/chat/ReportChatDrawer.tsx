import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemeMode } from '@/context/theme';
import { KeyboardAwareDrawer, KeyboardAwareDrawerScrollView, KeyboardAwareDrawerTextInput } from '@/components/KeyboardAwareDrawer';
import { CHAT_REPORT_REASONS, submitChatReport, type ChatReportReason } from '@/services/chat-safety';

export type ReportChatTarget =
  | { kind: 'message'; messageId: string; senderName?: string }
  | { kind: 'user'; targetUserId: string; displayName?: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  threadId: string;
  target: ReportChatTarget | null;
  onSubmitted: (reportId: string) => void;
};

export function ReportChatDrawer({ visible, onClose, threadId, target, onSubmitted }: Props) {
  const { resolvedThemeMode } = useThemeMode();
  const dark = resolvedThemeMode === 'dark';
  const colors = { card: dark ? '#12274D' : '#FFFFFF', text: dark ? '#F4F8FF' : '#172033', muted: dark ? '#B7C7DD' : '#53627A', border: dark ? '#38517E' : '#CBD5E1' };
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const requestId = useRef('');
  const requestPayload = useRef<string | null>(null);
  const submissionGeneration = useRef(0);
  const targetKey = target ? `${target.kind}:${target.kind === 'message' ? target.messageId : target.targetUserId}` : '';

  useEffect(() => {
    ++submissionGeneration.current;
    if (!visible) return;
    setReason(null); setDetails(''); setError(null); setSubmitted(false); setBusy(false);
    requestId.current = `report_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
    requestPayload.current = null;
  }, [visible, threadId, targetKey]);
  useEffect(() => () => { ++submissionGeneration.current; }, []);

  const submit = async () => {
    if (!target || !reason || busy || submitted) return;
    const payload = {
      threadId, kind: target.kind, reason, details: details.trim(),
      ...(target.kind === 'message' ? { messageId: target.messageId } : { targetUserId: target.targetUserId }),
    };
    const serialized = JSON.stringify(payload);
    // A retry keeps its ID; editing a failed request starts a distinct report.
    if (requestPayload.current && requestPayload.current !== serialized) {
      requestId.current = `report_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
    }
    requestPayload.current = serialized;
    const generation = submissionGeneration.current;
    setBusy(true); setError(null);
    try {
      const result = await submitChatReport({ ...payload, clientRequestId: requestId.current });
      if (generation !== submissionGeneration.current) return;
      setSubmitted(true);
      onSubmitted(result.reportId);
    } catch (cause) {
      if (generation !== submissionGeneration.current) return;
      setError(cause instanceof Error ? cause.message : 'Your report could not be submitted. Please try again.');
    } finally { if (generation === submissionGeneration.current) setBusy(false); }
  };
  const name = target?.kind === 'message' ? target.senderName : target?.displayName;

  return (
    <KeyboardAwareDrawer visible={visible} onClose={() => { if (!busy) onClose(); }} backgroundColor={colors.card} accessibilityLabel="Close report" surfaceStyle={[styles.drawer, { backgroundColor: colors.card }]}>
      <KeyboardAwareDrawerScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{target?.kind === 'message' ? 'Report message' : 'Report person'}</Text>
        {submitted ? (
          <Text accessibilityLiveRegion="polite" style={styles.success}>Your report was submitted. You can check its status in Chat safety.</Text>
        ) : (
          <>
            <Text style={[styles.body, { color: colors.muted }]}>{name ? `Tell us about your concern involving ${name}. ` : ''}Authorized reviewers can review your concern. Your report is not shared with the person you report.</Text>
            <Text style={[styles.label, { color: colors.text }]}>Reason</Text>
            <View accessibilityRole="radiogroup" style={styles.reasons}>
              {CHAT_REPORT_REASONS.map((item) => <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ checked: reason === item.value, disabled: busy }} disabled={busy} onPress={() => setReason(item.value)} style={[styles.reason, { borderColor: reason === item.value ? '#0B7D82' : colors.border, backgroundColor: reason === item.value ? '#D8F9F7' : colors.card }]}><Text style={[styles.reasonText, { color: reason === item.value ? '#075E62' : colors.text }]}>{reason === item.value ? '● ' : '○ '}{item.label}</Text></Pressable>)}
            </View>
            <Text style={[styles.label, { color: colors.text }]}>Additional details (optional)</Text>
            <KeyboardAwareDrawerTextInput accessibilityLabel="Additional report details, optional" value={details} onChangeText={setDetails} editable={!busy} maxLength={2000} multiline placeholder="What would you like the reviewer to know?" placeholderTextColor={colors.muted} style={[styles.input, { color: colors.text, borderColor: colors.border }]} />
            <Text style={[styles.count, { color: colors.muted }]}>{details.length}/2,000</Text>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !reason || busy }} disabled={!reason || busy} onPress={() => void submit()} style={[styles.submit, !reason || busy ? styles.disabled : null]}><Text style={styles.submitText}>{busy ? 'Submitting…' : 'Submit report'}</Text></Pressable>
          </>
        )}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={onClose} style={styles.close}><Text style={[styles.closeText, { color: colors.text }]}>{submitted ? 'Done' : 'Cancel'}</Text></Pressable>
      </KeyboardAwareDrawerScrollView>
    </KeyboardAwareDrawer>
  );
}

const styles = StyleSheet.create({
  drawer: { width: '100%', maxWidth: 640, alignSelf: 'center', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  content: { padding: 20, gap: 12 },
  title: { fontSize: 24, fontWeight: '800' },
  body: { fontSize: 15, lineHeight: 22 },
  label: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  reasons: { gap: 8 },
  reason: { minHeight: 44, padding: 12, borderWidth: 1, borderRadius: 10, justifyContent: 'center' },
  reasonText: { fontSize: 15, fontWeight: '600' },
  input: { minHeight: 110, padding: 12, borderWidth: 1, borderRadius: 10, textAlignVertical: 'top', fontSize: 16 },
  count: { textAlign: 'right', fontSize: 12 },
  submit: { minHeight: 48, backgroundColor: '#0EC3C9', borderRadius: 10, padding: 12, justifyContent: 'center' },
  submitText: { color: '#061229', textAlign: 'center', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.5 },
  close: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 16, fontWeight: '600' },
  error: { color: '#991B1B', backgroundColor: '#FFF1F2', borderRadius: 8, padding: 12, lineHeight: 20 },
  success: { color: '#166534', backgroundColor: '#DCFCE7', borderRadius: 8, padding: 14, fontSize: 16, lineHeight: 24 },
});
