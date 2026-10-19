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
`src/input.ts` (`heart.keydown` handler — all in-game keys),
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

## 3. DH2 Key Input Architecture (ported 2026-10-17, known_bugs C43)

**`src/hotkeys.ts` `gameHandleKey(e)`** is CE `game.cc gameHandleKey` plus `combat.cc _combat_input`, on the full `KeyboardEvent` (`e.key`, `e.code` for Shift+digit, Ctrl / Alt). `installInputHandlers()` (`src/input.ts`) registers it as a window capture listener:
- not while typing in a field, loading, or with the game UI disabled (movies);
- an open window gets its own close keys first (CE runs each window's own input loop): Pip-Boy Esc / Return / P / Z, inventory Esc / I, automap Esc / Tab / Return; the options, skilldex, save/load, dialog and barter windows keep their own handlers;
- otherwise the game keys only act on the map (`UIMode.none`, or skill targeting, where Esc cancels).

`interfaceBarEnabled()` = not during an AI combat turn; in combat only the player's turn reads keys (Space ends it, Return tries to end combat).

`heart.keydown` (the old lower-case char path) now only carries the camera arrows, the DH2 item-highlight key (Space outside combat) and the DH2 developer keys (`Config.engine.devKeys`, console `setDevKeys(true)`: elevation q/e, layer toggles r/f/o/w, talk t, inspect i, move m, run j, attack g, raycast y, loot v, use u, kill k, worldmap l); with dev keys on, a key bound to one of those is not a game key. The old DarkFO game bindings (c combat, b inventory, n/m save/load, z called shot) are gone.

---

## 4. DH2 Hotkey Table — as CE

| Key | Action | CE |
|---|---|---|
| `A` | start combat (not in combat) | `_combat(nullptr)` |
| `B` | swap hands (`swapHands`) | `interfaceBarSwapHands` |
| `C` | character screen | `characterEditorShow` |
| `I` | inventory | `inventoryOpen` |
| `Esc` / `O` | options | `showOptions` |
| `P` | Pip-Boy; in combat "Pipboy not available in combat!" (misc.msg 7) | `pipboyOpen` |
| `Z` | Pip-Boy on the alarm clock (`openPipBoyRest`); in combat misc.msg 7 | `pipboyOpen(PIPBOY_OPEN_INTENT_REST)` |
| `S` | skilldex | `skilldexOpen` |
| `N` | cycle the item action (`cycleActiveItemAction`) | `interfaceCycleItemAction` |
| `M` | cycle the mouse mode (`cycleMouseMode`, also right-click) | `gameMouseCycleMode` |
| `Tab` | automap | `automapShow` |
| `1`–`8` (also Shift) | sneak toggle / skill crosshair: lockpick, steal, traps, first aid, doctor, science, repair (`beginSkillTargeting`) | `gameMouseSetMode(GAME_MOUSE_MODE_USE_*)` |
| `Home` | back to the dude's elevation, scroll to him | `_tile_scroll_to(gDude->tile)` |
| `-` `_` / `=` `+` | brightness − / + | `brightnessDecrease/Increase` |
| `,` `<` / `.` `>` | turn the dude counter-clockwise / clockwise | `animationRegisterRotate*` |
| `/` `?` | "<month>: <day>/<year> <time>" in the monitor (editor.msg 500+) | `gameTimeGetDate` |
| `F1` | help screen (helpscrn) until any input | `showHelp` |
| `F2` / `F3` | master volume −/+ 2047 of 32767 | `gameSoundSetMasterVolume` |
| `F4` / `Ctrl+S` | save window | `lsgSaveGame(1)` |
| `F5` / `Ctrl+L` | load window | `lsgLoadGame` |
| `F6` / `F7` | quick save / load: the first time the window picks the slot, then straight into it (misc.msg 5 / 4) | `LOAD_SAVE_MODE_QUICK`, `_quick_done` |
| `Ctrl+P` | pause window (charwin, PAUSED / DONE; +/- still work) | `showPause` |
| `Ctrl+V` | version lines | `versionGetVersion` |
| `Ctrl+Q` / `Ctrl+X` / `F10` | quit confirmation | `showQuitConfirmationDialog` |
| `Space` (combat) | end turn | `_combat_input` |
| `Return` (combat) | try to end combat | `combatAttemptEnd` |
| arrows | scroll the map | `mapScroll` |

---

## 5. Remaining differences

- **Mouse wheel** zooms (DH2 feature) instead of scrolling the map as CE `gameHandleKey(-1)`; the arrows scroll.
- **Pause window** text is drawn in the browser font, not font 103/104.
- **Space** doubles as the DH2 item-highlight key outside combat (CE has none there).

<!-- audited: 2026-10-17 -->
