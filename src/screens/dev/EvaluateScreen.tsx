import { Asset } from 'expo-asset';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { ChipGroup } from '@/components/Controls';
import { EvidenceImage } from '@/components/EvidenceImage';
import { Card, Divider, Row, Screen, Section } from '@/components/Layout';
import { Banner } from '@/components/States';
import { T } from '@/components/Typography';
import { CATEGORY_INFO } from '@/constants/categories';
import { DEMO_SCENARIOS } from '@/constants/demoScenarios';
import { colors, space } from '@/constants/theme';
import { useSettings } from '@/hooks/useStore';
import type { ModelClass } from '@/models/issue';
import { DetectionService, getHead, type PhotoAnalysis } from '@/services/detection/detectionService';
import {
  appendFieldRecord,
  clearFieldRecords,
  loadFieldRecords,
  predictionFor,
  summarizeFieldRecords,
  type FieldRecord,
  type FieldTruth,
} from '@/services/dev/fieldEvaluation';
import { getDefaultStore } from '@/storage/kv';
import { formatPercent } from '@/utils/format';

const classLabel = (c: ModelClass | FieldTruth): string =>
  c === 'none' ? 'No issue' : c === 'other_issue' ? 'Other issue' : CATEGORY_INFO[c].label;

const pct = (v: number | undefined) => (v === undefined ? '—' : formatPercent(v));

/**
 * Developer evaluation tool: runs any photo through the full pipeline and
 * shows the raw numbers, then lets the tester record the true label to build
 * an on-device field evaluation (stored locally, exportable as JSON).
 */
export const EvaluateScreen = () => {
  const { settings } = useSettings();
  const head = getHead();
  const [subject, setSubject] = useState<{ uri: string; source: string } | undefined>();
  const [result, setResult] = useState<PhotoAnalysis | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [truth, setTruth] = useState<FieldTruth | undefined>();
  const [records, setRecords] = useState<FieldRecord[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadFieldRecords(getDefaultStore()).then(setRecords);
  }, []);

  const analyze = async (uri: string, width: number | undefined, height: number | undefined, source: string) => {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setTruth(undefined);
    setSaved(false);
    setSubject({ uri, source });
    try {
      setResult(await DetectionService.analyzePhoto(uri, width, height, settings, 'scan'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed.');
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    const a = res.canceled ? undefined : res.assets[0];
    if (a) await analyze(a.uri, a.width, a.height, 'Photo library');
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('Camera permission is needed to take a test photo.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    const a = res.canceled ? undefined : res.assets[0];
    if (a) await analyze(a.uri, a.width, a.height, 'Camera');
  };

  const runDemo = async (id: string) => {
    const s = DEMO_SCENARIOS.find((d) => d.id === id);
    if (!s) return;
    const asset = Asset.fromModule(s.image);
    await asset.downloadAsync();
    await analyze(asset.localUri ?? asset.uri, asset.width ?? undefined, asset.height ?? undefined, `Demo: ${s.title}`);
  };

  const record = async () => {
    if (!result || !truth) return;
    const a = result.analysis;
    const predicted = predictionFor(a.outcome, a.top?.category);
    const rec: FieldRecord = {
      at: new Date().toISOString(),
      truth,
      predicted,
      confidence: a.top?.probability ?? 0,
      latencyMs: Math.round(a.timings.totalMs),
    };
    setRecords(await appendFieldRecord(getDefaultStore(), rec));
    setSaved(true);
  };

  const summary = summarizeFieldRecords(records, head.classes);
  const a = result?.analysis;
  const probs = a?.probabilities ? (Object.entries(a.probabilities) as [ModelClass, number][]).sort((x, y) => y[1] - x[1]) : [];
  const truthOptions = [...head.classes, 'other_issue' as const].map((c) => ({ value: c, label: classLabel(c) }));

  return (
    <Screen title="Evaluation tool" subtitle="Developer mode">
      <Banner tone="info" title="Raw model output">
        <T variant="callout" tone="secondary">
          Photos analyzed here are not saved as scans. Record the true label to measure accuracy on real phone photos.
        </T>
      </Banner>

      <Section title="Choose a photo">
        <View style={styles.row}>
          <Button label="Take photo" icon="camera" variant="secondary" onPress={() => void takePhoto()} style={styles.flex} disabled={busy} />
          <Button label="Library" icon="gallery" variant="secondary" onPress={() => void pick()} style={styles.flex} disabled={busy} />
        </View>
        <ChipGroup
          options={DEMO_SCENARIOS.map((d) => ({ value: d.id, label: d.title }))}
          value={undefined}
          onChange={(id) => void runDemo(id)}
          accessibilityLabel="Analyze a demo photo"
        />
      </Section>

      {error ? <Banner tone="critical" title="Analysis failed" body={error} /> : null}

      {busy ? (
        <T variant="callout" tone="secondary">
          Analyzing…
        </T>
      ) : null}

      {result && a && subject ? (
        <>
          <EvidenceImage
            uri={result.prepared.uri}
            width={result.prepared.width}
            height={result.prepared.height}
            box={a.top?.region}
            label={a.top ? `${a.top.category} ${a.top.probability.toFixed(3)}` : undefined}
            accessibilityLabel={`Analyzed photo from ${subject.source}`}
          />
          <Section title="Result">
            <Card>
              <Row label="Outcome" value={a.outcome + (a.top ? ` · ${a.top.category} (${a.top.level}${a.top.viaRegion ? ', via region' : ''})` : '')} mono />
              <Divider />
              <Row label="Class probabilities" value={probs.map(([c, p]) => `${c.padEnd(18)} ${p.toFixed(4)}`).join('\n')} mono />
              <Divider />
              <Row
                label="Timings"
                value={`quality ${Math.round(a.timings.qualityMs)} · prep ${Math.round(a.timings.preprocessMs)} · infer ${Math.round(a.timings.inferenceMs)} · post ${Math.round(a.timings.postMs)} · total ${Math.round(a.timings.totalMs)} ms`}
                mono
              />
              <Divider />
              <Row
                label="Quality"
                value={`sharpness ${a.quality.metrics.sharpness.toFixed(0)} · luma ${a.quality.metrics.meanLuma.toFixed(0)} · contrast ${a.quality.metrics.contrast.toFixed(0)} · flat ${a.quality.metrics.flatCellRatio.toFixed(2)}`}
                hint={a.quality.issues.map((i) => `${i.kind} (${i.level})`).join(', ') || 'no issues'}
                mono
              />
              <Divider />
              <Row label="Input" value={`${result.prepared.width}×${result.prepared.height} · ${a.regionsAnalyzed} regions · ${result.model.backend}`} mono />
            </Card>
          </Section>

          {a.regions?.length ? (
            <Section title="Regions">
              <Card>
                {a.regions.map((r) => {
                  const best = (Object.entries(r.probabilities) as [ModelClass, number][]).sort((x, y) => y[1] - x[1])[0];
                  return (
                    <View key={r.id} style={styles.line}>
                      <T variant="mono" style={styles.flex}>
                        {r.id}
                      </T>
                      <T variant="mono" tone="secondary">
                        {best ? `${best[0]} ${best[1].toFixed(3)}` : '—'}
                      </T>
                    </View>
                  );
                })}
              </Card>
            </Section>
          ) : null}

          {a.concepts?.length ? (
            <Section title="Strongest concept probes (z-score)">
              <Card>
                {[...a.concepts]
                  .sort((x, y) => y.z - x.z)
                  .slice(0, 10)
                  .map((c) => (
                    <View key={c.id} style={styles.line}>
                      <T variant="mono" style={styles.flex} numberOfLines={1}>
                        {c.label}
                      </T>
                      <T variant="mono" tone={c.z >= 2 ? 'accent' : 'secondary'}>
                        {c.z.toFixed(2)}
                      </T>
                    </View>
                  ))}
              </Card>
            </Section>
          ) : null}

          <Section title="What was actually in the photo?">
            <ChipGroup options={truthOptions} value={truth} onChange={(v) => setTruth(v)} accessibilityLabel="True label" />
            <Button label={saved ? 'Recorded' : 'Record result'} icon="check" onPress={() => void record()} disabled={!truth || saved} />
          </Section>
        </>
      ) : null}

      <Section title={`Field evaluation (${summary.total} photos)`}>
        <Card>
          <Row label="Accuracy (excluding rejected)" value={pct(summary.accuracy)} mono />
          <Divider />
          <Row label="False alarms on no-issue photos" value={pct(summary.falseAlarmRate)} mono />
          <Divider />
          <Row label="Rejected by photo check / uncertain" value={`${summary.rejected} / ${summary.uncertain}`} mono />
          <Divider />
          <Row
            label="Per class (precision · recall · tp/fp/fn)"
            value={Object.entries(summary.perClass)
              .map(([c, m]) => `${c.padEnd(18)} ${pct(m.precision)} · ${pct(m.recall)} · ${m.tp}/${m.fp}/${m.fn}`)
              .join('\n')}
            mono
          />
          <Divider />
          <Row label="Median latency" value={summary.medianLatencyMs !== undefined ? `${summary.medianLatencyMs} ms` : '—'} mono />
        </Card>
        <View style={styles.row}>
          <Button
            label="Copy JSON"
            icon="copy"
            variant="secondary"
            onPress={() => void Clipboard.setStringAsync(JSON.stringify({ model: result?.model ?? DetectionService.modelInfo(), summary, records }, null, 2))}
            style={styles.flex}
            disabled={records.length === 0}
          />
          <Button
            label="Clear"
            icon="delete"
            variant="danger"
            onPress={() => void clearFieldRecords(getDefaultStore()).then(() => setRecords([]))}
            style={styles.flex}
            disabled={records.length === 0}
          />
        </View>
      </Section>
      <View style={{ height: space.lg, backgroundColor: colors.bg }} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: space.md },
  line: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
});
