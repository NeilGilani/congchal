import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { DemoBadge, SeverityBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { CategoryHeading, DuplicateSummary, JurisdictionSummary, LocationSummary, openPublicReport } from '@/components/CivicInfo';
import { ConfidenceMeter } from '@/components/ConfidenceMeter';
import { CategoryPicker } from '@/components/Controls';
import { EvidenceImage } from '@/components/EvidenceImage';
import { HeaderIconButton, Screen, Section } from '@/components/Layout';
import { Banner, ErrorState } from '@/components/States';
import { T } from '@/components/Typography';
import { CATEGORY_INFO, categoryLabel } from '@/constants/categories';
import { findDemoScenario } from '@/constants/demoScenarios';
import { colors, space } from '@/constants/theme';
import { useScan, useSettings } from '@/hooks/useStore';
import type { DuplicateCandidate } from '@/models/civic';
import { ISSUE_CATEGORIES, type IssueCategory } from '@/models/issue';
import { getHead } from '@/services/detection/detectionService';
import { applyDuplicateDecision, confirmAndDraftReport } from '@/services/scan/scanActions';
import { formatPercent } from '@/utils/format';

const supportedList = (): string =>
  getHead()
    .classes.filter((c) => c !== 'none')
    .map((c) => categoryLabel(c).toLowerCase())
    .join(', ');

export const ResultScreen = ({ scanId }: { scanId: string }) => {
  const { scan, loading } = useScan(scanId);
  const { settings } = useSettings();
  const [picker, setPicker] = useState(false);
  const [confirming, setConfirming] = useState<IssueCategory | undefined>();
  const [busy, setBusy] = useState(false);
  const announced = useRef(false);

  useEffect(() => {
    if (!scan || announced.current || Platform.OS === 'web') return;
    announced.current = true;
    if (scan.analysis.outcome === 'detected') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    if (scan.analysis.outcome === 'rejected_quality') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  }, [scan]);

  if (loading) {
    return (
      <Screen title="Result" scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.text} />
        </View>
      </Screen>
    );
  }
  if (!scan) {
    return (
      <Screen title="Result">
        <ErrorState title="Scan not found" body="It may have been deleted from your history." onRetry={() => router.replace('/')} retryLabel="Back to camera" />
      </Screen>
    );
  }

  const det = scan.detections[0];
  const outcome = scan.analysis.outcome;
  const demoScenario = scan.demoScenarioId ? findDemoScenario(scan.demoScenarioId) : undefined;
  const scanAgain = () => (scan.isDemo ? router.replace('/demo') : router.replace('/'));
  const category: IssueCategory | undefined = scan.confirmedCategory ?? (outcome === 'detected' || outcome === 'uncertain' ? det?.category : undefined);
  const suggested = scan.analysis.topScores.filter((s) => s.category !== 'none' && s.probability >= 0.1).map((s) => s.category as IssueCategory);

  const startReport = async (c: IssueCategory) => {
    setBusy(true);
    try {
      const report = await confirmAndDraftReport(scan, c);
      setConfirming(undefined);
      router.push({ pathname: '/report/[reportId]', params: { reportId: report.id } });
    } finally {
      setBusy(false);
    }
  };

  const onDecision = (d: 'report_anyway' | 'still_present' | 'viewed_existing', c?: DuplicateCandidate) => {
    void applyDuplicateDecision(scan, d, c);
    if (d === 'viewed_existing' && c) openPublicReport(c);
    if (d === 'report_anyway' && category) setConfirming(category);
  };

  const boxLabel = det && outcome !== 'none' && outcome !== 'rejected_quality' ? `${CATEGORY_INFO[det.category].label} · ${formatPercent(det.confidence)}` : undefined;

  const footer =
    outcome === 'rejected_quality' ? (
      <Button label={scan.isDemo ? 'Try another sample' : 'Try again'} icon={scan.isDemo ? 'flask' : 'camera'} size="lg" onPress={scanAgain} />
    ) : confirming ? (
      <View style={styles.confirm}>
        <T variant="headline" align="center">
          Is this {CATEGORY_INFO[confirming].noun === 'pothole' ? 'a pothole' : CATEGORY_INFO[confirming].noun}?
        </T>
        <T variant="caption" tone="secondary" align="center">
          You make the call. CivicLens only suggests.
        </T>
        <Button label="Yes, create report" icon="check" size="lg" loading={busy} onPress={() => void startReport(confirming)} />
        <Button label="Choose a different type" variant="secondary" onPress={() => setPicker(true)} />
        <Button label="Cancel" variant="ghost" onPress={() => setConfirming(undefined)} />
      </View>
    ) : (
      <View style={styles.footerRow}>
        <Button
          label={scan.isDemo ? 'Another sample' : 'Scan again'}
          icon={scan.isDemo ? 'flask' : 'camera'}
          variant="secondary"
          onPress={scanAgain}
          style={styles.flex}
        />
        {category ? (
          <Button label="Review issue" icon="check" onPress={() => setConfirming(category)} style={styles.flex} />
        ) : (
          <Button label="Choose issue type" icon="edit" onPress={() => setPicker(true)} style={styles.flex} />
        )}
      </View>
    );

  return (
    <Screen
      title="Result"
      subtitle={scan.isDemo ? 'Demo Mode · sample image' : undefined}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      backLabel="Back to camera"
      right={det ? <HeaderIconButton icon="info" label="Issue details" onPress={() => router.push({ pathname: '/issue/[id]', params: { id: scan.id } })} /> : undefined}
      footer={footer}
    >
      {scan.isDemo ? (
        <View style={styles.demo}>
          <DemoBadge />
          <T variant="caption" tone="demo">
            Real model output on a bundled sample photo. Not a live detection.
          </T>
          {demoScenario ? (
            <T variant="caption" tone="tertiary">
              Photo: “{demoScenario.attribution.title}” by {demoScenario.attribution.author} ({demoScenario.attribution.license})
            </T>
          ) : null}
        </View>
      ) : null}

      <EvidenceImage
        uri={scan.imageUri}
        width={scan.imageWidth}
        height={scan.imageHeight}
        box={outcome === 'detected' || outcome === 'uncertain' ? det?.boundingBox : undefined}
        label={boxLabel}
        boxColor={det?.confidenceLevel === 'high' ? colors.accent : colors.caution}
        accessibilityLabel={`Analyzed photo${det?.boundingBox ? ', with the region of strongest evidence outlined' : ''}`}
      />

      {outcome === 'rejected_quality' ? (
        <ErrorState
          title="We couldn't get a reliable read"
          body={`${scan.quality.issues.find((i) => i.level === 'blocking')?.message ?? 'The photo quality is too low.'} ${scan.quality.issues.find((i) => i.level === 'blocking')?.guidance ?? ''}`}
        />
      ) : null}

      {outcome === 'detected' && det ? (
        <>
          <Section>
            <T variant="eyebrow" tone="accent" accessibilityLiveRegion="polite">
              Possible {CATEGORY_INFO[det.category].noun} detected
            </T>
            <T variant="display">{CATEGORY_INFO[det.category].label}</T>
            <T variant="body" tone="secondary">
              {det.explanation}
            </T>
          </Section>
          <ConfidenceMeter level={det.confidenceLevel} value={det.confidence} />
          {det.severity ? (
            <Section>
              <SeverityBadge level={det.severity.level} />
              <T variant="callout" tone="secondary">
                {det.severity.rationale}
              </T>
              <T variant="caption" tone="tertiary">
                Severity is an automated estimate. Review before submitting.
              </T>
            </Section>
          ) : null}
        </>
      ) : null}

      {outcome === 'uncertain' && det ? (
        <>
          <Banner
            tone="caution"
            title={`Possible ${CATEGORY_INFO[det.category].noun}. Please review.`}
            body={
              det.evidence.some((e) => e.id === 'region-only')
                ? 'Only one part of the photo looked like this. Move closer and keep the issue centered, or confirm it yourself.'
                : "I'm not confident enough to identify this. Check the photo and choose the issue type yourself if it's right."
            }
          />
          <ConfidenceMeter level="low" value={det.confidence} />
        </>
      ) : null}

      {outcome === 'none' ? (
        <Banner
          tone="info"
          title="No recognized issue"
          body={`CivicLens didn't find strong evidence of an issue it recognizes (${supportedList()}). If you see a different problem, choose the issue type yourself.`}
        />
      ) : null}

      {scan.confirmedCategory && scan.confirmedCategory !== det?.category ? (
        <Banner tone="info" icon="edit" title={`You chose: ${CATEGORY_INFO[scan.confirmedCategory].label}`} body="Your choice is used for the report." />
      ) : null}

      {outcome !== 'rejected_quality' ? (
        <>
          {category && outcome === 'none' ? <CategoryHeading category={category} /> : null}
          <Section title="Location">
            <LocationSummary scan={scan} units={settings.units} />
          </Section>
          {scan.location ? (
            <Section title="Civic info">
              <JurisdictionSummary scan={scan} category={category} />
            </Section>
          ) : null}
          {category && scan.location ? (
            <Section title="Existing reports">
              <DuplicateSummary scan={scan} category={category} units={settings.units} onDecision={onDecision} />
            </Section>
          ) : null}
        </>
      ) : null}

      <CategoryPicker
        visible={picker}
        selected={confirming ?? category}
        suggested={suggested.filter((c) => ISSUE_CATEGORIES.includes(c))}
        onClose={() => setPicker(false)}
        onSelect={(c) => {
          setPicker(false);
          setConfirming(c);
        }}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  footerRow: { flexDirection: 'row', gap: space.sm },
  confirm: { gap: space.sm },
  demo: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
});
