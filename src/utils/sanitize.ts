const MAX_DESCRIPTION = 2000;

/**
 * Normalises user-entered text before it is stored or exported: strips
 * control characters (except newlines/tabs), collapses runaway whitespace and
 * enforces a length limit. HTML escaping happens separately at render time.
 */
export const sanitizeUserText = (input: string, maxLength = MAX_DESCRIPTION): string =>
  input
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]{3,}/g, '  ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, maxLength);

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

/** Only http(s) links may be opened or embedded. */
export const safeHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!/^https?:\/\/[^\s]+$/i.test(trimmed)) return undefined;
  return trimmed;
};
