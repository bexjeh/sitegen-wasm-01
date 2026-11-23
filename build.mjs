// Build the entry's WebAssembly module from src/ and embed it as base64 in
// wasm-data.js (the repository holds text files only).
// Usage: node build.mjs  (run from the repo root; AssemblyScript lives in
// ~/workspace/makefun/scratch/as-test/node_modules)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const asc = join(homedir(), 'workspace/makefun/scratch/as-test/node_modules/.bin/asc');
// The intermediate .wasm stays OUT of the repo (scratch only): the repository
// holds the base64 text in wasm-data.js, never a binary file.
const wasmPath = join(homedir(), 'workspace/makefun/scratch/sitegen-wasm-test/sitegen.wasm');

execFileSync(asc, [
  join(root, 'src/index.ts'),
  '--outFile', wasmPath,
  '--optimize', '--runtime', 'stub',
  '--initialMemory', '1024', '--maximumMemory', '8192',
], { stdio: 'inherit' });

const bytes = readFileSync(wasmPath);
const b64 = bytes.toString('base64');
const src = `// The compiled WebAssembly module, base64-encoded so the repository holds text
// files only. Built from src/ with AssemblyScript (see README.md); do not edit
// by hand — rebuild with \`node build.mjs\`.
// Module: ${bytes.length} bytes, base64 ${b64.length} chars.
export const WASM_BASE64 = '${b64}';
`;
writeFileSync(join(root, 'wasm-data.js'), src);
console.log(`wasm ${bytes.length} bytes -> wasm-data.js ${src.length} bytes`);
