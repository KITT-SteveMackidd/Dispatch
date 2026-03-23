import { ImageStyle, Platform, StyleSheet, TextStyle, ViewStyle } from 'react-native';

export const authFont = {
  regular: 'Inter',
  semibold: 'Inter-SemiBold',
  bold: 'Inter-Bold',
  extrabold: 'Inter-ExtraBold',
} as const;

type AuthPalette = {
  background: string;
  glow: string;
  card: string;
  cardBorder: string;
  text: string;
  mutedText: string;
  inputBackground: string;
  inputBorder: string;
  placeholder: string;
  primary: string;
  primaryPressed: string;
  accent: string;
  pillBackground: string;
  pillBorder: string;
  pillActiveBackground: string;
  pillActiveBorder: string;
  pillText: string;
  divider: string;
  shadowColor: string;
};

export const authPalettes: Record<'light' | 'dark', AuthPalette> = {
  light: {
    background: '#F4F7F7',
    glow: '#D7F3F1',
    card: '#FFFCF8',
    cardBorder: '#E6ECE8',
    text: '#142126',
    mutedText: '#667781',
    inputBackground: '#FFFFFF',
    inputBorder: '#D6E1DE',
    placeholder: '#8AA09A',
    primary: '#14B8B0',
    primaryPressed: '#0F9F98',
    accent: '#D97745',
    pillBackground: '#F2F5F4',
    pillBorder: '#D8E2DE',
    pillActiveBackground: '#DBF4F2',
    pillActiveBorder: '#62D3CA',
    pillText: '#37505A',
    divider: '#E1E8E5',
    shadowColor: '#10323B',
  },
  dark: {
    background: '#07161B',
    glow: '#0D3B40',
    card: '#0E2027',
    cardBorder: '#173844',
    text: '#F4FAF9',
    mutedText: '#94B1B6',
    inputBackground: '#112B33',
    inputBorder: '#1D4350',
    placeholder: '#6E9198',
    primary: '#19C7BE',
    primaryPressed: '#11A79F',
    accent: '#F0A06C',
    pillBackground: '#102A32',
    pillBorder: '#1C4552',
    pillActiveBackground: '#0E4344',
    pillActiveBorder: '#2FD3C8',
    pillText: '#D7ECE9',
    divider: '#17313A',
    shadowColor: '#02090C',
  },
};

export const authStyles = StyleSheet.create<{
  screen: ViewStyle;
  flex: ViewStyle;
  scrollContent: ViewStyle;
  backgroundGlowTop: ViewStyle;
  backgroundGlowBottom: ViewStyle;
  logoWrap: ViewStyle;
  logo: ImageStyle;
  brand: TextStyle;
  card: ViewStyle;
  eyebrow: TextStyle;
  title: TextStyle;
  subtitle: TextStyle;
  form: ViewStyle;
  input: TextStyle;
  helperRow: ViewStyle;
  row: ViewStyle;
  pill: ViewStyle;
  pillText: TextStyle;
  button: ViewStyle;
  buttonPressed: ViewStyle;
  buttonText: TextStyle;
  secondaryButton: ViewStyle;
  secondaryButtonText: TextStyle;
  linkRow: ViewStyle;
  linkLabel: TextStyle;
  linkText: TextStyle;
}>({
  screen: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  backgroundGlowTop: {
    position: 'absolute',
    top: -110,
    right: -70,
    width: 240,
    height: 240,
    borderRadius: 999,
    opacity: 0.25,
  },
  backgroundGlowBottom: {
    position: 'absolute',
    bottom: -150,
    left: -90,
    width: 280,
    height: 280,
    borderRadius: 999,
    opacity: 0.22,
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    marginBottom: 14,
  },
  brand: {
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 2.3,
    textTransform: 'uppercase',
    fontFamily: authFont.semibold,
  },
  card: {
    borderRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 24,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: Platform.OS === 'ios' ? 0.18 : 0,
    shadowRadius: 28,
    elevation: Platform.OS === 'android' ? 5 : 0,
  },
  eyebrow: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    fontFamily: authFont.semibold,
    marginBottom: 10,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: authFont.extrabold,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: authFont.regular,
    marginBottom: 24,
  },
  form: {
    gap: 12,
  },
  input: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: authFont.regular,
  },
  helperRow: {
    alignItems: 'flex-end',
    marginTop: 2,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  pill: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pillText: {
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: authFont.semibold,
  },
  button: {
    minHeight: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginTop: 6,
  },
  buttonPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.995 }],
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 20,
    fontFamily: authFont.bold,
  },
  secondaryButton: {
    minHeight: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: authFont.semibold,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 6,
    rowGap: 4,
    marginTop: 18,
  },
  linkLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: authFont.regular,
  },
  linkText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: authFont.semibold,
  },
});
