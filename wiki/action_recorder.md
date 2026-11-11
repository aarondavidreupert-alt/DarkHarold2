# Action Recorder, Replays, Save Files and Bug Reports

A guide to DarkHarold2's play-test tooling: the action recorder that runs while you play, how saves
carry their recorded history, how to replay it as an automated test, how to check save sizes, and
how to move saves, recordings and bug reports between browsers.

All of it is DH2 test tooling — Fallout 2 and fallout2-ce have nothing like it — and none of it
changes how the game plays, except that the random number generator is reseeded before each of
your actions while recording is on (see [Determinism](#10-determinism-and-the-rng)).

Code: `src/actionLog.ts` (hooks), `src/devConsole/recorder.ts` (recorder, commands),
`src/autocrawler/recording.ts` (format), `src/autocrawler/replay.ts` (replay),
`src/devConsole/gameSize.ts`, `src/devConsole/bugReport.ts`, `src/devConsole/saveFiles.ts`.
Implementation notes for developers: [autocrawler.md §9](autocrawler.md).

---

## Contents

1. [Quick start](#1-quick-start)
2. [How recording works](#2-how-recording-works)
3. [What is recorded](#3-what-is-recorded)
4. [Replaying](#4-replaying)
5. [Sizes: gameSize() and saveSize()](#5-sizes-gamesize-and-savesize)
6. [Moving saves: exportSave() / importSave()](#6-moving-saves-exportsave--importsave)
7. [Recording files: exportRecording() / importRecording()](#7-recording-files-exportrecording--importrecording)
8. [Bug reports: exportBugReport() / importBugReport()](#8-bug-reports-exportbugreport--importbugreport)
9. [Saves with the same name](#9-saves-with-the-same-name)
10. [Determinism and the RNG](#10-determinism-and-the-rng)
11. [Limits and known issues](#11-limits-and-known-issues)
12. [Troubleshooting](#12-troubleshooting)
13. [Command reference](#13-command-reference)
14. [File formats](#14-file-formats)

---

## 1. Quick start

You don't have to do anything: with the default `[dh2] record_actions=1` in `fallout2.cfg`, the
recorder runs from NEW GAME and from every save you load. Play, save as usual.

Open the browser console (F12) for the commands. They are there on every page load (no `#dev`
needed).

```js
recordingStatus()                 // is it recording, since when, how much
saveSize()                        // all saves and how large they are
replaySave("before the bridge")   // replay how you got to that save, report differences
exportBugReport("the guard walks through the wall")   // one file with everything for a bug
```

Turn it off with `record_actions=0` in the `[dh2]` section of `fallout2.cfg` (CE behaviour: no
recording, the RNG keeps its single seed).

---

## 2. How recording works

**Pieces.** A *piece* of recording starts

- at **NEW GAME**, once the first map is in (the piece carries a snapshot of the game at that point),
- at **every save load**, the moment the load is done (the piece names that save as its *parent*),
- when you call **`startRecording()`** (the game is snapshotted and reloaded at once; works with
  `record_actions=0` too).

A piece ends at the next load or NEW GAME, at `stopRecording()`, or when a replay starts. Actions
after your last save are lost on a reload, just like game progress.

**Saves carry the recording.** When you save, the save stores

- `recording` — the current piece up to this moment (the actions since the save you loaded, or since
  NEW GAME), and
- `history` — **every piece before it, back to the start of the chain**, compressed.

The chain starts at NEW GAME, at a `startRecording()` snapshot, or at the first save you loaded
that had no recording (a save from before this feature, or made with `record_actions=0`): that save
itself becomes the start. So every save knows its whole history, and it does **not** depend on the
earlier saves still existing — overwrite or delete them, the history stays complete.

```
NEW GAME ──piece 1──▶ save A ──(load A)──piece 2──▶ save B ──(load B)──piece 3──▶ save C
                                                                        save C stores:
                                                                          recording = piece 3
                                                                          history   = piece 1, piece 2
```

**After a page reload** nothing is recording until you load a save (or start a new game); the next
piece starts there and continues that save's history.

---

## 3. What is recorded

One compact entry per action, not per frame:

| Area | Entries |
|---|---|
| Moving | walk / run clicks (target tile, run or walk), the move / run hotkeys |
| Objects | using an object; the action menu: look, talk, use, pick up, rotate, loot, push, elevator |
| Skills, items | skill use on an object (or yourself), use item on |
| Dialogue | the option picked (number, the speaker's script, the option's text) |
| Barter | item moves between inventories and tables, Offer, Talk |
| Inventory | item-menu actions (use, drop, equip, unequip, unload), drags to the hand / armor slots |
| Quantities | every Move Items amount and explosive timer setting |
| Combat | combat start, attacks (also the attack hotkey, attacking doors), called-shot regions, hit mode, swap hands, end turn, end combat |
| World map | walking to a point, entering an area, picking an entrance, entering the wilderness |
| Windows | loot (moves, Take All, Done), steal / plant attempts, companion trade (moves, Offer, Talk), perk picks (and Tag! / Mutate! follow-ups), the character screen's result on Done / Cancel, the Pip-Boy rest option |
| Saves | save, load |
| Map loads | one entry per map that finishes loading (a sync point for the replay) |

Each entry also notes where the game stood just before the action — the frame and game tick, your
tile, the map and elevation when they changed, the GVARs that changed since the entry before. Those
are what a replay checks.

Objects are named by what they are and where they stood when the map loaded (`pid@tile`), items by
their PID, so the names stay the same in a replay.

**Not recorded:** opening and closing windows that change nothing by themselves (inventory, Pip-Boy,
skilldex, character screen opening), camera moves, options; bags opened *inside* the loot / steal
windows.

---

## 4. Replaying

```js
replaySave("name")                // the save's own piece: load its parent, replay, compare with the save
replayHistory("name")             // the save's whole chain, oldest piece first, from that save alone
replayRecording()                 // __recording (the last stopped / imported piece)
```

A replay

1. loads the start of the piece (its parent save, or its snapshot),
2. runs the game frame by frame at the recorded frame times (the frame loop is paused and the
   clock replaced, so a replay usually runs faster than real time),
3. before each action checks the map, elevation, your tile, whether you are in combat, and the
   GVARs against the recording,
4. carries out the action through the same code a click or key would run,
5. at the end compares the state with the save (map, elevation, tile, all GVARs).

The result is printed and returned:

```
[Replay] 34/34 entries, 0 divergences, 1 tile drift, 21.4 s
```

`divergences` lists every difference (`{ i, t, what, recorded, replayed }`, `i` = entry number, `-1`
= the end state); `firstDivergence` is the first. `downloadReplayReport()` saves the last report as
JSON.

**replayHistory** starts each piece from its own snapshot, else from its real parent save while
that is still stored, else from the state the replay of the piece before ended in (the moment that
parent save was made). `replayHistory("name", { useSaves: false })` never uses stored saves — a
test of the history alone.

**Options** (all replay commands):

| Option | Default | |
|---|---|---|
| `stopOnDivergence` | `false` | stop at the first difference |
| `tileTolerance` | `1` | a tile this many hexes off counts as drift, not a divergence (`0` = exact) |
| `stepTimeoutMs` | `60000` | how long one step may wait for a window, a map load, your turn |
| `maxDivergences` | `200` | how many differences the report keeps |

```js
replaySave("name", { stopOnDivergence: true, tileTolerance: 0 })
```

**Headless, both script backends** (needs the extracted game data, like the story crawler):

```bash
npm run storycrawl -- --replay my_session.dh2rec.json.gz
npm run storycrawl -- --replay my_session.dh2rec.json.gz --backends lua --stop
```

The file must carry its start: export it with `exportRecording({ save: "name" })` or
`exportRecording()` after `startRecording()` / `stopRecording()`.

---

## 5. Sizes: gameSize() and saveSize()

```js
gameSize()          // the game now, as a save would store it, by part
saveSize()          // every save: total, recording and history share
saveSize("name")    // one save by part (a number picks the save id)
```

Example:

```
[Size] 4 saves, 5.73 MB in all
  #4    fourth                     1.46 MB   recording 1 KB + history 92 KB (3 pieces)
  #3    third                      1.46 MB   recording 1 KB + history 91 KB (2 pieces)
  #1    base                       1.36 MB
```

A save over 20 MB is marked `(large)`. What makes saves big:

| Part | Typical size |
|---|---|
| `savedMaps` — every map you changed | ~1.3 MB for Arroyo; grows with each map visited |
| the current piece (`recording`) | ~430 KB per hour of play since the last load (half of it frame times) |
| `history` (compressed) | ~90 KB for the chain's start snapshot, then ~100 KB per hour of play |
| automap, player, rest | under 100 KB |

Browsers give IndexedDB hundreds of MB, so this is about write speed and export size, not running
out of room. If saves grow too large: start a fresh chain with `startRecording()` (its history
starts empty), or set `record_actions=0`.

---

## 6. Moving saves: exportSave() / importSave()

Saves live in the browser's IndexedDB — they stay with that browser profile. To move one, or attach
it to a bug report:

```js
exportSave()                      // the newest save
exportSave("name")                // the newest save with that name
exportSave(7)                     // save id 7 (the ids: saveSize())
importSave()                      // pick a file, store it as a new save and load it
importSave(false)                 // store it only (it shows in the Load Game list)
importSave("saves/x.json")        // from a URL instead of a file picker
```

The file is named `<name>_<date>_<time>.dh2save.json` with the save's own date and time (e.g.
`before_the_bridge_2026-11-11_20-33-12.dh2save.json`). An exported save includes its recording
and its whole history, so `replayHistory` works on it in the other browser.

---

## 7. Recording files: exportRecording() / importRecording()

```js
exportRecording()                 // __recording (after stopRecording()) → <map>_<date>.dh2rec.json.gz
exportRecording({ save: "name" }) // a save's piece, with its parent save packed in
exportRecording({ gzip: false })  // plain JSON
importRecording()                 // pick a .gz / .json file (or importRecording("url"))
replayRecording()                 // replay what you imported
```

A recording file is a single piece plus its start, made to be replayed anywhere (also by
`npm run storycrawl -- --replay`). Gzip packs it about 20:1.

---

## 8. Bug reports: exportBugReport() / importBugReport()

```js
exportBugReport("the guard walks through the wall")    // the game now
exportBugReport("...", { save: "name" })               // a stored save instead
importBugReport()                                      // pick the file (or importBugReport("url"))
```

The `.dh2bug.json.gz` file holds:

- the game at that moment as a save, with its recording and whole history,
- the parent saves the recording goes back through, where still stored (up to 8),
- the last 300 console errors and warnings (captured from page load, uncaught errors and rejected
  promises too),
- the combat event log (inside the save),
- the settings that change behaviour (script backend, script fixes, mods, `record_actions`, mouse
  and talk mode, …) and the browser.

About 70–80 KB gzipped per save in it. **Attach this one file to an issue.**

`importBugReport()` prints the note and the errors, stores the game as a save named
`bug: <note>` (load it to stand where the report was made), stores the parent saves under their own
names, and makes the recording `__recording`:

```js
replayRecording()                   // the actions since the last load before the report
replayHistory("bug: the guard ...") // the whole chain
```

---

## 9. Saves with the same name

You may have several saves with the same name (DH2's save list allows it, and every
`importSave()` adds a new save). Then:

- `exportSave("name")`, `replaySave("name")`, `replayHistory("name")`, `saveSize("name")`,
  `exportRecording({ save: "name" })`, `exportBugReport(…, { save: "name" })` all take the **newest**
  save with that name.
- To pick an older one, use its **id**: `saveSize()` lists `#id name size`, newest first; then
  `exportSave(7)`, `replaySave(7)`, …
- Export file names carry the save's date and time, so two same-named saves never export to the same
  file name.
- A recording's link to its parent save uses the name **and** the save time, so same-named saves are
  never mixed up in a history.

---

## 10. Determinism and the RNG

For a replay to take the same turns as your game, the recorder

- starts each piece at the end of a load — the replay starts with the same load,
- reseeds the random number generator before every action (and when a map finishes loading) from
  the recording's seed — so a dice roll depends on the action, not on how many random numbers the
  game drew in between,
- restarts the game loop's own timers at the start of a piece,
- stores every frame's time (0.1 ms) so the replay runs the same frames at the same times —
  animations and the 10 Hz game clock run on real time,
- pins the game clock to each action's recorded tick.

The reseeding is the one change to the game while recording is on: CE seeds the generator once at
start-up. The odds are the same; the exact sequence differs. `record_actions=0` gives CE's single
seed.

A NEW GAME piece's replay sets the GVARs and map variables back to the snapshot's after loading it:
a game load reruns the map's `map_enter_p_proc` with the load flag (Arroyo's temple script counts
entries in a GVAR), which the NEW GAME itself never did.

---

## 11. Limits and known issues

- **Tile drift.** The game reads the clock many times inside one frame; real time moves between
  those reads, the replay's clock does not. So a walk can end one hex off. Such tiles count as
  `tileDrift`, not as divergences (`tileTolerance: 0` to see them all). Because the RNG is reseeded at
  every action and walk targets are absolute tiles, drift does not build up.
- **Random draws differ slightly** between actions (`rngDifferences` in the report, for
  information): critter heartbeats and asset callbacks draw on timing the replay can't reproduce
  exactly.
- **A history replayed without its saves** chains each piece from the replayed end of the one
  before; small differences can carry over. With the real saves present each piece starts exact.
- **World map travel** runs on real-time timers; the replay waits until the party reaches the
  recorded position. Random encounters during that travel may differ.
- **`load` inside a piece** (loading a save while one is recording) ends the piece; a recording that
  contains one replays only where that save exists.
- **Companion trade** is hooked but not yet tested in a replay; **bags opened inside** the loot /
  steal windows are not recorded.
- **Unlimited growth.** There is no size cap on a save's history yet; `saveSize()` shows it.
- **Saves from before this feature** have no recording; loading one starts a fresh chain with that
  save as its start.

---

## 12. Troubleshooting

| Message / symptom | Meaning, what to do |
|---|---|
| `not recording (record_actions=1; the next load / NEW GAME starts a piece…)` | Normal after a page reload: load a save or start a new game. |
| `save 'x' has no recording` | Made with `record_actions=0` or before the feature. Load it and save again to start a chain. |
| `the parent save 'x' … is not in this browser` | `replaySave` needs the parent; use `replayHistory` (it carries the chain) or `exportRecording({ save })` in the browser that has it. |
| `#12 walk: player tile recorded 20715, replayed 20515` | The replay went somewhere else: a real difference (more than `tileTolerance` hexes). Look at the entries before it. |
| `GVARs recorded {…} replayed {…}` | A script set a global variable differently — usually the most interesting kind of divergence. |
| `window recorded 1 replayed 0` | A dialogue / barter / loot window the recording used never opened in the replay. |
| `no handler (the window is not open)` | A window's own entry (loot, steal, trade, …) came while that window wasn't open. |
| The replay seems stuck | It waits up to `stepTimeoutMs` (60 s) per step for a window, a map load or your combat turn, then reports and goes on. |
| Saves are getting big | `saveSize("name")` shows the parts; see [Sizes](#5-sizes-gamesize-and-savesize). |

---

## 13. Command reference

| Command | Does |
|---|---|
| `recordingStatus()` | what is being recorded now |
| `startRecording({ seed? })` | a new piece from a snapshot of the game now (reloaded at once) |
| `stopRecording()` | end the current piece; it becomes `__recording` |
| `replaySave(nameOrId?, options?)` | replay a save's own piece against its parent |
| `replayHistory(nameOrId?, options?)` | replay a save's whole chain (`useSaves: false`: from the history alone) |
| `replayRecording(rec?, options?)` | replay `__recording` or a given recording |
| `downloadReplayReport()` | the last replay report as JSON |
| `exportRecording({ save?, gzip?, recording? })` | download a recording file |
| `importRecording(url?)` | read a recording file into `__recording` |
| `gameSize()` | the game now, by part |
| `saveSize(nameOrId?)` | all saves, or one save by part |
| `exportSave(nameOrId?)` / `importSave(urlOrLoad?, load?)` | save files |
| `exportBugReport(note, { save?, gzip? })` / `importBugReport(urlOrBlob?)` | bug reports |
| `__recording` | the current piece, else the last stopped / imported one |
| `autoCrawler.runReplay(rec, options)` | the replay itself (scripts, the storycrawl tool) |

`fallout2.cfg`: `[dh2] record_actions=1` (default) / `0`.

---

## 14. File formats

All JSON (gzip where the name ends in `.gz`).

**Recording** (`*.dh2rec.json[.gz]`, a save's `recording`, the pieces inside `history`):

```jsonc
{
  "format": "dh2-recording", "version": 1, "created": "2026-11-11T19:26:27.488Z",
  "backend": "lua", "seed": 4242, "origin": "load",          // load | newGame | manual
  "parent": { "name": "base", "timestamp": 1794416719173 },  // or "start": { …a save… }
  "startTick": 302400,
  "frames": "AhAgAh…",          // frame times, 2 base-64 characters a frame (0.1 ms)
  "entries": [
    { "t": "walk", "ms": 231, "f": 8, "k": 2, "pl": 20517, "h": 20715, "run": false },
    { "t": "use", "ms": 3017, "f": 50, "k": 20, "pl": 20715, "o": "1000004@20719", "h": 20719 },
    { "t": "dlg", "ms": 5120, "f": 92, "k": 20, "pl": 20718, "opt": 0, "s": "ACVillgr", "x": "Can you tell me where I" }
  ],
  "end": { "ms": 10978, "f": 103, "k": 62, "mp": "arvillag", "el": 0, "pl": 21919, "gvHash": 1932137289 }
}
```

Entry fields: `t` type, `ms` / `f` / `k` time / frame / game tick since the start, `pl` your tile,
`mp` / `el` map / elevation when changed, `gv` changed GVARs, `cb` in combat, `rn` random draws
since the entry before, `wx` / `wy` world-map position; then the action's own fields (`o` object
label, `ip` item PID, `h` tile, …).

**Save history** (a save's `history`): `{ "chunks": ["<base64 gzip of Recording[]>", …],
"pending": [ …pieces not packed yet… ], "count": 3, "minutes": 41.5 }`.

**Bug report** (`*.dh2bug.json.gz`): `{ "format": "dh2-bugreport", "version": 1, "created", "note",
"game": { …save… }, "parents": [ …saves… ], "chainEnd", "log": [ { "t", "level", "text" } ],
"settings": { … }, "browser": { "userAgent", "viewport", "url" } }`.

**Save file** (`*.dh2save.json`): the save object as stored in IndexedDB (`SaveGame` in
`src/saveload.ts`), with `recording` and `history` when the recorder was on.
