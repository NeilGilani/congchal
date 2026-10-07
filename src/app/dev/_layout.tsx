import { Redirect, Stack } from 'expo-router';

import { colors } from '@/constants/theme';
import { useSettings } from '@/hooks/useStore';

/** Developer tools are reachable only with developer mode on (Settings → tap the version 7 times). */
export default function DevLayout() {
  const { settings, loaded } = useSettings();
  if (loaded && !settings.developerMode) return <Redirect href="/settings" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }} />;
}
