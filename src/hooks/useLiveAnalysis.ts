import type { CameraView } from 'expo-camera';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { AppState, Platform } from 'react-native';

import { LiveFrameFusion, type LiveState } from '@/ml/temporal';
import type { UserSettings } from '@/models/settings';
import { DetectionService } from '@/services/detection/detectionService';
import { log } from '@/utils/logger';

export interface LiveAnalysis {
  state: LiveState;
  lastLatencyMs?: number;
  framesAnalyzed: number;
  /** Set when live analysis had to stop (e.g. model unavailable). */
  error?: string;
}

const MIN_INTERVAL_MS = 900;

/**
 * Continuous analysis ("Live Civic Vision"): grabs a low-quality still from
 * the preview about once a second, runs the 2-region pipeline, and fuses
 * results across frames (LiveFrameFusion). Pauses whenever the camera isn't
 * visible, the app is backgrounded, or a full scan is running.
 */
export const useLiveAnalysis = (
  cameraRef: RefObject<CameraView | null>,
  opts: { enabled: boolean; cameraReady: boolean; paused: boolean; settings: UserSettings },
): LiveAnalysis => {
  const [fusion] = useState(() => new LiveFrameFusion());
  const [result, setResult] = useState<LiveAnalysis>(() => ({ state: fusion.snapshot(), framesAnalyzed: 0 }));
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const settingsRef = useRef(opts.settings);
  useEffect(() => {
    settingsRef.current = opts.settings;
  }, [opts.settings]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  const running = opts.enabled && opts.cameraReady && !opts.paused && appActive;

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let frames = 0;
    const loop = async () => {
      while (!cancelled) {
        const started = Date.now();
        const cam = cameraRef.current;
        if (!cam) break;
        try {
          const pic = await cam.takePictureAsync({ quality: 0.4, shutterSound: false, exif: false });
          if (cancelled) break;
          const { analysis } = await DetectionService.analyzePhoto(pic.uri, pic.width, pic.height, settingsRef.current, 'live');
          if (Platform.OS !== 'web') {
            try {
              new File(pic.uri).delete();
            } catch {
              // temp files are also purged by the OS
            }
          }
          if (cancelled) break;
          const prev = fusion.snapshot().status;
          const next = fusion.push({
            at: Date.now(),
            probabilities: analysis.probabilities ?? {},
            qualityBlocked: analysis.outcome === 'rejected_quality',
          });
          if (next.status === 'confirmed' && prev !== 'confirmed' && Platform.OS !== 'web') {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
          }
          frames++;
          setResult({ state: next, lastLatencyMs: Date.now() - started, framesAnalyzed: frames });
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Live analysis stopped.';
          log.warn('Detection', 'live frame failed', { error: msg });
          if (e instanceof Error && e.name === 'ModelUnavailableError') {
            setResult((r) => ({ ...r, error: msg }));
            break;
          }
        }
        const wait = MIN_INTERVAL_MS - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
    };
    void loop();
    return () => {
      cancelled = true;
      // Paused or stopped: evidence from earlier frames must not carry over.
      fusion.reset();
      setResult((r) => ({ ...r, state: fusion.snapshot() }));
    };
  }, [running, cameraRef, fusion]);

  return result;
};
