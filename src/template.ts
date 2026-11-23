// Templates: an exact port of vendor/makefun-site/lib/template.js.
// No exceptions: parse errors are returned as strings (the build reports them).

import { codeAt, jsTrim, lastNlBefore, indexOfNl, StrBuf } from './util';
import { jsonQuote } from './json';
import { escapeHtml } from './text';

export const N_TEXT = 0;
export const N_VAR = 1;
export const N_RAW = 2;
export const N_IF = 3;
export const N_FOR = 4;
export const N_INCLUDE = 5;
export const N_ROOT = 6;

/** One parsed template node. */
export class TNode {
  kind: i32 = N_TEXT;
  text: string = '';
  path: Array<string> = new Array<string>();
  name: string = '';
  not: bool = false;
  then: Array<TNode> = new Array<TNode>();
  els: Array<TNode> | null = null;
  body: Array<TNode> = new Array<TNode>();
}

/** A template's parse result: nodes, or an error string. */
export class ParseResult {
  nodes: Array<TNode> = new Array<TNode>();
  error: string = '';
}

const T_TEXT = 0;
const T_VAR = 1;
const T_RAW = 2;
const T_TAG = 3;

/** One tokenize token. */
class TToken {
  t: i32 = T_TEXT;
  text: string = '';
  path: Array<string> = new Array<string>();
  tag: string = '';
}

class TokenizeResult {
  tokens: Array<TToken> = new Array<TToken>();
  error: string = '';
}

function isPathStart(c: i32): bool {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c == 95;
}

function isPathChar(c: i32): bool {
  return isPathStart(c) || (c >= 48 && c <= 57);
}

/** Whether `s` is all spaces and tabs. */
function isSpacesTabs(s: string): bool {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c != 32 && c != 9) return false;
  }
  return true;
}

/**
 * The path `text` names, split at its dots, or null (with the error written to `err`).
 * PATH: /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.
 */
function pathOf(name: string, text: string, err: StrBuf): Array<string> | null {
  const parts = new Array<string>();
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i == text.length || text.charCodeAt(i) == 46) {
      const seg = text.slice(start, i);
      if (seg.length == 0 || !isPathStart(seg.charCodeAt(0))) {
        const q = new StrBuf();
        jsonQuote(text, q);
        err.add(`template "${name}": ${q.toString()} is not a path`);
        return null;
      }
      for (let j = 1; j < seg.length; j++) {
        if (!isPathChar(seg.charCodeAt(j))) {
          const q = new StrBuf();
          jsonQuote(text, q);
          err.add(`template "${name}": ${q.toString()} is not a path`);
          return null;
        }
      }
      parts.push(seg);
      start = i + 1;
    }
  }
  return parts;
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name: string, src: string): TokenizeResult {
  const res = new TokenizeResult();
  const tokens = res.tokens;
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open == -1 || open == src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src.charCodeAt(open + 1);
    if (next != 123 && next != 37) {
      // not '{' or '%'
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next == 123) {
      const raw = codeAt(src, open + 2) == 123;
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close == -1) {
        res.error = `template "${name}": a ${raw ? '{{{' : '{{'} is not closed`;
        return res;
      }
      if (text != '') {
        const tok = new TToken();
        tok.t = T_TEXT;
        tok.text = text;
        tokens.push(tok);
      }
      text = '';
      const err = new StrBuf();
      const p = pathOf(name, jsTrim(src.slice(open + (raw ? 3 : 2), close)), err);
      if (p === null) {
        res.error = err.toString();
        return res;
      }
      const tok = new TToken();
      tok.t = raw ? T_RAW : T_VAR;
      tok.path = p;
      tokens.push(tok);
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close == -1) {
      res.error = `template "${name}": a {% is not closed`;
      return res;
    }
    const end = close + 2;
    const lineStart = lastNlBefore(src, open - 1) + 1;
    const nl = indexOfNl(src, end);
    const lineEnd = nl == -1 ? src.length : nl;
    const standalone = isSpacesTabs(src.slice(lineStart, open)) && isSpacesTabs(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text != '') {
      const tok = new TToken();
      tok.t = T_TEXT;
      tok.text = text;
      tokens.push(tok);
    }
    text = '';
    const tok = new TToken();
    tok.t = T_TAG;
    tok.tag = jsTrim(src.slice(open + 2, close));
    tokens.push(tok);
    i = standalone ? (nl == -1 ? src.length : nl + 1) : end;
  }
  if (text != '') {
    const tok = new TToken();
    tok.t = T_TEXT;
    tok.text = text;
    tokens.push(tok);
  }
  return res;
}

/** Whether `s` holds any whitespace (JS \s). */
function hasWS(s: string): bool {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (
      c == 9 || c == 10 || c == 11 || c == 12 || c == 13 || c == 32 || c == 0xa0 || c == 0x1680 ||
      (c >= 0x2000 && c <= 0x200a) || c == 0x2028 || c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff
    ) return true;
  }
  return false;
}

/**
 * A `for x in path` tag: { name, pathText } or null.
 * FOR: /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/.
 */
function forOf(tag: string): Array<string> | null {
  if (!tag.startsWith('for ')) return null;
  let i = 4;
  if (i >= tag.length || !isPathStart(tag.charCodeAt(i))) return null;
  i++;
  while (i < tag.length && isPathChar(tag.charCodeAt(i))) i++;
  const varName = tag.slice(4, i);
  if (!tag.startsWith(' in ', i)) return null;
  const rest = tag.slice(i + 4);
  if (rest == '' || hasWS(rest)) return null;
  const out = new Array<string>();
  out.push(varName);
  out.push(rest);
  return out;
}

/**
 * An `if [not] path` tag: [not, pathText] or null.
 * IF: /^if (not )?(\S+)$/.
 */
function ifOf(tag: string): Array<string> | null {
  if (!tag.startsWith('if ')) return null;
  let i = 3;
  let not = false;
  if (tag.startsWith('not ', i)) {
    not = true;
    i += 4;
  }
  const rest = tag.slice(i);
  if (rest == '' || hasWS(rest)) return null;
  const out = new Array<string>();
  out.push(not ? '1' : '0');
  out.push(rest);
  return out;
}

/** An `include "name"` tag's name, or null. INCLUDE: /^include "([a-z0-9-]+)"$/. */
function includeOf(tag: string): string | null {
  if (!tag.startsWith('include "') || tag.length < 11 || tag.charCodeAt(tag.length - 1) != 34) return null;
  const inner = tag.slice(9, tag.length - 1);
  if (inner == '') return null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 45)) return null;
  }
  return inner;
}

/** `src` parsed into its tree of nodes (an error string when it does not parse). */
export function parseTemplate(name: string, src: string): ParseResult {
  const res = new ParseResult();
  const tk = tokenize(name, src);
  if (tk.error != '') {
    res.error = tk.error;
    return res;
  }
  const root = new TNode();
  root.kind = N_ROOT;
  const stack = new Array<TNode>();
  stack.push(root);
  let body: Array<TNode> = root.body;
  for (let ti = 0; ti < tk.tokens.length; ti++) {
    const tok = tk.tokens[ti];
    if (tok.t == T_TEXT) {
      const n = new TNode();
      n.kind = N_TEXT;
      n.text = tok.text;
      body.push(n);
    } else if (tok.t == T_VAR || tok.t == T_RAW) {
      const n = new TNode();
      n.kind = tok.t == T_VAR ? N_VAR : N_RAW;
      n.path = tok.path;
      body.push(n);
    } else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      const f = forOf(tag);
      if (f !== null) {
        const err = new StrBuf();
        const p = pathOf(name, f[1], err);
        if (p === null) {
          res.error = err.toString();
          return res;
        }
        const node = new TNode();
        node.kind = N_FOR;
        node.name = f[0];
        node.path = p;
        body.push(node);
        stack.push(node);
        body = node.body;
        continue;
      }
      const cond = ifOf(tag);
      if (cond !== null) {
        const err = new StrBuf();
        const p = pathOf(name, cond[1], err);
        if (p === null) {
          res.error = err.toString();
          return res;
        }
        const node = new TNode();
        node.kind = N_IF;
        node.not = cond[0] == '1';
        node.path = p;
        body.push(node);
        stack.push(node);
        body = node.then;
        continue;
      }
      if (tag == 'else') {
        if (top.kind != N_IF || top.els !== null) {
          res.error = `template "${name}": an else outside an if`;
          return res;
        }
        top.els = new Array<TNode>();
        body = top.els as Array<TNode>;
        continue;
      }
      if (tag == 'endfor' || tag == 'endif') {
        if (top.kind != (tag == 'endfor' ? N_FOR : N_IF)) {
          res.error = `template "${name}": an ${tag} with no open ${tag.slice(3)}`;
          return res;
        }
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent.kind == N_ROOT) body = parent.body;
        else if (parent.kind == N_FOR) body = parent.body;
        else body = parent.els !== null ? (parent.els as Array<TNode>) : parent.then;
        continue;
      }
      const inc = includeOf(tag);
      if (inc !== null) {
        const node = new TNode();
        node.kind = N_INCLUDE;
        node.name = inc;
        body.push(node);
        continue;
      }
      res.error = `template "${name}": {% ${tag} %} is not a tag`;
      return res;
    }
  }
  if (stack.length > 1) {
    const top = stack[stack.length - 1];
    res.error = `template "${name}": a ${top.kind == N_FOR ? 'for' : 'if'} is not closed`;
    return res;
  }
  res.nodes = root.body;
  return res;
}

// ---------------------------------------------------------------- values

export const V_UNDEF = 0;
export const V_NULL = 1;
export const V_STR = 2;
export const V_NUM = 3;
export const V_BOOL = 4;
export const V_ARR = 5;
export const V_OBJ = 6;

/** A tiny string-keyed map with linear search: faster than hashing for a handful of keys. */
export class VarMap {
  keys: Array<string> = new Array<string>();
  vals: Array<TVal> = new Array<TVal>();

  has(key: string): bool {
    for (let i = 0; i < this.keys.length; i++) if (this.keys[i] == key) return true;
    return false;
  }

  /** The value for `key`; the key must exist. */
  get(key: string): TVal {
    for (let i = 0; i < this.keys.length; i++) if (this.keys[i] == key) return this.vals[i];
    return tUndef(); // unreachable when has() was checked
  }

  /** Set `key`, replacing an existing value. */
  set(key: string, val: TVal): void {
    for (let i = 0; i < this.keys.length; i++) {
      if (this.keys[i] == key) {
        this.vals[i] = val;
        return;
      }
    }
    this.keys.push(key);
    this.vals.push(val);
  }
}

/** One template value: a tagged union over the JSON-ish values templates see. */
export class TVal {
  kind: i32 = V_UNDEF;
  s: string = '';
  n: i32 = 0;
  b: bool = false;
  arr: Array<TVal> | null = null;
  obj: VarMap | null = null;

  /** Set an own property (objects only; the map is allocated by tObj). */
  set(key: string, val: TVal): void {
    (this.obj as VarMap).set(key, val);
  }

  /** Whether an own property exists (objects only). */
  has(key: string): bool {
    return (this.obj as VarMap).has(key);
  }

  /** An own property's value (objects only; the key must exist). */
  get(key: string): TVal {
    return (this.obj as VarMap).get(key);
  }
}

export function tUndef(): TVal {
  const v = new TVal();
  v.kind = V_UNDEF;
  return v;
}

export function tNull(): TVal {
  const v = new TVal();
  v.kind = V_NULL;
  return v;
}

export function tStr(s: string): TVal {
  const v = new TVal();
  v.kind = V_STR;
  v.s = s;
  return v;
}

export function tNum(n: i32): TVal {
  const v = new TVal();
  v.kind = V_NUM;
  v.n = n;
  return v;
}

export function tBool(b: bool): TVal {
  const v = new TVal();
  v.kind = V_BOOL;
  v.b = b;
  return v;
}

export function tArr(a: Array<TVal>): TVal {
  const v = new TVal();
  v.kind = V_ARR;
  v.arr = a;
  return v;
}

export function tObj(): TVal {
  const v = new TVal();
  v.kind = V_OBJ;
  v.obj = new VarMap();
  return v;
}

/** One scope in the chain: its own variables and its parent. */
export class Scope {
  vars: VarMap = new VarMap();
  parent: Scope | null = null;
}

/** Whether `key` is a canonical array index (all digits, no leading zero unless itself '0'). */
function isCanonicalIndex(key: string): bool {
  if (key.length == 0 || key.length > 9) return false;
  if (key.length > 1 && key.charCodeAt(0) == 48) return false;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/** The value at `path` in the scope chain: its first name from the nearest scope holding it, then own properties. */
export function lookup(scope: Scope | null, path: Array<string>): TVal {
  let s: Scope | null = scope;
  while (s !== null && !s.vars.has(path[0])) s = s.parent;
  if (s === null) return tUndef();
  let v: TVal = s.vars.get(path[0]);
  for (let k = 1; k < path.length; k++) {
    const key = path[k];
    if (v.kind == V_ARR) {
      const arr = v.arr as Array<TVal>;
      if (key == 'length') {
        v = tNum(arr.length);
        continue;
      }
      if (isCanonicalIndex(key)) {
        let idx = 0;
        for (let j = 0; j < key.length; j++) idx = idx * 10 + (key.charCodeAt(j) - 48);
        if (idx < arr.length) {
          v = arr[idx];
          continue;
        }
      }
      return tUndef();
    }
    if (v.kind == V_OBJ) {
      if (!v.has(key)) return tUndef();
      v = v.get(key);
      continue;
    }
    return tUndef();
  }
  return v;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
export function textOf(v: TVal): string {
  if (v.kind == V_STR) return v.s;
  if (v.kind == V_NUM) return v.n.toString();
  if (v.kind == V_BOOL) return v.b ? 'true' : 'false';
  if (v.kind == V_ARR) {
    const arr = v.arr as Array<TVal>;
    const parts = new Array<string>();
    for (let i = 0; i < arr.length; i++) parts.push(textOf(arr[i]));
    return parts.join(', ');
  }
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
export function truthy(v: TVal): bool {
  if (v.kind == V_ARR) return (v.arr as Array<TVal>).length > 0;
  if (v.kind == V_UNDEF || v.kind == V_NULL) return false;
  if (v.kind == V_BOOL) return v.b;
  if (v.kind == V_STR) return v.s != '';
  if (v.kind == V_NUM) return v.n != 0;
  return true;
}

/** The render context: the parsed templates, by name (one that did not parse absent). */
export class RenderCtx {
  templates: Map<string, Array<TNode>> = new Map<string, Array<TNode>>();
}

/** `nodes` rendered in `scope`, appended to `out`. */
export function renderNodes(nodes: Array<TNode>, scope: Scope, ctx: RenderCtx, depth: i32, out: StrBuf): void {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind == N_TEXT) {
      out.add(n.text);
    } else if (n.kind == N_VAR) {
      out.add(escapeHtml(textOf(lookup(scope, n.path))));
    } else if (n.kind == N_RAW) {
      out.add(textOf(lookup(scope, n.path)));
    } else if (n.kind == N_IF) {
      const v = truthy(lookup(scope, n.path));
      const branch: Array<TNode> | null = v != n.not ? n.then : n.els;
      if (branch !== null) renderNodes(branch, scope, ctx, depth, out);
    } else if (n.kind == N_FOR) {
      const xs = lookup(scope, n.path);
      if (xs.kind != V_ARR) continue;
      const xarr = xs.arr as Array<TVal>;
      for (let k = 0; k < xarr.length; k++) {
        const vars = new VarMap();
        vars.set(n.name, xarr[k]);
        const loop = tObj();
        loop.set('index', tNum(k + 1));
        loop.set('first', tBool(k == 0));
        loop.set('last', tBool(k == xarr.length - 1));
        loop.set('length', tNum(xarr.length));
        vars.set('loop', loop);
        const child = new Scope();
        child.vars = vars;
        child.parent = scope;
        renderNodes(n.body, child, ctx, depth, out);
      }
    } else if (n.kind == N_INCLUDE) {
      if (ctx.templates.has(n.name) && depth < 8) {
        renderNodes(ctx.templates.get(n.name), scope, ctx, depth + 1, out);
      }
    }
  }
}
