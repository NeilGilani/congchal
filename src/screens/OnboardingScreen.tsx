import { useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { LogoMark } from '@/components/Logo';
import { T } from '@/components/Typography';
import { colors, radius, space } from '@/constants/theme';
import { useLocation } from '@/hooks/useLocation';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useSettings } from '@/hooks/useStore';
import { getHead } from '@/services/detection/detectionService';
import { CATEGORY_INFO } from '@/constants/categories';
import type { IssueCategory } from '@/models/issue';

interface Step {
  eyebrow: string;
  title: string;
  body: string;
  points: { icon: IconName; text: string }[];
}

const detectable = (): string =>
  getHead()
    .classes.filter((c): c is Exclude<typeof c, 'none'> => c !== 'none')
    .map((c) => CATEGORY_INFO[c as IssueCategory].label.toLowerCase())
    .join(', ');

const STEPS: Step[] = [
  {
    eyebrow: 'SEE IT',
    title: 'Point your camera at a problem',
    body: 'CivicLens looks at the scene on your phone and tells you what it thinks it sees, and how sure it is.',
    points: [
      { icon: 'camera', text: `It is trained on: ${detectable()}.` },
      { icon: 'phoneDevice', text: 'Analysis runs on your phone. Photos are not uploaded.' },
      { icon: 'help', text: 'When it isn’t sure, it says so instead of guessing.' },
    ],
  },
  {
    eyebrow: 'UNDERSTAND IT',
    title: 'Know where it is and who handles it',
    body: 'With your location, CivicLens finds the city or county responsible and checks whether the problem was already reported.',
    points: [
      { icon: 'landmark', text: 'Jurisdiction comes from the US Census geocoder.' },
      { icon: 'search', text: 'Nearby reports come from public 311 data, where a city publishes it.' },
      { icon: 'info', text: 'Every result explains what it’s based on and what it does not mean.' },
    ],
  },
  {
    eyebrow: 'ACT ON IT',
    title: 'Write a clear report, then send it yourself',
    body: 'CivicLens drafts a structured report you can edit. You review it and choose how to share it.',
    points: [
      { icon: 'edit', text: 'You confirm the issue type. The AI only suggests.' },
      { icon: 'share', text: 'Export a PDF, copy, email, or open the city’s official 311 page.' },
      { icon: 'lock', text: 'CivicLens never submits anything to a government agency for you.' },
    ],
  },
];

export const OnboardingScreen = () => {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { update } = useSettings();
  const [step, setStep] = useState(0);
  const [camera, requestCamera] = useCameraPermissions();
  const location = useLocation(false);
  const total = STEPS.length + 1;
  const onPermissions = step === STEPS.length;
  const current = STEPS[step];

  const finish = async (to: '/' | '/demo') => {
    await update({ onboardingComplete: true });
    router.replace(to);
  };

  const enter = reduceMotion ? undefined : FadeIn.duration(260);
  const exit = reduceMotion ? undefined : FadeOut.duration(120);

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
      <View style={styles.top}>
        <View style={styles.brand}>
          <LogoMark size={28} />
          <T variant="headline">CivicLens</T>
        </View>
        {!onPermissions ? <Button label="Skip" variant="ghost" onPress={() => setStep(STEPS.length)} accessibilityHint="Go to the permissions step" /> : null}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Animated.View key={step} entering={enter} exiting={exit} style={styles.page}>
          {current ? (
            <>
              <T variant="eyebrow" tone="accent" accessibilityRole="header">
                {current.eyebrow}
              </T>
              <T variant="display">{current.title}</T>
              <T variant="body" tone="secondary">
                {current.body}
              </T>
              <View style={styles.points}>
                {current.points.map((p) => (
                  <View key={p.text} style={styles.point} accessible accessibilityLabel={p.text}>
                    <View style={styles.pointIcon}>
                      <Icon name={p.icon} size={18} color={colors.accent} />
                    </View>
                    <T variant="callout" style={styles.flex}>
                      {p.text}
                    </T>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <>
              <T variant="eyebrow" tone="accent" accessibilityRole="header">
                BEFORE YOU START
              </T>
              <T variant="display">Two permissions, used only while you scan</T>
              <View style={styles.points}>
                <View style={styles.permission}>
                  <View style={styles.point}>
                    <View style={styles.pointIcon}>
                      <Icon name="camera" size={18} color={colors.accent} />
                    </View>
                    <View style={styles.flex}>
                      <T variant="bodyMedium">Camera</T>
                      <T variant="callout" tone="secondary">
                        To see the problem. Frames are analyzed on your phone and are not saved unless you tap Scan.
                      </T>
                    </View>
                  </View>
                  {camera?.granted ? (
                    <T variant="caption" tone="positive">
                      Allowed
                    </T>
                  ) : (
                    <Button label="Allow camera" variant="secondary" onPress={() => void requestCamera()} />
                  )}
                </View>
                <View style={styles.permission}>
                  <View style={styles.point}>
                    <View style={styles.pointIcon}>
                      <Icon name="pin" size={18} color={colors.accent} />
                    </View>
                    <View style={styles.flex}>
                      <T variant="bodyMedium">Location (optional)</T>
                      <T variant="callout" tone="secondary">
                        To find the responsible jurisdiction and nearby reports. Only while the app is open, never in the background.
                      </T>
                    </View>
                  </View>
                  {location.permission === 'granted' ? (
                    <T variant="caption" tone="positive">
                      Allowed
                    </T>
                  ) : (
                    <Button label="Allow location" variant="secondary" onPress={() => void location.request()} />
                  )}
                </View>
              </View>
              <T variant="caption" tone="tertiary">
                You can change both anytime in Settings, and turn on Local-only mode to keep everything on your device.
              </T>
            </>
          )}
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots} accessible accessibilityLabel={`Step ${step + 1} of ${total}`}>
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
          ))}
        </View>
        {onPermissions ? (
          <>
            <Button label="Start scanning" icon="camera" size="lg" onPress={() => void finish('/')} />
            <Button label="Try Demo Mode first" icon="flask" variant="demo" onPress={() => void finish('/demo')} />
          </>
        ) : (
          <View style={styles.row}>
            {step > 0 ? <Button label="Back" variant="secondary" onPress={() => setStep(step - 1)} style={styles.flex} /> : null}
            <Button label="Next" icon="chevron" onPress={() => setStep(step + 1)} style={styles.flex} />
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.xl },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  content: { flexGrow: 1, justifyContent: 'center', paddingVertical: space.xl },
  page: { gap: space.lg },
  points: { gap: space.md, marginTop: space.sm },
  point: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  pointIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permission: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  flex: { flex: 1 },
  footer: { gap: space.md },
  row: { flexDirection: 'row', gap: space.md },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, paddingVertical: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { width: 24, backgroundColor: colors.accent },
});
