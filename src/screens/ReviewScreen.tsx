import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { DemoBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Controls';
import { EvidenceImage } from '@/components/EvidenceImage';
import { Card, Screen, Section } from '@/components/Layout';
import { Banner, ErrorState } from '@/components/States';
import { T } from '@/components/Typography';
import { CATEGORY_INFO } from '@/constants/categories';
import { colors, space } from '@/constants/theme';
import { useReport, useScan, useSettings } from '@/hooks/useStore';
import { copyReport, emailReport, openOfficialChannel, savePdf, sharePdf } from '@/services/report/exportService';
import { REPORT_DISCLAIMER, reportFields } from '@/services/report/reportFormat';
import { checkReport, isReportReady, updateReport } from '@/services/report/reportService';
import { formatRelative } from '@/utils/format';

import { ReportChecklist } from './ReportScreen';

type Action = 'share' | 'pdf' | 'copy' | 'email' | 'official';

export const ReviewScreen = ({ reportId }: { reportId: string }) => {
  const { report, loading } = useReport(reportId);
  const { scan } = useScan(report?.scanId);
  const { settings } = useSettings();
  const [busy, setBusy] = useState<Action | undefined>();
  const [notice, setNotice] = useState<{ tone: 'positive' | 'caution'; text: string } | undefined>();

  if (loading) {
    return (
      <Screen title="Review" scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.text} />
        </View>
      </Screen>
    );
  }
  if (!report) {
    return (
      <Screen title="Review">
        <ErrorState title="Report not found" body="It may have been deleted." onRetry={() => router.replace('/history')} retryLabel="Go to history" />
      </Screen>
    );
  }

  const checks = checkReport(report);
  const ready = isReportReady(checks);
  const units = settings.units;

  const run = async (action: Action) => {
    setBusy(action);
    setNotice(undefined);
    try {
      switch (action) {
        case 'share':
          await sharePdf(report, units);
          setNotice({ tone: 'positive', text: 'Report PDF ready to share.' });
          break;
        case 'pdf':
          await savePdf(report, units);
          setNotice({ tone: 'positive', text: 'PDF created. Choose where to save it.' });
          break;
        case 'copy':
          await copyReport(report, units);
          setNotice({ tone: 'positive', text: 'Report text copied. Paste it into the official form.' });
          break;
        case 'email': {
          const r = await emailReport(report, units);
          setNotice(
            r === 'unavailable'
              ? { tone: 'caution', text: 'No email app is set up on this device. Use Share instead.' }
              : r === 'cancelled'
                ? { tone: 'caution', text: 'Email cancelled.' }
                : { tone: 'positive', text: r === 'sent' ? 'Email sent from your mail app.' : 'Email saved as a draft.' },
          );
          break;
        }
        case 'official': {
          const opened = await openOfficialChannel(report);
          if (!opened) setNotice({ tone: 'caution', text: 'No official reporting link is known for this location.' });
          break;
        }
      }
    } catch (e) {
      setNotice({ tone: 'caution', text: e instanceof Error ? e.message : 'Export failed. Try again.' });
    } finally {
      setBusy(undefined);
    }
  };

  const reviewed = report.userReviewedDetection;
  const canExport = ready && reviewed;

  return (
    <Screen title="Review before you report" subtitle={CATEGORY_INFO[report.category].label}>
      {report.isDemo ? <DemoBadge /> : null}
      <Banner
        tone="info"
        icon="shield"
        title="CivicLens never submits reports for you"
        body="You choose how to send it: share the PDF, paste the text into the official form, or email it."
      />

      {scan ? (
        <EvidenceImage uri={report.photoUri} width={scan.imageWidth} height={scan.imageHeight} maxHeight={260} accessibilityLabel="Evidence photo included in the report" />
      ) : null}

      <Section title="Civiclens report">
        <Card>
          <View style={styles.doc}>
            {reportFields(report, units).map((f) => (
              <View key={f.label} style={styles.field} accessible accessibilityLabel={`${f.label}: ${f.value}`}>
                <T variant="caption" tone="tertiary" style={styles.fieldLabel}>
                  {f.label}
                </T>
                <T variant="callout" style={styles.flex} selectable>
                  {f.value}
                </T>
              </View>
            ))}
            <View style={styles.descBlock}>
              <T variant="caption" tone="tertiary">
                Description
              </T>
              <T variant="body" selectable>
                {report.description}
              </T>
            </View>
            <T variant="caption" tone="caution">
              {REPORT_DISCLAIMER}
            </T>
          </View>
        </Card>
        <Button label="Edit report" icon="edit" variant="ghost" onPress={() => router.back()} />
      </Section>

      <Section title="Checklist">
        <ReportChecklist checks={checks} />
        <Checkbox
          checked={reviewed}
          onChange={(v) => void updateReport(report, { userReviewedDetection: v })}
          label="I reviewed the photo and these details, and they are accurate to my knowledge."
        />
      </Section>

      {notice ? <Banner tone={notice.tone === 'positive' ? 'positive' : 'caution'} title={notice.text} /> : null}

      <Section title="Share or submit">
        {!canExport ? (
          <T variant="callout" tone="caution">
            Complete the checklist and confirm your review to export.
          </T>
        ) : null}
        <Button label="Share report (PDF)" icon="share" size="lg" disabled={!canExport} loading={busy === 'share'} onPress={() => void run('share')} />
        <View style={styles.row}>
          <Button label="Save PDF" icon="download" variant="secondary" disabled={!canExport} loading={busy === 'pdf'} onPress={() => void run('pdf')} style={styles.flex} />
          <Button label="Copy text" icon="copy" variant="secondary" disabled={!canExport} loading={busy === 'copy'} onPress={() => void run('copy')} style={styles.flex} />
        </View>
        <Button label="Email report" icon="mail" variant="secondary" disabled={!canExport} loading={busy === 'email'} onPress={() => void run('email')} />
        {report.department?.reportingUrl ? (
          <Button
            label={report.department.reportingLabel ?? 'Open official reporting page'}
            icon="external"
            variant="secondary"
            disabled={!canExport}
            loading={busy === 'official'}
            onPress={() => void run('official')}
            accessibilityHint="Opens the official site in a browser. Paste or attach your report there."
          />
        ) : null}
        {report.exports.length ? (
          <T variant="caption" tone="tertiary">
            Last exported {formatRelative(report.exports[report.exports.length - 1]?.at ?? report.updatedAt)} via{' '}
            {report.exports[report.exports.length - 1]?.channel.replace('_', ' ')}.
          </T>
        ) : null}
      </Section>
      <Button label="Done" variant="ghost" onPress={() => router.dismissAll()} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.sm },
  doc: { padding: space.lg, gap: space.sm },
  field: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  fieldLabel: { width: 112, paddingTop: 2 },
  descBlock: { gap: space.xs, marginTop: space.sm, marginBottom: space.sm },
});
