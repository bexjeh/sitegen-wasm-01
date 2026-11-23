// JSON parsing (from a decoded string) and stringifying (JSON.stringify's rules).
// The input is always valid JSON from the harness; the parser assumes so but never
// reads past the string's end.

import { codeAt, isDigit, StrBuf } from './util';

export const J_NULL = 0;
export const J_BOOL = 1;
export const J_NUM = 2;
export const J_STR = 3;
export const J_ARR = 4;
export const J_OBJ = 5;

/** One JSON value. Objects keep insertion order (parallel keys/vals arrays). */
export class JVal {
  kind: i32 = J_NULL;
  b: bool = false;
  n: f64 = 0;
  s: string = '';
  arr: Array<JVal> | null = null;
  keys: Array<string> | null = null;
  vals: Array<JVal> | null = null;

  /** The member `key` of an object, or null. */
  get(key: string): JVal | null {
    const keys = this.keys;
    const vals = this.vals;
    if (keys === null || vals === null) return null;
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] == key) return vals[i];
    }
    return null;
  }
}

/** A JSON parser over one string. */
export class JParser {
  s: string;
  i: i32 = 0;

  constructor(s: string) {
    this.s = s;
  }

  parse(): JVal {
    this.ws();
    const v = this.value();
    return v;
  }

  ws(): void {
    while (this.i < this.s.length) {
      const c = this.s.charCodeAt(this.i);
      if (c == 32 || c == 9 || c == 10 || c == 13) this.i++;
      else break;
    }
  }

  value(): JVal {
    const c = this.s.charCodeAt(this.i);
    const v = new JVal();
    if (c == 123) {
      // {
      this.i++;
      v.kind = J_OBJ;
      v.keys = new Array<string>();
      v.vals = new Array<JVal>();
      this.ws();
      if (codeAt(this.s, this.i) == 125) {
        this.i++;
        return v;
      }
      for (;;) {
        this.ws();
        const k = this.str();
        this.ws();
        this.i++; // :
        this.ws();
        (v.keys as Array<string>).push(k);
        (v.vals as Array<JVal>).push(this.value());
        this.ws();
        const d = this.s.charCodeAt(this.i);
        this.i++;
        if (d == 125) break; // }
      }
      return v;
    }
    if (c == 91) {
      // [
      this.i++;
      v.kind = J_ARR;
      v.arr = new Array<JVal>();
      this.ws();
      if (codeAt(this.s, this.i) == 93) {
        this.i++;
        return v;
      }
      for (;;) {
        this.ws();
        (v.arr as Array<JVal>).push(this.value());
        this.ws();
        const d = this.s.charCodeAt(this.i);
        this.i++;
        if (d == 93) break; // ]
      }
      return v;
    }
    if (c == 34) {
      // "
      v.kind = J_STR;
      v.s = this.str();
      return v;
    }
    if (c == 116) {
      // true
      this.i += 4;
      v.kind = J_BOOL;
      v.b = true;
      return v;
    }
    if (c == 102) {
      // false
      this.i += 5;
      v.kind = J_BOOL;
      v.b = false;
      return v;
    }
    if (c == 110) {
      // null
      this.i += 4;
      v.kind = J_NULL;
      return v;
    }
    // number
    v.kind = J_NUM;
    v.n = this.num();
    return v;
  }

  /** A JSON string, `"` already at the cursor; returns its decoded value. */
  str(): string {
    this.i++; // opening "
    // Fast path: no escape before the closing quote — one slice, no builder.
    let j = this.i;
    while (j < this.s.length) {
      const c = this.s.charCodeAt(j);
      if (c == 34) {
        const out = this.s.slice(this.i, j);
        this.i = j + 1;
        return out;
      }
      if (c == 92) break;
      j++;
    }
    const out = new StrBuf();
    let runStart = this.i;
    while (this.i < this.s.length) {
      const c = this.s.charCodeAt(this.i);
      if (c == 34) {
        // closing "
        if (this.i > runStart) out.add(this.s.slice(runStart, this.i));
        this.i++;
        return out.toString();
      }
      if (c == 92) {
        // backslash escape
        if (this.i > runStart) out.add(this.s.slice(runStart, this.i));
        this.i++;
        const e = this.s.charCodeAt(this.i);
        this.i++;
        if (e == 34) out.addChar(34);
        else if (e == 92) out.addChar(92);
        else if (e == 47) out.addChar(47);
        else if (e == 98) out.addChar(8);
        else if (e == 102) out.addChar(12);
        else if (e == 110) out.addChar(10);
        else if (e == 114) out.addChar(13);
        else if (e == 116) out.addChar(9);
        else if (e == 117) {
          // \uXXXX: one code unit, exactly as JSON.parse leaves it
          let u = 0;
          for (let k = 0; k < 4; k++) {
            const h = this.s.charCodeAt(this.i);
            this.i++;
            u = u * 16 + (h >= 48 && h <= 57 ? h - 48 : h >= 97 && h <= 102 ? h - 87 : h - 55);
          }
          out.addChar(u);
        }
        runStart = this.i;
        continue;
      }
      this.i++;
    }
    if (this.i > runStart) out.add(this.s.slice(runStart, this.i));
    return out.toString();
  }

  /** A JSON number at the cursor. */
  num(): f64 {
    const start = this.i;
    if (codeAt(this.s, this.i) == 45) this.i++;
    while (this.i < this.s.length && isDigit(this.s.charCodeAt(this.i))) this.i++;
    if (codeAt(this.s, this.i) == 46) {
      this.i++;
      while (this.i < this.s.length && isDigit(this.s.charCodeAt(this.i))) this.i++;
    }
    const e = codeAt(this.s, this.i);
    if (e == 101 || e == 69) {
      this.i++;
      const s = codeAt(this.s, this.i);
      if (s == 43 || s == 45) this.i++;
      while (this.i < this.s.length && isDigit(this.s.charCodeAt(this.i))) this.i++;
    }
    return parseFloat(this.s.slice(start, this.i));
  }
}

const HEX = '0123456789abcdef';

/** JSON.stringify's escaping of one string, quotes included. */
export function jsonQuote(s: string, out: StrBuf): void {
  out.addChar(34);
  let runStart = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let esc: string | null = null;
    if (c == 34) esc = '\\"';
    else if (c == 92) esc = '\\\\';
    else if (c == 8) esc = '\\b';
    else if (c == 12) esc = '\\f';
    else if (c == 10) esc = '\\n';
    else if (c == 13) esc = '\\r';
    else if (c == 9) esc = '\\t';
    else if (c < 0x20) esc = '\\u00' + HEX.charAt(c >> 4) + HEX.charAt(c & 15);
    else if (c >= 0xd800 && c <= 0xdbff) {
      // high surrogate: a following low surrogate is a pair (raw); else lone (escaped)
      const d = codeAt(s, i + 1);
      if (d < 0xdc00 || d > 0xdfff) esc = '\\u' + HEX.charAt(c >> 12) + HEX.charAt((c >> 8) & 15) + HEX.charAt((c >> 4) & 15) + HEX.charAt(c & 15);
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      // lone low surrogate
      esc = '\\u' + HEX.charAt(c >> 12) + HEX.charAt((c >> 8) & 15) + HEX.charAt((c >> 4) & 15) + HEX.charAt(c & 15);
    }
    if (esc !== null) {
      if (i > runStart) out.add(s.slice(runStart, i));
      out.add(esc);
      runStart = i + 1;
    }
  }
  if (s.length > runStart) out.add(s.slice(runStart));
  out.addChar(34);
}
