# DarkHarold2 — Hotkeys / Key Bindings

**Audited:** 2026-06-01  
**CE ref:** `raw/fallout2-ce/src/game.cc` (`gameHandleKey`),
`raw/fallout2-ce/src/interface.cc` (`interfaceBarInit` — `buttonCreate` key codes),
`raw/fallout2-ce/src/combat.cc` (combat turn input loop),
`raw/fallout2-ce/src/kb.h` (key code constants),
`raw/fallout2-ce/src/kb.cc` (SDL scancode → CE key code mapping),
`raw/fallout2-ce/src/preferences.cc` (`brightnessIncrease`, `brightnessDecrease`),
`raw/fallout2-ce/src/pipboy.cc` (`pipboyOpen` — Pip-Boy window key loop)  
**DH2 ref:** `src/heart.ts` (`_getKeyChar`, `window.onkeydown`),
`src/main.ts` (`heart.keydown` handler — all in-game keys),
`src/config.ts` (`Config.controls.*` — full binding map),
`src/ui_options.ts` (`optionsKeyHandler`),
`src/ui_skilldex.ts` (`skilldexKeyHandler`)

---

## 1. CE Key Input Architecture

CE routes all keyboard input through a custom key code scheme defined in `kb.h` and
populated by `kb.cc`:

- **`kb.cc:keyboardInit()`** builds `gLogicalKeyEntries[SDL_NUM_SCANCODES]`, a table that
  maps each SDL physical scancode to a set of logical key codes — one each for
  unmodified, Shift, Left Alt, Right Alt, and Ctrl.
- **`_kb_getch()`** drains SDL events into a 64-entry circular queue and returns the
  next logical key code, or `−1` when empty.
- **`inputGetInput()`** (input.cc) calls `_kb_getch()` and also synthesises a `−2` event
  for mouse activity; `−1` means "no input this tick".
- **`buttonCreate(fd, x, y, w, h, mouseEnter, mouseLeave, mouseDown, keyCode, …)`**
  (win32.cc) registers a logical key code that fires the button's callback. The
  interface bar buttons use this to bind letter keys directly to UI actions (see §3).
- **`gameHandleKey(int eventCode, bool isInCombat)`** (game.cc:480) is the top-level
  dispatcher for all in-game keys; called from both the main loop and the combat turn
  loop.

Key code encoding in `kb.h`:
- Printable ASCII characters: numeric value equals the ASCII code (e.g. `KEY_LOWERCASE_P = 'p' = 112`).
- Ctrl+letter: ASCII control codes 1–26 (e.g. `KEY_CTRL_S = 19`).
- Alt+letter: 272–306 (e.g. `KEY_ALT_A = 286`).
- Function keys: `KEY_F1 = 315` … `KEY_F12 = 390`; Shift/Ctrl/Alt variants add 25/35/45 to the base.
- Navigation: `KEY_ARROW_UP = 328`, `KEY_HOME = 327`, `KEY_PAGE_UP = 329`, etc.

There is no user-facing key rebinding UI in CE. All bindings are hardcoded.

---

## 2. CE Hotkey Table

All keys listed here are from `game.cc:gameHandleKey()` unless noted otherwise.
Cases are case-insensitive (CE handles both `KEY_UPPERCASE_X` and `KEY_LOWERCASE_X`).

### 2.1 Interface / Navigation

| Key(s) | Action | CE source |
|---|---|---|
| `P` / `p` | Open Pip-Boy (blocked in combat with error dialog) | `game.cc:652` |
| `Z` / `z` | Open Pip-Boy to REST screen (blocked in combat) | `game.cc:721` |
| `I` / `i` | Open inventory | `game.cc:635` |
| `C` / `c` | Open character editor (SPECIAL + skills screen) | `game.cc:624` |
| `S` / `s` | Open Skilldex (pick skill to use) | `game.cc:670` |
| `O` / `o` | Open options menu | `game.cc:643` |
| `Escape` | Open options menu (same as O) | `game.cc:643` |
| `Tab` | Open automap overlay (blocked if Alt held) | `game.cc:585` |
| `Home` | Center viewport on player / snap to player elevation | `game.cc:738` |
| `Ctrl+P` | Pause game | `game.cc:593` |
| `Ctrl+Q` / `Ctrl+X` / `F10` | Quit game (confirmation dialog) | `game.cc:579` |

### 2.2 Combat

| Key(s) | Action | CE source |
|---|---|---|
| `A` / `a` | Start combat | `game.cc:597` |
| `N` / `n` | Cycle weapon attack mode (single/burst/called) | `game.cc:605`, `interface.cc:511` |
| `B` / `b` | Switch active hand (left ↔ right) | `game.cc:616`, `interface.cc:533` |
| `Space` | End player turn (mid-combat, breaks turn loop) | `combat.cc:3171` |
| `Enter` | `combatAttemptEnd()` — graceful end of combat turn | `combat.cc:3175` |

### 2.3 Skill Shortcuts (direct use without Skilldex)

| Key(s) | Skill triggered | CE source |
|---|---|---|
| `1` / `!` | Sneak | `game.cc:750` |
| `2` / `@` | Lockpick | `game.cc:758` |
| `3` / `#` | Steal | `game.cc:766` |
| `4` / `$` | Traps | `game.cc:774` |
| `5` / `%` | First Aid | `game.cc:782` |
| `6` / `^` | Doctor | `game.cc:790` |
| `7` / `&` | Science | `game.cc:798` |
| `8` / `*` | Repair | `game.cc:806` |

### 2.4 Movement / Camera

| Key(s) | Action | CE source |
|---|---|---|
| Arrow keys (←→↑↓) | Scroll map | `game.cc:932` |
| `,` / `<` | Rotate player counter-clockwise | `game.cc:822` |
| `.` / `>` | Rotate player clockwise | `game.cc:829` |
| Mouse wheel (horizontal) | Scroll map left/right | `game.cc:500` |
| Mouse wheel (vertical) | Scroll map up/down | `game.cc:507` |

### 2.5 Audio / Display

| Key(s) | Action | CE source |
|---|---|---|
| `-` / `_` | Brightness decrease (`brightnessDecrease()`) | `game.cc:814`, `preferences.cc:934` |
| `=` / `+` | Brightness increase (`brightnessIncrease()`) | `game.cc:818`, `preferences.cc:910` |
| `F2` | Master volume down (−2047 steps) | `game.cc:872` |
| `F3` | Master volume up (+2047 steps) | `game.cc:875` |

### 2.6 Save / Load

| Key(s) | Action | CE source |
|---|---|---|
| `Ctrl+S` / `F4` | Save game (normal save screen) | `game.cc:878` |
| `Ctrl+L` / `F5` | Load game (normal load screen) | `game.cc:885` |
| `F6` | Quick save | `game.cc:892` |
| `F7` | Quick load | `game.cc:907` |

### 2.7 Miscellaneous

| Key(s) | Action | CE source |
|---|---|---|
| `F1` | Open in-game help screen | `game.cc:868` |
| `/` / `?` | Display current date and time in message log | `game.cc:836` |
| `Ctrl+V` | Display version string in message log | `game.cc:922` |
| `F12` | Screenshot | `preferences.cc:1252` (in prefs window), `pipboy.cc:457` |

### 2.8 Pip-Boy Window Keys (while Pip-Boy is open)

| Key(s) | Action | CE source |
|---|---|---|
| `P` / `Z` / `Enter` / `Escape` | Close Pip-Boy | `pipboy.cc:453` |
| `Page Up` | Scroll content up | `pipboy.cc:470` |
| `Page Down` | Scroll content down | `pipboy.cc:472` |
| `Ctrl+Q` / `Ctrl+X` / `F10` | Quit (from inside Pip-Boy) | `pipboy.cc:447` |

---

## 3. DH2 Key Input Architecture

DH2's keyboard system is simpler than CE's and lives in two files:

**`src/heart.ts:_getKeyChar(keyCode: number)`** converts a browser `KeyboardEvent.keyCode`
into a lowercase string:

```
38→'up', 37→'left', 39→'right', 40→'down', 27→'escape', 13→'return'
all others → String.fromCharCode(keyCode).toLowerCase()
```

`window.onkeydown` passes the result to `heart.keydown(k: string)`, which is
assigned in `main.ts` to the main dispatcher.

**Critical limitations vs CE:**
1. **No modifier detection**: `e.keyCode` is read without checking `e.ctrlKey`,
   `e.altKey`, or `e.shiftKey`. Ctrl+S and bare S produce the same string ('s').
2. **F-keys collide with alphabetic keys**: `_getKeyChar` falls through to
   `String.fromCharCode(keyCode)`, so F1 (keyCode 112)→'p', F2 (113)→'q', F3 (114)→'r',
   F4 (115)→'s'. Pressing F1 accidentally triggers the Pip-Boy key.
3. **No PageUp/PageDown/Home/Insert/Delete** special-case mapping — these produce
   non-ASCII garbage via `String.fromCharCode()`.
4. **No Ctrl+letter** support — Ctrl+S fires 's' (Skilldex default, but 's' is not
   mapped in `Config.controls` so it silently no-ops in the main handler).

Some UI panels bypass `heart.keydown` entirely by registering their own
`document.addEventListener('keydown', handler)` with the full `KeyboardEvent`
(giving them `e.key`, modifier flags, etc.). Those handlers work correctly.

**`Config.controls`** (src/config.ts:72) is a flat object of `string` values —
all lowercase key strings matching what `_getKeyChar` produces. Every
`Config.controls.*` field is remappable by writing to the Config object (e.g. from the
browser console), but there is no UI for it.

---

## 4. DH2 Hotkey Table

### 4.1 Config.controls Bindings (main.ts:719)

All handled in `heart.keydown` at `main.ts:719`. Key value from `Config.controls`.

| Default key | Config field | Action | CE equivalent |
|---|---|---|---|
| `ArrowDown` (`'down'`) | `cameraDown` | Scroll camera down | Arrow Down (`mapScroll`) |
| `ArrowUp` (`'up'`) | `cameraUp` | Scroll camera up | Arrow Up |
| `ArrowLeft` (`'left'`) | `cameraLeft` | Scroll camera left | Arrow Left |
| `ArrowRight` (`'right'`) | `cameraRight` | Scroll camera right | Arrow Right |
| `q` | `elevationDown` | Go to previous elevation | No direct CE key (elevation change via map transitions) |
| `e` | `elevationUp` | Go to next elevation | No direct CE key |
| `r` | `showRoof` | Toggle roof tile rendering (debug) | No CE equivalent — dev toggle |
| `f` | `showFloor` | Toggle floor tile rendering (debug) | No CE equivalent — dev toggle |
| `o` | `showObjects` | Toggle object rendering (debug) | No CE equivalent — dev toggle |
| `w` | `showWalls` | Toggle wall rendering (debug) | No CE equivalent — dev toggle |
| `t` | `talkTo` | Talk to critter at mouse hex | CE: left-click critter with move cursor |
| `i` | `inspect` | Debug-log object at mouse hex to console | No CE equivalent — dev tool |
| `m` | `moveTo` | Walk player to mouse hex | CE: left-click ground |
| `j` | `runTo` | Force-run player to mouse hex | No CE equivalent — dev shortcut |
| `g` | `attack` | Attack critter at mouse hex (in combat) | CE: left-click critter in combat |
| `c` | `combat` | Start combat / end player turn | CE: `A` starts combat; `Enter`/`Space` ends turn |
| `y` | `playerToTargetRaycast` | Debug line-of-sight raycast to mouse | No CE equivalent — dev tool |
| `v` | `showTargetInventory` | Loot / inspect inventory of object at mouse | No CE equivalent as a key |
| `u` | `use` | Use all objects at mouse hex | CE: left-click object with use cursor |
| `k` | `kill` | Instantly kill critter at mouse (debug cheat) | No CE equivalent |
| `l` | `worldmap` | Open world map | CE: no direct hotkey (worldmap via exit grids) |
| `p` | `pipboy` | Toggle Pip-Boy | CE: `P` opens; same letter |
| `z` | `calledShot` | (Configured but handler commented out — no effect) | CE: weapon mode; called shot via `N` cycle |
| `n` | `saveKey` | Open save game screen | CE: `Ctrl+S` / `F4` |
| `m` | `loadKey` | Open load game screen ⚠️ conflicts with `moveTo` | CE: `Ctrl+L` / `F5` |
| `b` | `inventory` | Toggle inventory screen | CE: `I` |

### 4.2 Hardcoded Keys (not via Config.controls)

| Key | Action | CE equivalent | Source |
|---|---|---|---|
| `Escape` | Cancel skill-targeting mode | CE: Escape opens options | `main.ts:724` |
| `h` | Direct teleport player to mouse hex (`player.move()`) | No CE equivalent — debug leftover | `main.ts:884` |

### 4.3 Mouse Input

| Input | Action | CE equivalent |
|---|---|---|
| Left click | Use / attack based on cursor mode | Same in CE |
| Right click | Cycle cursor mode: move → command → attack → move | CE: right-click cycles arrow / crosshair modes |
| Scroll wheel | **Zoom** in/out, anchored on cursor | CE: scroll wheel **scrolls map** (CE never zooms) |

### 4.4 UI Panel Key Handlers (bypass heart.keydown)

These use `document.addEventListener('keydown')` directly and have full modifier access.

**Options menu** (`ui_options.ts:407`, `optionsKeyHandler`):

| Key | Action | CE equivalent |
|---|---|---|
| `S` | Save game | CE: `S` in options menu |
| `L` | Load game | CE: `L` in options menu |
| `P` | Open preferences panel | CE: `P` in options menu |
| `X` | Quit to main menu (with confirm) | CE: `Ctrl+Q` / `F10` |
| `D` / `Escape` | Close options menu | CE: `D` / `Escape` in options menu |

**Skilldex** (`ui_skilldex.ts:164`, `skilldexKeyHandler`):

| Key | Action | CE equivalent |
|---|---|---|
| `1`–`8` | Select skill at that position | CE: `1`–`8` direct skill shortcuts |
| `Escape` | Close Skilldex | CE: `Escape` closes Skilldex |

---

## 5. CE → DH2 Mapping Summary

| CE key | CE action | DH2 key | DH2 status |
|---|---|---|---|
| `P` / `p` | Open Pip-Boy | `p` | ✅ Implemented (`Config.controls.pipboy`) |
| `I` / `i` | Open inventory | `b` | ✅ Implemented (different key: `Config.controls.inventory`) |
| `C` / `c` | Character editor | — | ❌ Not implemented (no character editor screen) |
| `S` / `s` | Skilldex | `s` in `ui_options`; DH2 has Skilldex opened from HUD | ⚠️ Partial — accessible via UI but no main-handler key |
| `O` / `o` / `Escape` | Options | `o` key → options (via CE mapping) | ❌ `o` is mapped to `showObjects` toggle in DH2 |
| `Tab` | Open automap overlay | `Tab` not mapped; automap is inside Pip-Boy | ❌ No Tab shortcut |
| `A` / `a` | Start combat | `c` | ✅ Different key, same action |
| `N` / `n` | Cycle weapon mode | `n` → save game | ❌ Weapon mode cycling not implemented; key repurposed |
| `B` / `b` | Switch hands | `b` → inventory | ❌ Switch hands not as a key; key repurposed |
| `Z` / `z` | Pip-Boy REST | — | ❌ REST not in Pip-Boy; no key |
| `Space` | End player turn | — | ❌ Space not handled; `c` is end-turn in DH2 |
| `Enter` | combatAttemptEnd() | — | ❌ `'return'` not bound in DH2 |
| `1`–`8` | Direct skill shortcuts | `1`–`8` in Skilldex panel | ⚠️ Only works when Skilldex is open |
| `Home` | Center on player | — | ❌ Not implemented (`Home` produces garbage in heart.ts) |
| `-` / `_` | Brightness decrease | — | ❌ No brightness control (gap #5 in preferences.md) |
| `=` / `+` | Brightness increase | — | ❌ No brightness control |
| `F2` | Volume down | — | ❌ F2 collides with `q` (elevation down) in heart.ts |
| `F3` | Volume up | — | ❌ F3 collides with `r` (toggle roof) |
| `F4` / `Ctrl+S` | Save game | `n` | ✅ Different key; same action |
| `F5` / `Ctrl+L` | Load game | `m` (conflicts) | ⚠️ `loadKey:'m'` conflicts with `moveTo:'m'` |
| `F6` | Quick save | — | ❌ No quick save |
| `F7` | Quick load | — | ❌ No quick load |
| `F1` | Help | — | ❌ F1→'p' in heart.ts (Pip-Boy collision); no help screen |
| `,` / `<` | Rotate player CCW | — | ❌ Not implemented |
| `.` / `>` | Rotate player CW | — | ❌ Not implemented |
| `/` / `?` | Show date/time | — | ❌ Not implemented |
| Arrow keys | Scroll map | Arrow keys | ✅ Same keys, same scroll action |
| Mouse scroll | Scroll map | Mouse scroll | ❌ DH2 repurposed wheel as **zoom** not scroll |
| `Ctrl+Q` / `F10` | Quit | — | ❌ No quit hotkey; browser handles page close |

---

## 6. Known Gaps

### Gap #1 — F-key collisions in heart.ts

`heart._getKeyChar()` uses `String.fromCharCode(e.keyCode)` as a fallback, which
means F-keys fall through to their ASCII equivalents: F1→'p' (Pip-Boy), F2→'q'
(elevation down), F3→'r' (roof toggle), F4→'s' (nothing), F5→'t' (talkTo), etc.
CE's F1=Help, F2=Vol−, F3=Vol+, F4=Save, F5=Load are all absent or misfiring.
To fix: add explicit cases for F-key keyCodes (112–123) in `_getKeyChar()`.

### Gap #2 — `moveTo` / `loadKey` both mapped to 'm'

`Config.controls` has `moveTo: 'm'` (line 85) and `loadKey: 'm'` (line 97).
Both are checked in `heart.keydown`; pressing `m` triggers walk-to first and
load-screen second every time. The load-screen was likely intended to be a
different key (CE used `Ctrl+L` / `F5`). One of the two must be rebound.

### Gap #3 — Escape is overloaded / conflicts with CE behaviour

In CE, `Escape` opens the options menu (`game.cc:643`). In DH2 `Escape` cancels
skill-targeting mode (`main.ts:724`), which is correct. But when skill-targeting
is not active, `Escape` is dropped — there is no fallthrough to open options.
CE's `O` key also maps to options; DH2 repurposed `o` to toggle object rendering.

### Gap #4 — No Ctrl/Alt modifier support in heart.keydown

All CE Ctrl-key bindings (`Ctrl+S`, `Ctrl+L`, `Ctrl+Q`, `Ctrl+P`, etc.) are
unavailable in DH2 because `heart._getKeyChar()` ignores `e.ctrlKey`. The
UI-panel handlers that use `document.addEventListener('keydown', …)` do have
full modifier access, but the main world-level handler does not.

### Gap #5 — Quick save / quick load absent

CE `F6`/`F7` quick save and quick load have no equivalent in DH2.
`uiSaveLoad()` always opens the full slot-selection screen.

### Gap #6 — CE skill direct shortcuts (1–8) scope

CE `1`–`8` activate skill mouse modes from anywhere in the world.
In DH2 the `1`–`8` shortcut only works inside the Skilldex panel
(`ui_skilldex.ts:173`); pressing a number key from the map does nothing.

### Gap #7 — Scroll wheel repurposed as zoom

CE uses the scroll wheel to scroll the map viewport (game.cc:495). DH2 uses it
for zoom (main.ts:481). There is no keyboard zoom in CE; this is a DH2-only
feature. The map scroll that the wheel provided in CE is covered by keyboard
arrow keys (wired in both engines).

### Gap #8 — calledShot key wired but not active

`Config.controls.calledShot` is set to `'z'` (config.ts:95) but the handler in
`main.ts` is commented out (lines 921–922). Pressing `z` does nothing in DH2.
CE's `Z` opens the REST Pip-Boy screen, which is also absent (see wiki/pipboy.md
gap #4).

### Gap #9 — No key rebinding UI

CE also has no key rebinding UI; bindings are hardcoded in both engines.
DH2's `Config.controls` object is architecturally rebindable (it is plain JS and
exposed on `window.Config`), but there is no panel or save/load for it — changes
survive only for the current browser session.

<!-- audited: 2026-06-01 -->
