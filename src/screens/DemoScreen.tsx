import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { DemoBadge, Pill } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Screen, Section } from '@/components/Layout';
import { Banner } from '@/components/States';
import { T } from '@/components/Typography';
import { CATEGORY_INFO } from '@/constants/categories';
import { DEMO_SCENARIOS, type DemoScenario } from '@/constants/demoScenarios';
import { colors, radius, space } from '@/constants/theme';
import { useCollectionList, useSettings } from '@/hooks/useStore';
import { clearDemoData, modelCanDetect, runDemoScenario } from '@/services/demo/demoService';
import { getRepositories } from '@/storage/repositories';

const ScenarioCard = ({ scenario, busy, disabled, onPress }: { scenario: DemoScenario; busy: boolean; disabled: boolean; onPress: () => void }) => {
  const supported = modelCanDetect(scenario);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      accessibilityLabel={`Analyze sample photo: ${scenario.title}. ${scenario.summary}`}
      accessibilityHint={supported ? undefined : 'CivicLens is not trained on this category yet. Shows how it handles that.'}
      style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.surfacePressed }, disabled && !busy && styles.dim]}
    >
      <View>
        <Image source={scenario.image} style={styles.thumb} contentFit="cover" accessibilityIgnoresInvertColors />
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.text} />
            <T variant="caption">Analyzing…</T>
          </View>
        ) : null}
      </View>
      <View style={styles.cardBody}>
        <T variant="headline">{scenario.title}</T>
        <T variant="callout" tone="secondary">
          {scenario.summary}
        </T>
        <View style={styles.pills}>
          {supported ? (
            <Pill label="Model is trained on this" fg={colors.positive} bg={colors.positiveMuted} icon="check" />
          ) : (
            <Pill label="Not a model category yet" fg={colors.caution} bg={colors.cautionMuted} icon="warning" />
          )}
        </View>
        <T variant="caption" tone="tertiary" numberOfLines={2}>
          Photo: “{scenario.attribution.title}” by {scenario.attribution.author}, {scenario.attribution.license}
        </T>
      </View>
    </Pressable>
  );
};

export const DemoScreen = () => {
  const { settings } = useSettings();
  const { items: demoScans } = useCollectionList(getRepositories().demoScans);
  const [running, setRunning] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const run = async (scenario: DemoScenario) => {
    setRunning(scenario.id);
    setError(undefined);
    try {
      const scan = await runDemoScenario(scenario, settings);
      router.push({ pathname: '/result/[scanId]', params: { scanId: scan.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The sample photo could not be analyzed.');
    } finally {
      setRunning(undefined);
    }
  };

  const unsupported = DEMO_SCENARIOS.filter((s) => !modelCanDetect(s))
    .map((s) => CATEGORY_INFO[s.shows].label.toLowerCase())
    .join(', ');

  return (
    <Screen title="Demo Mode" subtitle="Sample photos, real analysis">
      <View style={styles.header}>
        <DemoBadge />
      </View>
      <Banner tone="demo" title="These are sample photos, not live detections">
        <T variant="callout" tone="secondary">
          Each photo goes through the same on-device analysis as a camera scan. Results are not scripted: you see exactly what the model
          returns. Demo scans use a labeled sample location, stay separate from your history and are never counted in your impact.
        </T>
      </Banner>

      {error ? <Banner tone="critical" title="Couldn't run the demo" body={error} /> : null}

      <Section title="Pick a scenario">
        {DEMO_SCENARIOS.map((s) => (
          <ScenarioCard key={s.id} scenario={s} busy={running === s.id} disabled={Boolean(running)} onPress={() => void run(s)} />
        ))}
      </Section>

      {unsupported ? (
        <T variant="caption" tone="tertiary">
          The model is not trained to recognize {unsupported}. Those scenarios show how CivicLens behaves when it can’t tell: it says so,
          and you can still choose the issue type yourself.
        </T>
      ) : null}

      <Section title="Demo data">
        <T variant="callout" tone="secondary">
          {demoScans.length === 0
            ? 'No demo scans yet.'
            : `${demoScans.length} demo scan${demoScans.length === 1 ? '' : 's'} saved separately from your real history.`}
        </T>
        <Button label="Clear demo data" icon="delete" variant="secondary" onPress={() => void clearDemoData()} disabled={demoScans.length === 0} />
        <Button label="Leave Demo Mode" icon="camera" variant="ghost" onPress={() => router.replace('/')} />
      </Section>
    </Screen>
  );
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row' },
  card: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  dim: { opacity: 0.5 },
  thumb: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  busy: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.md,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  cardBody: { flex: 1, gap: space.xs },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
