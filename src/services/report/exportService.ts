import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as MailComposer from 'expo-mail-composer';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';

import type { Report } from '@/models/report';
import { readImageBase64 } from '@/storage/imageStore';
import { log } from '@/utils/logger';
import { safeHttpUrl } from '@/utils/sanitize';

import { emailSubject, renderReportHtml, renderReportText } from './reportFormat';
import { recordExport } from './reportService';

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

const photoDataUri = async (uri: string): Promise<string | undefined> => {
  try {
    return `data:image/jpeg;base64,${await readImageBase64(uri)}`;
  } catch {
    return undefined;
  }
};

/** Renders the report to a PDF in the cache directory and returns its URI. */
export const createReportPdf = async (report: Report, units: 'imperial' | 'metric'): Promise<string> => {
  const started = Date.now();
  const html = renderReportHtml(report, units, await photoDataUri(report.photoUri));
  const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792, margins: { left: 24, right: 24, top: 24, bottom: 24 } });
  // Give the file a human-readable name for share sheets and email.
  const named = new File(Paths.cache, `CivicLens-${report.category}-${report.createdAt.slice(0, 10)}.pdf`);
  try {
    if (named.exists) named.delete();
    new File(uri).moveSync(named);
    log.info('Export', 'pdf', { latency: Date.now() - started });
    return named.uri;
  } catch {
    return uri;
  }
};

export const sharePdf = async (report: Report, units: 'imperial' | 'metric'): Promise<void> => {
  if (!(await Sharing.isAvailableAsync())) throw new ExportError('Sharing is not available on this device.');
  const pdf = await createReportPdf(report, units);
  await Sharing.shareAsync(pdf, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Share CivicLens report' });
  await recordExport(report, 'share');
};

export const savePdf = async (report: Report, units: 'imperial' | 'metric'): Promise<string> => {
  const pdf = await createReportPdf(report, units);
  if (await Sharing.isAvailableAsync()) {
    // On iOS "Save to Files" and on Android "Save" / Drive live in the share sheet.
    await Sharing.shareAsync(pdf, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Save report PDF' });
  }
  await recordExport(report, 'pdf');
  return pdf;
};

export const copyReport = async (report: Report, units: 'imperial' | 'metric'): Promise<void> => {
  await Clipboard.setStringAsync(renderReportText(report, units));
  await recordExport(report, 'copy');
};

export const emailReport = async (report: Report, units: 'imperial' | 'metric'): Promise<'sent' | 'saved' | 'cancelled' | 'unavailable'> => {
  if (!(await MailComposer.isAvailableAsync())) return 'unavailable';
  const pdf = await createReportPdf(report, units);
  const result = await MailComposer.composeAsync({
    subject: emailSubject(report),
    body: renderReportText(report, units),
    attachments: [pdf],
  });
  if (result.status === MailComposer.MailComposerStatus.SENT || result.status === MailComposer.MailComposerStatus.SAVED) {
    await recordExport(report, 'email');
  }
  return result.status === MailComposer.MailComposerStatus.SENT
    ? 'sent'
    : result.status === MailComposer.MailComposerStatus.SAVED
      ? 'saved'
      : 'cancelled';
};

/** Opens the jurisdiction's official reporting page. CivicLens never submits on the user's behalf. */
export const openOfficialChannel = async (report: Report): Promise<boolean> => {
  const url = safeHttpUrl(report.department?.reportingUrl);
  if (!url) return false;
  await WebBrowser.openBrowserAsync(url);
  await recordExport(report, 'official_link');
  return true;
};
