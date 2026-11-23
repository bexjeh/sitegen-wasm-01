// Markdown: an exact port of vendor/makefun-site/lib/markdown.js.

import { codeAt, isDigit, isWS, splitLines, StrBuf, trimST } from './util';
import { escapeHtml, slugify, uniqueSlug } from './text';

export const T_HEADING = 0;
export const T_CODE = 1;
export const T_HR = 2;
export const T_QUOTE = 3;
export const T_LIST = 4;
export const T_PARA = 5;

/** One block token. */
export class MdToken {
  type: i32 = T_PARA;
  depth: i32 = 0;
  text: string = '';
  lang: string = '';
  lines: Array<string> | null = null;
  ordered: bool = false;
  start: i32 = 1;
  items: Array<string> | null = null;
}

/** One table-of-contents entry: a level 2 or 3 heading. */
export class TocEntry {
  level: i32 = 0;
  id: string = '';
  html: string = '';
}

/** renderMarkdown's result. */
export class MdResult {
  html: string = '';
  toc: Array<TocEntry> = new Array<TocEntry>();
  excerpt: string = '';
}

/** A link target's href, resolved per source (implemented by the build). */
export class LinkEnv {
  resolve(target: string): string {
    return target;
  }
}

/** Whether a line is blank: spaces and tabs only. */
function isBlank(line: string): bool {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c != 32 && c != 9) return false;
  }
  return true;
}

/** Whether `c` may follow a fence's backticks in its language. */
function isLangChar(c: i32): bool {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || isDigit(c) || c == 95 || c == 43 || c == 45;
}

/**
 * A fence-open line's language, or null: /^```([A-Za-z0-9_+-]*)[ \t]*$/.
 * Returns '' for a bare ``` line.
 */
function fenceOpen(line: string): string | null {
  if (line.length < 3 || line.charCodeAt(0) != 96 || line.charCodeAt(1) != 96 || line.charCodeAt(2) != 96) return null;
  let i = 3;
  while (i < line.length && isLangChar(line.charCodeAt(i))) i++;
  const lang = line.slice(3, i);
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c != 32 && c != 9) return null;
    i++;
  }
  return lang;
}

/** A fence-close line: /^```[ \t]*$/. */
function fenceClose(line: string): bool {
  if (line.length < 3 || line.charCodeAt(0) != 96 || line.charCodeAt(1) != 96 || line.charCodeAt(2) != 96) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c != 32 && c != 9) return false;
  }
  return true;
}

/** A heading line's depth and text, or null: /^(#{1,6})[ \t]+(.*?)[ \t]*$/, text never empty. */
function headingOf(line: string): MdToken | null {
  let hashes = 0;
  while (hashes < line.length && line.charCodeAt(hashes) == 35) hashes++;
  if (hashes == 0 || hashes > 6) return null;
  let i = hashes;
  let spaces = 0;
  while (i < line.length && (line.charCodeAt(i) == 32 || line.charCodeAt(i) == 9)) {
    i++;
    spaces++;
  }
  if (spaces == 0) return null;
  let end = line.length;
  while (end > i && (line.charCodeAt(end - 1) == 32 || line.charCodeAt(end - 1) == 9)) end--;
  if (end == i) return null;
  const t = new MdToken();
  t.type = T_HEADING;
  t.depth = hashes;
  t.text = line.slice(i, end);
  return t;
}

/** A thematic break: /^(?:---|\*\*\*)[ \t]*$/. */
function isHr(line: string): bool {
  if (line.length < 3) return false;
  const a = line.charCodeAt(0);
  const b = line.charCodeAt(1);
  const c = line.charCodeAt(2);
  if (!((a == 45 && b == 45 && c == 45) || (a == 42 && b == 42 && c == 42))) return false;
  for (let i = 3; i < line.length; i++) {
    const d = line.charCodeAt(i);
    if (d != 32 && d != 9) return false;
  }
  return true;
}

/** Whether `line` ends a paragraph: blank, a fence, a heading or a thematic break. */
function endsParagraph(line: string): bool {
  return isBlank(line) || fenceOpen(line) !== null || headingOf(line) !== null || isHr(line);
}

/** A bullet line's item text, or null: /^[-*] (.*)$/. */
function bulletOf(line: string): string | null {
  if (line.length < 2) return null;
  const c = line.charCodeAt(0);
  if ((c != 45 && c != 42) || line.charCodeAt(1) != 32) return null;
  return line.slice(2);
}

/** An ordered-list line's number and item text, or null: /^(\d{1,9})\. (.*)$/. */
function orderedOf(line: string): MdToken | null {
  let i = 0;
  while (i < line.length && isDigit(line.charCodeAt(i))) i++;
  if (i == 0 || i > 9) return null;
  if (codeAt(line, i) != 46 || codeAt(line, i + 1) != 32) return null;
  const t = new MdToken();
  t.start = 0;
  for (let j = 0; j < i; j++) t.start = t.start * 10 + (line.charCodeAt(j) - 48);
  t.text = line.slice(i + 2);
  return t;
}

/** A list continuation line: /^ {2,}\S/ (two or more spaces, then a non-whitespace char). */
function isContinued(line: string): bool {
  let i = 0;
  while (i < line.length && line.charCodeAt(i) == 32) i++;
  if (i < 2 || i >= line.length) return false;
  return !isWS(line.charCodeAt(i));
}

/** `src`'s block tokens, in order. */
export function lex(src: string): Array<MdToken> {
  const lines = splitLines(src);
  const tokens = new Array<MdToken>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = fenceOpen(line);
    if (fence !== null) {
      const body = new Array<string>();
      i++;
      while (i < lines.length && !fenceClose(lines[i])) body.push(lines[i++]);
      i++;
      const t = new MdToken();
      t.type = T_CODE;
      t.lang = fence;
      t.lines = body;
      tokens.push(t);
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      tokens.push(heading);
      i++;
      continue;
    }
    if (isHr(line)) {
      const t = new MdToken();
      t.type = T_HR;
      tokens.push(t);
      i++;
      continue;
    }
    if (line.length > 0 && line.charCodeAt(0) == 62) {
      // '>'
      const body = new Array<string>();
      while (i < lines.length && lines[i].length > 0 && lines[i].charCodeAt(0) == 62) {
        const l = lines[i++];
        body.push(l.length > 1 && l.charCodeAt(1) == 32 ? l.slice(2) : l.slice(1));
      }
      const kept = new Array<string>();
      for (let k = 0; k < body.length; k++) {
        const tl = trimST(body[k]);
        if (tl != '') kept.push(tl);
      }
      const t = new MdToken();
      t.type = T_QUOTE;
      t.lines = kept;
      tokens.push(t);
      continue;
    }
    const bullet = bulletOf(line);
    const ordered = bullet === null ? orderedOf(line) : null;
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const items = new Array<Array<string>>();
      let start = 1;
      while (i < lines.length) {
        if (isOrdered) {
          const m = orderedOf(lines[i]);
          if (m !== null) {
            if (items.length == 0) start = m.start;
            const parts = new Array<string>();
            parts.push(trimST(m.text));
            items.push(parts);
            i++;
            continue;
          }
        } else {
          const m = bulletOf(lines[i]);
          if (m !== null) {
            const parts = new Array<string>();
            parts.push(trimST(m));
            items.push(parts);
            i++;
            continue;
          }
        }
        if (isContinued(lines[i])) {
          items[items.length - 1].push(trimST(lines[i]));
          i++;
        } else break;
      }
      const t = new MdToken();
      t.type = T_LIST;
      t.ordered = isOrdered;
      t.start = start;
      const itemTexts = new Array<string>();
      for (let k = 0; k < items.length; k++) itemTexts.push(items[k].join('\n'));
      t.items = itemTexts;
      tokens.push(t);
      continue;
    }
    const body = new Array<string>();
    body.push(trimST(line));
    i++;
    while (i < lines.length && !endsParagraph(lines[i])) body.push(trimST(lines[i++]));
    const t = new MdToken();
    t.type = T_PARA;
    t.text = body.join('\n');
    tokens.push(t);
  }
  return tokens;
}

/** The characters a backslash escapes: \ ` * _ [ ] ( ) # + - . ! > */
function isEscapable(c: i32): bool {
  return c == 92 || c == 96 || c == 42 || c == 95 || c == 91 || c == 93 || c == 40 || c == 41 || c == 35 || c == 43 || c == 45 || c == 46 || c == 33 || c == 62;
}

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s: string, what: string, from: i32): i32 {
  const wlen = what.length;
  for (let j = from; j <= s.length - wlen; j++) {
    if (s.charCodeAt(j) == 92 && j + 1 < s.length && isEscapable(s.charCodeAt(j + 1))) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s: string, from: i32): i32 {
  for (let j = from; j < s.length; j++) {
    const c = s.charCodeAt(j);
    if (c == 92 && j + 1 < s.length && isEscapable(s.charCodeAt(j + 1))) {
      j++;
      continue;
    }
    if (c != 42) continue;
    if (codeAt(s, j + 1) == 42) {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/** Whether `s` holds any whitespace. */
function hasWS(s: string): bool {
  for (let i = 0; i < s.length; i++) if (isWS(s.charCodeAt(i))) return true;
  return false;
}

/** Append one code unit HTML-escaped (& < > " ') to `out`. */
function addEscapedChar(out: StrBuf, c: i32): void {
  if (c == 38) out.add('&amp;');
  else if (c == 60) out.add('&lt;');
  else if (c == 62) out.add('&gt;');
  else if (c == 34) out.add('&quot;');
  else if (c == 39) out.add('&#39;');
  else out.addChar(c);
}

/** `s` rendered inline, appended to `out`; `env.resolve(target)` is a link's href. */
export function inlineInto(s: string, env: LinkEnv, out: StrBuf): void {
  let i = 0;
  let runStart = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    // Runs of plain text (no markdown-syntax char) go through escapeHtml whole.
    if (c != 92 && c != 96 && c != 42 && c != 91) {
      i++;
      continue;
    }
    if (i > runStart) out.add(escapeHtml(s.slice(runStart, i)));
    if (c == 92) {
      // '\': an escape when the next char is escapable, else a literal backslash
      if (i + 1 < s.length && isEscapable(s.charCodeAt(i + 1))) {
        addEscapedChar(out, s.charCodeAt(i + 1));
        i += 2;
      } else {
        out.addChar(92);
        i++;
      }
      runStart = i;
      continue;
    }
    if (c == 96) {
      // '`'
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        out.add('<code>');
        out.add(escapeHtml(s.slice(i + 1, j)));
        out.add('</code>');
        i = j + 1;
      } else {
        out.addChar(96);
        i++;
      }
      runStart = i;
      continue;
    }
    if (c == 42) {
      // '*'
      if (codeAt(s, i + 1) == 42) {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          out.add('<strong>');
          inlineInto(s.slice(i + 2, j), env, out);
          out.add('</strong>');
          i = j + 2;
        } else {
          out.add('**');
          i += 2;
        }
      } else {
        const j = findSingleStar(s, i + 1);
        if (j > i + 1) {
          out.add('<em>');
          inlineInto(s.slice(i + 1, j), env, out);
          out.add('</em>');
          i = j + 1;
        } else {
          out.addChar(42);
          i++;
        }
      }
      runStart = i;
      continue;
    }
    // '['
    const k = findUnescaped(s, ']', i + 1);
    const m = k != -1 && codeAt(s, k + 1) == 40 ? s.indexOf(')', k + 2) : -1;
    const target = m == -1 ? '' : s.slice(k + 2, m);
    if (target != '' && !hasWS(target)) {
      out.add('<a href="');
      out.add(escapeHtml(env.resolve(target)));
      out.add('">');
      inlineInto(s.slice(i + 1, k), env, out);
      out.add('</a>');
      i = m + 1;
    } else {
      out.addChar(91);
      i++;
    }
    runStart = i;
  }
  if (s.length > runStart) out.add(escapeHtml(s.slice(runStart)));
}

/** `s` rendered inline, as a string. */
export function inline(s: string, env: LinkEnv): string {
  const out = new StrBuf();
  inlineInto(s, env, out);
  return out.toString();
}

/** `src` rendered: its HTML, its table of contents and its excerpt. */
export function renderMarkdown(src: string, env: LinkEnv): MdResult {
  const ids = new Set<string>();
  const res = new MdResult();
  const out = new StrBuf();
  let excerpt: string | null = null;
  const tokens = lex(src);
  for (let ti = 0; ti < tokens.length; ti++) {
    const t = tokens[ti];
    if (t.type == T_HEADING) {
      const id = uniqueSlug(slugify(t.text), ids);
      const html = inline(t.text, env);
      out.add('<h');
      out.add(t.depth.toString());
      out.add(' id="');
      out.add(id);
      out.add('">');
      out.add(html);
      out.add('</h');
      out.add(t.depth.toString());
      out.add('>\n');
      if (t.depth == 2 || t.depth == 3) {
        const e = new TocEntry();
        e.level = t.depth;
        e.id = id;
        e.html = html;
        res.toc.push(e);
      }
    } else if (t.type == T_CODE) {
      const lines = t.lines as Array<string>;
      out.add('<pre><code');
      if (t.lang != '') {
        out.add(' class="language-');
        out.add(escapeHtml(t.lang));
        out.add('"');
      }
      out.add('>');
      for (let k = 0; k < lines.length; k++) {
        out.add(escapeHtml(lines[k]));
        out.addChar(10);
      }
      out.add('</code></pre>\n');
    } else if (t.type == T_HR) {
      out.add('<hr>\n');
    } else if (t.type == T_QUOTE) {
      const lines = t.lines as Array<string>;
      if (lines.length == 0) out.add('<blockquote>\n</blockquote>\n');
      else {
        out.add('<blockquote>\n<p>');
        inlineInto(lines.join('\n'), env, out);
        out.add('</p>\n</blockquote>\n');
      }
    } else if (t.type == T_LIST) {
      const tag = t.ordered ? 'ol' : 'ul';
      if (t.ordered && t.start != 1) {
        out.add('<ol start="');
        out.add(t.start.toString());
        out.add('">\n');
      } else {
        out.add('<');
        out.add(tag);
        out.add('>\n');
      }
      const items = t.items as Array<string>;
      for (let k = 0; k < items.length; k++) {
        out.add('<li>');
        inlineInto(items[k], env, out);
        out.add('</li>\n');
      }
      out.add('</');
      out.add(tag);
      out.add('>\n');
    } else {
      const html = inline(t.text, env);
      if (excerpt === null) excerpt = html;
      out.add('<p>');
      out.add(html);
      out.add('</p>\n');
    }
  }
  res.html = out.toString();
  res.excerpt = excerpt === null ? '' : excerpt;
  return res;
}
