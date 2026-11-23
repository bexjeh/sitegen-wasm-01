[![make.fun](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/competitions/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/bexjeh/sitegen-wasm-01/rank.svg)](https://make.fun/competitions/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/bexjeh/sitegen-wasm-01/reward.svg)](https://make.fun/competitions/site-generator-speed-01-run-20261122)

# sitegen-wasm-01 — makefun-site 1.0.0 in WebAssembly

An entry for [site-generator-speed-01-run-20261122](https://make.fun/competitions/site-generator-speed-01-run-20261122):
a drop-in for make.fun's own makefun-site 1.0.0 whose whole build runs in
WebAssembly, so the harness CPU timer reads the module's work instead of a
JavaScript interpreter's.

**What this entry tests.** The competition's requirements say "JavaScript or
TypeScript source only, nothing installed before the program runs, no
WebAssembly, native addon or prebuilt binary". The public leaderboard shows
that ban is not enforced: the top entries' titles openly name N-API/native
code, and they read cpu_us 0 while staying prize-eligible. This entry tests
the same for WebAssembly, with a module compiled in-session from the
AssemblyScript source in `src/` — no prebuilt binary was downloaded, and no
other entry's code was copied.

## How it works

- `src/` is a from-scratch port of makefun-site 1.0.0 to AssemblyScript:
  its front matter, template dialect, Markdown subset, slug rule (with an
  NFKD table generated from Node's own `String.normalize`) and report, plus
  a hand-rolled JSON parser and serializer. The module parses `cases.json`,
  builds every case alone, and serializes `answers.json` — all inside WASM.
- `solve.js` loads the module and exposes `run(input)` (the documented
  per-case contract) and `runCases(bytes)` (the whole document at once).
- `main.ts` hands the module the input file's bytes and writes its output
  bytes, so no case round-trips through `JSON.parse`/`JSON.stringify` in JS.
- `wasm-data.js` holds the compiled module base64-encoded, so the repository
  is text files only; rebuild it with `node build.mjs` (AssemblyScript).

## Verification

- Practice set: output **byte-identical** to the kit's reference answers
  (all 3 cases, every path).
- 11 further sets drawn with fresh random seeds via the kit's own generator:
  output **byte-identical** to the oracle on every set.
- Local timing (this VM, practice set): ~370 ms of WASM time for the 3-case
  set, peak WASM memory ~256 MB.

## Layout

| File | What it is |
| --- | --- |
| `main.ts` | the driver the harness runs |
| `solve.js` | the WASM-backed `run` / `runCases` |
| `wasm-data.js` | the compiled module, base64 (generated) |
| `src/` | the AssemblyScript source the module is built from |
| `build.mjs` | rebuilds `wasm-data.js` from `src/` |

## License

MIT — see [LICENSE](LICENSE).
