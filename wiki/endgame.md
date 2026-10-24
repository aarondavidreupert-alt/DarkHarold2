# Endgame System

Covers the victory slideshow, death endings, and the "continue playing?" dialog. Read alongside `wiki/known_bugs.md §23` for active gap entries.

Ground truth: `raw/fallout2-ce/src/endgame.cc`, `endgame.h`  
DH2 implementation: `src/endgame.ts` (public surface; `src/endgame/{deathEndings,slideRender}.ts`), `tools/convertEndgame.py`, `lut/endgame.json`, `lut/enddeath.json`

---

## 1. System Overview

The endgame system has two distinct paths:

| Path | Triggered by | Data file | Art |
|------|-------------|-----------|-----|
| Victory slideshow | `endgame_slideshow` opcode (0x8146) | `data/endgame.txt` | Interface FRMs (per-slide) |
| Death ending | `endgameSetupDeathEnding()` on player death | `data/enddeath.txt` | None (narrator only) |

Both play narrator voice-over from `data/sound/speech/narrator/` with optional subtitles from `data/text/english/cuts/`.

### CE trigger chain

```
Script opcode endgame_slideshow (0x8146)
  → opEndgameSlideshow (interpreter_extra.cc:4573)
  → scriptsRequestEndgame() sets SCRIPT_REQUEST_ENDGAME flag
  → next scriptsExecStartProc() iteration (scripts.cc:1012)
  → endgamePlaySlideshow()  (endgame.cc:211)
  → endgamePlayMovie()      (endgame.cc:234)  [credits.txt + music]
  → endgameEndingHandleContinuePlaying()  (endgame.cc:261) [misc.msg #30]
```

DH2 fires `Endgame.playSlideshow()` directly from the `endgame_slideshow` method in `scripting.ts`. No deferred flag mechanism. `endgame_movie` (0x8148) similarly calls `Endgame.playMovie()` directly.

---

## 2. Data Files

### 2.1 endgame.txt — Slideshow Entries

Format (fields separated by whitespace or commas; `#` = comment):
```
gvar  value  art_num  voiceOverBaseName  [direction]
```

| Field | Type | Description |
|-------|------|-------------|
| `gvar` | int | Global variable index to check |
| `value` | int | Required value of `gvar` for this slide to play |
| `art_num` | int | Interface FRM art number (327 = panning background) |
| `voiceOverBaseName` | string | Narrator file basename (no path, no extension) |
| `direction` | int | Panning direction: `1` = left→right, `-1` = right→left; default `1` |

CE iterates ALL entries and plays every one where `getGlobalVar(gvar) == value`. Multiple matching entries play in order. (`endgame.cc:217`)

Parsed by `tools/convertEndgame.py` → `lut/endgame.json`.

### 2.2 enddeath.txt — Death Ending Entries

Format:
```
gvar  value  worldAreaKnown  worldAreaNotKnown  min_level  percentage  voiceOverBaseName
```

| Field | Type | Description |
|-------|------|-------------|
| `gvar` | int | GVAR to check; `-1` = no check |
| `value` | int | Entry enabled only when `getGlobalVar(gvar) < value` |
| `worldAreaKnown` | int | Area must be known; `-1` = no check |
| `worldAreaNotKnown` | int | Area must NOT be known; `-1` = no check |
| `min_level` | int | Minimum player level required |
| `percentage` | int | Weight for random selection |
| `voiceOverBaseName` | string | Narrator file basename |

Parsed by `tools/convertEndgame.py` → `lut/enddeath.json`.

---

## 3. Slideshow Rendering — Two Slide Types

### 3.1 Static Slide (`art_num ≠ 327`)

CE: `endgameEndingRenderStaticScene` (`endgame.cc:448`)

1. Lock FRM, blit to window buffer
2. Load per-slide `.pal` palette from `art/intrface/<name>.pal`
3. Load narrator audio via `speechLoad("narrator/<baseName>", ...)`
4. Fade in (CE: `paletteFadeTo(_cmap)`)
5. Wait 500 ticks (`inputPauseForTocks(500)`)
6. Start voice-over playback and subtitle timer
7. Loop until: key pressed, speech ended, subtitles ended, or 3s timeout (if no audio/subtitles)
8. Fade out (CE: `paletteFadeTo(gPaletteBlack)`)

DH2 (`showStaticSlide`, `endgame.ts`): renders to a 640×480 `<canvas>` DOM overlay. CSS `opacity` transitions replace palette fades. No `.pal` file support (PNG export is already colour-correct). Steps are otherwise structurally equivalent.

### 3.2 Panning Slide (`art_num == 327`)

CE: `endgameEndingRenderPanningScene` (`endgame.cc:314`)

The FRM at index 327 is wider than 640px. CE pans it horizontally using a complex per-pixel-step timing formula (`endgame.cc:337-345`):

```c
int v8 = width - 640;          // total pan distance
int v32 = v8 / 4;              // fade-in/fade-out quarter
unsigned int v9 = 16 * v8 / v8;  // base ms per pixel step
// If speech duration > v9_ / 2, stretch timing to fit speech
if (speechLoaded && 1000 * speechGetDuration() > v9_ / 2)
    v9 = (speechDuration * 1000 + v9 * (v8 / 2)) / v8;
```

Fade-in happens during the first `v32` pixels of panning; fade-out during the last `v32` pixels.

DH2 (`showPanningSlide`, ported 2026-10-17): one pixel per `v9` ms with the same integer formula; the image brightness follows CE's palette darkening by position (fade in over the first `v32` pixels, out near the end); the speech and subtitles start at pixel `v32` (left→right) or `640 − v32` (right→left), as `endgameEndingVoiceOverReset`; only the end of the pan or a key / click ends it (not the end of the speech).

---

## 4. Subtitles

CE: `endgameEndingSubtitlesLoad` (`endgame.cc:764`), `endgameEndingRefreshSubtitles` (`endgame.cc:805`)

Subtitle file path: `text/<lang>/cuts/<baseName>.txt`  
Format: each line is `N:subtitle text` — the part after the first `:` is displayed.

### Timing formula (`endgame.cc:686`)

```c
double durationPerChar = speechDuration / totalCharCount;  // seconds per character
// fallback if no speech loaded: 0.08 s/char

for each line:
    timing += (int)(lineLength * durationPerChar * 1000);  // ms deadline for this line
```

Each `timing[i]` is the cumulative milliseconds from when the voice-over started at which line `i` should be shown. Lines are updated by polling `getTicksSince(referenceTime) > timings[currentLine]` each render frame.

DH2 (`buildSubtitleTimings`, `endgame.ts`): implements identical formula. Uses `window.setTimeout` per line instead of per-frame polling.

---

## 5. Death Ending Selection

CE: `endgameDeathEndingValidate` (`endgame.cc:1176`), `endgameSetupDeathEnding` (`endgame.cc:1118`)

### Validation pass

An entry is **enabled** when ALL four conditions hold:

| Condition | CE code |
|-----------|---------|
| `gvar == -1` OR `getGlobalVar(gvar) < value` | Skip if `>= value` (`endgame.cc:1185`) |
| `worldAreaKnown == -1` OR area is known | Skip if not known (`endgame.cc:1191`) |
| `worldAreaNotKnown == -1` OR area NOT known | Skip if known (`endgame.cc:1197`) |
| `player.level >= min_level` | Skip if below (`endgame.cc:1203`) |

Note: the `gvar` condition skips when `>= value`, meaning entries are enabled when the variable has NOT yet reached the threshold — used for "you died before discovering X" semantics.

### Weighted random selection (`endgame.cc:1147`)

```c
int chance = randomBetween(0, totalPercentage);
int accum = 0;
int selectedEnding = 0;  // walks as array index
for each entry in order:
    if (!enabled) continue
    accum += percentage
    if (accum >= chance) break
    selectedEnding++           // increments before break — CE mirror
gEndgameDeathEndings[selectedEnding].voiceOverBaseName
```

`selectedEnding` is incremented per enabled non-winning entry and used directly as an array index into the full (not enabled-only) array. This matches CE faithfully, including its edge-case behaviour when disabled entries precede enabled ones.

### Special case: GVAR_MODOC_SHITTY_DEATH

When reason = DEATH and `GVAR_MODOC_SHITTY_DEATH` (index 491) ≠ 0, the death ending at array index 12 is forced regardless of weights. (`endgame.cc:1134-1142`)

---

## 6. DH2 Implementation Notes

### Asset pipeline

`tools/convertEndgame.py` reads `data/data/endgame.txt` and `data/data/enddeath.txt` (the DATs' `data\` folder; before 2026-10-22 it looked in `data/` and wrote nothing, known_bugs EG7). It also reads `data/art/intrface/intrface.lst` to resolve `art_num` values to PNG paths (e.g. `art/intrface/endar101.png`). Output: `lut/endgame.json`, `lut/enddeath.json`.

Called from `tools/setup.py:convert_endgame_data()` after `convert_lsts()`.

### DOM overlay approach

CE renders to a palette-indexed CPU pixel buffer. DH2 overlays a `<div id="endgame-overlay">` (z-index 9999) containing a `<canvas>` for the slide and a `<div>` for subtitles. This is architecturally correct for a browser: no palette pipeline, no WebGL needed for full-screen 2D images.

### Narrator audio

`globalState.audioEngine.playSound('narrator/' + baseName)` loads `audio/narrator/<baseName>.wav`. Fails silently if the file is missing (a 404 error is logged but playback continues). Speech duration is read from `HTMLAudioElement.duration` after `loadedmetadata`, with a 3 s safety timeout.

### Subtitle file path

CE loads from `text/<lang>/cuts/<baseName>.txt`. DH2 loads synchronously from `data/text/english/cuts/<baseName>.txt` via `getFileText()`. Returns `[]` (no subtitles) if the file is missing.

---

## 7. Known Gaps vs CE

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| EG1 | **No per-slide `.pal` file support.** CE loads `art/intrface/<name>.pal` for each slide to apply a custom palette. DH2 uses PNGs from the export pipeline (already colour-correct) and ignores `.pal` files. Colour appearance may differ from original for slides with custom palettes. | `src/endgame/slideRender.ts` | `endgame.cc:735–753 endgameEndingLoadPalette()` | low | accepted |
| EG2 | **`endgame_slideshow` fires asynchronously; script continues immediately.** CE defers via `SCRIPT_REQUEST_ENDGAME` flag so the slideshow runs after the triggering script fully exits. DH2 fires `playSlideshow()` as a fire-and-forget Promise from within the script method. In practice this is harmless because the endgame opcode is always the last call in endgame scripts. | `src/scripting.ts:1778` | `scripts.cc:1012`; `interpreter_extra.cc:4573` | low | accepted |
| EG3 | **Panning slide timing.** FIXED 2026-10-17 (C41): CE per-pixel timing, positional fade and voice start ported (§3). | `src/endgame/slideRender.ts` | `endgame.cc endgameEndingRenderPanningScene` | low | fixed |
| EG4 | **`endgame_movie` credits.** Implemented: `akiss` music, 3 s pause, `credits.txt` scroller, then the continue dialog. | `src/endgame.ts` (`playMovie`) | `endgame.cc:234 endgamePlayMovie` | minor | fixed |
| EG5 | **Death screen art.** Implemented: `death.png` (DEATH.FRM, interface #309) with the narrator and subtitles. | `src/endgame.ts` (`playDeathEnding`) | `main.cc showDeath` | low | fixed |
| EG6 | **Death ending wiring.** FIXED 2026-10-17 (C41): `dudeDeathScene()` (once) — `endgameSetupDeathEnding(REASON_DEATH)`, the death screen, then back to the main menu as CE `mainLoop` → `showDeath`. A dude knocked out outside combat ends the game too (CE `mainLoop` tests `DAM_DEAD \| DAM_KNOCKED_OUT`). The 13-year timeout (`gameTimeAddTicks`) sets the TIMEOUT ending and returns to the main menu **without** a death screen, as CE (it used to re-trigger the death screen every tick). | `src/endgame.ts`, `src/critter/lifecycle.ts`, `src/gameTick.ts` | `main.cc mainLoop, showDeath`; `scripts.cc gameTimeAddTicks` | major | fixed |
| EG7 | **Continue dialog** was a hand-styled HTML box with hardcoded text. FIXED 2026-10-17 (C41): the CE dialog box (`showConfirm`) with misc.msg 30, YES / NO. | `src/endgame.ts` | `endgame.cc endgameEndingHandleContinuePlaying` | low | fixed |

Last audited: 2026-10-17
