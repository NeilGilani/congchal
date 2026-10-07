/**
 * Collision-resistant local ids. Uses crypto.getRandomValues when available
 * (Hermes + expo-crypto polyfill, Node, browsers) and falls back to
 * Math.random only if no CSPRNG exists. Ids are not security tokens.
 */
const randomBytes = (n: number): Uint8Array => {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(out);
  } else {
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
};

export const newId = (prefix: string): string => {
  const time = Date.now().toString(36);
  const rand = Array.from(randomBytes(8), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${time}${rand}`;
};
