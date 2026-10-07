import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { DemoBadge, SeverityBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { DuplicateSummary, JurisdictionSummary, LocationSummary, openPublicReport } from '@/components/CivicInfo';
import { ConfidenceMeter } from '@/components/ConfidenceMeter';
import { EvidenceImage } from '@/components/EvidenceImage';
import { Icon } from '@/components/Icon';
import { Card, Divider, Row, Screen, Section } from '@/components/Layout';
import { Banner, ErrorState } from '@/components/States';
import { T } from '@/components/Typography';
import { CATEGORY_INFO, categoryLabel } from '@/constants/categories';
import { colors, space } from '@/constants/theme';
import { useReportForScan, useScan, useSettings } from '@/hooks/useStore';
import type { Evidence } from '@/models/detection';
import { applyDuplicateDecision, confirmAndDraftReport, deleteScan, markResolved } from '@/services/scan/scanActions';
import { formatDateLong, formatMs, formatPercent, formatTime } from '@/utils/format';

const EVIDENCE_ICON: Record<Evidence['kind'], 'eye' | 'pin' | 'activity' | 'checkCircle'> = {
  visual: 'eye',
  context: 'pin',
  temporal: 'activity',
  quality: 'checkCircle',
};

export const IssueDetailScreen = ({ id }: { id: string }) => {
  const { scan, loading } = useScan(id);
  const { settings } = useSettings();
  const report = useReportForScan(scan?.id, scan?.isDemo ?? false);
  const [showScores, setShowScores] = useState(false);

  if (loading) {
    return (
      <Screen title="Issue detail" scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.text} />
        </View>
      </Screen>
    );
  }
  if (!scan) {
    return (
      <Screen title="Issue detail">
        <ErrorState title="Issue not found" body="It may have been deleted from your history." onRetry={() => router.replace('/history')} retryLabel="Go to history" />
      </Screen>
    );
  }

  const det = scan.detections[0];
  const category = scan.confirmedCategory ?? det?.category;
  const supporting = det?.evidence.filter((e) => e.supports) ?? [];
  const against = det?.evidence.filter((e) => !e.supports) ?? [];

  const confirmDelete = () =>
    Alert.alert('Delete this scan?', 'The photo and any report draft are removed from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteScan(scan).then(() => router.back());
        },
      },
    ]);

  return (
    <Screen title="Issue detail" subtitle={formatDateLong(scan.createdAt)}>
      {scan.isDemo ? <DemoBadge /> : null}
      <EvidenceImage
        uri={scan.imageUri}
        width={scan.imageWidth}
        height={scan.imageHeight}
        box={det?.boundingBox}
        label={det ? CATEGORY_INFO[det.category].label : undefined}
        accessibilityLabel="Evidence photo"
      />

      <Section>
        <T variant="eyebrow" tone="tertiary">
          {scan.confirmedCategory ? 'Confirmed by you' : det ? 'Model suggestion' : 'No detection'}
        </T>
        <T variant="display">{category ? CATEGORY_INFO[category].label : 'No recognized issue'}</T>
        {scan.status === 'resolved' ? <Banner tone="positive" title="Marked resolved" body="You marked this issue as fixed." /> : null}
      </Section>

      {det ? (
        <>
          <ConfidenceMeter level={det.confidenceLevel} value={det.confidence} />
          {det.severity ? (
            <Section title="Estimated severity">
              <SeverityBadge level={det.severity.level} />
              <T variant="callout" tone="secondary">
                {det.severity.rationale}
              </T>
              <Card>
                {det.severity.factors.map((f, i) => (
                  <View key={f.id}>
                    {i > 0 ? <Divider /> : null}
                    <View style={styles.factor} accessible accessibilityLabel={`${f.label}: ${Math.round(f.value * 100)} out of 100. ${f.note}`}>
                      <View style={styles.factorHead}>
                        <T variant="bodyMedium">{f.label}</T>
                        <T variant="mono" tone="secondary">
                          {Math.round(f.value * 100)}
                        </T>
                      </View>
                      <View style={styles.track}>
                        <View style={[styles.bar, { width: `${Math.round(f.value * 100)}%` }]} />
                      </View>
                      <T variant="caption" tone="tertiary">
                        {f.note}
                      </T>
                    </View>
                  </View>
                ))}
              </Card>
              <T variant="caption" tone="tertiary">
                Severity is an automated estimate (score {det.severity.score}/100). Review before submitting.
              </T>
            </Section>
          ) : null}

          <Section title="Why CivicLens thinks this">
            <Card>
              <View style={styles.pad}>
                <T variant="body">{det.explanation}</T>
                {supporting.map((e) => (
                  <View key={e.id} style={styles.evidence}>
                    <Icon name={EVIDENCE_ICON[e.kind]} size={16} color={colors.accent} />
                    <T variant="callout" style={styles.flex}>
                      {e.label}
                    </T>
                    {e.strengthLabel ? (
                      <T variant="caption" tone="tertiary">
                        {e.strengthLabel}
                      </T>
                    ) : null}
                  </View>
                ))}
                {against.map((e) => (
                  <View key={e.id} style={styles.evidence}>
                    <Icon name="warning" size={16} color={colors.caution} />
                    <T variant="callout" tone="secondary" style={styles.flex}>
                      {e.label}
                    </T>
                  </View>
                ))}
                {det.boundingBox ? (
                  <T variant="caption" tone="tertiary">
                    The outline marks where the model’s evidence was strongest across overlapping parts of the photo. It is
                    not a precise boundary of the defect.
                  </T>
                ) : null}
              </View>
            </Card>
          </Section>
        </>
      ) : null}

      <Section title="What this does NOT mean">
        <Card>
          <View style={styles.pad}>
            <T variant="callout" tone="secondary">
              This is a visual assessment, not a legal or engineering determination. CivicLens can be wrong, confidence is
              not certainty, and severity is an estimate. It cannot determine legal or ADA compliance from a photo.
            </T>
          </View>
        </Card>
      </Section>

      <Section title="Location & civic info">
        <LocationSummary scan={scan} units={settings.units} />
        <JurisdictionSummary scan={scan} category={category} />
        <DuplicateSummary
          scan={scan}
          category={category}
          units={settings.units}
          onDecision={(d, c) => {
            void applyDuplicateDecision(scan, d, c);
            if (d === 'viewed_existing' && c) openPublicReport(c);
          }}
        />
        {scan.observations.length ? (
          <T variant="caption" tone="secondary">
            You confirmed this is still present {scan.observations.length} time{scan.observations.length > 1 ? 's' : ''}.
          </T>
        ) : null}
      </Section>

      <Section title="Analysis details">
        <Card>
          <Row label="Detected" value={`${formatDateLong(scan.createdAt)} · ${formatTime(scan.createdAt)}`} icon="clock" />
          <Divider />
          <Row
            label="Model"
            value={`${scan.analysis.model.modelName}`}
            hint={`${scan.analysis.model.modelVersion} · head ${scan.analysis.model.headVersion} · ${scan.analysis.model.backend}`}
            icon="cpu"
          />
          <Divider />
          <Row
            label="Processing time"
            value={`${formatMs(scan.analysis.latencyMs)} total · ${formatMs(scan.analysis.inferenceMs)} inference`}
            hint={`${scan.analysis.regionsAnalyzed} image regions analyzed at ${scan.analysis.imageWidth}×${scan.analysis.imageHeight}`}
            icon="gauge"
          />
          <Divider />
          <Pressable onPress={() => setShowScores((s) => !s)} accessibilityRole="button" accessibilityState={{ expanded: showScores }}>
            <Row label="Model scores" value={showScores ? 'Hide' : 'Show all scores'} icon="sort" />
          </Pressable>
          {showScores ? (
            <View style={styles.pad}>
              {scan.analysis.topScores.map((s) => (
                <View key={s.category} style={styles.scoreRow}>
                  <T variant="callout" style={styles.flex}>
                    {categoryLabel(s.category)}
                  </T>
                  <T variant="mono" tone="secondary">
                    {formatPercent(s.probability)}
                  </T>
                </View>
              ))}
              <T variant="caption" tone="tertiary">
                Calibrated probabilities from the CivicLens head over the whole photo.
              </T>
            </View>
          ) : null}
        </Card>
      </Section>

      <Section title="Actions">
        {category ? (
          <Button
            label={report ? 'Open report' : 'Create report'}
            icon="file"
            onPress={async () => {
              const r = report ?? (await confirmAndDraftReport(scan, category));
              router.push({ pathname: '/report/[reportId]', params: { reportId: r.id } });
            }}
          />
        ) : null}
        <Button
          label={scan.status === 'resolved' ? 'Mark as not resolved' : 'Mark as resolved'}
          icon="checkCircle"
          variant="secondary"
          onPress={() => void markResolved(scan, scan.status !== 'resolved')}
        />
        <Button label="Delete scan" icon="delete" variant="danger" onPress={confirmDelete} />
      </Section>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pad: { padding: space.lg, gap: space.sm },
  evidence: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  factor: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs },
  factorHead: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 4, backgroundColor: colors.surfaceRaised, borderRadius: 2, overflow: 'hidden' },
  bar: { height: '100%', backgroundColor: colors.textSecondary },
  scoreRow: { flexDirection: 'row', alignItems: 'center' },
});
