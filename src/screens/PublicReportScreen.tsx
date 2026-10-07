import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { StatusBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Card, Divider, Row, Screen, Section } from '@/components/Layout';
import { ErrorState } from '@/components/States';
import { T } from '@/components/Typography';
import { CATEGORY_INFO } from '@/constants/categories';
import { colors, radius, space } from '@/constants/theme';
import { useSettings } from '@/hooks/useStore';
import type { PublicReport } from '@/models/civic';
import { findPublicReport } from '@/services/civic/publicReportRegistry';
import { LocationService } from '@/services/location/locationService';
import { distanceMeters, formatCoordinates, formatDistance } from '@/utils/geo';
import { formatDateTime } from '@/utils/format';
import { safeHttpUrl } from '@/utils/sanitize';

export const PublicReportScreen = ({ id }: { id: string }) => {
  const [report, setReport] = useState<PublicReport | undefined | null>(undefined);
  const { settings } = useSettings();
  useEffect(() => {
    void findPublicReport(id).then((r) => setReport(r ?? null));
  }, [id]);

  if (report === undefined) {
    return (
      <Screen title="Public report" scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.text} />
        </View>
      </Screen>
    );
  }
  if (report === null) {
    return (
      <Screen title="Public report">
        <ErrorState title="Report not loaded" body="Public reports are only kept while you browse. Open the map again to reload it." onRetry={() => router.replace('/map')} retryLabel="Open map" />
      </Screen>
    );
  }
  const here = LocationService.latestFix();
  const url = safeHttpUrl(report.url);
  return (
    <Screen title="Public report" subtitle={report.providerName}>
      {report.imageUrl ? <Image source={{ uri: report.imageUrl }} style={styles.photo} contentFit="cover" accessibilityLabel="Photo attached to the public report" /> : null}
      <Section>
        <T variant="eyebrow" tone="tertiary">
          {report.mappedCategory ? CATEGORY_INFO[report.mappedCategory].label : (report.rawCategory ?? 'Public report')}
        </T>
        <T variant="title">{report.title}</T>
        <StatusBadge status={report.status} />
      </Section>
      {report.description ? (
        <T variant="body" tone="secondary">
          {report.description}
        </T>
      ) : null}
      <Card>
        <Row icon="file" label="Source" value={report.providerName} hint="Official public data. CivicLens displays it as published." />
        <Divider />
        {report.createdAt ? (
          <>
            <Row icon="clock" label="Reported" value={formatDateTime(report.createdAt)} />
            <Divider />
          </>
        ) : null}
        <Row icon="pin" label="Location" value={report.address ?? formatCoordinates(report)} />
        {here ? (
          <>
            <Divider />
            <Row icon="route" label="Distance from you" value={formatDistance(distanceMeters(here, report), settings.units)} />
          </>
        ) : null}
        {report.rawStatus ? (
          <>
            <Divider />
            <Row icon="info" label="Status (as published)" value={report.rawStatus} />
          </>
        ) : null}
      </Card>
      {url ? <Button label="Open original report" icon="external" onPress={() => void WebBrowser.openBrowserAsync(url)} /> : null}
      <T variant="caption" tone="tertiary">
        Status reflects the source system at the time it was loaded and may have changed since.
      </T>
    </Screen>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: 220, borderRadius: radius.lg, backgroundColor: colors.surface, marginBottom: space.xs },
});
