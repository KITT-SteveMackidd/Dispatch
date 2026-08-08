import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useThemeMode } from '@/context/theme';
import { useSession } from '@/context/session';
import { AppRole } from '@/types/dispatch';

export default function AccountSettingsScreen() {
  const { themeMode, resolvedThemeMode, setThemeMode } = useThemeMode();
  const { profile, saveProfile } = useSession();
  const router = useRouter();

  const isDarkMode = resolvedThemeMode === 'dark';
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [phoneNumber, setPhoneNumber] = useState(profile?.phoneNumber || '');
  const [role, setRole] = useState<AppRole>(profile?.role || 'manager');
  const [savingProfile, setSavingProfile] = useState(false);

  const onSaveProfile = async () => {
    if (!displayName.trim()) {
      Alert.alert('Missing name', 'Please enter your name.');
      return;
    }

    setSavingProfile(true);
    try {
      await saveProfile({ displayName: displayName.trim(), phoneNumber: phoneNumber.trim(), role });
      router.replace('/(tabs)/profile');
      Alert.alert('Profile updated', 'Your profile details were saved.');
    } catch (error) {
      Alert.alert('Unable to update profile', error instanceof Error ? error.message : 'Try again in a moment.');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, isDarkMode ? styles.containerDark : styles.containerLight]}
      behavior={Platform.select({ ios: 'padding', android: 'height' })}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
          <Text style={[styles.eyebrow, isDarkMode ? styles.eyebrowDark : styles.eyebrowLight]}>Profile</Text>
          <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>Update details</Text>
          <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>
            Keep your name, phone number, and role up to date.
          </Text>

          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            placeholderTextColor={isDarkMode ? '#94A3B8' : '#94a3b8'}
            style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
          />
          <TextInput
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder="Phone number"
            placeholderTextColor={isDarkMode ? '#94A3B8' : '#94a3b8'}
            keyboardType="phone-pad"
            style={[styles.input, isDarkMode ? styles.inputDark : styles.inputLight]}
          />

          <View style={styles.roleRow}>
            {(['manager', 'worker'] as AppRole[]).map((mode) => {
              const selected = role === mode;
              return (
                <Pressable
                  key={mode}
                  onPress={() => setRole(mode)}
                  style={[
                    styles.rolePill,
                    isDarkMode ? styles.rolePillDark : styles.rolePillLight,
                    selected && (isDarkMode ? styles.rolePillSelectedDark : styles.rolePillSelectedLight),
                  ]}>
                  <Text
                    style={[
                      styles.rolePillText,
                      selected
                        ? (isDarkMode ? styles.rolePillTextSelectedDark : styles.rolePillTextSelectedLight)
                        : isDarkMode
                          ? styles.rolePillTextDark
                          : styles.rolePillTextLight,
                    ]}>
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable onPress={onSaveProfile} style={[styles.primaryBtn, savingProfile && styles.disabled]} disabled={savingProfile}>
            <Text style={[styles.primaryBtnText, isDarkMode ? styles.primaryBtnTextDark : styles.primaryBtnTextLight]}>
              {savingProfile ? 'Saving...' : 'Save profile changes'}
            </Text>
          </Pressable>
        </View>

        <View style={[styles.card, isDarkMode ? styles.cardDark : styles.cardLight]}>
          <Text style={[styles.eyebrow, isDarkMode ? styles.eyebrowDark : styles.eyebrowLight]}>Preferences</Text>
          <Text style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>Appearance</Text>
          <Text style={[styles.subtitle, isDarkMode ? styles.subtitleDark : styles.subtitleLight]}>
            Choose how Events looks for you.
          </Text>

          <View style={styles.options}>
            {(['light', 'dark', 'system'] as const).map((mode) => (
              <Pressable
                key={mode}
                onPress={() => setThemeMode(mode)}
                style={[
                  styles.option,
                  isDarkMode ? styles.optionDark : styles.optionLight,
                  themeMode === mode ? styles.optionSelected : null,
                ]}>
                <Text style={[styles.optionLabel, isDarkMode ? styles.optionLabelDark : styles.optionLabelLight]}>
                  {mode[0].toUpperCase() + mode.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.helper, isDarkMode ? styles.helperDark : styles.helperLight]}>
            Current mode: {themeMode === 'system' ? `System (${resolvedThemeMode})` : themeMode}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  containerLight: { backgroundColor: '#eef2ff' },
  containerDark: { backgroundColor: '#101A2F' },
  content: { padding: 16, gap: 14 },
  card: { borderRadius: 16, borderWidth: 1, padding: 18 },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#e2e8f0' },
  cardDark: { backgroundColor: '#1A2540', borderColor: '#001A4D' },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  eyebrowLight: { color: '#2563eb' },
  eyebrowDark: { color: '#0EC3C9' },
  title: { marginTop: 6, fontSize: 22, fontWeight: '700' },
  titleLight: { color: '#232832' },
  titleDark: { color: '#F4F8FF' },
  subtitle: { marginTop: 6, marginBottom: 16 },
  subtitleLight: { color: '#64748b' },
  subtitleDark: { color: '#F4F8FF' },
  input: { padding: 13, borderRadius: 12, marginBottom: 12, borderWidth: 1 },
  inputLight: { backgroundColor: '#f8fafc', color: '#232832', borderColor: '#e2e8f0' },
  inputDark: { backgroundColor: '#1A2540', color: '#F4F8FF', borderColor: '#001A4D' },
  roleRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  rolePill: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  rolePillLight: { backgroundColor: '#f1f5f9', borderColor: '#e2e8f0' },
  rolePillDark: { backgroundColor: '#1A2540', borderColor: '#0EC3C9' },
  rolePillSelectedLight: { backgroundColor: '#0EC3C9', borderColor: '#0EC3C9' },
  rolePillSelectedDark: { backgroundColor: '#0EC3C9', borderColor: '#0EC3C9' },
  rolePillText: { fontWeight: '700' },
  rolePillTextLight: { color: '#334155' },
  rolePillTextDark: { color: '#0EC3C9' },
  rolePillTextSelectedLight: { color: '#FFFFFF' },
  rolePillTextSelectedDark: { color: '#1A2540' },
  primaryBtn: { backgroundColor: '#0EC3C9', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center' },
  primaryBtnText: { fontWeight: '700' },
  primaryBtnTextLight: { color: '#FFFFFF' },
  primaryBtnTextDark: { color: '#1A2540' },
  options: { gap: 10 },
  option: { borderWidth: 1, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14 },
  optionLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  optionDark: { borderColor: '#001A4D', backgroundColor: '#1A2540' },
  optionSelected: { borderColor: '#0EC3C9', borderWidth: 2 },
  optionLabel: { fontWeight: '700' },
  optionLabelLight: { color: '#232832' },
  optionLabelDark: { color: '#F4F8FF' },
  helper: { marginTop: 12, fontSize: 12 },
  helperLight: { color: '#475569' },
  helperDark: { color: '#F4F8FF' },
  disabled: { opacity: 0.65 },
});
