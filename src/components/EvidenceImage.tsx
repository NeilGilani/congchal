import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { colors, radius } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { BoundingBox } from '@/models/detection';

import { T } from './Typography';

export interface EvidenceImageProps {
  uri: string;
  width: number;
  height: number;
  box?: BoundingBox;
  label?: string;
  boxColor?: string;
  maxHeight?: number;
  accessibilityLabel: string;
}

/**
 * The evidence photo, letterboxed to its true aspect ratio, with the model's
 * region of strongest evidence drawn on top. The box animates in ("locks on")
 * unless reduced motion is enabled.
 */
export const EvidenceImage = ({ uri, width, height, box, label, boxColor = colors.accent, maxHeight = 420, accessibilityLabel }: EvidenceImageProps) => {
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!box) return;
    progress.value = reduced ? 1 : 0;
    if (!reduced) progress.value = withDelay(150, withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) }));
  }, [box, reduced, progress]);

  const aspect = width > 0 && height > 0 ? width / height : 4 / 3;
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setFrame({ w, h: Math.min(maxHeight, w / aspect) });
  };
  // Displayed image rect inside the container (contain fit).
  const dispW = Math.min(frame.w, frame.h * aspect);
  const dispH = dispW / aspect;
  const offX = (frame.w - dispW) / 2;
  const offY = (frame.h - dispH) / 2;

  const boxStyle = useAnimatedStyle(() => {
    if (!box) return { opacity: 0 };
    const grow = 1 + (1 - progress.value) * 0.18;
    const w = box.width * dispW;
    const h = box.height * dispH;
    return {
      opacity: progress.value,
      left: offX + box.x * dispW - ((grow - 1) * w) / 2,
      top: offY + box.y * dispH - ((grow - 1) * h) / 2,
      width: w * grow,
      height: h * grow,
    };
  }, [box, dispW, dispH, offX, offY]);

  return (
    <View style={[styles.frame, { height: frame.h || undefined, aspectRatio: frame.h ? undefined : aspect }]} onLayout={onLayout}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        accessible
        accessibilityLabel={accessibilityLabel}
        transition={reduced ? 0 : 150}
      />
      {box && frame.w > 0 ? (
        <Animated.View pointerEvents="none" style={[styles.box, { borderColor: boxColor }, boxStyle]}>
          {label ? (
            <View style={[styles.boxLabel, { backgroundColor: boxColor }]}>
              <T variant="caption" tone="inverse" numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {label}
              </T>
            </View>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  frame: { width: '100%', backgroundColor: colors.black, borderRadius: radius.lg, overflow: 'hidden' },
  box: { position: 'absolute', borderWidth: 2, borderRadius: 6 },
  boxLabel: { position: 'absolute', top: -2, left: -2, paddingHorizontal: 6, paddingVertical: 2, borderTopLeftRadius: 6, borderBottomRightRadius: 6 },
});
