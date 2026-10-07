import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, HIT_TARGET, radius, space } from '@/constants/theme';

import { Icon, type IconName } from './Icon';
import { T } from './Typography';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'demo';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
  /** Extra context for screen readers when the label alone is ambiguous. */
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const BG: Record<Variant, string> = {
  primary: colors.accent,
  secondary: colors.surfaceRaised,
  ghost: 'transparent',
  danger: colors.criticalMuted,
  demo: colors.demoMuted,
};
const FG: Record<Variant, string> = {
  primary: colors.textInverse,
  secondary: colors.text,
  ghost: colors.accent,
  danger: colors.critical,
  demo: colors.demo,
};

export const tapFeedback = (): void => {
  if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => undefined);
};

export const Button = ({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  size = 'md',
  accessibilityHint,
  style,
  testID,
}: ButtonProps) => {
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }}
      disabled={inactive}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' && styles.lg,
        { backgroundColor: BG[variant] },
        variant === 'secondary' && styles.bordered,
        pressed && !inactive && styles.pressed,
        inactive && styles.disabled,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={FG[variant]} size="small" />
        ) : icon ? (
          <Icon name={icon} size={18} color={FG[variant]} />
        ) : null}
        <T variant={size === 'lg' ? 'headline' : 'bodyMedium'} style={{ color: FG[variant] }} numberOfLines={1}>
          {label}
        </T>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    minHeight: HIT_TARGET,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lg: { minHeight: 54, paddingHorizontal: space.xl },
  bordered: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.45 },
});
