// Text helpers: an exact port of vendor/makefun-site/lib/text.js.

import { isWS, parseDigits, splitChar, StrBuf } from './util';
import { NFKD_DATA } from './nfkd';

/** NFKD expansion lookup, built once from the generated table. */
const NFKD = new Map<i32, string>();
let nfkdReady = false;

function initNfkd(): void {
  if (nfkdReady) return;
  const lines = splitChar(NFKD_DATA, 10);
  for (let i = 0; i < lines.length; i++) {
    const e = lines[i];
    const sep = e.indexOf('\u0001');
    NFKD.set(parseDigits(e.slice(0, sep)), e.slice(sep + 1));
  }
  nfkdReady = true;
}

/** JS `escapeHtml`: & < > " ' only. */
export function escapeHtml(s: string): string {
  let out: StrBuf | null = null;
  let runStart = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep: string | null = null;
    if (c == 38) rep = '&amp;';
    else if (c == 60) rep = '&lt;';
    else if (c == 62) rep = '&gt;';
    else if (c == 34) rep = '&quot;';
    else if (c == 39) rep = '&#39;';
    if (rep !== null) {
      if (out === null) out = new StrBuf();
      if (i > runStart) out.add(s.slice(runStart, i));
      out.add(rep);
      runStart = i + 1;
    }
  }
  if (out === null) return s;
  if (s.length > runStart) out.add(s.slice(runStart));
  return out.toString();
}

/** The keep/gap state machine of slugify, one ASCII char at a time. */
class SlugState {
  out: StrBuf = new StrBuf();
  gap: bool = false;

  emit(c0: i32): void {
    let c = c0;
    if (c >= 65 && c <= 90) c += 32; // A-Z -> a-z
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) {
      if (this.gap && this.out.len > 0) this.out.addChar(45); // '-'
      this.gap = false;
      this.out.addChar(c);
    } else {
      this.gap = true;
    }
  }
}

/**
 * JS `slugify`, with NFKD done through the generated table instead of
 * String.normalize (AssemblyScript has none). The reference algorithm:
 * NFKD -> drop \p{M} -> lowercase A-Z -> runs of non-[a-z0-9] become one '-',
 * none at the ends -> cut to 64 chars, dropping a trailing '-' -> 'untitled' if empty.
 */
export function slugify(input: string): string {
  initNfkd();
  const st = new SlugState();
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 128) {
      st.emit(c);
      continue;
    }
    if (NFKD.has(c)) {
      const exp = NFKD.get(c);
      for (let j = 0; j < exp.length; j++) {
        const e = exp.charCodeAt(j);
        // Table expansions are fully decomposed; any non-ASCII inside one is a gap.
        if (e < 128) st.emit(e);
        else st.gap = true;
      }
      continue;
    }
    st.gap = true; // no decomposition: a gap
  }
  let s = st.out.toString();
  if (s.length > 64) {
    s = s.slice(0, 64);
    if (s.charCodeAt(s.length - 1) == 45) s = s.slice(0, s.length - 1);
  }
  return s.length == 0 ? 'untitled' : s;
}

/** JS `uniqueSlug`: `s`, `s-2`, `s-3`, ... against a Set of taken slugs. */
export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let n = 2;
  for (;;) {
    const cand = base + '-' + n.toString();
    if (!taken.has(cand)) {
      taken.add(cand);
      return cand;
    }
    n++;
  }
  return base; // unreachable
}

const MONTHS: Array<string> = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** JS `longDate`: '2026-11-09' -> '9 November 2026' (the year stays a string). */
export function longDate(iso: string): string {
  const m = parseDigits(iso.slice(5, 7));
  const d = parseDigits(iso.slice(8, 10));
  return d.toString() + ' ' + MONTHS[m - 1] + ' ' + iso.slice(0, 4);
}

/** JS `wordsOf`: the count of runs of non-whitespace. */
export function wordsOf(text: string): i32 {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    if (isWS(text.charCodeAt(i))) inWord = false;
    else if (!inWord) {
      inWord = true;
      n++;
    }
  }
  return n;
}
