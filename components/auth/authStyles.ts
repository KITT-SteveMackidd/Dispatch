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
    background: '#F3F6F7',
    glow: '#D8EFED',
    card: '#FFFCF8',
    cardBorder: '#E3EBE8',
    text: '#122027',
    mutedText: '#667680',
    inputBackground: '#FFFFFF',
    inputBorder: '#D4DFDC',
    placeholder: '#8AA09A',
    primary: '#16B6AE',
    primaryPressed: '#109B95',
    accent: '#D67B48',
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
  lightScrollContent: ViewStyle;
  darkScrollContent: ViewStyle;
  backgroundGlowTop: ViewStyle;
  backgroundGlowBottom: ViewStyle;
  shell: ViewStyle;
  heroPanel: ViewStyle;
  heroBadge: ViewStyle;
  heroBadgeText: TextStyle;
  heroTitle: TextStyle;
  heroBody: TextStyle;
  heroList: ViewStyle;
  heroListItem: ViewStyle;
  heroBullet: ViewStyle;
  heroListText: TextStyle;
  heroFootnote: TextStyle;
  formPanel: ViewStyle;
  lightLogoWrap: ViewStyle;
  lightHeroGraphic: ImageStyle;
  lightCard: ViewStyle;
  lightTitle: TextStyle;
  lightSubtitle: TextStyle;
  lightForm: ViewStyle;
  lightInput: TextStyle;
  lightActionGroup: ViewStyle;
  lightActionLink: TextStyle;
  lightButton: ViewStyle;
  lightRoleRow: ViewStyle;
  lightRolePill: ViewStyle;
  lightRolePillText: TextStyle;
  lightFooterRow: ViewStyle;
  lightFooterLabel: TextStyle;
  lightFooterLink: TextStyle;
  darkLogoWrap: ViewStyle;
  darkHeroGraphic: ImageStyle;
  darkCard: ViewStyle;
  darkTitle: TextStyle;
  darkSubtitle: TextStyle;
  darkForm: ViewStyle;
  darkInput: TextStyle;
  darkRoleRow: ViewStyle;
  darkRolePill: ViewStyle;
  darkRolePillText: TextStyle;
  darkButton: ViewStyle;
  darkFooterRow: ViewStyle;
  darkFooterLabel: TextStyle;
  darkFooterLink: TextStyle;
  darkActionLink: TextStyle;
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
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  lightScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
  },
  darkScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
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
  shell: {
    width: '100%',
    maxWidth: 1060,
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 32,
    overflow: 'hidden',
  },
  heroPanel: {
    flexGrow: 1,
    flexBasis: 320,
    minHeight: 300,
    paddingHorizontal: 28,
    paddingVertical: 30,
    justifyContent: 'space-between',
    gap: 20,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  heroBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontFamily: authFont.semibold,
  },
  heroTitle: {
    fontSize: 34,
    lineHeight: 40,
    fontFamily: authFont.extrabold,
    maxWidth: 320,
  },
  heroBody: {
    fontSize: 15,
    lineHeight: 24,
    fontFamily: authFont.regular,
    maxWidth: 360,
  },
  heroList: {
    gap: 12,
  },
  heroListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  heroBullet: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  heroListText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: authFont.semibold,
  },
  heroFootnote: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: authFont.regular,
  },
  formPanel: {
    flexGrow: 1,
    flexBasis: 360,
    minWidth: 300,
    paddingHorizontal: 22,
    paddingVertical: 22,
  },
  lightLogoWrap: {
    width: '100%',
    maxWidth: 402,
    alignItems: 'center',
    marginBottom: 10,
  },
  lightHeroGraphic: {
    width: 465,
    height: 310,
  },
  lightCard: {
    width: '100%',
    maxWidth: 354,
    backgroundColor: '#EDF0FC',
    borderRadius: 16,
    padding: 16,
    gap: 16,
  },
  lightTitle: {
    fontSize: 24,
    lineHeight: 29,
    fontFamily: authFont.extrabold,
    color: '#121212',
  },
  lightSubtitle: {
    fontSize: 14,
    lineHeight: 17,
    fontFamily: authFont.regular,
    color: 'rgba(18,18,18,0.7)',
  },
  lightForm: {
    gap: 8,
  },
  lightInput: {
    minHeight: 41,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    fontSize: 16,
    lineHeight: 19,
    fontFamily: authFont.regular,
  },
  lightActionGroup: {
    gap: 8,
    marginTop: 8,
  },
  lightActionLink: {
    fontSize: 16,
    lineHeight: 19,
    fontFamily: authFont.bold,
    color: '#F98D2F',
  },
  lightButton: {
    minHeight: 43,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  lightRoleRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  lightRolePill: {
    flex: 1,
    minHeight: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  lightRolePillText: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: authFont.bold,
  },
  lightFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 4,
    width: '100%',
  },
  lightFooterLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: authFont.regular,
    color: '#121212',
  },
  lightFooterLink: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: authFont.bold,
    color: '#F98D2F',
  },
  darkLogoWrap: {
    width: '100%',
    maxWidth: 402,
    alignItems: 'center',
    marginBottom: 10,
  },
  darkHeroGraphic: {
    width: 465,
    height: 310,
  },
  darkCard: {
    width: '100%',
    maxWidth: 354,
    backgroundColor: '#12274D',
    borderRadius: 16,
    padding: 16,
    gap: 16,
  },
  darkTitle: {
    fontSize: 24,
    lineHeight: 29,
    fontFamily: authFont.extrabold,
    color: '#F7F7F7',
  },
  darkSubtitle: {
    fontSize: 14,
    lineHeight: 17,
    fontFamily: authFont.regular,
    color: 'rgba(247,247,247,0.7)',
  },
  darkForm: {
    gap: 8,
  },
  darkInput: {
    minHeight: 41,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    fontSize: 16,
    lineHeight: 19,
    fontFamily: authFont.regular,
    color: '#F7F7F7',
    backgroundColor: '#203E75',
  },
  darkRoleRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  darkRolePill: {
    flex: 1,
    minHeight: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  darkRolePillText: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: authFont.bold,
  },
  darkButton: {
    minHeight: 43,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  darkFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 4,
    width: '100%',
  },
  darkFooterLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: authFont.regular,
    color: '#F7F7F7',
  },
  darkFooterLink: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: authFont.bold,
    color: '#F98D2F',
  },
  darkActionLink: {
    fontSize: 16,
    lineHeight: 19,
    fontFamily: authFont.bold,
    color: '#F98D2F',
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 20,
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
    minHeight: 56,
    borderRadius: 18,
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
    minHeight: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginTop: 8,
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
