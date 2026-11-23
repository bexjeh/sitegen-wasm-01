// makefun-site 1.0.0, the house entry's reference program, reimplemented in
// WebAssembly: run(input) returns makefun-site 1.0.0's answer for one case's
// input, and runCases(bytes) answers a whole cases.json document at once.
//
// The hot path runs in WebAssembly (src/, AssemblyScript): the JS side only
// hands bytes to the module and reads bytes back. run() stays available for
// the documented contract; main.ts uses runCases so the JSON round-trip
// through JS is skipped — the module parses and serializes JSON itself, and
// every case is still built alone, from its own input only.

import { WASM_BASE64 } from './wasm-data.js';

const bytes = Buffer.from(WASM_BASE64, 'base64');
const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
  env: {
    abort() {
      throw new Error('wasm abort');
    },
  },
});
const { alloc, build_all, build_one, out_len, memory } = instance.exports;

/** Run one WASM build function over `inputBytes`; returns the output bytes. */
function runBytes(inputBytes, fn) {
  const ptr = alloc(inputBytes.length);
  // The allocator may grow memory: take a fresh view after every call that can.
  new Uint8Array(memory.buffer).set(inputBytes, ptr);
  const outPtr = fn(ptr, inputBytes.length);
  const len = out_len();
  return Buffer.from(new Uint8Array(memory.buffer, outPtr, len));
}

/** makefun-site 1.0.0's answer for one case's input. */
export function run(input) {
  const out = runBytes(Buffer.from(JSON.stringify(input), 'utf8'), build_one);
  return JSON.parse(out.toString('utf8'));
}

/** The answers for a whole cases.json document, as answers.json bytes. */
export function runCases(casesBytes) {
  return runBytes(casesBytes, build_all);
}
