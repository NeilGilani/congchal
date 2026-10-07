/**
 * CivicLens design tokens. Dark, camera-first. Color is always paired with
 * text or an icon; it never carries meaning on its own.
 */
export const colors = {
  bg: '#0B0D10',
  surface: '#13161B',
  surfaceRaised: '#1A1E24',
  surfacePressed: '#20252C',
  border: '#272C34',
  hairline: 'rgba(255,255,255,0.08)',
  scrim: 'rgba(5,7,9,0.72)',
  scrimLight: 'rgba(5,7,9,0.45)',

  text: '#F2F4F7',
  textSecondary: '#A6AEBA',
  textTertiary: '#737C89',
  textInverse: '#0B0D10',

  accent: '#6EA8FE',
  accentPressed: '#5B93E6',
  accentMuted: 'rgba(110,168,254,0.16)',

  // Semantic (WCAG AA against `bg` for text use)
  positive: '#3FB950',
  positiveMuted: 'rgba(63,185,80,0.16)',
  caution: '#E3B341',
  cautionMuted: 'rgba(227,179,65,0.16)',
  concern: '#F0883E',
  concernMuted: 'rgba(240,136,62,0.16)',
  critical: '#F85149',
  criticalMuted: 'rgba(248,81,73,0.16)',
  neutral: '#8B949E',
  neutralMuted: 'rgba(139,148,158,0.16)',

  demo: '#C297FF',
  demoMuted: 'rgba(194,151,255,0.16)',

  white: '#FFFFFF',
  black: '#000000',
} as const;

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  mono: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

export const type = {
  display: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, letterSpacing: -0.6 },
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  headline: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.1 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  callout: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  eyebrow: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.1 },
  mono: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18 },
  monoLarge: { fontFamily: fonts.monoBold, fontSize: 28, lineHeight: 32, letterSpacing: -0.5 },
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const motion = {
  fast: 120,
  normal: 200,
  slow: 320,
} as const;

/** Minimum touch target (Apple HIG 44pt, Material 48dp). */
export const HIT_TARGET = 48;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;
