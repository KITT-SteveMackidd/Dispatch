import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useThemeMode } from '@/context/theme';

export default function EnterInviteCodeScreen() {
  const router = useRouter();
  const { resolvedThemeMode } = useThemeMode();
  const isDarkMode = resolvedThemeMode === 'dark';
  const [code, setCode] = useState('');
  const normalizedCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '');

  return (
    <SafeAreaView style={[styles.screen, isDarkMode ? styles.screenDark : styles.screenLight]}>
      <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.select({ ios: 'padding', android: 'height' })}>
        <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
          <Text style={[styles.eyebrow, isDarkMode ? styles.eyebrowDark : styles.eyebrowLight]}>Dispatch invitation</Text>
          <Text style={[styles.title, isDarkMode ? styles.textDark : styles.textLight]}>Enter invitation code</Text>
          <Text style={[styles.body, isDarkMode ? styles.mutedDark : styles.mutedLight]}>
            Enter the backup code from your invitation email.
          </Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={16}
            placeholder="ABCD 2345 EFGH"
            placeholderTextColor="#64748B"
            style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
            returnKeyType="go"
            onSubmitEditing={() => {
              if (normalizedCode.length >= 8) {
                router.replace({ pathname: '/invite/[token]', params: { token: normalizedCode, direct: '1' } });
              }
            }}
          />
          <Pressable
            style={[styles.primaryButton, normalizedCode.length < 8 && styles.disabled]}
            disabled={normalizedCode.length < 8}
            onPress={() => router.replace({ pathname: '/invite/[token]', params: { token: normalizedCode, direct: '1' } })}>
            <Text style={styles.primaryButtonText}>Review invitation</Text>
          </Pressable>
          <Pressable style={styles.textButton} onPress={() => router.replace('/')}>
            <Text style={styles.textButtonText}>Back to Dispatch</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenLight: { backgroundColor: '#DBE2F9' },
  screenDark: { backgroundColor: '#061229' },
  keyboardView: { flex: 1, justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 520, alignSelf: 'center', borderRadius: 8, borderWidth: 1, padding: 20 },
  cardLight: { backgroundColor: '#F7F7F7', borderColor: 'rgba(6,18,41,0.12)' },
  cardDark: { backgroundColor: '#12274D', borderColor: 'rgba(247,247,247,0.16)' },
  eyebrow: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  eyebrowLight: { color: '#F98D2F' },
  eyebrowDark: { color: '#0EC3C9' },
  title: { marginTop: 6, fontSize: 26, fontWeight: '800' },
  body: { marginTop: 8, fontSize: 15, lineHeight: 22 },
  textLight: { color: '#121212' },
  textDark: { color: '#F7F7F7' },
  mutedLight: { color: '#64748B' },
  mutedDark: { color: '#CBD5E1' },
  input: { minHeight: 52, marginTop: 18, borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  inputLight: { backgroundColor: '#EDF0FC', borderColor: '#CBD5E1', color: '#121212' },
  inputDark: { backgroundColor: '#203E75', borderColor: '#64748B', color: '#F7F7F7' },
  primaryButton: { minHeight: 50, marginTop: 14, borderRadius: 8, backgroundColor: '#0EC3C9', alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#061229', fontSize: 16, fontWeight: '800' },
  textButton: { minHeight: 44, marginTop: 8, alignItems: 'center', justifyContent: 'center' },
  textButtonText: { color: '#F98D2F', fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
