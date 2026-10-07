import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '@/constants/theme';

/** CivicLens mark: a lens ring with a street grid seen through it. */
export const LogoMark = ({ size = 28, color = colors.text, accent = colors.accent }: { size?: number; color?: string; accent?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no">
    <Circle cx={32} cy={32} r={27} stroke={color} strokeWidth={5} fill="none" />
    <Path d="M20 26 H44 M20 38 H44 M26 20 V44 M38 20 V44" stroke={color} strokeOpacity={0.5} strokeWidth={3} strokeLinecap="round" />
    <Rect x={33} y={27} width={10} height={10} rx={2.5} fill={accent} />
  </Svg>
);
