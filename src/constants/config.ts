/**
 * Build-time configuration. `EXPO_PUBLIC_*` variables are inlined into the
 * bundle by Expo, so nothing secret may live here. See `.env.example`.
 */
const env = (name: string): string | undefined => {
  // Expo only inlines literal `process.env.EXPO_PUBLIC_*` accesses, so each is spelled out.
  const values: Record<string, string | undefined> = {
    EXPO_PUBLIC_MAP_STYLE_URL: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
    EXPO_PUBLIC_REMOTE_INFERENCE_URL: process.env.EXPO_PUBLIC_REMOTE_INFERENCE_URL,
    EXPO_PUBLIC_OSM_CONTACT: process.env.EXPO_PUBLIC_OSM_CONTACT,
    EXPO_PUBLIC_SOCRATA_APP_TOKEN: process.env.EXPO_PUBLIC_SOCRATA_APP_TOKEN,
  };
  const v = values[name]?.trim();
  return v ? v : undefined;
};

const APP_VERSION = '1.0.0';

export const appConfig = {
  appVersion: APP_VERSION,
  /** OpenFreeMap: free, keyless vector tiles built from OpenStreetMap. */
  mapStyleUrl: env('EXPO_PUBLIC_MAP_STYLE_URL') ?? 'https://tiles.openfreemap.org/styles/dark',
  remoteInferenceUrl: env('EXPO_PUBLIC_REMOTE_INFERENCE_URL'),
  socrataAppToken: env('EXPO_PUBLIC_SOCRATA_APP_TOKEN'),
  userAgent: `CivicLens/${APP_VERSION} (${env('EXPO_PUBLIC_OSM_CONTACT') ?? 'https://github.com/NeilGilani/congchal'})`,
} as const;
