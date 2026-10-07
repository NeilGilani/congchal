import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { DemoBadge, Pill } from '@/components/Badges';
import { Button } from '@/components/Button';
import { AddOnSiteLocation } from '@/components/CivicInfo';
import { CategoryPicker, Segmented } from '@/components/Controls';
import { EvidenceImage } from '@/components/EvidenceImage';
import { Card, Divider, Row, Screen, Section } from '@/components/Layout';
import { ErrorState } from '@/components/States';
import { T } from '@/components/Typography';
import { CATEGORY_INFO } from '@/constants/categories';
import { colors, radius, space, type as typeScale } from '@/constants/theme';
import { useReport, useScan, useSettings } from '@/hooks/useStore';
import type { SeverityLevel } from '@/models/issue';
import { photographedAt } from '@/models/scan';
import { checkReport, departmentFor, generateDescription, isReportReady, updateReport } from '@/services/report/reportService';
import { formatAccuracy, formatCoordinates } from '@/utils/geo';
import { CONFIDENCE_LABEL, formatDateTime, formatPercent } from '@/utils/format';

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
] as const;

export const ReportChecklist = ({ checks }: { checks: ReturnType<typeof checkReport> }) => {
  const ready = isReportReady(checks);
  return (
    <Card tone={ready ? 'default' : 'caution'}>
      <View style={styles.checkHeader}>
        <T variant="eyebrow" style={{ color: ready ? colors.positive : colors.caution }} accessibilityRole="header">
          {ready ? 'Report ready' : 'Not ready yet'}
        </T>
      </View>
      {checks.map((c) => (
        <View key={c.id} style={styles.checkRow} accessible accessibilityLabel={`${c.label}: ${c.passed ? 'done' : c.blocking ? 'required' : 'advisory'}${c.hint ? `. ${c.hint}` : ''}`}>
          <T variant="mono" style={{ color: c.passed ? colors.positive : c.blocking ? colors.critical : colors.caution, width: 22 }}>
            {c.passed ? '✓' : c.blocking ? '✕' : '!'}
          </T>
          <View style={styles.flex}>
            <T variant="callout">{c.label}</T>
            {c.hint && !c.passed ? (
              <T variant="caption" tone="secondary">
                {c.hint}
              </T>
            ) : c.hint && c.id === 'location' ? (
              <T variant="caption" tone="secondary">
                {c.hint}
              </T>
            ) : null}
          </View>
        </View>
      ))}
    </Card>
  );
};

export const ReportScreen = ({ reportId }: { reportId: string }) => {
  const { report, loading } = useReport(reportId);
  const { scan } = useScan(report?.scanId);
  const { settings } = useSettings();
  const [draft, setDraft] = useState<string | undefined>();
  const [picker, setPicker] = useState(false);

  // Department follows late-arriving jurisdiction info and category changes.
  useEffect(() => {
    if (!report || !scan) return;
    const dept = departmentFor(scan, report.category);
    const changed =
      dept.name !== report.department?.name ||
      dept.certainty !== report.department?.certainty ||
      scan.jurisdiction?.displayName !== report.jurisdiction?.displayName ||
      scan.address?.formatted !== report.address?.formatted ||
      (!report.location && Boolean(scan.location));
    if (changed) {
      void updateReport(report, {
        department: dept,
        jurisdiction: scan.jurisdiction,
        address: scan.address,
        location: report.location ?? scan.location,
      });
    }
  }, [report, scan]);

  const checks = useMemo(() => (report ? checkReport({ ...report, description: draft ?? report.description }) : []), [report, draft]);

  if (loading) {
    return (
      <Screen title="Report" scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.text} />
        </View>
      </Screen>
    );
  }
  if (!report) {
    return (
      <Screen title="Report">
        <ErrorState title="Report not found" body="It may have been deleted." onRetry={() => router.replace('/history')} retryLabel="Go to history" />
      </Screen>
    );
  }

  const saveDescription = async () => {
    if (draft !== undefined && draft !== report.description) await updateReport(report, { description: draft, descriptionEdited: true });
  };
  const ready = isReportReady(checks);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        title="Create report"
        subtitle={report.isDemo ? 'Demo Mode' : 'Edit anything before you share'}
        footer={
          <Button
            label="Review report"
            icon="clipboard"
            size="lg"
            disabled={!ready}
            accessibilityHint={ready ? undefined : 'Complete the required checklist items first'}
            onPress={async () => {
              await saveDescription();
              router.push({ pathname: '/report/review/[reportId]', params: { reportId: report.id } });
            }}
          />
        }
      >
        {report.isDemo ? <DemoBadge /> : null}
        {scan ? (
          <EvidenceImage
            uri={report.photoUri}
            width={scan.imageWidth}
            height={scan.imageHeight}
            box={scan.detections.find((d) => d.category === report.category)?.boundingBox}
            maxHeight={240}
            accessibilityLabel="Evidence photo for this report"
          />
        ) : null}

        <Section title="Issue">
          <Card>
            <Row
              icon={CATEGORY_INFO[report.category].icon}
              label="Issue type"
              value={CATEGORY_INFO[report.category].label}
              onPress={() => setPicker(true)}
              hint="Tap to change"
              accessibilityLabel={`Issue type: ${CATEGORY_INFO[report.category].label}. Tap to change.`}
            />
            <Divider />
            <Row
              icon="target"
              label="Detection confidence"
              value={
                report.detectionConfidence !== undefined && report.detectionConfidenceLevel
                  ? `${CONFIDENCE_LABEL[report.detectionConfidenceLevel]} · ${formatPercent(report.detectionConfidence)}`
                  : 'Chosen by you (not detected)'
              }
            />
          </Card>
        </Section>

        <Section title="Description">
          <TextInput
            value={draft ?? report.description}
            onChangeText={setDraft}
            onBlur={() => void saveDescription()}
            multiline
            placeholder="Describe the issue and exactly where it is."
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            accessibilityLabel="Report description"
            accessibilityHint="Automatically drafted from the photo analysis. Edit it freely."
            maxLength={2000}
            textAlignVertical="top"
          />
          <View style={styles.inline}>
            <T variant="caption" tone="tertiary" style={styles.flex}>
              {report.descriptionEdited ? 'Edited by you.' : 'Drafted from what CivicLens saw. Please check it.'}
            </T>
            {scan ? (
              <Button
                label="Regenerate"
                variant="ghost"
                icon="retry"
                onPress={() => {
                  const d = generateDescription(scan, report.category);
                  setDraft(d);
                  void updateReport(report, { description: d, descriptionEdited: false });
                }}
              />
            ) : null}
          </View>
        </Section>

        <Section title="Estimated severity">
          <Segmented
            options={SEVERITY_OPTIONS}
            value={report.severity}
            onChange={(v: SeverityLevel) => void updateReport(report, { severity: v, severityOverridden: true })}
            accessibilityLabel="Severity"
          />
          <T variant="caption" tone="tertiary">
            {report.severityOverridden ? 'Set by you.' : 'Automated estimate from the photo. Adjust it if you know better.'}
          </T>
        </Section>

        <Section title="Location">
          <Card>
            <Row icon="pin" label="Address" value={report.address?.formatted ?? 'Not available'} />
            {report.location ? (
              <>
                <Divider />
                <Row
                  icon="crosshair"
                  label="Coordinates"
                  value={`${formatCoordinates(report.location)} (${formatAccuracy(report.location.accuracy, settings.units)})`}
                  mono
                />
              </>
            ) : null}
            <Divider />
            <Row icon="clock" label="Photographed" value={formatDateTime(scan ? photographedAt(scan) : report.createdAt)} />
            {scan && !report.location ? <AddOnSiteLocation scan={scan} /> : null}
          </Card>
        </Section>

        <Section title="Where it goes">
          <Card>
            <Row
              icon="building"
              label={report.department?.certainty === 'confirmed' ? 'Department' : 'Likely department'}
              value={report.department?.name ?? 'Unknown'}
              hint={report.department?.basis}
            />
            {report.jurisdiction ? (
              <>
                <Divider />
                <Row icon="landmark" label="Jurisdiction" value={report.jurisdiction.displayName} />
              </>
            ) : null}
          </Card>
          {report.department?.certainty !== 'confirmed' ? (
            <View style={styles.inline}>
              <Pill label="Departments vary by city" fg={colors.textSecondary} bg={colors.neutralMuted} icon="info" />
            </View>
          ) : null}
        </Section>

        <Section title="Checklist">
          <ReportChecklist checks={checks} />
        </Section>

        <CategoryPicker
          visible={picker}
          selected={report.category}
          suggested={scan?.detections.map((d) => d.category)}
          onClose={() => setPicker(false)}
          onSelect={(c) => {
            setPicker(false);
            const det = scan?.detections.find((d) => d.category === c);
            void updateReport(report, {
              category: c,
              detectionConfidence: det?.confidence,
              detectionConfidenceLevel: det?.confidenceLevel,
              severity: report.severityOverridden ? report.severity : det?.severity?.level,
              department: scan ? departmentFor(scan, c) : report.department,
            });
          }}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  input: {
    ...typeScale.body,
    color: colors.text,
    minHeight: 140,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  checkHeader: { paddingHorizontal: space.lg, paddingTop: space.md },
  checkRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, alignItems: 'flex-start' },
});
