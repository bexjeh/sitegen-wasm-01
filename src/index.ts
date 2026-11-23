// The module's boundary: raw bytes in, raw bytes out.
//
// The JS driver writes the input bytes into memory (alloc), calls build_all
// (all cases at once) or build_one (one case, for run()), reads the returned
// pointer and out_len() bytes back, and writes them out. Everything between
// the bytes — JSON parsing, the whole makefun-site build, JSON serializing —
// runs in WebAssembly.

import { JParser, JVal, jsonQuote } from './json';
import { build, Build } from './build';
import { StrBuf } from './util';

/** The byte length of the last emitted output. */
let lastOutLen: i32 = 0;

/** Allocate `size` bytes in linear memory; returns the pointer. */
export function alloc(size: i32): i32 {
  return <i32>heap.alloc(<usize>size);
}

/** The byte length of the output the last build call returned. */
export function out_len(): i32 {
  return lastOutLen;
}

/** Serialize one build's output tree (a JSON object, path -> text) into `out`. */
function serializeBuild(b: Build, out: StrBuf): void {
  out.addChar(123); // '{'
  for (let i = 0; i < b.outputKeys.length; i++) {
    if (i > 0) out.addChar(44); // ','
    const k = b.outputKeys[i];
    jsonQuote(k, out);
    out.addChar(58); // ':'
    jsonQuote(b.outputVals.get(k), out);
  }
  out.addChar(125); // '}'
}

/** Emit `s` as UTF-8 bytes in linear memory; returns the pointer. */
function emit(s: string): i32 {
  const n = String.UTF8.byteLength(s);
  const ptr = heap.alloc(<usize>n);
  String.UTF8.encodeUnsafe(changetype<usize>(s), s.length, ptr);
  lastOutLen = n;
  return <i32>ptr;
}

/**
 * Build every case in a cases.json document (a JSON array of {id, input}):
 * returns a pointer to the answers.json bytes (a JSON array, one answer per
 * case, in order). Each case is built alone, from its own input only.
 */
export function build_all(ptr: i32, len: i32): i32 {
  const text = String.UTF8.decodeUnsafe(<usize>ptr, <usize>len);
  const cases = new JParser(text).parse();
  const arr = cases.arr as Array<JVal>;
  const out = new StrBuf();
  out.addChar(91); // '['
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) out.addChar(44); // ','
    const input = arr[i].get('input');
    const b = build(input === null ? new JParser('{}').parse() : input);
    serializeBuild(b, out);
  }
  out.addChar(93); // ']'
  return emit(out.toString());
}

/**
 * Build one case from its input (a JSON object): returns a pointer to the
 * output tree's JSON bytes.
 */
export function build_one(ptr: i32, len: i32): i32 {
  const text = String.UTF8.decodeUnsafe(<usize>ptr, <usize>len);
  const input = new JParser(text).parse();
  const b = build(input);
  const out = new StrBuf();
  serializeBuild(b, out);
  return emit(out.toString());
}
