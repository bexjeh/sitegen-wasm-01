// Shared helpers: exact JS string semantics in AssemblyScript.
// Every helper here mirrors one JavaScript operation the reference relies on.

/** Code unit at `i`, or -1 past either end (JS's `s[i]` is undefined there, never equal to any char). */
export function codeAt(s: string, i: i32): i32 {
  return i >= 0 && i < s.length ? s.charCodeAt(i) : -1;
}

/** Whether `c` is JS whitespace (RegExp \s / String trim set). */
export function isWS(c: i32): bool {
  return (
    c == 0x09 || c == 0x0a || c == 0x0b || c == 0x0c || c == 0x0d || c == 0x20 ||
    c == 0xa0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200a) || c == 0x2028 || c == 0x2029 ||
    c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff
  );
}

/** Whether `c` is an ASCII digit. */
export function isDigit(c: i32): bool {
  return c >= 48 && c <= 57;
}

/** Whether `c` is a-z, A-Z or 0-9. */
export function isAlnum(c: i32): bool {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/** JS `s.split(sep)` for a one-code-unit separator (exact, including empty pieces). */
export function splitChar(s: string, sep: i32): Array<string> {
  const out = new Array<string>();
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) == sep) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** JS `s.split('\n')`. */
export function splitLines(s: string): Array<string> {
  return splitChar(s, 10);
}

/** JS `String.prototype.trim` (the \s set at both ends). */
export function jsTrim(s: string): string {
  if (s.length == 0) return s;
  const first = s.charCodeAt(0);
  const last = s.charCodeAt(s.length - 1);
  if (!isWS(first) && !isWS(last)) return s;
  let a = 0;
  let b = s.length;
  while (a < b && isWS(s.charCodeAt(a))) a++;
  while (b > a && isWS(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}

/** Drop spaces and tabs at both ends (markdown's trimLine). */
export function trimST(s: string): string {
  if (s.length == 0) return s;
  const first = s.charCodeAt(0);
  const last = s.charCodeAt(s.length - 1);
  if (first != 32 && first != 9 && last != 32 && last != 9) return s;
  let a = 0;
  let b = s.length;
  while (a < b && (s.charCodeAt(a) == 32 || s.charCodeAt(a) == 9)) a++;
  while (b > a && (s.charCodeAt(b - 1) == 32 || s.charCodeAt(b - 1) == 9)) b--;
  return s.slice(a, b);
}

/** Drop trailing spaces and tabs (front matter's value trim). */
export function trimEndST(s: string): string {
  if (s.length == 0) return s;
  const last = s.charCodeAt(s.length - 1);
  if (last != 32 && last != 9) return s;
  let b = s.length;
  while (b > 0 && (s.charCodeAt(b - 1) == 32 || s.charCodeAt(b - 1) == 9)) b--;
  return s.slice(0, b);
}

/** JS `s.lastIndexOf('\n', from)`: the last '\n' at or before `from`, or -1. */
export function lastNlBefore(s: string, from: i32): i32 {
  let i = from < s.length - 1 ? from : s.length - 1;
  for (; i >= 0; i--) if (s.charCodeAt(i) == 10) return i;
  return -1;
}

/** JS `s.indexOf('\n', from)`. */
export function indexOfNl(s: string, from: i32): i32 {
  for (let i = from; i < s.length; i++) if (s.charCodeAt(i) == 10) return i;
  return -1;
}

/** Parse an all-digit string as an integer (no sign, no whitespace). */
export function parseDigits(s: string): i32 {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 10 + (s.charCodeAt(i) - 48);
  return n;
}

/** A chunked string builder: avoids the quadratic cost of repeated `+=`. */
export class StrBuf {
  parts: Array<string> = new Array<string>();
  len: i32 = 0;

  add(s: string): void {
    if (s.length == 0) return;
    this.parts.push(s);
    this.len += s.length;
  }

  addChar(c: i32): void {
    this.parts.push(String.fromCharCode(c));
    this.len++;
  }

  toString(): string {
    return this.parts.join('');
  }
}

/** Compare two strings in JS code-unit order (-1, 0, 1). */
export function cmpStr(a: string, b: string): i32 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
