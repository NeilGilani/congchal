import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { CATEGORY_INFO } from '@/constants/categories';
import { colors, space } from '@/constants/theme';
import { useIsOffline } from '@/hooks/useNetwork';
import type { DuplicateCandidate } from '@/models/civic';
import type { IssueCategory } from '@/models/issue';
import type { Scan } from '@/models/scan';
import { duplicateHeadline } from '@/services/civic/duplicateDetection';
import { classifyAccuracy, locationQualityMessage } from '@/services/location/locationQuality';
import { departmentFor } from '@/services/report/reportService';
import { formatAccuracy, formatCoordinates, formatDistance } from '@/utils/geo';
import { formatRelative } from '@/utils/format';
import { safeHttpUrl } from '@/utils/sanitize';

import { StatusBadge } from './Badges';
import { Button } from './Button';
import { Card, Divider, Row, Section } from './Layout';
import { T } from './Typography';

const ACC_COLOR = { good: colors.positive, fair: colors.caution, poor: colors.critical, unknown: colors.textSecondary } as const;

export const LocationSummary = ({ scan, units }: { scan: Scan; units: 'imperial' | 'metric' }) => {
  const offline = useIsOffline();
  if (!scan.location) {
    return (
      <Card>
        <Row
          icon="locateOff"
          label="Location"
          value="No location attached"
          hint={
            scan.source === 'gallery'
              ? "This photo has no GPS data, so CivicLens won't guess where it was taken."
              : 'Location was off or unavailable. You can describe the place in the report.'
          }
        />
      </Card>
    );
  }
  const q = classifyAccuracy(scan.location.accuracy);
  const pendingPlace = scan.pendingLookups.includes('address') && !scan.address;
  return (
    <Card>
      <Row
        icon="pin"
        label="Location"
        value={
          scan.address?.formatted ??
          (pendingPlace ? (offline ? 'Address will be looked up when you are online' : 'Finding address…') : 'Address unavailable')
        }
        hint={scan.location.source === 'photo-exif' ? 'From the photo\'s GPS data' : scan.location.source === 'demo' ? 'Sample location (Demo Mode)' : undefined}
      />
      <Divider />
      <Row
        icon="crosshair"
        label="Coordinates"
        value={
          <View style={styles.inline}>
            <T variant="mono" selectable>
              {formatCoordinates(scan.location)}
            </T>
            <T variant="mono" style={{ color: ACC_COLOR[q] }}>
              {formatAccuracy(scan.location.accuracy, units)}
            </T>
          </View>
        }
        hint={locationQualityMessage(q)}
        accessibilityLabel={`Coordinates ${formatCoordinates(scan.location)}, accuracy ${formatAccuracy(scan.location.accuracy, units)}`}
      />
    </Card>
  );
};

export const JurisdictionSummary = ({ scan, category }: { scan: Scan; category?: IssueCategory }) => {
  const offline = useIsOffline();
  if (!scan.location) return null;
  const j = scan.jurisdiction;
  const dept = category ? departmentFor(scan, category) : undefined;
  const pending = !j && scan.pendingLookups.includes('jurisdiction');
  return (
    <Card>
      <Row
        icon="landmark"
        label="Jurisdiction"
        value={j?.displayName ?? (pending ? (offline ? 'Will be looked up when you are online' : 'Looking up…') : 'Unknown')}
        hint={
          j
            ? j.confidence === 'authoritative'
              ? 'From official US Census boundary data'
              : 'Approximate (based on the address, not official boundaries)'
            : undefined
        }
      />
      {dept ? (
        <>
          <Divider />
          <Row
            icon="building"
            label={dept.certainty === 'confirmed' ? 'Department' : 'Likely department'}
            value={`${dept.name}${dept.organization && !dept.name.includes(dept.organization) ? ` · ${dept.organization}` : ''}`}
            hint={dept.basis}
          />
          {dept.reportingUrl ? (
            <View style={styles.pad}>
              <Button
                label={dept.reportingLabel ?? 'Open official reporting page'}
                icon="external"
                variant="secondary"
                onPress={() => {
                  const url = safeHttpUrl(dept.reportingUrl);
                  if (url) void WebBrowser.openBrowserAsync(url);
                }}
              />
            </View>
          ) : null}
        </>
      ) : null}
      {scan.roadContext?.nearestRoadName || scan.roadContext?.routeRef ? (
        <>
          <Divider />
          <Row
            icon="route"
            label="Nearest road (OpenStreetMap)"
            value={[scan.roadContext.nearestRoadName, scan.roadContext.routeRef].filter(Boolean).join(' · ')}
          />
        </>
      ) : null}
    </Card>
  );
};

const candidateTitle = (c: DuplicateCandidate): string => c.report.title;

export const DuplicateSummary = ({
  scan,
  category,
  units,
  onDecision,
}: {
  scan: Scan;
  category?: IssueCategory;
  units: 'imperial' | 'metric';
  onDecision: (d: 'report_anyway' | 'still_present' | 'viewed_existing', c?: DuplicateCandidate) => void;
}) => {
  const offline = useIsOffline();
  if (!scan.location || !category) return null;
  const check = scan.duplicateCheck;
  if (!check) {
    return (
      <Card>
        <View style={[styles.pad, styles.inline]}>
          {offline ? null : <ActivityIndicator color={colors.textSecondary} />}
          <T variant="callout" tone="secondary">
            {offline ? 'Nearby reports will be checked when you are back online.' : 'Checking for existing reports nearby…'}
          </T>
        </View>
      </Card>
    );
  }
  const top = check.candidates[0];
  const failed = check.sourcesFailed.length > 0;
  return (
    <Card tone={top ? 'caution' : 'default'}>
      <View style={styles.pad}>
        {top ? (
          <>
            <T variant="headline" accessibilityRole="header">
              {duplicateHeadline(top, (m) => formatDistance(m, units))}
            </T>
            <View style={styles.candidate}>
              <View style={styles.flex}>
                <T variant="bodyMedium">{candidateTitle(top)}</T>
                <T variant="caption" tone="secondary">
                  {top.report.providerName}
                  {top.report.createdAt ? ` · reported ${formatRelative(top.report.createdAt)}` : ''}
                </T>
              </View>
              <StatusBadge status={top.report.status} />
            </View>
            {check.candidates.length > 1 ? (
              <T variant="caption" tone="tertiary">
                {check.candidates.length - 1} more possible match{check.candidates.length > 2 ? 'es' : ''} nearby.
              </T>
            ) : null}
            <View style={styles.actions}>
              <Button label="View existing report" icon="eye" variant="secondary" onPress={() => onDecision('viewed_existing', top)} />
              <Button label="Mark as still present" icon="flag" variant="secondary" onPress={() => onDecision('still_present', top)} />
              <Button label="Report anyway" icon="file" variant="ghost" onPress={() => onDecision('report_anyway', top)} />
            </View>
            {check.decision ? (
              <T variant="caption" tone="positive">
                {check.decision === 'still_present'
                  ? 'Saved: you confirmed it is still there. To notify the city, open the existing report and add a comment there.'
                  : check.decision === 'report_anyway'
                    ? 'You chose to create a new report.'
                    : 'You viewed the existing report.'}
              </T>
            ) : null}
          </>
        ) : (
          <>
            <T variant="headline">No nearby report found</T>
            <T variant="callout" tone="secondary">
              {check.sourcesChecked.length
                ? `Checked ${check.sourcesChecked.join(', ')} within ${formatDistance(check.radiusMeters, units)}.`
                : 'No public report data is available for this area.'}
            </T>
          </>
        )}
        {failed ? (
          <T variant="caption" tone="caution">
            Couldn’t check: {check.sourcesFailed.map((f) => `${f.source} (${f.reason})`).join('; ')}
          </T>
        ) : null}
      </View>
    </Card>
  );
};

export const CategoryHeading = ({ category }: { category: IssueCategory }) => (
  <Section>
    <T variant="eyebrow" tone="tertiary">
      {CATEGORY_INFO[category].group === 'other' ? 'Civic issue' : CATEGORY_INFO[category].group}
    </T>
    <T variant="display">{CATEGORY_INFO[category].label}</T>
  </Section>
);

export const openPublicReport = (c: DuplicateCandidate): void => {
  if (c.report.provider === 'local') {
    router.push({ pathname: '/issue/[id]', params: { id: (c.report as { scanId: string }).scanId } });
    return;
  }
  const url = 'url' in c.report ? safeHttpUrl(c.report.url) : undefined;
  if (url) void WebBrowser.openBrowserAsync(url);
  else router.push({ pathname: '/public/[id]', params: { id: c.report.id } });
};

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  pad: { padding: space.lg, gap: space.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  candidate: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  actions: { gap: space.sm, marginTop: space.xs },
});
