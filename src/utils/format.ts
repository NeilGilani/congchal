import type { ConfidenceLevel, SeverityLevel } from '@/models/issue';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad = (n: number): string => n.toString().padStart(2, '0');

export const formatTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
};

/** "October 6, 2026" */
export const formatDateLong = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

/** "Oct 6, 2026 · 5:23 PM" */
export const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${formatTime(iso)}`;
};

export const formatRelative = (iso: string, now: Date = new Date()): string => {
  const d = new Date(iso);
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (!Number.isFinite(sec)) return '';
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  return formatDateLong(iso);
};

export const formatPercent = (p: number): string => `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: 'High confidence',
  moderate: 'Moderate confidence',
  low: 'Low confidence',
};

export const SEVERITY_LABEL: Record<SeverityLevel, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
};

export const formatMs = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
