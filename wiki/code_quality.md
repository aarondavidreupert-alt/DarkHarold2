# Code quality vs modern standards — assessment and fixing plan

> Assessed 2026-10-27 on branch `claude/cleanup-audit` (`d60c260d`), after the cleanup pass in
> [`cleanup_audit.md`](cleanup_audit.md) (its CA IDs are referenced below). Numbers are measured, not
> estimated; re-run the commands in "How to re-measure" to update them.

## Verdict

The engine works, is CE-faithful and is unusually well documented, but measured against current
TypeScript / web practice it is about half-way: type safety is loose, there are no automated tests or
CI, one import cycle spans most of the code base, file loading is synchronous, and the toolchain is
two to four years old. None of this is a correctness emergency; it makes changes slower and riskier.

## Status after the 2026-10-27 pass

> Parity baseline since the 2026-10-27 re-run of `decompile_scripts`: **12840** runs (was 12800; 40 more
> procedure runs from the new decompiler output, still 0 differing procedures). `tools/parity.mjs` checks 12840.

Phases 1–4 and Q17 are done; Phase 5 is partly done. Every step kept the parity baseline (tsc 0 errors, luadiff
"36 scripts, 12800 runs (69 cut short), 0 differing procedures, 70 runs where the VM threw"), `npm test`, `npm run
smoke` (artemple, klamall, denbus1 load without errors) and `npm run storycrawl` (klamall / denbus1 VM = Lua and
identical to the pre-Phase-2 traces on every run; arvillag / kladwtwn show timing flakes that unchanged code shows
too). Type-only steps were also checked by comparing tsc's output before and after (Prettier-normalised).

| | Before | After |
|---|---|---|
| `strict` | off (597 errors) | **on**, 0 errors (Q10) |
| `as any` | 694 | **172** (Q11) |
| `namespace` blocks | 9 | **0** (Q12) |
| `var` / `arguments` / string `throw` | 305 / 59 / 50 | **0 / 0 / 0** (Q5, Q6) |
| loose `==` (not `== null`) | 30 | **2**, the VM's SSL comparison opcodes, on purpose (Q7) |
| ESLint (recommended + curly) | 5486 | **4198** (ESLint 10 rule set; mostly `curly`) |
| Prettier | 205 files differ | **0**, checked in CI (Q8) |
| sync XHR per map boot | artemple 39, klamall 91, denbus1 130 | **1, 3, 3** (Q13) |
| largest import cycle | 145 modules, main.js first | **73**, luadiff loads without main.js (Q14) |
| toolchain | TS 4.6, ESLint 7, Python lock for 3.9 | **TS 6.0, ESLint 10 + typescript-eslint 8, Python 3.11+** (Q17) |
| unit tests | 0 | **45** (Q2, + the light table) |

Open: **Q14** past 73 modules (scripting hooks for objects / combat / dialogue), **Q15** (globalState split),
**Q16** (files over 1500 lines: `scripting.ts`, `combat/Combat.ts`, `object/Obj.ts`; the `ui_*.ts` camelCase renames,
CA40 / CA41), the world-map map entries in Q13 (still loaded synchronously), and two Q13 leftovers by design (scripts
a script spawns later, dialogue `.msg` on first talk).

## Scorecard (as assessed before the pass)

| Area | Status | Findings |
|---|---|---|
| Type safety | ⚠️ weak | `tsconfig.json` has `noImplicitAny` / `noImplicitReturns` / `noImplicitThis` but not `strict`. `--strict` gives **597** errors, **544** of them `strictNullChecks` (most in `object/Obj.ts` 67, `playerUse.ts` 60, `render/webglContext.ts` 53, `saveload.ts` 47, `ui_inventory/panel.ts` 46, `input.ts` 40). **694** `as any`, **1056** ESLint `no-explicit-any`, **279** non-null assertions `!`, 22 `as unknown as`; 0 `@ts-ignore`. Other flags: `noUnusedLocals` 42, `noUnusedParameters` 59, `noImplicitOverride` 43, `noFallthroughCasesInSwitch` 4 (all four are deliberate, marked `// falls through`, CE ports). |
| Architecture | ❌ dated | **144 of 206** compiled modules form one strongly connected import cycle (why `main.js` must be imported first, e.g. in `tools/luadiff.html`). The `globalState` singleton is imported by **119** modules and is read and written from everywhere. 9 files still use TS `module` / `namespace` blocks (`scripting.ts`, `vm_bridge.ts`, `worldmap.ts`, `events.ts`, `idbcache.ts`, `lighting.ts`, `lightmap.ts`, `encounters.ts`, `criticalEffects.ts`). Ten files are over 800 lines (`scripting.ts` 4533, `combat/Combat.ts` 3498 — CA41). |
| Legacy syntax | ⚠️ | **253** `var`, **59** uses of `arguments`, **123** loose `==` / `!=`, **52** `throw` of a string instead of an `Error` (most in `encounters/conditionLang.ts` and `scripting.ts`), 2 empty `catch {}`. |
| I/O and startup | ❌ | Synchronous `XMLHttpRequest` on the main thread (deprecated by browsers; freezes the page while it waits): `util.ts` `getFileText` / `getFileBinarySync` / `fileExistsSync`, `main.ts` `fileStamp`, `modAssets.ts` manifests, `aiPackets.ts`; **49** call sites use the sync `getFile*` helpers. Startup still chains callbacks (`IDBCache.init → cachedJSON → ...`, CA21 / CA22). |
| Tests and CI | ⚠️ started (Phase 1, 2026-10-27) | GitHub Actions (`.github/workflows/ci.yml`) runs `tsc`, the ESLint ratchet and `npm test` (42 unit tests of formula code against CE) on every push / PR. `npm run parity` runs `tools/luadiff.html` headless, locally (needs game data). Still manual: the AutoCrawler and story crawler (`wiki/autocrawler.md`), play tests. ~~No unit tests, no test runner, no CI.~~ |
| Lint and format | ⚠️ | ESLint reports **5486** problems (4047 errors, mostly `curly`; 5490 / 4051 before the CA47 fix); CI fails if the count rises (`tools/eslintBaseline.json`, Q1), it does not have to be 0. All **205** source files differ from the repo's own `.prettierrc.json`. No pre-commit hook. |
| Dependencies | ⚠️ outdated | TypeScript **4.6** (2022; current 5.x), ESLint **7** with legacy `.eslintrc.js` (out of support), `@typescript-eslint` 5 (CA24). Pipeline targets **Python 3.9** (end of life Oct 2025); 29 of 329 Python functions have type hints. Source maps on since Q4 (2026-10-27): browser stack traces show the `.ts` files. Dev dependency added: Playwright (Q3, `npm run parity`). |
| Security | ✅ mostly fine | No `eval` / `new Function` / `document.write`; `localStorage` access is guarded; Lua scripts run sandboxed in wasmoon. 14 `innerHTML` writes remain, mostly constants or numbers; the one that took game text (`ui_dialogue.ts` reply) was a real bug and is fixed (known_bugs CA47). `ui_components.ts` `Label.setText` still uses `innerHTML` (callers pass editor.msg text). |
| Strengths | ✅ | Native ES modules, WebGL 2, `async` / `await` in newer code (69 async functions), `requestAnimationFrame` loop. Every system cites its CE source; the wiki covers each subsystem; barrel / subfolder convention applied consistently; structured logging (`dbg`, categories); deterministic differential tests for the script backends. |

## Fixing plan

Ordered by value per risk. Every step must keep the parity baseline: `npx tsc -p .` 0 errors,
`tools/luadiff.html` = "36 scripts, 12800 runs (69 cut short), 0 differing procedures, 70 runs where the
VM threw", story crawler (subset `arvillag,klamall,kladwtwn,denbus1` at least) identical on VM and Lua
and against the previous run, plus a short play test. **Approval** marks steps that are RISKY under the
cleanup rules (startup order, VM / scripting, dependency upgrades, renames, deletions).

### Phase 1 — safety net (do first; everything else depends on it) — ✅ done 2026-10-27

| # | Step | Approval | Done when |
|---|---|---|---|
| Q1 | ✅ **CI on every push / PR** (GitHub Actions): `npm ci`, `npm run build`, ESLint with a *ratchet* (fail only if the problem count rises above a stored baseline). | no (new file) | CI green on the branch; a deliberate type error fails it |
| Q2 | ✅ **Unit test runner** for pure logic (Vitest or `node --test` on the compiled `js/`): start with formula code that needs no DOM — `combat/damage.ts`, `combat/hitChance.ts`, `random.ts`, `geometry/hexGrid.ts`, `gametime.ts`, `skills.ts`; test values taken from CE. | dev dependency | ≥ 30 tests, run in CI |
| Q3 | ✅ **Headless parity tests in CI**: run `tools/luadiff.html` (and later the story crawler subset) in headless Chromium. Needs game data, which can't be committed: run on a self-hosted runner or a local `npm run parity` script. | no | `npm run parity` prints the baseline line |
| Q4 | ✅ **Source maps** (`"sourceMap": true`; `*.map` is already ignored). | no | DevTools shows `.ts` lines in stack traces |

What Phase 1 delivered (2026-10-27):

- **Q1** `.github/workflows/ci.yml`: `npm ci` → `npm run build` (0 errors) → `npm run lint:ratchet` →
  `npm test`, Node 22, on every push and pull request. `tools/eslintRatchet.mjs` compares the error and
  warning counts with `tools/eslintBaseline.json` (5486 problems: 4047 errors, 1439 warnings; the same
  on an LF checkout as on Windows CRLF) and fails if either rises; `npm run lint:ratchet -- --update`
  writes a lower baseline. Checked locally: one added `curly` error fails it. Not yet run on GitHub
  (the branch is unpushed); the workflow was reviewed by hand and parsed as YAML.
- **Q2** `npm test`: `node --test` over `test/*.test.mjs` on the compiled `js/` (pretest runs `tsc`); no
  new dependency (Vitest would add a bundler for no gain while the tests read compiled ES modules).
  **42 tests**: `combat/damage.ts` 16 (`combat.cc` attackComputeDamage, damageModGlovzDivRound,
  damageModCalculateGlovz, damageModCalculateYaam as meant), `skills.ts` 8 (`skill.cc`
  gSkillDescriptions parsed from the CE source, skillsGetCost, skillGetGameDifficultyModifier;
  `perk.cc` perkGetSkillModifier; `trait.cc` traitGetSkillModifier), `gametime.ts` 6 (`scripts.cc`
  gameTimeGetDate / gameTimeGetHour / gameTimeGetTimeString, `scripts.h`), `geometry/hexGrid.ts` +
  `hexScreen.ts` 6 (`tile.cc` _dir_tile, tileDistanceBetween, tileGetRotationTo, tileToScreenXY,
  tileGetTileInDirection), `random.ts` 6 (`random.cc` draw for draw). Expected values are worked out
  by hand in the test comments or come from the CE function transliterated in the test. All pass;
  no disagreement with CE found, so nothing new in `known_bugs.md`. `js/logger.js` imports
  `globalState.js`, which pulls in the browser-only cycle; a resolve hook (`test/support/`) swaps those
  two for stubs so the formula modules load in Node — engine code unchanged. `combat/hitChance.ts`
  is not covered: it imports protos, the lightmap and tiles (needs Q14 or a larger stub set).
- **Q3** `npm run parity` (`tools/parity.mjs`, Playwright dev dependency): builds, serves the project
  root with `python -m http.server` on port 8124, opens `tools/luadiff.html` in headless Chromium
  (falls back to an installed Chrome / Edge), prints the status line and exits 1 unless it starts with
  the baseline. Needs the extracted game data, so it is a local script, not in GitHub CI. Measured:
  the baseline line (`..., missing: none`) in 28–29 s.
- **Q4** `"sourceMap": true` in `tsconfig.json`; `js/**/*.js.map` point at `../src/**/*.ts`, which the
  same static server serves. Checked in headless Chromium: all 202 modules load with a map, and a
  TypeError thrown at `js/combat/damage.js:15:46` resolves to `src/combat/damage.ts:52`.

### Phase 2 — mechanical modernisation (low risk, provable) — ✅ done 2026-10-27

| # | Step | Approval | Done when |
|---|---|---|---|
| Q5 | ✅ `var` → `let` / `const`, `arguments` → rest parameters, outside `vm.ts` / `vm_bridge.ts` / `scripting.ts` first. ESLint `--fix` for `prefer-const` / `no-var`, review `var` hoisting cases by hand. | no (VM files: yes) | ESLint `no-var` 0 outside VM files; luadiff + crawler unchanged |
| Q6 | ✅ `throw 'string'` → `throw new Error(...)` (52). Check every `catch` that tests the thrown value (`typeof e === 'string'`, `VMFatalError` handling in `ScriptVM.run`). | VM paths: yes | 0 string throws; error paths behave the same |
| Q7 | ✅ Loose `==` → `===` where both sides are known types; keep `== null` checks (one idiom, document it). | no | ESLint `eqeqeq` with `null: ignore` passes |
| Q8 | ✅ One Prettier run in a commit of its own (plus `.git-blame-ignore-revs`), then `prettier --check` in CI. | yes (touches every file) | `prettier --check` clean |
| Q9 | ✅ Remaining `innerHTML` with text → `textContent` (`Label.setText`, barter amounts). | no | no `innerHTML` assignment of non-constant text |

### Phase 3 — type safety, one subsystem at a time — ✅ done 2026-10-27 (whole tree at once)

| # | Step | Approval | Done when |
|---|---|---|---|
| Q10 | ✅ Turn on `strictNullChecks` per area using a second tsconfig (`tsconfig.strict.json` with `include` growing folder by folder), in CI. Order: `geometry/`, `formats/`, `ui/` → `render/` → `object/` → `map/` → `combat/` → `scripting.ts` last. | combat / scripting: yes | the whole tree compiles with `strict: true`; `tsconfig.strict.json` deleted |
| Q11 | ✅ Replace `as any` hot spots with real types: `Obj` subtypes (`pro`, `extra`, `art`), `proMap` entries (`proto_types.ts` already has them), `globalState.renderer` as `WebGLRenderer`. Track the count in CI (ratchet). | combat / scripting: yes | `as any` < 200 |
| Q12 | ✅ `namespace` / `module` blocks → plain ES module exports (keep the barrels; call sites keep `Worldmap.x` via `import * as Worldmap`). | yes (scripting, VM bridge) | 0 `export module` |

### Phase 4 — I/O and startup — ✅ done 2026-10-27 (prefetch; see Status)

| # | Step | Approval | Done when |
|---|---|---|---|
| Q13 | ✅ Async loading: `fetch` versions of `getFileText` / `getFileJSON` / `getFileBinarySync`; preload what the synchronous paths need (msg files, protos, scripts) at map load so engine code can stay synchronous where CE is. `main.ts` boot with `await` (CA21, CA22). | yes (startup order, script loading) | no `open(..., false)` left; crawler + luadiff unchanged; load time measured before / after |

### Phase 5 — architecture (long term) — 🔶 Q14 partial, Q15 / Q16 open

| # | Step | Approval | Done when |
|---|---|---|---|
| Q14 | 🔶 partial Break the 144-module import cycle: move shared types into type-only modules, pass services in (renderer, audio, UI callbacks) instead of importing them, keep the hook pattern already used (`globalState.drugHandler`, `setWorldmapGlobalVarHooks`). Measure the largest cycle in CI. | yes | largest cycle < 30 modules; `main.js` no longer has to be imported first |
| Q15 | Split `globalState` into owned state (map, party, camera, UI mode, caches) with accessors; save format unchanged (`eventLog`, `seenMovies`, `knownAreas` ... keep their names). | yes (save format adjacent) | old saves load; ≤ 40 importers of `globalState` |
| Q16 | Split files > 800 lines per `ts-split-refactor.md` (CA41), file renames to camelCase (CA40). | yes | no file > 1500 lines |
| Q17 | ✅ Toolchain upgrade: TypeScript 5.x, ESLint 9 flat config + `typescript-eslint` 8, Python ≥ 3.11 for the pipeline (CA24). After Phase 1 so CI catches the fallout. | yes | CI green on the new versions |

## How to re-measure

```bash
npx tsc -p . --noEmit --strict 2>&1 | grep -c "error TS"
```

```bash
npx eslint "src/**/*.ts" -f json > eslint.json
```

```bash
grep -ro "as any" src | wc -l
```

The import-cycle size comes from a Tarjan SCC walk over the static imports of the compiled `js/`
(as used for the 2026-10-26 cleanup); the other counts are plain `grep` over `src/`.
