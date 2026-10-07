import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, tapFeedback } from '@/components/Button';
import { Banner } from '@/components/States';
import { ScanReticle } from '@/components/camera/ScanReticle';
import { Icon, type IconName } from '@/components/Icon';
import { LogoMark } from '@/components/Logo';
import { T } from '@/components/Typography';
import { CATEGORY_INFO } from '@/constants/categories';
import { colors, HIT_TARGET, hitSlop, radius, space } from '@/constants/theme';
import { useLiveAnalysis } from '@/hooks/useLiveAnalysis';
import { useLocation } from '@/hooks/useLocation';
import { useIsOffline } from '@/hooks/useNetwork';
import { useSettings } from '@/hooks/useStore';
import { UnsupportedImageError } from '@/ml/image/decode';
import { ModelUnavailableError } from '@/ml/runtime/types';
import type { DetectableCategory } from '@/models/issue';
import { DetectionService, type ModelStatus } from '@/services/detection/detectionService';
import { locationQualityMessage } from '@/services/location/locationQuality';
import { createScanFromPhoto } from '@/services/scan/scanService';
import { CONFIDENCE_LABEL, formatPercent } from '@/utils/format';
import { formatAccuracy } from '@/utils/geo';
import { geoFixFromExif } from '@/utils/exif';
import { readExifFromPhoto } from '@/utils/exifJpeg';
import { log } from '@/utils/logger';

type Phase = 'idle' | 'capturing' | 'analyzing';

interface ScanError {
  title: string;
  body: string;
  model?: boolean;
}

const describeScanError = (e: unknown): ScanError => {
  if (e instanceof ModelUnavailableError) {
    return {
      title: "On-device analysis isn't available",
      body: `${e.message} You can still try Demo Mode, or enable cloud analysis in Settings if your build has a server configured.`,
      model: true,
    };
  }
  if (e instanceof UnsupportedImageError) return { title: "This photo can't be analyzed", body: e.message };
  return { title: "Couldn't analyze the image", body: 'Something went wrong while analyzing. Hold steady and try again.' };
};

const useModelStatus = (): ModelStatus => {
  const [s, setS] = useState(DetectionService.getStatus());
  useEffect(() => DetectionService.subscribe(() => setS(DetectionService.getStatus())), []);
  return s;
};

const RoundButton = ({ icon, label, onPress, active }: { icon: IconName; label: string; onPress: () => void; active?: boolean }) => (
  <Pressable
    onPress={() => {
      tapFeedback();
      onPress();
    }}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={active === undefined ? undefined : { selected: active }}
    hitSlop={hitSlop}
    style={({ pressed }) => [styles.round, active && styles.roundActive, pressed && { opacity: 0.7 }]}
  >
    <Icon name={icon} size={22} color={active ? colors.textInverse : colors.white} />
  </Pressable>
);

export const CameraScreen = () => {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const { settings, loaded, update } = useSettings();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [focused, setFocused] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [frozenUri, setFrozenUri] = useState<string | undefined>();
  const [error, setError] = useState<ScanError | undefined>();
  const [mountError, setMountError] = useState<string | undefined>();
  const offline = useIsOffline();
  const model = useModelStatus();
  const location = useLocation(focused, settings.attachLocation);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  // Warm up the model while the user aims.
  useEffect(() => {
    if (loaded && permission?.granted) void DetectionService.ensureBackend(settings).catch(() => undefined);
  }, [loaded, permission?.granted, settings]);

  const live = useLiveAnalysis(cameraRef, {
    enabled: settings.liveAnalysisEnabled && model.state === 'ready',
    cameraReady,
    paused: !focused || phase !== 'idle' || Boolean(error),
    settings,
  });

  const runScan = useCallback(
    async (source: 'camera' | 'gallery') => {
      setError(undefined);
      try {
        let uri: string;
        let w: number | undefined;
        let h: number | undefined;
        let exifLocation;
        if (source === 'camera') {
          if (!cameraRef.current || !cameraReady) return;
          setPhase('capturing');
          const pic = await cameraRef.current.takePictureAsync({ quality: 0.92, exif: false });
          uri = pic.uri;
          w = pic.width;
          h = pic.height;
          setFrozenUri(pic.uri);
        } else {
          const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: true });
          if (res.canceled || !res.assets[0]) return;
          const a = res.assets[0];
          uri = a.uri;
          w = a.width;
          h = a.height;
          // Browsers' photo pickers return no EXIF, so the GPS position is read from the file itself.
          const exif = a.exif ?? (Platform.OS === 'web' ? await readExifFromPhoto(a.uri, a.file) : undefined);
          exifLocation = settings.attachLocation ? geoFixFromExif(exif, new Date().toISOString()) : undefined;
          setFrozenUri(a.uri);
        }
        setPhase('analyzing');
        const confirmed = live.state.status === 'confirmed' ? live.state.streak : undefined;
        const scan = await createScanFromPhoto({ uri, width: w, height: h, source, settings, framesConfirmed: confirmed, exifLocation });
        router.push({ pathname: '/result/[scanId]', params: { scanId: scan.id } });
      } catch (e) {
        log.error('Detection', 'scan failed', { error: e instanceof Error ? e.message : 'unknown' });
        setError(describeScanError(e));
      } finally {
        setPhase('idle');
        setFrozenUri(undefined);
      }
    },
    [cameraReady, live.state, settings],
  );

  const reticle = useMemo(() => {
    const w = Math.min(winW * 0.78, 380);
    return { width: w, height: Math.min(w * 1.05, winH * 0.45) };
  }, [winW, winH]);

  if (!loaded) return <View style={styles.root} />;
  if (!settings.onboardingComplete) return <Redirect href="/onboarding" />;

  if (!permission) return <View style={styles.root} />;
  if (!permission.granted) {
    const blocked = !permission.canAskAgain;
    return (
      <View style={[styles.root, styles.gate, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]}>
        <View style={styles.gateBody}>
          <View style={styles.gateIcon}>
            <Icon name="camera" size={34} />
          </View>
          <T variant="title" align="center" accessibilityRole="header">
            CivicLens needs your camera
          </T>
          <T variant="body" tone="secondary" align="center">
            Point your camera at a pothole, graffiti, or other problem and CivicLens analyzes it on your device. Photos stay on
            your device unless you choose to share a report.
          </T>
        </View>
        <View style={styles.gateActions}>
          {blocked ? (
            <Button label="Open Settings" icon="settings" size="lg" onPress={() => void Linking.openSettings()} />
          ) : (
            <Button label="Allow camera" icon="camera" size="lg" onPress={() => void requestPermission()} />
          )}
          {blocked ? (
            <T variant="caption" tone="tertiary" align="center">
              Camera access was turned off for CivicLens. Enable it in your {Platform.OS === 'web' ? 'browser’s site settings' : 'phone’s settings'}.
            </T>
          ) : null}
          {error ? (
            <Banner tone="critical" title={error.title} body={error.body}>
              {error.model ? <Button label="Demo Mode" icon="flask" variant="demo" onPress={() => router.push('/demo')} /> : null}
            </Banner>
          ) : null}
          <Button
            label={phase === 'analyzing' ? 'Analyzing your photo…' : 'Analyze a photo instead'}
            icon="gallery"
            variant="secondary"
            loading={phase !== 'idle'}
            onPress={() => void runScan('gallery')}
          />
          <Button label="Try Demo Mode" icon="flask" variant="ghost" onPress={() => router.push('/demo')} />
        </View>
      </View>
    );
  }

  const ls = live.state;
  const liveCategory = ls.category && ls.category in CATEGORY_INFO ? (ls.category as DetectableCategory) : undefined;
  let status: { text: string; tone: 'neutral' | 'caution' | 'accent' } = { text: 'Point at an issue', tone: 'neutral' };
  if (phase === 'analyzing' || phase === 'capturing') status = { text: 'Analyzing what you see…', tone: 'accent' };
  else if (model.state === 'loading') status = { text: 'Preparing on-device model…', tone: 'neutral' };
  else if (model.state === 'unavailable') status = { text: 'On-device analysis unavailable', tone: 'caution' };
  else if (!settings.liveAnalysisEnabled) status = { text: 'Point at an issue, then tap Scan', tone: 'neutral' };
  else if (ls.status === 'poor_quality') status = { text: "I can't get a reliable read yet", tone: 'caution' };
  else if (ls.status === 'candidate' && liveCategory) status = { text: `Possible ${CATEGORY_INFO[liveCategory].noun}…`, tone: 'caution' };
  else if (ls.status === 'confirmed' && liveCategory)
    status = { text: `${CATEGORY_INFO[liveCategory].label} · ${CONFIDENCE_LABEL[(ls.confidence ?? 0) >= 0.9 ? 'high' : 'moderate'].toLowerCase()}`, tone: 'accent' };

  const reticleMode =
    phase !== 'idle' ? 'analyzing' : ls.status === 'confirmed' ? 'locked' : ls.status === 'candidate' ? 'candidate' : 'searching';

  const locLabel =
    !settings.attachLocation
      ? 'Location off'
      : location.permission !== 'granted'
        ? 'Location'
        : location.fix
          ? formatAccuracy(location.fix.accuracy, settings.units)
          : 'Locating…';
  const locColor =
    location.quality === 'good' ? colors.positive : location.quality === 'fair' ? colors.caution : location.quality === 'poor' ? colors.critical : colors.textSecondary;

  const onLocationPress = async () => {
    if (!settings.attachLocation) {
      await update({ attachLocation: true });
      return;
    }
    if (location.permission === 'blocked') {
      void Linking.openSettings();
      return;
    }
    if (location.permission !== 'granted') {
      await location.request();
    }
  };

  return (
    <View style={styles.root}>
      {mountError ? (
        <View style={[StyleSheet.absoluteFill, styles.center, { padding: space.xl }]}>
          <T variant="headline" align="center">
            The camera couldn’t start
          </T>
          <T variant="callout" tone="secondary" align="center">
            {mountError}
          </T>
        </View>
      ) : (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          animateShutter={false}
          active={focused}
          responsiveOrientationWhenOrientationLocked
          onCameraReady={() => setCameraReady(true)}
          onMountError={(e) => setMountError(e.message)}
          accessible
          accessibilityLabel="Camera viewfinder"
        />
      )}
      {frozenUri ? <Image source={{ uri: frozenUri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: phase === 'analyzing' ? colors.scrimLight : 'transparent' }]} pointerEvents="none" />

      {/* Top bar */}
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.brand} accessible accessibilityRole="header" accessibilityLabel="CivicLens">
          <LogoMark size={24} color={colors.white} />
          <T variant="headline" style={styles.shadowText}>
            CivicLens
          </T>
        </View>
        <View style={styles.topActions}>
          <RoundButton icon="map" label="Map of nearby issues" onPress={() => router.push('/map')} />
          <RoundButton icon="clock" label="History and impact" onPress={() => router.push('/history')} />
        </View>
      </View>

      {/* Status */}
      <View style={[styles.statusWrap, { top: insets.top + 68 }]} pointerEvents="box-none">
        <View
          style={[styles.status, status.tone === 'caution' && { borderColor: colors.caution }, status.tone === 'accent' && { borderColor: colors.accent }]}
          accessible
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          accessibilityLabel={status.text}
        >
          {offline ? <Icon name="offline" size={14} color={colors.textSecondary} /> : null}
          <T variant="bodyMedium" numberOfLines={1} maxFontSizeMultiplier={1.4}>
            {status.text}
          </T>
        </View>
        {offline ? (
          <T variant="caption" tone="secondary" style={styles.shadowText}>
            Offline · analysis still runs on your device
          </T>
        ) : null}
      </View>

      {/* Reticle */}
      <View style={styles.center} pointerEvents="none">
        <ScanReticle mode={reticleMode} size={reticle} />
        {phase === 'idle' && ls.status === 'confirmed' && ls.confidence !== undefined ? (
          <View style={styles.liveChip} accessibilityElementsHidden>
            <T variant="caption" tone="accent">
              Model confidence {formatPercent(ls.confidence)} · consistent in {ls.streak} frames
            </T>
            <T variant="caption" tone="secondary">
              Tap Scan to review
            </T>
          </View>
        ) : null}
        {phase === 'idle' && ls.status === 'poor_quality' ? (
          <View style={styles.liveChip}>
            <T variant="caption" tone="secondary">
              Move closer, hold steady, and keep the issue centered.
            </T>
          </View>
        ) : null}
      </View>

      {/* Error card */}
      {error ? (
        <View style={[styles.errorCard, { bottom: insets.bottom + 150 }]} accessibilityRole="alert">
          <T variant="headline">{error.title}</T>
          <T variant="callout" tone="secondary">
            {error.body}
          </T>
          <View style={styles.errorActions}>
            <Button label="Try again" icon="retry" onPress={() => setError(undefined)} style={styles.flex} />
            {error.model ? <Button label="Demo Mode" icon="flask" variant="demo" onPress={() => router.push('/demo')} style={styles.flex} /> : null}
          </View>
        </View>
      ) : null}

      {/* Bottom controls */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        {settings.attachLocation && location.quality === 'poor' ? (
          <T variant="caption" tone="caution" align="center" style={styles.shadowText}>
            {locationQualityMessage('poor')}
          </T>
        ) : null}
        <View style={styles.controls}>
          <RoundButton icon="gallery" label="Analyze a photo from your library" onPress={() => void runScan('gallery')} />
          <RoundButton icon={torch ? 'flash' : 'flashOff'} label={torch ? 'Turn flashlight off' : 'Turn flashlight on'} active={torch} onPress={() => setTorch((t) => !t)} />
          <Pressable
            onPress={() => {
              tapFeedback();
              void runScan('camera');
            }}
            disabled={phase !== 'idle' || !cameraReady}
            accessibilityRole="button"
            accessibilityLabel="Scan"
            accessibilityHint="Takes a photo and analyzes it for infrastructure issues"
            accessibilityState={{ disabled: phase !== 'idle' || !cameraReady, busy: phase !== 'idle' }}
            style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.95 }] }, (phase !== 'idle' || !cameraReady) && { opacity: 0.6 }]}
          >
            <View style={styles.shutterInner}>
              <T variant="eyebrow" tone="inverse" maxFontSizeMultiplier={1.2}>
                {phase === 'idle' ? 'Scan' : '…'}
              </T>
            </View>
          </Pressable>
          <Pressable
            onPress={() => {
              tapFeedback();
              void onLocationPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Location: ${locLabel}`}
            accessibilityHint={location.permission !== 'granted' ? 'Allows CivicLens to use your location for jurisdiction lookup' : undefined}
            hitSlop={hitSlop}
            style={[styles.round, styles.locButton]}
          >
            <Icon name={location.permission === 'granted' && settings.attachLocation ? 'locate' : 'locateOff'} size={18} color={locColor} />
            <T variant="caption" style={{ color: colors.white }} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {locLabel}
            </T>
          </Pressable>
          <RoundButton icon="settings" label="Settings" onPress={() => router.push('/settings')} />
        </View>
        {location.permission !== 'granted' && location.permission !== 'unknown' && settings.attachLocation ? (
          <T variant="caption" tone="secondary" align="center" style={styles.shadowText}>
            Your location helps us find the right jurisdiction. Tap Location to allow.
          </T>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  flex: { flex: 1 },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: space.md },
  shadowText: { textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  top: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.lg },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  topActions: { flexDirection: 'row', gap: space.sm },
  statusWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: space.xs },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.scrim,
    borderWidth: 1,
    borderColor: 'transparent',
    maxWidth: '88%',
  },
  liveChip: { backgroundColor: colors.scrim, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, alignItems: 'center', gap: 2 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: space.sm, paddingTop: space.lg, backgroundColor: 'rgba(5,7,9,0.35)' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: space.md },
  round: { width: HIT_TARGET, height: HIT_TARGET, borderRadius: HIT_TARGET / 2, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center' },
  roundActive: { backgroundColor: colors.white },
  locButton: { width: 64, borderRadius: radius.md, gap: 1 },
  shutter: { width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  errorCard: { position: 'absolute', left: space.lg, right: space.lg, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm, borderWidth: 1, borderColor: colors.caution },
  errorActions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  gate: { justifyContent: 'space-between', paddingHorizontal: space.xl, backgroundColor: colors.bg },
  gateBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  gateIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  gateActions: { gap: space.sm },
});
