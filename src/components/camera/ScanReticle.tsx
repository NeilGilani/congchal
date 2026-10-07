import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type Mode = 'idle' | 'searching' | 'candidate' | 'locked' | 'analyzing';

const CORNER = 28;
const STROKE = 3;

const Corner = ({ pos, color }: { pos: 'tl' | 'tr' | 'bl' | 'br'; color: string }) => (
  <View
    style={[
      styles.corner,
      { borderColor: color },
      pos === 'tl' && { top: 0, left: 0, borderTopWidth: STROKE, borderLeftWidth: STROKE, borderTopLeftRadius: 10 },
      pos === 'tr' && { top: 0, right: 0, borderTopWidth: STROKE, borderRightWidth: STROKE, borderTopRightRadius: 10 },
      pos === 'bl' && { bottom: 0, left: 0, borderBottomWidth: STROKE, borderLeftWidth: STROKE, borderBottomLeftRadius: 10 },
      pos === 'br' && { bottom: 0, right: 0, borderBottomWidth: STROKE, borderRightWidth: STROKE, borderBottomRightRadius: 10 },
    ]}
  />
);

/**
 * Targeting guide. Breathes gently while searching, tightens when a candidate
 * appears, turns solid when a detection is confirmed across frames, and shows
 * a scan line while a full analysis runs (UI-thread animation, so it keeps
 * moving while the JS thread works).
 */
export const ScanReticle = ({ mode, size }: { mode: Mode; size: { width: number; height: number } }) => {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const line = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(scale);
    if (reduced) {
      scale.value = mode === 'locked' ? 0.94 : 1;
      return;
    }
    if (mode === 'searching' || mode === 'idle') {
      scale.value = withRepeat(withSequence(withTiming(1.025, { duration: 1400 }), withTiming(1, { duration: 1400 })), -1);
    } else if (mode === 'candidate') {
      scale.value = withTiming(0.97, { duration: 220, easing: Easing.out(Easing.quad) });
    } else if (mode === 'locked') {
      scale.value = withSequence(withTiming(0.9, { duration: 140 }), withTiming(0.94, { duration: 160 }));
    } else {
      scale.value = withTiming(1, { duration: 150 });
    }
  }, [mode, reduced, scale]);

  useEffect(() => {
    cancelAnimation(line);
    line.value = 0;
    if (mode === 'analyzing' && !reduced) {
      line.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }), -1, true);
    }
  }, [mode, reduced, line]);

  const frameStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const lineStyle = useAnimatedStyle(() => ({ transform: [{ translateY: line.value * (size.height - 4) }] }));

  const color = mode === 'locked' ? colors.accent : mode === 'candidate' ? colors.caution : colors.white;
  return (
    <Animated.View pointerEvents="none" style={[{ width: size.width, height: size.height }, frameStyle]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Corner pos="tl" color={color} />
      <Corner pos="tr" color={color} />
      <Corner pos="bl" color={color} />
      <Corner pos="br" color={color} />
      {mode === 'analyzing' ? <Animated.View style={[styles.line, lineStyle]} /> : null}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  corner: { position: 'absolute', width: CORNER, height: CORNER },
  line: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 2,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
});
