import * as Clipboard from 'expo-clipboard';
import { useNetworkState } from 'expo-network';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Card, Divider, Row, Screen, Section } from '@/components/Layout';
import { T } from '@/components/Typography';
import { colors, space } from '@/constants/theme';
import { useLocation } from '@/hooks/useLocation';
import { useCollectionList, useSettings } from '@/hooks/useStore';
import { getLatencySamples } from '@/api/http';
import { DetectionService, getHead } from '@/services/detection/detectionService';
import { processPendingLookups } from '@/services/sync/syncService';
import { getCacheStats } from '@/storage/cache';
import { getRepositories } from '@/storage/repositories';
import { formatLogEntry, getLogEntries, subscribeToLogs } from '@/utils/logger';

const useTick = (ms: number): number => {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
};

const useLogs = () => {
  const [, setVersion] = useState(0);
  useEffect(() => subscribeToLogs(() => setVersion((v) => v + 1)), []);
  return getLogEntries();
};

const fmtMs = (ms: number | undefined) => (ms === undefined ? '—' : `${Math.round(ms)} ms`);

/**
 * Developer panel (Settings → tap the version 7 times). Everything here is
 * read from live services; nothing is simulated.
 */
export const DebugScreen = () => {
  useTick(2000);
  const { settings, update } = useSettings();
  const net = useNetworkState();
  const location = useLocation(true);
  const { items: scans } = useCollectionList(getRepositories().scans);
  const logs = useLogs();
  const [syncResult, setSyncResult] = useState<string | undefined>();
  const status = DetectionService.getStatus();
  const head = getHead();
  const last = scans[0];
  const latency = getLatencySamples().slice(-15).reverse();
  const caches = [...getCacheStats().entries()];
  const pending = scans.filter((s) => s.location && s.pendingLookups.length > 0).length;

  const copyLogs = () => void Clipboard.setStringAsync(getLogEntries().map((e) => `${new Date(e.at).toISOString()} ${formatLogEntry(e)}`).join('\n'));

  return (
    <Screen title="Debug panel" subtitle="Developer mode">
      <Section title="Model">
        <Card>
          <Row label="State" value={status.state + (status.error ? ` · ${status.error}` : '')} mono />
          <Divider />
          <Row label="Backend" value={status.description ?? status.backend ?? 'not loaded'} mono />
          <Divider />
          <Row label="Load time" value={fmtMs(status.loadMs)} mono />
          <Divider />
          <Row label="Model / classifier" value={`${head.def.modelVersion} / ${head.def.version}`} mono />
          <Divider />
          <Row
            label="Thresholds"
            value={`detect ${head.def.thresholds.detect} · high ${head.def.thresholds.high} · uncertain ${head.def.thresholds.uncertain} · T ${head.def.temperature}`}
            mono
          />
          <Divider />
          <Row label="Last analysis latency" value={fmtMs(DetectionService.lastLatency())} mono />
        </Card>
      </Section>

      <Section title="Last scan">
        {last ? (
          <Card>
            <Row label="Outcome" value={`${last.analysis.outcome} · ${last.source}`} mono />
            <Divider />
            <Row label="Resolution" value={`${last.imageWidth}×${last.imageHeight} · ${last.analysis.regionsAnalyzed} regions`} mono />
            <Divider />
            <Row label="Latency (total / inference)" value={`${fmtMs(last.analysis.latencyMs)} / ${fmtMs(last.analysis.inferenceMs)}`} mono />
            <Divider />
            <Row label="Top scores" value={last.analysis.topScores.map((s) => `${s.category} ${s.probability.toFixed(3)}`).join('\n')} mono />
            <Divider />
            <Row label="Quality" value={`sharpness ${last.quality.sharpness.toFixed(0)} · luma ${last.quality.meanLuma.toFixed(0)} · ${last.quality.ok ? 'ok' : 'rejected'}`} mono />
            {last.location ? (
              <>
                <Divider />
                <Row label="Scan location accuracy" value={last.location.accuracy !== null ? `±${Math.round(last.location.accuracy)} m (${last.location.source})` : `unknown (${last.location.source})`} mono />
              </>
            ) : null}
          </Card>
        ) : (
          <T variant="callout" tone="secondary">
            No scans yet.
          </T>
        )}
      </Section>

      <Section title="Location">
        <Card>
          <Row label="Permission" value={location.permission} mono />
          <Divider />
          <Row
            label="Current fix"
            value={location.fix ? `±${location.fix.accuracy !== null ? Math.round(location.fix.accuracy) : '?'} m · ${location.quality} · ${location.fix.source}` : 'none'}
            hint={location.fix ? `at ${new Date(location.fix.timestamp).toLocaleTimeString()}` : undefined}
            mono
          />
        </Card>
      </Section>

      <Section title="Network">
        <Card>
          <Row label="Connection" value={`${net.type ?? 'unknown'} · connected ${String(net.isConnected)} · internet ${String(net.isInternetReachable)}`} mono />
          <Divider />
          <Row label="Scans waiting for lookups" value={String(pending)} mono />
          <Divider />
          <Row
            label="Civic lookups"
            value={settings.localOnlyMode ? 'off (local-only mode)' : settings.civicLookupsEnabled ? 'on' : 'off'}
            mono
          />
        </Card>
        <Button
          label="Process pending lookups now"
          icon="retry"
          variant="secondary"
          onPress={() => void processPendingLookups().then((n) => setSyncResult(`${n} scan${n === 1 ? '' : 's'} processed`))}
        />
        {syncResult ? (
          <T variant="caption" tone="secondary">
            {syncResult}
          </T>
        ) : null}
      </Section>

      <Section title="API latency (latest first)">
        <Card>
          {latency.length === 0 ? (
            <View style={styles.pad}>
              <T variant="callout" tone="secondary">
                No requests yet.
              </T>
            </View>
          ) : (
            latency.map((s, i) => (
              <View key={`${s.at}-${i}`} style={styles.line}>
                <T variant="mono" style={styles.flex} numberOfLines={1}>
                  {s.label}
                </T>
                <T variant="mono" tone={s.status === 'error' || (typeof s.status === 'number' && s.status >= 400) ? 'critical' : 'secondary'}>
                  {String(s.status)} · {Math.round(s.ms)} ms
                </T>
              </View>
            ))
          )}
        </Card>
      </Section>

      <Section title="Caches">
        <Card>
          {caches.length === 0 ? (
            <View style={styles.pad}>
              <T variant="callout" tone="secondary">
                No cache activity yet.
              </T>
            </View>
          ) : (
            caches.map(([name, s]) => (
              <View key={name} style={styles.line}>
                <T variant="mono" style={styles.flex}>
                  {name}
                </T>
                <T variant="mono" tone="secondary">
                  hit {s.hits} · miss {s.misses} · write {s.writes}
                </T>
              </View>
            ))
          )}
        </Card>
      </Section>

      <Section title={`Logs (${logs.length})`} right={<Button label="Copy" icon="copy" variant="ghost" onPress={copyLogs} />}>
        <Card>
          <View style={styles.pad}>
            {logs.length === 0 ? (
              <T variant="callout" tone="secondary">
                No log entries yet.
              </T>
            ) : (
              [...logs]
                .slice(-60)
                .reverse()
                .map((e, i) => (
                  <T key={`${e.at}-${i}`} variant="mono" tone={e.level === 'error' ? 'critical' : e.level === 'warn' ? 'caution' : 'secondary'} selectable>
                    {new Date(e.at).toLocaleTimeString()} {formatLogEntry(e)}
                  </T>
                ))
            )}
          </View>
        </Card>
        <T variant="caption" tone="tertiary">
          Logs hold metrics only. Coordinates, addresses and descriptions are never logged.
        </T>
      </Section>

      <Section title="Tools">
        <Button label="Model evaluation tool" icon="target" variant="secondary" onPress={() => router.push('/dev/evaluate')} />
        <Button
          label="Turn off developer mode"
          variant="ghost"
          onPress={() => void update({ developerMode: false }).then(() => router.back())}
        />
      </Section>
      <View style={{ height: space.lg, backgroundColor: colors.bg }} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: space.lg, gap: space.xs },
  line: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
});
