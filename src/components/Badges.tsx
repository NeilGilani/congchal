import { StyleSheet, View } from 'react-native';

import { colors, radius, space } from '@/constants/theme';
import type { PublicReportStatus } from '@/models/civic';
import type { ConfidenceLevel, SeverityLevel } from '@/models/issue';
import { CONFIDENCE_LABEL, formatPercent, SEVERITY_LABEL } from '@/utils/format';

import { Icon, type IconName } from './Icon';
import { T } from './Typography';

interface PillProps {
  label: string;
  fg: string;
  bg: string;
  icon?: IconName;
  accessibilityLabel?: string;
}

/** Color is always paired with an icon and text. */
export const Pill = ({ label, fg, bg, icon, accessibilityLabel }: PillProps) => (
  <View
    style={[styles.pill, { backgroundColor: bg }]}
    accessible
    accessibilityRole="text"
    accessibilityLabel={accessibilityLabel ?? label}
  >
    {icon ? <Icon name={icon} size={13} color={fg} strokeWidth={2.2} /> : null}
    <T variant="caption" style={{ color: fg }} numberOfLines={1}>
      {label}
    </T>
  </View>
);

const CONF_STYLE: Record<ConfidenceLevel, { fg: string; bg: string; icon: IconName }> = {
  high: { fg: colors.accent, bg: colors.accentMuted, icon: 'target' },
  moderate: { fg: colors.caution, bg: colors.cautionMuted, icon: 'eye' },
  low: { fg: colors.neutral, bg: colors.neutralMuted, icon: 'help' },
};

export const ConfidenceBadge = ({ level, value }: { level: ConfidenceLevel; value?: number }) => {
  const s = CONF_STYLE[level];
  const text = value === undefined ? CONFIDENCE_LABEL[level] : `${CONFIDENCE_LABEL[level]} · ${formatPercent(value)}`;
  return (
    <Pill
      label={text}
      fg={s.fg}
      bg={s.bg}
      icon={s.icon}
      accessibilityLabel={`${CONFIDENCE_LABEL[level]}${value === undefined ? '' : `, model confidence ${formatPercent(value)}`}`}
    />
  );
};

const SEV_STYLE: Record<SeverityLevel, { fg: string; bg: string; icon: IconName }> = {
  low: { fg: colors.neutral, bg: colors.neutralMuted, icon: 'dot' },
  moderate: { fg: colors.caution, bg: colors.cautionMuted, icon: 'warning' },
  high: { fg: colors.critical, bg: colors.criticalMuted, icon: 'alertOctagon' },
};

export const SeverityBadge = ({ level, estimated = true }: { level: SeverityLevel; estimated?: boolean }) => {
  const s = SEV_STYLE[level];
  const label = `${estimated ? 'Est. severity' : 'Severity'}: ${SEVERITY_LABEL[level]}`;
  return <Pill label={label} fg={s.fg} bg={s.bg} icon={s.icon} accessibilityLabel={`${estimated ? 'Estimated severity' : 'Severity'} ${SEVERITY_LABEL[level]}`} />;
};

const STATUS_STYLE: Record<PublicReportStatus, { fg: string; bg: string; icon: IconName; label: string }> = {
  open: { fg: colors.concern, bg: colors.concernMuted, icon: 'dot', label: 'Open' },
  acknowledged: { fg: colors.caution, bg: colors.cautionMuted, icon: 'clock', label: 'Acknowledged' },
  closed: { fg: colors.positive, bg: colors.positiveMuted, icon: 'checkCircle', label: 'Closed' },
  unknown: { fg: colors.neutral, bg: colors.neutralMuted, icon: 'help', label: 'Status unknown' },
};

export const StatusBadge = ({ status }: { status: PublicReportStatus }) => {
  const s = STATUS_STYLE[status];
  return <Pill label={s.label} fg={s.fg} bg={s.bg} icon={s.icon} accessibilityLabel={`Report status: ${s.label}`} />;
};

export const DemoBadge = () => (
  <Pill label="DEMO MODE" fg={colors.demo} bg={colors.demoMuted} icon="flask" accessibilityLabel="Demo mode. Sample data, not a live detection." />
);

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
});
