import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius, space } from '@/constants/theme';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { T } from './Typography';

export const EmptyState = ({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body: string;
  action?: { label: string; onPress: () => void; icon?: IconName };
}) => (
  <View style={styles.empty} accessible accessibilityLabel={`${title}. ${body}`}>
    <View style={styles.emptyIcon}>
      <Icon name={icon} size={28} color={colors.textSecondary} />
    </View>
    <T variant="title" align="center">
      {title}
    </T>
    <T variant="body" tone="secondary" align="center" style={styles.body}>
      {body}
    </T>
    {action ? <Button label={action.label} icon={action.icon} onPress={action.onPress} variant="secondary" /> : null}
  </View>
);

export const ErrorState = ({
  title,
  body,
  onRetry,
  retryLabel = 'Try again',
  secondary,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
  retryLabel?: string;
  secondary?: ReactNode;
}) => (
  <View style={styles.empty} accessibilityRole="alert">
    <View style={[styles.emptyIcon, { backgroundColor: colors.cautionMuted }]}>
      <Icon name="warning" size={28} color={colors.caution} />
    </View>
    <T variant="title" align="center">
      {title}
    </T>
    <T variant="body" tone="secondary" align="center" style={styles.body}>
      {body}
    </T>
    {onRetry ? <Button label={retryLabel} icon="retry" onPress={onRetry} /> : null}
    {secondary}
  </View>
);

type BannerTone = 'info' | 'caution' | 'critical' | 'demo' | 'positive';
const BANNER: Record<BannerTone, { fg: string; bg: string; icon: IconName }> = {
  info: { fg: colors.accent, bg: colors.accentMuted, icon: 'info' },
  caution: { fg: colors.caution, bg: colors.cautionMuted, icon: 'warning' },
  critical: { fg: colors.critical, bg: colors.criticalMuted, icon: 'alertOctagon' },
  demo: { fg: colors.demo, bg: colors.demoMuted, icon: 'flask' },
  positive: { fg: colors.positive, bg: colors.positiveMuted, icon: 'checkCircle' },
};

export const Banner = ({ tone, title, body, icon, children }: { tone: BannerTone; title: string; body?: string; icon?: IconName; children?: ReactNode }) => {
  const s = BANNER[tone];
  return (
    <View style={[styles.banner, { backgroundColor: s.bg }]} accessible={!children} accessibilityLabel={`${title}${body ? `. ${body}` : ''}`}>
      <Icon name={icon ?? s.icon} size={18} color={s.fg} />
      <View style={styles.flex}>
        <T variant="bodyMedium" style={{ color: s.fg }}>
          {title}
        </T>
        {body ? (
          <T variant="callout" tone="secondary">
            {body}
          </T>
        ) : null}
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: space.huge, paddingHorizontal: space.xl, gap: space.md },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  body: { maxWidth: 320, marginBottom: space.sm },
  banner: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md, alignItems: 'flex-start' },
  flex: { flex: 1, gap: 2 },
});
