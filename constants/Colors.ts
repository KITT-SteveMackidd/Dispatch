const brandPalette = {
  navy900: '#00133D',
  navy800: '#001A4D',
  orange500: '#F98D2F',
  cyan500: '#0EC3C9',
  green500: '#78D24F',
  offwhite: '#F4F8FF',
};

const tintColorLight = '#2f95dc';
const tintColorDark = brandPalette.offwhite;

export default {
  brand: brandPalette,
  light: {
    text: '#000',
    background: '#fff',
    surface: '#ffffff',
    tint: tintColorLight,
    tabIconDefault: '#ccc',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: brandPalette.offwhite,
    mutedText: brandPalette.offwhite,
    background: '#101A2F',
    surface: '#1A2540',
    border: brandPalette.navy800,
    tint: tintColorDark,
    accentPrimary: brandPalette.cyan500,
    accentSecondary: brandPalette.navy800,
    accentSuccess: brandPalette.green500,
    accentWarning: brandPalette.orange500,
    tabIconDefault: brandPalette.offwhite,
    tabIconSelected: brandPalette.offwhite,
  },
};
