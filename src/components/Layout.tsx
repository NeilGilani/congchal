import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, HIT_TARGET, hitSlop, radius, space } from '@/constants/theme';

import { Icon, type IconName } from './Icon';
import { T } from './Typography';

export interface ScreenProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
  right?: ReactNode;
  footer?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  contentStyle?: StyleProp<ViewStyle>;
  hideBack?: boolean;
}

/** Standard stack screen: safe areas, back button, title, optional sticky footer. */
export const Screen = ({ title, subtitle, children, scroll = true, right, footer, onBack, backLabel, contentStyle, hideBack }: ScreenProps) => {
  const insets = useSafeAreaInsets();
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: footer ? space.xl : insets.bottom + space.xxl }, contentStyle]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, contentStyle]}>{children}</View>
  );
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {hideBack ? (
          <View style={styles.headerButton} />
        ) : (
          <Pressable
            onPress={back}
            accessibilityRole="button"
            accessibilityLabel={backLabel ?? 'Back'}
            hitSlop={hitSlop}
            style={styles.headerButton}
          >
            <Icon name="back" size={26} />
          </Pressable>
        )}
        <View style={styles.headerTitle}>
          <T variant="headline" numberOfLines={1} accessibilityRole="header">
            {title}
          </T>
          {subtitle ? (
            <T variant="caption" tone="secondary" numberOfLines={1}>
              {subtitle}
            </T>
          ) : null}
        </View>
        <View style={[styles.headerButton, styles.right]}>{right}</View>
      </View>
      {body}
      {footer ? <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>{footer}</View> : null}
    </View>
  );
};

export const HeaderIconButton = ({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) => (
  <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={hitSlop} style={styles.headerButton}>
    <Icon name={icon} size={22} />
  </Pressable>
);

export const Section = ({ title, children, right, style }: { title?: string; children: ReactNode; right?: ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={[styles.section, style]}>
    {title ? (
      <View style={styles.sectionHeader}>
        <T variant="eyebrow" tone="tertiary" accessibilityRole="header">
          {title}
        </T>
        {right}
      </View>
    ) : null}
    {children}
  </View>
);

export const Card = ({ children, style, tone = 'default' }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'default' | 'demo' | 'caution' }) => (
  <View
    style={[
      styles.card,
      tone === 'demo' && { borderColor: colors.demo },
      tone === 'caution' && { borderColor: colors.caution },
      style,
    ]}
  >
    {children}
  </View>
);

export const Row = ({
  label,
  value,
  icon,
  mono,
  onPress,
  hint,
  accessibilityLabel,
}: {
  label: string;
  value?: ReactNode;
  icon?: IconName;
  mono?: boolean;
  onPress?: () => void;
  hint?: string;
  accessibilityLabel?: string;
}) => {
  const content = (
    <View style={styles.row}>
      {icon ? <Icon name={icon} size={18} color={colors.textSecondary} /> : null}
      <View style={styles.flex}>
        <T variant="callout" tone="secondary">
          {label}
        </T>
        {typeof value === 'string' ? (
          <T variant={mono ? 'mono' : 'bodyMedium'} selectable>
            {value}
          </T>
        ) : (
          value
        )}
        {hint ? (
          <T variant="caption" tone="tertiary">
            {hint}
          </T>
        ) : null}
      </View>
      {onPress ? <Icon name="chevron" size={18} color={colors.textTertiary} /> : null}
    </View>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel ?? (typeof value === 'string' ? `${label}: ${value}` : label)}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (typeof value === 'string' ? `${label}: ${value}` : label)}
      style={({ pressed }) => pressed && { backgroundColor: colors.surfacePressed }}
    >
      {content}
    </Pressable>
  );
};

export const Divider = () => <View style={styles.divider} />;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xs,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  headerButton: { width: HIT_TARGET, height: HIT_TARGET, alignItems: 'center', justifyContent: 'center' },
  right: { flexDirection: 'row', width: undefined, minWidth: HIT_TARGET },
  headerTitle: { flex: 1, alignItems: 'center' },
  content: { padding: space.lg, gap: space.xl },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.bg,
    gap: space.sm,
  },
  section: { gap: space.sm },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: HIT_TARGET },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, marginLeft: space.lg },
});
