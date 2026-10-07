import { useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useMemo, useRef } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Segmented, ToggleRow } from '@/components/Controls';
import { Card, Divider, Row, Screen, Section } from '@/components/Layout';
import { Banner } from '@/components/States';
import { T } from '@/components/Typography';
import { appConfig } from '@/constants/config';
import { colors, space } from '@/constants/theme';
import { useLocation } from '@/hooks/useLocation';
import { useCollectionList, useSettings } from '@/hooks/useStore';
import { getHead } from '@/services/detection/detectionService';
import { clearAllHistory } from '@/services/scan/scanActions';
import { clearAllCaches } from '@/storage/cache';
import { scanImagesSizeBytes } from '@/storage/imageStore';
import { getDefaultStore } from '@/storage/kv';
import { getRepositories } from '@/storage/repositories';
import { formatBytes } from '@/utils/format';

const photoStorageBytes = (_scanCount: number): number | undefined => {
  try {
    return scanImagesSizeBytes();
  } catch {
    return undefined;
  }
};

const UNITS = [
  { value: 'imperial', label: 'Feet / miles' },
  { value: 'metric', label: 'Meters / km' },
] as const;

export const SettingsScreen = () => {
  const { settings, update } = useSettings();
  const [camera] = useCameraPermissions();
  const location = useLocation(false);
  const { items: scans } = useCollectionList(getRepositories().scans);
  const taps = useRef(0);

  // Re-measured whenever the number of saved scans changes.
  const storage = useMemo(() => photoStorageBytes(scans.length), [scans.length]);

  const cloudAvailable = Boolean(appConfig.remoteInferenceUrl);

  const confirmClear = () =>
    Alert.alert('Clear history?', 'All scans, photos and report drafts on this device will be permanently deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete everything',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await clearAllHistory();
            await clearAllCaches(getDefaultStore());
          })();
        },
      },
    ]);

  const onVersionTap = () => {
    taps.current += 1;
    if (taps.current >= 7) {
      taps.current = 0;
      void update({ developerMode: !settings.developerMode });
    }
  };

  const permLabel = (granted: boolean | undefined, blocked: boolean) => (granted ? 'Allowed' : blocked ? 'Blocked in system settings' : 'Not allowed');

  return (
    <Screen title="Settings">
      <Section title="Privacy">
        <Card>
          <Row
            icon="camera"
            label="Camera"
            value={permLabel(camera?.granted, camera ? !camera.canAskAgain : false)}
            onPress={() => void Linking.openSettings()}
            hint="Used only while the scanner is open."
          />
          <Divider />
          <Row
            icon="pin"
            label="Location"
            value={location.permission === 'granted' ? 'Allowed (while using the app)' : permLabel(false, location.permission === 'blocked')}
            onPress={() => (location.permission === 'denied' || location.permission === 'undetermined' ? void location.request() : void Linking.openSettings())}
            hint="Never used in the background."
          />
          <Divider />
          <ToggleRow
            label="Local-only mode"
            description="No image upload, no cloud AI. Address, jurisdiction and public-report lookups are also turned off, and reports stay on this device until you share them."
            value={settings.localOnlyMode}
            onChange={(v) => void update({ localOnlyMode: v, civicLookupsEnabled: v ? false : true, cloudAnalysisEnabled: v ? false : settings.cloudAnalysisEnabled })}
          />
          <Divider />
          <ToggleRow
            label="Cloud image analysis"
            description="If the on-device model can't run, send 256-pixel crops of a photo to the configured CivicLens server. Off by default."
            value={settings.cloudAnalysisEnabled}
            onChange={(v) => void update({ cloudAnalysisEnabled: v })}
            disabled={settings.localOnlyMode || !cloudAvailable}
            disabledReason={settings.localOnlyMode ? 'Unavailable in Local-only mode.' : !cloudAvailable ? 'No analysis server is configured in this build.' : undefined}
          />
          <Divider />
          <ToggleRow
            label="Civic data lookups"
            description="Sends the scan's coordinates (never the photo) to the US Census geocoder, OpenStreetMap and public 311 services to find the jurisdiction and existing reports."
            value={settings.civicLookupsEnabled && !settings.localOnlyMode}
            onChange={(v) => void update({ civicLookupsEnabled: v })}
            disabled={settings.localOnlyMode}
            disabledReason={settings.localOnlyMode ? 'Turn off Local-only mode to enable.' : undefined}
          />
        </Card>
        <Banner
          tone="info"
          icon="shield"
          title="What leaves your device"
          body={
            settings.localOnlyMode
              ? 'Nothing, except map tiles when you open the map. Analysis runs on your device.'
              : 'Photos never leave your device unless you share a report (or enable cloud analysis). Coordinates are sent to public civic data services only for lookups you can turn off above.'
          }
        />
      </Section>

      <Section title="Scanning">
        <Card>
          <ToggleRow
            label="Live analysis"
            description="Analyze the camera view about once a second before you tap Scan. Uses more battery."
            value={settings.liveAnalysisEnabled}
            onChange={(v) => void update({ liveAnalysisEnabled: v })}
          />
          <Divider />
          <ToggleRow
            label="Attach location to scans"
            description="Needed for jurisdiction lookup, duplicate checks and the map."
            value={settings.attachLocation}
            onChange={(v) => void update({ attachLocation: v })}
          />
          <Divider />
          <ToggleRow
            label="Reduce motion"
            description="Turns off scanning and lock-on animations (the system setting is always respected)."
            value={settings.reduceMotion === 'always'}
            onChange={(v) => void update({ reduceMotion: v ? 'always' : 'system' })}
          />
        </Card>
        <T variant="callout" tone="secondary">
          Distances
        </T>
        <Segmented options={UNITS} value={settings.units} onChange={(v) => void update({ units: v })} accessibilityLabel="Distance units" />
      </Section>

      <Section title="History">
        <Card>
          <Row icon="clock" label="Saved scans" value={`${scans.length}`} hint={storage !== undefined ? `${formatBytes(storage)} of photos on this device` : undefined} />
        </Card>
        <Button label="Clear history" icon="delete" variant="danger" onPress={confirmClear} disabled={scans.length === 0} />
      </Section>

      <Section title="Learn">
        <Card>
          <Row icon="flask" label="Demo Mode" value="Try CivicLens with sample photos" onPress={() => router.push('/demo')} />
          <Divider />
          <Row icon="shield" label="About & responsible AI" value="How CivicLens works and its limits" onPress={() => router.push('/about')} />
          <Divider />
          <Row icon="retry" label="Show introduction again" value="Replay onboarding" onPress={() => void update({ onboardingComplete: false }).then(() => router.replace('/onboarding'))} />
        </Card>
      </Section>

      {settings.developerMode ? (
        <Section title="Developer">
          <Card>
            <Row icon="bug" label="Debug panel" value="Model, latency, GPS, network, cache" onPress={() => router.push('/dev/debug')} />
            <Divider />
            <Row icon="target" label="Evaluation tool" value="Test the model on an image" onPress={() => router.push('/dev/evaluate')} />
          </Card>
        </Section>
      ) : null}

      <Pressable onPress={onVersionTap} accessibilityRole="text" accessibilityLabel={`CivicLens version ${appConfig.appVersion}`} style={styles.version}>
        <T variant="caption" tone="tertiary" align="center">
          CivicLens {appConfig.appVersion} · model {getHead().def.modelVersion} · head {getHead().def.version}
        </T>
        {settings.developerMode ? (
          <T variant="caption" tone="accent" align="center">
            Developer mode on
          </T>
        ) : null}
      </Pressable>
      <View style={{ height: space.lg, backgroundColor: colors.bg }} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  version: { paddingVertical: space.lg, gap: 2 },
});
