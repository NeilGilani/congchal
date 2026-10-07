import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors, radius, space } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { ConfidenceLevel } from '@/models/issue';
import { CONFIDENCE_LABEL, formatPercent } from '@/utils/format';

import { T } from './Typography';

const LEVEL_COLOR: Record<ConfidenceLevel, string> = {
  high: colors.accent,
  moderate: colors.caution,
  low: colors.neutral,
};

const LEVEL_NOTE: Record<ConfidenceLevel, string> = {
  high: 'Strong visual evidence.',
  moderate: 'Review the image before reporting.',
  low: "I'm not confident enough yet.",
};

/**
 * Confidence presented as a level first; the number is secondary and labelled
 * as model confidence. The bar fills once on appear.
 */
export const ConfidenceMeter = ({ level, value }: { level: ConfidenceLevel; value: number }) => {
  const reduced = useReducedMotion();
  const fill = useSharedValue(reduced ? value : 0);
  useEffect(() => {
    fill.value = reduced ? value : withTiming(value, { duration: 600, easing: Easing.out(Easing.quad) });
  }, [value, reduced, fill]);
  const barStyle = useAnimatedStyle(() => ({ width: `${Math.round(fill.value * 100)}%` }));
  const color = LEVEL_COLOR[level];
  return (
    <View
      style={styles.root}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${CONFIDENCE_LABEL[level]}. Model confidence ${formatPercent(value)}. ${LEVEL_NOTE[level]}`}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
    >
      <View style={styles.row}>
        <T variant="eyebrow" style={{ color }}>
          {CONFIDENCE_LABEL[level]}
        </T>
        <T variant="mono" tone="secondary">
          {formatPercent(value)}
        </T>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.bar, { backgroundColor: color }, barStyle]} />
      </View>
      <T variant="caption" tone="tertiary">
        {LEVEL_NOTE[level]} The number is the model’s calibrated probability, not a guarantee.
      </T>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { gap: space.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: radius.pill },
});
