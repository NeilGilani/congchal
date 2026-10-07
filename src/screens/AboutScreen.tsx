import * as WebBrowser from 'expo-web-browser';
import { StyleSheet, View } from 'react-native';

import { Card, Divider, Row, Screen, Section } from '@/components/Layout';
import { LogoMark } from '@/components/Logo';
import { Banner } from '@/components/States';
import { T } from '@/components/Typography';
import { CATEGORY_INFO } from '@/constants/categories';
import { appConfig } from '@/constants/config';
import { DEMO_SCENARIOS } from '@/constants/demoScenarios';
import { colors, radius, space } from '@/constants/theme';
import { ISSUE_CATEGORIES, type IssueCategory } from '@/models/issue';
import { getHead } from '@/services/detection/detectionService';
import { formatPercent } from '@/utils/format';

import evaluation from '../../docs/eval/results.json';

interface ClassMetrics {
  support: number;
  precision: number;
  recall: number;
  precisionCi95: [number, number];
  recallCi95: [number, number];
}

interface EvaluationSummary {
  evaluatedAt: string;
  images: number;
  qualityRejected: number;
  perClass: Record<string, ClassMetrics>;
  noIssueImages: number;
  falseAlarmRate: number;
  falseAlarmRateCi95: [number, number];
  confidenceLevels: Record<string, { detections: number; precision: number; ci95: [number, number] }>;
}

const EVAL = evaluation as unknown as EvaluationSummary;

const open = (url: string) => void WebBrowser.openBrowserAsync(url).catch(() => undefined);

const Step = ({ n, title, body }: { n: number; title: string; body: string }) => (
  <View style={styles.step} accessible accessibilityLabel={`Step ${n}. ${title}. ${body}`}>
    <View style={styles.stepNum}>
      <T variant="mono" tone="accent">
        {n}
      </T>
    </View>
    <View style={styles.flex}>
      <T variant="bodyMedium">{title}</T>
      <T variant="callout" tone="secondary">
        {body}
      </T>
    </View>
  </View>
);

const range = (ci: [number, number]) => `${formatPercent(ci[0])}–${formatPercent(ci[1])}`;

const MetricsTable = () => {
  const head = getHead();
  const classes = head.classes.filter((c) => c !== 'none') as IssueCategory[];
  return (
    <View style={styles.table}>
      <View style={[styles.tr, styles.th]}>
        <T variant="caption" tone="tertiary" style={styles.tcName}>
          Issue
        </T>
        <T variant="caption" tone="tertiary" style={styles.tc}>
          Precision
        </T>
        <T variant="caption" tone="tertiary" style={styles.tc}>
          Recall
        </T>
        <T variant="caption" tone="tertiary" style={styles.tcN}>
          Photos
        </T>
      </View>
      {classes.map((c) => {
        const m = EVAL.perClass[c];
        if (!m) return null;
        return (
          <View
            key={c}
            style={styles.tr}
            accessible
            accessibilityLabel={`${CATEGORY_INFO[c].label}: precision ${formatPercent(m.precision)}, range ${range(m.precisionCi95)}. Recall ${formatPercent(m.recall)}, range ${range(m.recallCi95)}. ${m.support} test photos.`}
          >
            <T variant="callout" style={styles.tcName}>
              {CATEGORY_INFO[c].label}
            </T>
            <View style={styles.tc}>
              <T variant="mono">{formatPercent(m.precision)}</T>
              <T variant="caption" tone="tertiary">
                {range(m.precisionCi95)}
              </T>
            </View>
            <View style={styles.tc}>
              <T variant="mono">{formatPercent(m.recall)}</T>
              <T variant="caption" tone="tertiary">
                {range(m.recallCi95)}
              </T>
            </View>
            <T variant="mono" tone="secondary" style={styles.tcN}>
              {m.support}
            </T>
          </View>
        );
      })}
    </View>
  );
};

export const AboutScreen = () => {
  const head = getHead();
  const trained = head.classes.filter((c) => c !== 'none') as IssueCategory[];
  const notTrained = ISSUE_CATEGORIES.filter((c) => c !== 'other' && !trained.includes(c));
  const high = EVAL.confidenceLevels.high;

  return (
    <Screen title="About CivicLens" subtitle="How it works and where it falls short">
      <View style={styles.hero}>
        <LogoMark size={44} />
        <View style={styles.flex}>
          <T variant="title">CivicLens</T>
          <T variant="callout" tone="secondary">
            See it. Understand it. Act on it.
          </T>
        </View>
      </View>

      <Section title="How a scan works">
        <Card>
          <View style={styles.steps}>
            <Step n={1} title="Photo check" body="Blurry, dark, washed-out or blocked photos are rejected with a reason, instead of being guessed at." />
            <Step
              n={2}
              title="On-device vision model"
              body={`${head.def.modelName}. The image encoder runs on your phone with ONNX Runtime; the photo is not uploaded.`}
            />
            <Step n={3} title="Several views" body="The whole photo plus crops are analyzed, so a small pothole in a big street scene is not missed." />
            <Step n={4} title="Calibrated confidence" body="Scores were calibrated on held-out photos. Below the threshold, CivicLens says it isn't sure." />
            <Step n={5} title="You decide" body="You confirm the issue type, edit the report and choose how to send it. Nothing is submitted automatically." />
          </View>
        </Card>
      </Section>

      <Section title="What it can recognize">
        <T variant="callout" tone="secondary">
          Trained on: {trained.map((c) => CATEGORY_INFO[c].label.toLowerCase()).join(', ')}.
        </T>
        <T variant="callout" tone="secondary">
          Not trained on (choose these yourself): {notTrained.map((c) => CATEGORY_INFO[c].label.toLowerCase()).join(', ')}. There weren’t enough
          clean example photos to train and test these honestly.
        </T>
      </Section>

      <Section title="Measured accuracy">
        <T variant="callout" tone="secondary">
          Tested on {EVAL.images} held-out photos the model never saw in training, through the same code that runs in the app.{' '}
          {EVAL.qualityRejected} were rejected by the photo check.
        </T>
        <Card>
          <MetricsTable />
        </Card>
        <Card>
          <Row
            label="False alarms on scenes with no issue"
            value={`${formatPercent(EVAL.falseAlarmRate)} (${range(EVAL.falseAlarmRateCi95)})`}
            hint={`${EVAL.noIssueImages} ordinary street scenes`}
          />
          {high ? (
            <>
              <Divider />
              <Row label="Correct when it says “high confidence”" value={`${formatPercent(high.precision)} (${range(high.ci95)})`} hint={`${high.detections} detections`} />
            </>
          ) : null}
        </Card>
        <T variant="caption" tone="tertiary">
          Precision: when CivicLens says it found an issue, how often it’s right. Recall: of the real issues, how many it finds. Ranges are 95%
          confidence intervals; small test sets (overflowing trash, illegal dumping) have wide ranges.
        </T>
        <Banner tone="caution" title="Limits of these numbers">
          <T variant="callout" tone="secondary">
            The test photos come from public web datasets, not phone cameras on real streets. Labels for most non-road photos were reviewed by an AI
            assistant, not a person. Accuracy on your street may be lower. Evaluated {new Date(EVAL.evaluatedAt).toLocaleDateString()}.
          </T>
        </Banner>
      </Section>

      <Section title="Responsible use">
        <Card>
          <View style={styles.steps}>
            <T variant="callout">CivicLens reports what is visible in a photo. It does not decide legal responsibility, code violations or ADA compliance.</T>
            <T variant="callout">Severity is an estimate from visible cues, not an engineering assessment.</T>
            <T variant="callout">It never sends reports to a government agency on your behalf. You review and send them yourself.</T>
            <T variant="callout">Avoid photographing people’s faces or license plates when you can. Reports you share are your responsibility.</T>
          </View>
        </Card>
      </Section>

      <Section title="Data sources and licenses">
        <Card>
          <Row label="Vision model" value="SigLIP 2 B/32 by Google (Apache 2.0)" onPress={() => open('https://github.com/google-research/big_vision')} />
          <Divider />
          <Row
            label="Training photos"
            value="Open Images V7 (CC BY 2.0), Pothole Dataset, DeepCrack, CrackForest"
            hint="Used only to train the classifier; none of these photos ship with the app."
            onPress={() => open('https://storage.googleapis.com/openimages/web/index.html')}
          />
          <Divider />
          <Row label="Jurisdiction" value="US Census Bureau Geocoder (public domain)" onPress={() => open('https://geocoding.geo.census.gov/')} />
          <Divider />
          <Row
            label="Addresses, roads and map"
            value="© OpenStreetMap contributors (ODbL), via Nominatim and Overpass. Map tiles: OpenFreeMap, OpenMapTiles"
            onPress={() => open('https://www.openstreetmap.org/copyright')}
          />
          <Divider />
          <Row label="Existing reports" value="SeeClickFix, and 311 open data from New York City, San Francisco and Chicago" />
        </Card>
        <T variant="caption" tone="tertiary">
          Demo Mode photos (CC BY 2.0, via Open Images):{' '}
          {DEMO_SCENARIOS.map((s) => `“${s.attribution.title}” by ${s.attribution.author}`).join('; ')}.
        </T>
      </Section>

      <T variant="caption" tone="tertiary" align="center">
        App {appConfig.appVersion} · model {head.def.modelVersion} · classifier {head.def.version}
      </T>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.md },
  steps: { gap: space.lg, padding: space.lg },
  step: { flexDirection: 'row', gap: space.md },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  table: { paddingVertical: space.sm },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm },
  th: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, borderRadius: radius.sm },
  tcName: { flex: 1.4 },
  tc: { flex: 1 },
  tcN: { width: 52, textAlign: 'right' },
});
