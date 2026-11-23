// The driver the harness runs: node /bot/main.ts (node22). It reads every case
// from /input/cases.json, answers them with the WebAssembly module behind
// solve.js, and writes /output/answers.json: a JSON array of the answers, one
// per case and in the cases' order. Outside a container MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR stand in for /input and /output.
//
// The module parses cases.json and serializes answers.json itself, so the
// driver hands it the file's bytes directly (solve.js's runCases) instead of
// round-tripping every case through JSON.parse/JSON.stringify in JS; each
// case is still built alone, from its own input only. solve.js's run(input)
// stays available for the documented per-case contract.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of its
// work runs under it (the rules: the house baseline runs with
// --no-incremental-marking, and an entry may tune V8's flags too).
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { runCases } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  runCases: (bytes: Buffer) => Buffer;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = readFileSync(join(INPUT_DIR, 'cases.json'));
const answers = runCases(cases);
writeFileSync(join(OUTPUT_DIR, 'answers.json'), answers);
