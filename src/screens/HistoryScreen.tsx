import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ConfidenceBadge, Pill } from '@/components/Badges';
import { ChipGroup } from '@/components/Controls';
import { HeaderIconButton, Screen } from '@/components/Layout';
import { EmptyState } from '@/components/States';
import { T } from '@/components/Typography';
import { CATEGORY_INFO } from '@/constants/categories';
import { colors, radius, space } from '@/constants/theme';
import { useCollectionList } from '@/hooks/useStore';
import type { Scan } from '@/models/scan';
import { computeImpact } from '@/services/impact/impactService';
import { effectiveCategory } from '@/services/scan/enrichment';
import { getRepositories } from '@/storage/repositories';
import { formatRelative } from '@/utils/format';

type Filter = 'all' | 'issues' | 'reported' | 'resolved';
const FILTERS = [
  { value: 'all', label: 'All scans' },
  { value: 'issues', label: 'Issues' },
  { value: 'reported', label: 'Reported' },
  { value: 'resolved', label: 'Resolved' },
] as const;

const Stat = ({ value, label, hint }: { value: string; label: string; hint?: string }) => (
  <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}${hint ? `. ${hint}` : ''}`}>
    <T variant="monoLarge">{value}</T>
    <T variant="caption" tone="secondary">
      {label}
    </T>
  </View>
);

const statusLabel = (s: Scan): { text: string; fg: string; bg: string } => {
  switch (s.status) {
    case 'resolved':
      return { text: 'Resolved', fg: colors.positive, bg: colors.positiveMuted };
    case 'reported':
      return { text: 'Reported', fg: colors.accent, bg: colors.accentMuted };
    case 'reviewed':
      return { text: 'Reviewed', fg: colors.textSecondary, bg: colors.neutralMuted };
    default:
      return { text: 'Not reported', fg: colors.textTertiary, bg: colors.neutralMuted };
  }
};

export const HistoryScreen = () => {
  const repos = getRepositories();
  const { items: scans, loading } = useCollectionList(repos.scans);
  const { items: reports } = useCollectionList(repos.reports);
  const [filter, setFilter] = useState<Filter>('all');
  const impact = useMemo(() => computeImpact(scans, reports), [scans, reports]);

  const visible = scans.filter((s) => {
    if (filter === 'issues') return Boolean(effectiveCategory(s));
    if (filter === 'reported') return s.status === 'reported';
    if (filter === 'resolved') return s.status === 'resolved';
    return true;
  });

  const header = (
    <View style={styles.header}>
      <View style={styles.dashboard}>
        <T variant="eyebrow" tone="tertiary" accessibilityRole="header">
          Your civic impact
        </T>
        <View style={styles.stats}>
          <Stat value={String(impact.issuesIdentified)} label="Issues identified" />
          <Stat value={String(impact.reportsCreated)} label="Reports created" />
          <Stat value={String(impact.duplicatesAvoided)} label="Duplicates avoided" hint="Times you checked an existing report instead of filing a new one" />
          <Stat value={String(impact.resolved)} label="Marked resolved" />
        </View>
        <View style={styles.badges}>
          {impact.streakDays > 0 ? <Pill label={`Civic streak · ${impact.streakDays} day${impact.streakDays > 1 ? 's' : ''}`} fg={colors.text} bg={colors.surfaceRaised} icon="activity" /> : null}
          {impact.verifiedObservations >= 10 ? (
            <Pill label={`Neighborhood Scout · ${impact.verifiedObservations} verified`} fg={colors.text} bg={colors.surfaceRaised} icon="award" />
          ) : impact.verifiedObservations > 0 ? (
            <Pill label={`${impact.verifiedObservations} verified observation${impact.verifiedObservations > 1 ? 's' : ''}`} fg={colors.textSecondary} bg={colors.surfaceRaised} icon="verified" />
          ) : null}
          {impact.reportQuality !== undefined ? <Pill label={`Report quality ${impact.reportQuality}/100`} fg={colors.textSecondary} bg={colors.surfaceRaised} icon="clipboard" /> : null}
        </View>
        <T variant="caption" tone="tertiary">
          Counts come only from scans you reviewed on this device. Quality matters more than quantity: blurry or unreviewed scans don’t count.
        </T>
      </View>
      <ChipGroup options={FILTERS} value={filter} onChange={setFilter} accessibilityLabel="Filter history" />
    </View>
  );

  return (
    <Screen title="History" scroll={false} right={<HeaderIconButton icon="map" label="Open map" onPress={() => router.push('/map')} />}>
      <FlatList
        data={visible}
        keyExtractor={(s) => s.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="clock"
              title={scans.length ? 'Nothing here yet' : 'Your civic trail starts here.'}
              body={scans.length ? 'No scans match this filter.' : 'Scans you take are saved on this device. Point your camera at a problem to begin.'}
              action={scans.length ? undefined : { label: 'Start scanning', icon: 'camera', onPress: () => router.replace('/') }}
            />
          )
        }
        renderItem={({ item }) => {
          const cat = effectiveCategory(item);
          const det = item.detections[0];
          const st = statusLabel(item);
          const title = cat ? CATEGORY_INFO[cat].label : item.analysis.outcome === 'rejected_quality' ? 'Unclear photo' : 'No recognized issue';
          return (
            <Pressable
              onPress={() => router.push({ pathname: '/issue/[id]', params: { id: item.id } })}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${formatRelative(item.createdAt)}, ${st.text}${item.address?.line1 ? `, near ${item.address.line1}` : ''}`}
            >
              <Image source={{ uri: item.imageUri }} style={styles.thumb} contentFit="cover" />
              <View style={styles.flex}>
                <T variant="bodyMedium" numberOfLines={1}>
                  {title}
                </T>
                <T variant="caption" tone="secondary" numberOfLines={1}>
                  {formatRelative(item.createdAt)}
                  {item.address?.line1 ? ` · ${item.address.line1}` : item.address?.city ? ` · ${item.address.city}` : ''}
                </T>
                <View style={styles.rowBadges}>
                  {det && item.analysis.outcome !== 'none' ? <ConfidenceBadge level={det.confidenceLevel} /> : null}
                  <Pill label={st.text} fg={st.fg} bg={st.bg} />
                  {item.pendingLookups.length ? <Pill label="Waiting for network" fg={colors.textTertiary} bg={colors.neutralMuted} icon="offline" /> : null}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 4 },
  list: { paddingBottom: space.huge },
  header: { padding: space.lg, gap: space.lg },
  dashboard: { gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  stat: { width: '50%', gap: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, alignItems: 'center' },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surface },
  rowBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: 2 },
});
