import type { ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type SwipeActionButtonProps = {
  progress: SharedValue<number>;
  accessibilityLabel: string;
  onPress: () => void;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
};

export function SwipeActionButton({ progress, ...props }: SwipeActionButtonProps) {
  // ReanimatedSwipeable keeps actions mounted at rest. Hide their backgrounds
  // so they cannot show through the rounded card corners or its bottom margin.
  const visibilityStyle = useAnimatedStyle(() => ({ opacity: progress.value === 0 ? 0 : 1 }), [progress]);

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      style={[props.style, visibilityStyle]}>
      {props.children}
    </AnimatedPressable>
  );
}
