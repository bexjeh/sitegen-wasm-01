// Front matter: an exact port of vendor/makefun-site/lib/frontmatter.js.

import { codeAt, isDigit, jsTrim, parseDigits, splitChar, trimEndST } from './util';

/** One source's parsed front matter (plus its body), or an error string. */
export class FrontMatter {
  title: string = '';
  hasTitle: bool = false;
  date: string = '';
  hasDate: bool = false;
  tags: Array<string> = new Array<string>();
  hasTags: bool = false;
  draft: bool = false;
  hasDraft: bool = false;
  layout: string = '';
  hasLayout: bool = false;
  slug: string = '';
  hasSlug: bool = false;
  summary: string = '';
  hasSummary: bool = false;
  body: string = '';
  error: string = '';
}

function daysIn(y: i32, m: i32): i32 {
  if (m == 2) return ((y % 4 == 0 && y % 100 != 0) || y % 400 == 0) ? 29 : 28;
  return m == 4 || m == 6 || m == 9 || m == 11 ? 30 : 31;
}

function isKeyChar(c: i32): bool {
  return (c >= 97 && c <= 122) || c == 95; // [a-z_]
}

function isNameChar(c: i32): bool {
  return (c >= 97 && c <= 122) || isDigit(c) || c == 45; // [a-z0-9-]
}

/** /^[a-z0-9]+(?:-[a-z0-9]+)*$/ and at most 64 chars. */
function isSlug(raw: string): bool {
  if (raw.length == 0 || raw.length > 64) return false;
  // First and last are [a-z0-9]; every '-' is followed by [a-z0-9].
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c == 45) {
      if (i == 0 || i == raw.length - 1) return false;
      const n = raw.charCodeAt(i + 1);
      if (!((n >= 97 && n <= 122) || isDigit(n))) return false;
    } else if (!((c >= 97 && c <= 122) || isDigit(c))) return false;
  }
  return true;
}

/** A quoted or bare string value; the error is the bare reason (no `key "...": ` prefix). */
function stringOf(raw: string, out: FrontMatter, which: i32): string {
  // which: 0 = title, 1 = summary. Returns '' on success, the error reason otherwise.
  if (raw.charCodeAt(0) == 34) {
    // '"'
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) != 34) return 'a quoted string is not closed';
    let value = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw.charCodeAt(i);
      if (c == 92) {
        // '\\'
        const n = codeAt(raw, i + 1);
        if ((n != 34 && n != 92) || i + 1 == raw.length - 1) return 'a quoted string holds an escape other than \\" or \\\\';
        value += String.fromCharCode(n);
        i++;
      } else if (c == 34) {
        return 'a quoted string holds a stray quote';
      } else {
        value += raw.slice(i, i + 1);
      }
    }
    if (which == 0) out.title = value;
    else out.summary = value;
    return '';
  }
  if (raw.charCodeAt(0) == 91) return 'a bare string opens on ['; // '['
  if (which == 0) out.title = raw;
  else out.summary = raw;
  return '';
}

/** Parse one key's value into `out`; returns '' on success, the full error reason otherwise. */
function valueOf(key: string, raw: string, out: FrontMatter): string {
  if (key == 'title' || key == 'summary') {
    const err = stringOf(raw, out, key == 'title' ? 0 : 1);
    return err == '' ? '' : `key "${key}": ${err}`;
  }
  if (key == 'date') {
    let ok = raw.length == 10;
    if (ok) {
      for (let i = 0; i < 10; i++) {
        const c = raw.charCodeAt(i);
        if (i == 4 || i == 7) {
          if (c != 45) { ok = false; break; }
        } else if (!isDigit(c)) {
          ok = false;
          break;
        }
      }
    }
    let y = 0;
    let mo = 0;
    let d = 0;
    if (ok) {
      y = parseDigits(raw.slice(0, 4));
      mo = parseDigits(raw.slice(5, 7));
      d = parseDigits(raw.slice(8, 10));
      if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) ok = false;
    }
    if (!ok) return 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)';
    out.date = raw;
    return '';
  }
  if (key == 'tags') {
    if (raw.charCodeAt(0) != 91 || raw.charCodeAt(raw.length - 1) != 93) return 'key "tags": not a list [a, b]';
    const inner = raw.slice(1, raw.length - 1);
    if (jsTrim(inner) == '') {
      out.tags = new Array<string>();
      return '';
    }
    const parts = splitChar(inner, 44); // ','
    const tags = new Array<string>();
    for (let i = 0; i < parts.length; i++) {
      const t = jsTrim(parts[i]);
      if (t == '') return 'key "tags": an empty tag, or one holding " [ or ]';
      for (let j = 0; j < t.length; j++) {
        const c = t.charCodeAt(j);
        if (c == 34 || c == 91 || c == 93) return 'key "tags": an empty tag, or one holding " [ or ]';
      }
      tags.push(t);
    }
    out.tags = tags;
    return '';
  }
  if (key == 'draft') {
    if (raw == 'true') {
      out.draft = true;
      return '';
    }
    if (raw == 'false') {
      out.draft = false;
      return '';
    }
    return 'key "draft": true or false';
  }
  if (key == 'layout') {
    if (raw.length == 0) return 'key "layout": not a template name';
    for (let i = 0; i < raw.length; i++) {
      if (!isNameChar(raw.charCodeAt(i))) return 'key "layout": not a template name';
    }
    out.layout = raw;
    return '';
  }
  if (key == 'slug') {
    if (!isSlug(raw)) return 'key "slug": not a slug';
    out.slug = raw;
    return '';
  }
  return `unknown key "${key}"`;
}

function isKnownKey(key: string): bool {
  return key == 'title' || key == 'date' || key == 'tags' || key == 'draft' || key == 'layout' || key == 'slug' || key == 'summary';
}

function hasKey(out: FrontMatter, key: string): bool {
  if (key == 'title') return out.hasTitle;
  if (key == 'date') return out.hasDate;
  if (key == 'tags') return out.hasTags;
  if (key == 'draft') return out.hasDraft;
  if (key == 'layout') return out.hasLayout;
  if (key == 'slug') return out.hasSlug;
  return out.hasSummary;
}

function markKey(out: FrontMatter, key: string): void {
  if (key == 'title') out.hasTitle = true;
  else if (key == 'date') out.hasDate = true;
  else if (key == 'tags') out.hasTags = true;
  else if (key == 'draft') out.hasDraft = true;
  else if (key == 'layout') out.hasLayout = true;
  else if (key == 'slug') out.hasSlug = true;
  else out.hasSummary = true;
}

/** Parse a source's front matter and body. `out.error` is '' on success. */
export function parseFrontMatter(text: string): FrontMatter {
  const out = new FrontMatter();
  // Line 0 must be '---'.
  let nl = text.indexOf('\n');
  const firstEnd = nl == -1 ? text.length : nl;
  if (text.slice(0, firstEnd) != '---') {
    out.error = 'no front matter';
    return out;
  }
  if (nl == -1) {
    out.error = 'the front matter is not closed';
    return out;
  }
  // Collect the front-matter lines (few) and find the closing '---' line,
  // without splitting the whole body into lines.
  const fmLines = new Array<string>();
  let pos = nl + 1;
  let close = -1;
  let bodyStart = text.length;
  let i = 1; // the 0-based index of the line starting at `pos`
  for (;;) {
    nl = text.indexOf('\n', pos);
    const lineEnd = nl == -1 ? text.length : nl;
    const line = text.slice(pos, lineEnd);
    if (line == '---') {
      close = i;
      bodyStart = nl == -1 ? text.length : nl + 1;
      break;
    }
    fmLines.push(line);
    if (nl == -1) break;
    pos = nl + 1;
    i++;
  }
  if (close == -1) {
    out.error = 'the front matter is not closed';
    return out;
  }
  for (let j = 0; j < fmLines.length; j++) {
    const line = fmLines[j];
    const lineNo = j + 2; // the line's 1-based number (line 0 was '---')
    // Blank (spaces/tabs only) or a comment ('#' first).
    let blank = true;
    for (let k = 0; k < line.length; k++) {
      const c = line.charCodeAt(k);
      if (c != 32 && c != 9) {
        blank = false;
        break;
      }
    }
    if (blank || line.charCodeAt(0) == 35) continue;
    // LINE: ^([a-z_]+):(?: (.*))?$
    let k = 0;
    while (k < line.length && isKeyChar(line.charCodeAt(k))) k++;
    if (k == 0 || codeAt(line, k) != 58) {
      out.error = `line ${lineNo} is not "key: value"`;
      return out;
    }
    const key = line.slice(0, k);
    let raw: string;
    if (k + 1 == line.length) raw = '';
    else if (line.charCodeAt(k + 1) == 32) raw = line.slice(k + 2);
    else {
      out.error = `line ${lineNo} is not "key: value"`;
      return out;
    }
    raw = trimEndST(raw);
    if (!isKnownKey(key)) {
      out.error = `unknown key "${key}"`;
      return out;
    }
    if (hasKey(out, key)) {
      out.error = `key "${key}" is given twice`;
      return out;
    }
    if (raw == '') {
      out.error = `key "${key}" has no value`;
      return out;
    }
    const err = valueOf(key, raw, out);
    if (err != '') {
      out.error = err;
      return out;
    }
    markKey(out, key);
  }
  if (!out.hasTitle) {
    out.error = 'no title';
    return out;
  }
  out.body = text.slice(bodyStart);
  return out;
}
