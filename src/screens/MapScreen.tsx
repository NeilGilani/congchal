import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { StatusBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { ChipGroup, Segmented } from '@/components/Controls';
import { Icon } from '@/components/Icon';
import { IssueMap } from '@/components/map/IssueMap';
import { Screen } from '@/components/Layout';
import { Banner, EmptyState } from '@/components/States';
import { T } from '@/components/Typography';
import { CATEGORY_INFO, GROUP_LABELS } from '@/constants/categories';
import { colors, radius, space } from '@/constants/theme';
import { useLocation } from '@/hooks/useLocation';
import { useIsOffline } from '@/hooks/useNetwork';
import { useCollectionList, useSettings } from '@/hooks/useStore';
import type { CategoryGroup } from '@/models/issue';
import { getNearbyPublicReports } from '@/services/civic/civicDataService';
import { filterAndSort, isUnresolved, publicToMapIssue, scanToMapIssue, type MapIssue, type SortKey } from '@/services/civic/mapIssues';
import { rememberPublicReports } from '@/services/civic/publicReportRegistry';
import { getRepositories } from '@/storage/repositories';
import { formatDistance } from '@/utils/geo';
import { formatRelative, SEVERITY_LABEL } from '@/utils/format';

const NEARBY_RADIUS_M = 800;
const GROUPS: { value: CategoryGroup | 'all'; label: string }[] = (['all', 'roads', 'sidewalks', 'accessibility', 'waste', 'signs', 'other'] as const).map(
  (g) => ({ value: g, label: GROUP_LABELS[g] }),
);
const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'severity', label: 'Severity' },
  { value: 'distance', label: 'Distance' },
] as const;

const statusText = (i: MapIssue): string => {
  if (i.kind === 'public') return i.status === 'closed' ? 'Closed' : i.status === 'acknowledged' ? 'Acknowledged' : i.status === 'open' ? 'Open' : 'Status unknown';
  return i.status === 'resolved' ? 'Resolved' : i.status === 'reported' ? 'Reported by you' : 'Not reported yet';
};

const openIssue = (i: MapIssue) => {
  if (i.kind === 'local' && i.scanId) router.push({ pathname: '/issue/[id]', params: { id: i.scanId } });
  else router.push({ pathname: '/public/[id]', params: { id: i.id } });
};

export const MapScreen = () => {
  const { settings } = useSettings();
  const offline = useIsOffline();
  const location = useLocation(true, true);
  const { items: scans } = useCollectionList(getRepositories().scans);
  const [publicResult, setPublicResult] = useState<{ key: string; issues: MapIssue[]; checked: string[]; failed: string[] } | undefined>();
  const [group, setGroup] = useState<CategoryGroup | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [selected, setSelected] = useState<MapIssue | undefined>();

  const here = location.fix;
  const lookupsAllowed = settings.civicLookupsEnabled && !settings.localOnlyMode;

  // Public data loads once per ~100 m cell (not on every GPS jitter) while lookups are allowed and online.
  const hereKey = here ? `${here.latitude.toFixed(3)},${here.longitude.toFixed(3)}` : '';
  const requestKey = here && lookupsAllowed && !offline ? hereKey : undefined;
  const hereRef = useRef(here);
  useEffect(() => {
    hereRef.current = here;
  }, [here]);

  useEffect(() => {
    const point = hereRef.current;
    if (!requestKey || !point) return;
    let alive = true;
    void (async () => {
      const withJ = (await getRepositories().scans.list()).find((s) => s.jurisdiction && s.location);
      const res = await getNearbyPublicReports(point, withJ?.jurisdiction, NEARBY_RADIUS_M);
      rememberPublicReports(res.reports);
      if (!alive) return;
      setPublicResult({
        key: requestKey,
        issues: res.reports.map((r) => publicToMapIssue(r, point)),
        checked: res.sourcesChecked,
        failed: res.sourcesFailed.map((f) => `${f.source} (${f.reason})`),
      });
    })();
    return () => {
      alive = false;
    };
  }, [requestKey]);

  const publicIssues = useMemo(() => publicResult?.issues ?? [], [publicResult]);
  const publicState = {
    loading: Boolean(requestKey) && publicResult?.key !== requestKey,
    checked: publicResult?.checked ?? [],
    failed: publicResult?.failed ?? [],
  };

  const localIssues = useMemo(() => scans.flatMap((s) => scanToMapIssue(s, here) ?? []), [scans, here]);
  const all = useMemo(() => [...localIssues, ...publicIssues], [localIssues, publicIssues]);
  const visible = useMemo(() => filterAndSort(all, group, sort), [all, group, sort]);
  const unresolved = visible.filter(isUnresolved).length;
  const center = here ?? (localIssues[0] ? { latitude: localIssues[0].latitude, longitude: localIssues[0].longitude } : undefined);

  const header = (
    <View style={styles.listHeader}>
      <ChipGroup options={GROUPS} value={group} onChange={setGroup} accessibilityLabel="Filter by category" />
      <View style={styles.summary}>
        <T variant="bodyMedium" accessibilityLiveRegion="polite">
          {visible.length} issue{visible.length === 1 ? '' : 's'}
          {here ? ' nearby' : ''} · {unresolved} still unresolved
        </T>
        {publicState.loading ? <ActivityIndicator color={colors.textSecondary} /> : null}
      </View>
      <Segmented options={SORTS} value={sort} onChange={setSort} accessibilityLabel="Sort issues" />
      {offline ? <Banner tone="caution" icon="offline" title="Offline" body="Showing your saved scans. Public reports will load when you're back online." /> : null}
      {!lookupsAllowed ? (
        <Banner tone="info" icon="lock" title="Public reports are off" body="Local-only mode or civic lookups are disabled in Settings, so only your own scans are shown." />
      ) : null}
      {location.permission !== 'granted' ? (
        <Banner tone="info" icon="locateOff" title="Turn on location to see issues around you">
          <Button label="Allow location" variant="secondary" icon="locate" onPress={() => void location.request()} />
        </Banner>
      ) : null}
      {publicState.failed.length ? <T variant="caption" tone="caution">Couldn’t load: {publicState.failed.join('; ')}</T> : null}
      {publicState.checked.length ? (
        <T variant="caption" tone="tertiary">
          Public data: {publicState.checked.join(', ')} (within {formatDistance(NEARBY_RADIUS_M, settings.units)})
        </T>
      ) : null}
    </View>
  );

  return (
    <Screen title="Nearby issues" scroll={false}>
      <View style={styles.mapWrap}>
        <IssueMap issues={visible} center={center} showUser={location.permission === 'granted'} onSelect={setSelected} />
        {selected ? (
          <Pressable
            style={styles.card}
            onPress={() => openIssue(selected)}
            accessibilityRole="button"
            accessibilityLabel={`${selected.title}. ${statusText(selected)}. Open details.`}
          >
            <View style={styles.cardIcon}>
              <Icon name={selected.category ? CATEGORY_INFO[selected.category].icon : 'other'} size={20} />
            </View>
            <View style={styles.flex}>
              <T variant="bodyMedium" numberOfLines={1}>
                {selected.title}
              </T>
              <T variant="caption" tone="secondary" numberOfLines={1}>
                {[
                  selected.severity ? `${SEVERITY_LABEL[selected.severity]} estimated severity` : undefined,
                  selected.distanceMeters !== undefined ? `${formatDistance(selected.distanceMeters, settings.units)} away` : undefined,
                  statusText(selected),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </T>
            </View>
            <Icon name="chevron" size={18} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>
      <FlatList
        data={visible}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        initialNumToRender={12}
        windowSize={7}
        ListEmptyComponent={
          <EmptyState
            icon="map"
            title="No issues nearby yet."
            body={here ? 'Nothing reported within this area. Scan something to add it to your map.' : 'Your scans with a location will appear here.'}
            action={{ label: 'Start scanning', icon: 'camera', onPress: () => router.replace('/') }}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openIssue(item)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${item.source}, ${statusText(item)}${item.distanceMeters !== undefined ? `, ${formatDistance(item.distanceMeters, settings.units)} away` : ''}`}
          >
            <View style={[styles.cardIcon, item.kind === 'local' && styles.localIcon]}>
              <Icon name={item.category ? CATEGORY_INFO[item.category].icon : 'other'} size={18} />
            </View>
            <View style={styles.flex}>
              <T variant="bodyMedium" numberOfLines={1}>
                {item.title}
              </T>
              <T variant="caption" tone="secondary" numberOfLines={1}>
                {item.source}
                {item.createdAt ? ` · ${formatRelative(item.createdAt)}` : ''}
                {item.distanceMeters !== undefined ? ` · ${formatDistance(item.distanceMeters, settings.units)}` : ''}
              </T>
            </View>
            {item.kind === 'public' && (item.status === 'open' || item.status === 'acknowledged' || item.status === 'closed' || item.status === 'unknown') ? (
              <StatusBadge status={item.status} />
            ) : (
              <T variant="caption" tone="tertiary">
                {statusText(item)}
              </T>
            )}
          </Pressable>
        )}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  mapWrap: { height: '46%', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  list: { paddingBottom: space.huge },
  listHeader: { padding: space.lg, gap: space.md },
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  card: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  localIcon: { borderWidth: 1.5, borderColor: colors.accent },
});
