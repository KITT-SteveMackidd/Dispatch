import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ModalProps,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { DrawerBottomFill } from '@/components/DrawerBottomFill';
import { DRAWER_KEYBOARD_CONTENT_GAP, getKeyboardAwareDrawerScrollOffset } from '@/lib/keyboard-layout';

type KeyboardAwareDrawerProps = {
  visible: boolean;
  onClose: () => void;
  backgroundColor: string;
  children: React.ReactNode;
  surfaceStyle?: StyleProp<ViewStyle>;
  animationType?: ModalProps['animationType'];
  accessibilityLabel?: string;
};

type DrawerScrollContextValue = {
  focusInput: (input: TextInput | null) => void;
  blurInput: (input: TextInput | null) => void;
};

const DrawerScrollContext = createContext<DrawerScrollContextValue | null>(null);

export function KeyboardAwareDrawer({
  visible,
  onClose,
  backgroundColor,
  children,
  surfaceStyle,
  animationType = 'slide',
  accessibilityLabel = 'Close drawer',
}: KeyboardAwareDrawerProps) {
  return (
    <Modal visible={visible} transparent animationType={animationType} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <KeyboardAvoidingView
          pointerEvents="box-none"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardViewport}>
          <View style={[styles.surface, surfaceStyle]}>
            <DrawerBottomFill backgroundColor={backgroundColor} />
            {children}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

type KeyboardAwareDrawerScrollViewProps = ScrollViewProps & {
  focusedInputGap?: number;
};

export const KeyboardAwareDrawerScrollView = forwardRef<ScrollView, KeyboardAwareDrawerScrollViewProps>(
  function KeyboardAwareDrawerScrollView(
    {
      children,
      contentContainerStyle,
      focusedInputGap = DRAWER_KEYBOARD_CONTENT_GAP,
      keyboardDismissMode,
      onContentSizeChange,
      onScroll,
      ...props
    },
    forwardedRef
  ) {
    const scrollRef = useRef<ScrollView>(null);
    const scrollOffsetRef = useRef(0);
    const activeInputRef = useRef<TextInput | null>(null);
    const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

    useImperativeHandle(forwardedRef, () => scrollRef.current as ScrollView);

    const clearTimers = useCallback(() => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    }, []);

    const revealInput = useCallback((input: TextInput | null, animated = true) => {
      const scrollView = scrollRef.current;
      if (!input || !scrollView) return;

      input.measureInWindow((_inputX, inputY, _inputWidth, inputHeight) => {
        scrollView.getNativeScrollRef()?.measureInWindow((_scrollX, scrollY, _scrollWidth, scrollHeight) => {
          const keyboardTop = Keyboard.metrics()?.screenY;
          const nextOffset = getKeyboardAwareDrawerScrollOffset({
            currentOffset: scrollOffsetRef.current,
            inputTop: inputY,
            inputHeight,
            viewportTop: scrollY,
            viewportHeight: scrollHeight,
            keyboardTop,
            gap: focusedInputGap,
          });

          if (Math.abs(nextOffset - scrollOffsetRef.current) < 1) return;
          scrollOffsetRef.current = nextOffset;
          scrollView.scrollTo({ y: nextOffset, animated });
        });
      });
    }, [focusedInputGap]);

    const scheduleReveal = useCallback((input: TextInput | null) => {
      if (!input) return;
      clearTimers();
      requestAnimationFrame(() => revealInput(input));
      timersRef.current = [80, 280].map((delay) => setTimeout(() => revealInput(input), delay));
    }, [clearTimers, revealInput]);

    useEffect(() => {
      const revealActiveInput = () => scheduleReveal(activeInputRef.current);
      const showSubscription = Keyboard.addListener('keyboardDidShow', revealActiveInput);
      const frameSubscription = Keyboard.addListener('keyboardDidChangeFrame', revealActiveInput);
      return () => {
        showSubscription.remove();
        frameSubscription.remove();
        clearTimers();
      };
    }, [clearTimers, scheduleReveal]);

    const contextValue = useMemo<DrawerScrollContextValue>(() => ({
      focusInput: (input) => {
        activeInputRef.current = input;
        scheduleReveal(input);
      },
      blurInput: (input) => {
        if (activeInputRef.current === input) activeInputRef.current = null;
      },
    }), [scheduleReveal]);

    const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
      onScroll?.(event);
    };

    const handleContentSizeChange = (width: number, height: number) => {
      onContentSizeChange?.(width, height);
      if (activeInputRef.current && Keyboard.isVisible()) scheduleReveal(activeInputRef.current);
    };

    return (
      <DrawerScrollContext.Provider value={contextValue}>
        <ScrollView
          {...props}
          ref={scrollRef}
          automaticallyAdjustKeyboardInsets={false}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
          keyboardDismissMode={keyboardDismissMode ?? (Platform.OS === 'ios' ? 'interactive' : 'on-drag')}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={handleContentSizeChange}
          onScroll={handleScroll}
          scrollEventThrottle={16}>
          {children}
        </ScrollView>
      </DrawerScrollContext.Provider>
    );
  }
);

export const KeyboardAwareDrawerTextInput = forwardRef<TextInput, TextInputProps>(
  function KeyboardAwareDrawerTextInput({ onBlur, onFocus, ...props }, forwardedRef) {
    const inputRef = useRef<TextInput>(null);
    const drawerScroll = useContext(DrawerScrollContext);

    useImperativeHandle(forwardedRef, () => inputRef.current as TextInput);

    return (
      <TextInput
        {...props}
        ref={inputRef}
        onFocus={(event) => {
          drawerScroll?.focusInput(inputRef.current);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          drawerScroll?.blurInput(inputRef.current);
          onBlur?.(event);
        }}
      />
    );
  }
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(6,18,41,0.55)',
  },
  keyboardViewport: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
  },
  surface: {
    width: '100%',
    maxHeight: '90%',
    minHeight: 0,
    overflow: 'visible',
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: DRAWER_KEYBOARD_CONTENT_GAP,
  },
});
