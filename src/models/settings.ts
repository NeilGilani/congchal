export interface UserSettings {
  onboardingComplete: boolean;
  /** No network use for images; inference on device only; reports stay local. */
  localOnlyMode: boolean;
  /** Allows sending a compressed photo to the configured remote inference server. */
  cloudAnalysisEnabled: boolean;
  /** Allows jurisdiction / public-report / map-tile lookups with coordinates. */
  civicLookupsEnabled: boolean;
  /** Continuous analysis while the camera is open. */
  liveAnalysisEnabled: boolean;
  /** Attach GPS position to scans. */
  attachLocation: boolean;
  units: 'imperial' | 'metric';
  reduceMotion: 'system' | 'always';
  developerMode: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  onboardingComplete: false,
  localOnlyMode: false,
  cloudAnalysisEnabled: false,
  civicLookupsEnabled: true,
  liveAnalysisEnabled: true,
  attachLocation: true,
  units: 'imperial',
  reduceMotion: 'system',
  developerMode: false,
};
