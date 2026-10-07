import type { ReactNode } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import { colors, type as typeScale } from '@/constants/theme';

type Variant = keyof typeof typeScale;
type Tone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'positive' | 'caution' | 'concern' | 'critical' | 'inverse' | 'demo';

const TONE: Record<Tone, string> = {
  primary: colors.text,
  secondary: colors.textSecondary,
  tertiary: colors.textTertiary,
  accent: colors.accent,
  positive: colors.positive,
  caution: colors.caution,
  concern: colors.concern,
  critical: colors.critical,
  inverse: colors.textInverse,
  demo: colors.demo,
};

export interface TProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  align?: TextStyle['textAlign'];
  uppercase?: boolean;
  children?: ReactNode;
}

/**
 * All text in CivicLens. Respects the system font size (Dynamic Type /
 * font scale) with a cap so dense layouts don't break.
 */
export const T = ({ variant = 'body', tone = 'primary', align, uppercase, style, maxFontSizeMultiplier, ...rest }: TProps) => (
  <Text
    {...rest}
    maxFontSizeMultiplier={maxFontSizeMultiplier ?? (variant === 'display' || variant === 'monoLarge' ? 1.3 : 1.8)}
    style={[
      typeScale[variant],
      { color: TONE[tone] },
      align ? { textAlign: align } : null,
      uppercase || variant === 'eyebrow' ? { textTransform: 'uppercase' } : null,
      style,
    ]}
  />
);
