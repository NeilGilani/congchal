import { escapeHtml, safeHttpUrl, sanitizeUserText } from '@/utils/sanitize';

describe('sanitizeUserText', () => {
  it('strips control characters but keeps newlines and tabs', () => {
    expect(sanitizeUserText('Pot\u0000hole\u0007 near\tthe\ncurb\u001B\u007F')).toBe('Pothole near\tthe\ncurb');
  });

  it('strips invisible formatting and bidi override characters', () => {
    // U+202E (right-to-left override) can make text display differently from what is stored.
    expect(sanitizeUserText('Main​ St‮ ⁦near⁩ ‏park')).toBe('Main St near park');
  });

  it('normalises line endings and runaway whitespace', () => {
    expect(sanitizeUserText('a\r\nb\rc')).toBe('a\nb\nc');
    expect(sanitizeUserText('wide      gap')).toBe('wide  gap');
    expect(sanitizeUserText('two  spaces stay')).toBe('two  spaces stay');
    expect(sanitizeUserText('a\n\n\n\n\n\nb')).toBe('a\n\n\nb');
  });

  it('trims and composes to NFC', () => {
    const decomposed = '  San José  ';
    expect(sanitizeUserText(decomposed)).toBe('San José');
  });

  it('enforces the length limit (2000 by default)', () => {
    expect(sanitizeUserText('x'.repeat(2500))).toHaveLength(2000);
    expect(sanitizeUserText('abcdef', 3)).toBe('abc');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>Tom & Jerry</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;',
    );
  });

  it('escapes an existing entity again rather than trusting it', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('San José 311 · Pothole')).toBe('San José 311 · Pothole');
  });
});

describe('safeHttpUrl', () => {
  it.each([
    ['https://seeclickfix.com/issues/123', 'https://seeclickfix.com/issues/123'],
    ['  http://311.dc.gov/  ', 'http://311.dc.gov/'],
    ['HTTPS://PORTAL.311.NYC.GOV/', 'HTTPS://PORTAL.311.NYC.GOV/'],
  ])('accepts %s', (input, expected) => {
    expect(safeHttpUrl(input)).toBe(expected);
  });

  it.each([['javascript:alert(1)'], ['data:text/html,<script>1</script>'], ['ftp://example.com/x'], ['https://exa mple.com'], ['//example.com'], ['']])(
    'rejects %s',
    (input) => {
      expect(safeHttpUrl(input)).toBeUndefined();
    },
  );

  it('rejects non-strings', () => {
    expect(safeHttpUrl(undefined)).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
    expect(safeHttpUrl(42)).toBeUndefined();
  });
});
