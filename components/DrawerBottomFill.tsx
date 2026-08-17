import { StyleSheet, useWindowDimensions, View } from 'react-native';

type DrawerBottomFillProps = {
  backgroundColor: string;
};

/**
 * Extends a bottom drawer's surface beneath the visible viewport. The native
 * keyboard and tab bar render above this non-interactive layer, so their
 * rounded corners cannot expose the dimmed backdrop behind the drawer.
 */
export function DrawerBottomFill({ backgroundColor }: DrawerBottomFillProps) {
  const { height } = useWindowDimensions();

  return (
    <View
      pointerEvents="none"
      style={[styles.fill, { backgroundColor, bottom: -height, height }]}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    right: 0,
    left: 0,
  },
});
