import { StyleSheet, View } from 'react-native';

const DRAWER_BOTTOM_FILL_HEIGHT = 640;

type DrawerBottomFillProps = {
  backgroundColor: string;
};

/**
 * Extends a bottom drawer's surface beneath the visible viewport. The native
 * keyboard and tab bar render above this non-interactive layer, so their
 * rounded corners cannot expose the dimmed backdrop behind the drawer.
 */
export function DrawerBottomFill({ backgroundColor }: DrawerBottomFillProps) {
  return (
    <View
      pointerEvents="none"
      style={[styles.fill, { backgroundColor }]}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    right: 0,
    bottom: -DRAWER_BOTTOM_FILL_HEIGHT,
    left: 0,
    height: DRAWER_BOTTOM_FILL_HEIGHT,
  },
});
