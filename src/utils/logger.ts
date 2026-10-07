/**
 * Structured development logging.
 *
 *   [Detection] category=pothole confidence=0.82 latency=184ms
 *
 * Coordinates, addresses and free text are never logged; callers pass only
 * metrics. Logs are kept in a small ring buffer for the debug panel and are
 * printed to the console only in development builds.
 */
export type LogScope =
  | 'Detection'
  | 'Quality'
  | 'Location'
  | 'Jurisdiction'
  | 'CivicData'
  | 'Map'
  | 'Storage'
  | 'Export'
  | 'Network'
  | 'Model'
  | 'Sync';

export interface LogEntry {
  at: number;
  scope: LogScope;
  level: 'info' | 'warn' | 'error';
  message: string;
  fields: Record<string, string | number | boolean>;
}

const MAX_ENTRIES = 200;
const entries: LogEntry[] = [];
const listeners = new Set<() => void>();

const isDev = (): boolean => (globalThis as { __DEV__?: boolean }).__DEV__ === true;

const format = (e: LogEntry): string => {
  const fields = Object.entries(e.fields)
    .map(([k, v]) => `${k}=${typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(3) : String(v)}`)
    .join(' ');
  return `[${e.scope}] ${e.message}${fields ? ` ${fields}` : ''}`;
};

const write = (
  level: LogEntry['level'],
  scope: LogScope,
  message: string,
  fields: LogEntry['fields'] = {},
): void => {
  const entry: LogEntry = { at: Date.now(), scope, level, message, fields };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  listeners.forEach((l) => l());
  if (isDev()) {
    const line = format(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
};

export const log = {
  info: (scope: LogScope, message: string, fields?: LogEntry['fields']) => write('info', scope, message, fields),
  warn: (scope: LogScope, message: string, fields?: LogEntry['fields']) => write('warn', scope, message, fields),
  error: (scope: LogScope, message: string, fields?: LogEntry['fields']) => write('error', scope, message, fields),
};

export const getLogEntries = (): readonly LogEntry[] => entries;
export const formatLogEntry = format;
export const subscribeToLogs = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
