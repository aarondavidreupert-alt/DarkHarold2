# Config, INI & Preferences System

Cross-references: `wiki/sound_system.md` (volume keys), `wiki/save_load.md` (localStorage persistence).

**Audited:** 2026-07-04 — S-CI2 fixed (game/combat difficulty split); §4.5's control table flagged stale pending full re-pass  
**CE source files:**  
`raw/fallout2-ce/src/config.cc` (`configRead`, `configWrite`, `configParseLine`, `configParseCommandLineArguments`),  
`raw/fallout2-ce/src/settings.cc` (`settingsFromConfig`, `settingsToConfig`),  
`raw/fallout2-ce/src/preferences.cc` (`preferencesInit`, `preferencesSetDefaults`, `_SetSystemPrefs`, `_JustUpdate_`, `_SavePrefs`, `preferencesSave`, `preferencesLoad`, `doPreferences`, `_DoThing`, `_UpdateThing`, `brightnessIncrease`, `brightnessDecrease`),  
`raw/fallout2-ce/src/options.cc`,  
`raw/fallout2-ce/src/text_object.cc` (`textObjectAdd`, `textObjectsRenderInRect`, `textObjectFindPlacement`, `textObjectsSetBaseDelay`)  
**DH2 source files:**  
`src/config.ts` (all Config fields and defaults),  
`src/ui_options.ts` (`buildPrefsPanel`), `src/ui_options/preferences.ts` (`loadPreferences`, `savePreferences`, `SavedPreferences`),  
`src/main.ts` / `src/input.ts` (consumption of `Config.engine.doAlwaysRun`),  
`src/combat.ts` (barrel; `src/combat/*.ts`) (consumption of `Config.combat.difficultyModifier`, combat damage only),  
`src/skills.ts` (consumption of `Config.combat.gameDifficultyModifier`, skill-check modifier — **FIXED 2026-07-04, S-CI2**: now a field separate from `difficultyModifier`),  
`src/worldmap/encounters.ts` (consumption of `Config.combat.gameDifficultyModifier`: encounter rate, pick and critter count)

---

## 1. CE Config File Format

### 1.1 File Names

| Mode | File |
|------|------|
| Game | `fallout2.cfg` (`DEFAULT_GAME_CONFIG_FILE_NAME`, `game_config.h:8`) |
| Mapper | `mapper2.cfg` (`MAPPER_CONFIG_FILE_NAME`, `game_config.h:9`) |

### 1.2 INI Grammar

```ini
; comment (semicolon truncates the rest of the line)
[section]
key=value     ; both key and value are whitespace-trimmed
```

`configParseLine()` (`config.cc:378`): finds `;` and truncates; if line starts with `[`, stores section name in `gConfigLastSectionKey`; otherwise splits on first `=` and stores the key-value pair under the current section. Lines without `=` outside a section throw no error — they're skipped.

### 1.3 C++ Data Structure

```c
// config.h:12-18
typedef Dictionary Config;         // key=section name, value=ConfigSection*
typedef Dictionary ConfigSection;  // key=INI key, value=char**
```

`Config` is a flat dictionary of sections; each section is a dictionary of `char*` values. No typed coercion at storage time — all values are raw strings.

### 1.4 API Surface

| Function | Signature | Notes |
|----------|-----------|-------|
| `configGetString` | `(config, section, key, char** out)` | Returns `false` if not found |
| `configGetInt` | `(config, section, key, int* out, base=0)` | Uses `strtol`; ignores trailing non-digit chars |
| `configGetDouble` | `(config, section, key, double* out)` | Uses `strtod` |
| `configGetBool` | `(config, section, key, bool* out)` | `int != 0` |
| `configGetIntList` | `(config, section, key, int* arr, count)` | Comma-separated list |
| `configSetString/Int/Double/Bool` | write variants | Used before `configWrite()` |

### 1.5 Command-Line Overrides

`configParseCommandLineArguments()` (`config.cc:79`) accepts arguments in the format `[section]key=value` and injects them before `settingsFromConfig()` reads them. No DH2 equivalent.

### 1.6 CE Sections and Keys

All keys read in `settingsFromConfig()` (`settings.cc:44`). Defaults defined in `settings.h`.

#### 1.6.1 `[system]`

| Key | CE default | Type | Description |
|-----|-----------|------|-------------|
| `executable` | `"game"` | string | Unused by CE; legacy |
| `master_dat` | `"master.dat"` | string | Path to master.dat |
| `master_patches` | `"data"` | string | Patch directory for master.dat |
| `critter_dat` | `"critter.dat"` | string | Path to critter.dat |
| `critter_patches` | `"data"` | string | Patch directory for critter.dat |
| `language` | `"english"` | string | `english`/`french`/`german`/`italian`/`spanish` |
| `scroll_lock` | `0` | int | Lock camera scrolling |
| `interrupt_walk` | `1` | bool | Interrupt walking on combat start |
| `art_cache_size` | `8` | int | ART sprite cache size in MB |
| `color_cycling` | `1` | bool | Animate palette-cycling effects |
| `cycle_speed_factor` | `1` | int | Palette cycle rate multiplier |
| `hashing` | `1` | bool | DAT file hash verification |
| `splash` | `0` | int | Number of times intro splash shown |
| `free_space` | `20480` | int | Minimum free disk space in KB |
| `times_run` | `0` | int | Counter incremented each launch |

#### 1.6.2 `[preferences]`

| Key | CE default | Type | Valid range / values | Description |
|-----|-----------|------|---------------------|-------------|
| `game_difficulty` | `1` | int | 0=Easy, 1=Normal, 2=Hard | Loot/XP/shop multipliers; skill modifier for 9 skills |
| `combat_difficulty` | `1` | int | 0=Easy, 1=Normal, 2=Hard | Enemy HP and to-hit modifiers; damage calculation |
| `violence_level` | `3` | int | 0=None, 1=Minimal, 2=Normal, 3=Maximum Blood | Limb fly-off, blood pool, death animations |
| `target_highlight` | `1` | int | 0=Off, 1=Targeting Only, 2=All | Highlight enemies in targeting cursor mode |
| `item_highlight` | `1` | bool | 0/1 | Highlight items on cursor hover |
| `combat_looks` | `0` | bool | 0/1 | Enable "look" in combat |
| `combat_messages` | `1` | bool | 0=Verbose, 1=Brief (stored inverted) | Combat log verbosity |
| `combat_taunts` | `1` | bool | 0/1 | Allow NPC combat taunts |
| `language_filter` | `0` | bool | 0/1 | Bleep profanity |
| `running` | `0` | bool | 0=Walk, 1=Run | Default movement speed |
| `subtitles` | `0` | bool | 0/1 | Show subtitles for speech |
| `combat_speed` | `0` | int | 0–50 | Combat animation delay: 0=slowest (longest pause per frame), 50=fastest |
| `player_speed` | `0` | bool | 0/1 | Player speed-up cheat |
| `text_base_delay` | `3.5` | double | 1.0–6.0 | Seconds before floating text auto-expires (see §6) |
| `text_line_delay` | `1.4` | double | — | Per-line delay for multi-line floating text; derived, not user input |
| `brightness` | `1.0` | double | 1.0–1.18 | Display brightness multiplier |
| `mouse_sensitivity` | `1.0` | double | 1.0–2.5 | Mouse speed multiplier |
| `running_burning_guy` | `1` | bool | 0/1 | Allow burning NPCs to run |

Example `[preferences]` block as it appears in `fallout2.cfg`:
```
game_difficulty = 1
combat_difficulty = 1
violence_level = 3
target_highlight = 1
combat_messages = 1
combat_looks = 0
combat_taunts = 1
language_filter = 0
running = 0
subtitles = 0
item_highlight = 1
combat_speed = 0
text_base_delay = 3.5
text_line_delay = 1.0    ; derived, not a user input
player_speedup = 0
brightness = 1.0
mouse_sensitivity = 1.0
```

#### 1.6.3 `[sound]`

| Key | CE default | Type | Description |
|-----|-----------|------|-------------|
| `initialize` | `1` | bool | Enable audio subsystem |
| `sounds` | `1` | bool | Enable sound effects |
| `music` | `1` | bool | Enable background music |
| `speech` | `1` | bool | Enable voiced speech |
| `master_volume` | `22281` | int | 0–32767 |
| `music_volume` | `22281` | int | 0–32767 |
| `sndfx_volume` | `22281` | int | 0–32767 |
| `speech_volume` | `22281` | int | 0–32767 |
| `cache_size` | `448` | int | Sound cache in KB |
| `music_path1` | `"sound\\music\\"` | string | Primary music directory |
| `music_path2` | `"sound\\music\\"` | string | Fallback music directory |
| `device` | `-1` | int | Audio device ID (-1=default) |
| `port`/`irq`/`dma` | `-1` | int | Legacy DOS hardware config; unused in CE |
| `debug` | `0` | bool | Audio debug logging |
| `debug_sfxc` | `1` | bool | Sound-effects cache debug logging |

Example `[sound]` block:
```
master_volume = 22281
music_volume = 22281
sndfx_volume = 22281
speech_volume = 22281
```

#### 1.6.4 `[debug]`

| Key | CE default | Type | Description |
|-----|-----------|------|-------------|
| `mode` | `"environment"` | string | Debug output destination |
| `show_tile_num` | `0` | bool | Overlay tile numbers on map |
| `show_script_messages` | `0` | bool | Print script debug_message() to log |
| `show_load_info` | `0` | bool | Log file-load operations |
| `output_map_data_info` | `0` | bool | Print map statistics on load |

#### 1.6.5 `[mapper]`

Mapper-only keys — not relevant to the game engine. Loaded by `settingsFromConfig()` but ignored unless CE was launched in mapper mode.

---

## 2. Preference System Overview

CE stores all preferences in two places:

1. **`fallout2.cfg`** (`[preferences]` and `[sound]` sections): loaded at startup by `settingsLoad()`, flushed on DONE by `_SavePrefs(save=true)`.
2. **Save slot binary** (`preferencesSave` / `preferencesLoad`): preferences are embedded in each save file so they travel with the save. On load, `_SavePrefs(save=false)` copies them back to `settings` without re-writing the config file.

Three button types in the Preferences window (`preferences.cc`):

| Type | Controls | Range |
|------|----------|-------|
| Primary (4-way rotary knob) | Game Difficulty, Combat Difficulty, Violence Level, Target Highlight, Combat Looks | 0–2 or 0–3 |
| Secondary (2-way toggle switch) | Combat Messages, Combat Taunts, Language Filter, Running, Subtitles, Item Highlight | 0–1 |
| Range (continuous slider) | Combat Speed, Text Base Delay, volumes × 4, Brightness, Mouse Sensitivity | continuous |
| Special checkbox | Player Speedup | 0–1 |

`preferencesSetDefaults(true)` resets all preferences to their factory values and immediately applies them. CANCEL restores the previous session's values via `_RestoreSettings()`. On DONE, `_changed` flag triggers `_SavePrefs(1)` + `_JustUpdate_()` + `_combat_highlight_change()`.

---

## 3. Full Preference Table

### 3.1 Primary Preferences (4-way rotary knob)

| CE key (`settings.preferences.*`) | Values | Default | CE gameplay effect |
|------------------------------------|--------|---------|-------------------|
| `game_difficulty` | 0=Easy, 1=Normal, 2=Hard | **1 (Normal)** | Skill modifier: Easy +20%, Normal 0%, Hard -10% on specific skills (First Aid, Doctor, Sneak, Lockpick, Steal, Traps, Science, Repair, Outdoorsman). Applied via `skillGetGameDifficultyModifier()` in `skill.cc`. |
| `combat_difficulty` | 0=Easy, 1=Normal, 2=Hard | **1 (Normal)** | Damage dealt to player and enemy HP modifiers. Easy = player takes less; Hard = player takes more. Separate from game difficulty. |
| `violence_level` | 0=None, 1=Minimum Blood, 2=Normal, 3=Maximum Blood | **3 (Maximum Blood)** | Controls death animation and gore: 0=no gore, 1=minimal, 2=normal, 3=full mutilation animations. CE checks this before playing violent animation FIDs. |
| `target_highlight` | 0=Off, 1=Targeting Only, 2=All | **1 (Targeting Only)** | Whether enemies glow/highlight when targeted. Targeting Only = only during combat targeting; All = always; Off = never. `_combat_highlight_change()` fires on change. |
| `combat_looks` | 0=Off, 1=On | **0 (Off)** | When On, hovering the cursor over critters in combat shows an info string (HP, description). |

### 3.2 Secondary Preferences (2-way toggle)

Note: `combat_messages` storage is inverted in the source — stored value 0 = verbose, 1 = brief. The UI XORs the value when drawing the switch position. All others: 0 = left/first label, 1 = right/second label.

| CE key | Labels | Default stored value | CE gameplay effect |
|--------|--------|---------------------|-------------------|
| `combat_messages` | Verbose / Brief | **1 (Brief)** | Verbose: full text description of every hit ("You hit the Radscorpion in the eyes for 14 damage!"). Brief: shortened one-line combat roll. `_scr_message_free()` reloads message cache on change. |
| `combat_taunts` | Off / On | **1 (On)** | When On, critters voice combat taunts during battle. `aiMessageListReloadIfNeeded()` called via `_JustUpdate_`. |
| `language_filter` | Off / On | **0 (Off)** | When On, censors profanity in all message text. `_scr_message_free()` reloads on change. |
| `running` | Walk / Run | **0 (Walk)** | 0 = default movement is walk; 1 = default is run. Does not prevent the player from manually switching. |
| `subtitles` | Off / On | **0 (Off)** | When On, displays subtitle text for speech audio. In CE, speech files must be present; subtitles render from `.msg` text. |
| `item_highlight` | Off / On | **1 (On)** | When On, pressing Tab highlights interactable items on the ground. `gameMouseLoadItemHighlight()` called on change. |

### 3.3 Range Preferences (continuous slider)

| CE key | Range | Default | CE gameplay effect |
|--------|-------|---------|-------------------|
| `combat_speed` | 0–50 (int) | **0** | Millisecond delay added per combat animation step. 0 = no delay (fastest); 50 = maximum pause. Applies after each hit, death, and movement step in combat. |
| `text_base_delay` | 1.0–6.0 (float) | **3.5** | Base duration in seconds for floating text messages above critters. Calls `textObjectsSetBaseDelay()`. Derived `text_line_delay = (base - 1.0) × 0.4`, clamped [0, 2]. See §6 for floating text architecture. |
| `master_volume` | 0–32767 | **22281** (~68%) | Master gain applied to all audio channels. `gameSoundSetMasterVolume()`. |
| `music_volume` | 0–32767 | **22281** | Background music gain. `backgroundSoundSetVolume()`. |
| `sndfx_volume` | 0–32767 | **22281** | Sound effects gain. `soundEffectsSetVolume()`. Plays `butin1` sample while dragging. |
| `speech_volume` | 0–32767 | **22281** | Speech / voice-over gain. `speechSetVolume()`. Plays `narrator\options` sample while dragging. |
| `brightness` | 1.0–1.18 | **1.0** | Palette brightness multiplier. `colorSetBrightness()` adjusts colour palette entries in-engine. Also adjustable at any time via `+`/`-` keys. |
| `mouse_sensitivity` | 1.0–2.5 | **1.0** | Mouse movement multiplier. `mouseSetSensitivity()`. |

### 3.4 Special Checkbox

| CE key | Default | CE effect |
|--------|---------|-----------|
| `player_speedup` | **0 (Off)** | "Affect Player Speed" — when On, the player character moves at animation speed in sync with combat animation delay rather than always at full walk speed. Checkbox only; no CE default change. |

---

## 4. DH2 Config System

### 4.1 Architecture

`src/config.ts` holds the defaults (CE `settings.h` values; `Config` is also `window.Config`). At startup `src/ui_options/fallout2Cfg.ts` reads `fallout2.cfg` (CE `configParseLine` / `settingsFromConfig`): `[preferences]`, `[sound]`, `[system]` keys that matter in a browser, plus a `[dh2]` section for DH2-only options (window dragging, overlays, edge scroll, Pip-Boy at start, day/night curve …, see README). The asset pipeline's `write_config` stage (`tools/fallout2Cfg.py`) creates the file with CE `gameConfigInit` defaults and never overwrites it. Changes made in the Preferences window are kept in `localStorage` (`dh2_preferences`) and win over the file — a browser can't write the file back (S-CI5).

### 4.2 Preferences (CE `preferences.cc`)

The Preferences window (`src/ui_options.ts buildPrefsPanel`) is CE's at CE pixel positions: the five 4-way knobs (game / combat difficulty, violence, target highlight, combat looks), the six toggles (combat messages, taunts, language filter, running, subtitles, item highlight), the sliders (combat speed + player speedup, text delay, the four volumes, brightness, mouse sensitivity) and DEFAULT / DONE / CANCEL. DEFAULT is `preferencesSetDefaults` (incl. the volumes at 22281 / 32767); CANCEL restores the values from when the window opened.

| CE key | DH2 field | CE default | Consumed in |
|--------|-----------|------------|-------------|
| `game_difficulty` | `Config.combat.gameDifficultyModifier` (75 / 100 / 125) | 1 (Normal) | skills, encounter rate / pick / count |
| `combat_difficulty` | `Config.combat.difficultyModifier` | 1 | combat damage |
| `violence_level` | `Config.combat.violenceLevel` | 3 (Maximum Blood) | death animations, blood (`critter/deathAnim.ts`, `lifecycle.ts`), `metarule VIOLENCE_FILTER` |
| `target_highlight` | `Config.ui.targetHighlight` (off / on / targeting-only) | targeting only | combat outlines |
| `combat_looks` | `Config.ui.combatLooks` | off | HUD look messages |
| `combat_messages` | `Config.ui.combatMessages` | verbose | critical-hit lines |
| `combat_taunts` | `Config.ui.combatTaunts` | on | AI taunts |
| `language_filter` | `Config.ui.languageFilter` | off | `metarule LANGUAGE_FILTER` |
| `running` | `Config.engine.doAlwaysRun` | off | walking / running |
| `subtitles` | `Config.ui.subtitles` | off | movie / slide subtitles |
| `item_highlight` | `Config.ui.itemHighlight` | on | item outlines (Tab) |
| `combat_speed`, `player_speedup` | `Config.combat.combatSpeed`, `Config.engine.playerSpeedup` | 0, off | walk fps in combat |
| `text_base_delay` | `Config.ui.textBaseDelay` | 3.5 | float text time (line delay derived as CE) |
| `brightness`, `mouse_sensitivity` | `Config.ui.brightness`, `Config.ui.mouseSensitivity` | 1.0 | brightness filter; sensitivity stored only |
| `running_burning_guy` | `Config.combat.runningBurningGuy` | on | `metarule3` / death anim |
| `master_volume` … `speech_volume` | `audioEngine` (0–100) | 22281 / 32767 | Web Audio gains |

### 4.3 DH2-only switches

Debug and engine toggles (`Config.ui.show*`, `Config.engine.*`, `Config.scripting.debugLogShowType`) have no CE key; the user-facing ones are `[dh2]` keys and console commands (README → Configuration).

### 4.4 URL Query Parameter

`?mapname` in the URL loads that map directly (developer shortcut, no CE equivalent).

---

## 5. CE Options Window (`options.cc`)

The game menu (Escape / Menu button): SAVE GAME, LOAD GAME, PREFERENCES, EXIT GAME, DONE (keys S, L, P, E / Ctrl+Q / Ctrl+X / F10, O / D / Enter); `+` / `-` change the brightness. DH2 (`src/ui_options.ts initOptionsMenu`) has the same buttons and keys; the Preferences window is CE's separate window (§4.2). Credits are on the main menu, as in CE.

---

## 6. Floating Text Objects (`text_object.cc`)

This section documents CE's `textObjectsSetBaseDelay` system, which is driven by the `text_base_delay` preference (§3.3).

### 6.1 CE Architecture

CE maintains a fixed pool of up to `TEXT_OBJECTS_MAX_COUNT = 20` `TextObject` instances:

```c
typedef struct TextObject {
    Object*  owner;          // object the text floats above
    int      created_time;   // game time at creation
    int      tile;           // anchor tile number
    int      x, y;           // pixel offset within tile
    Buffer*  buffer;         // pre-rendered pixel data
    int      flags;          // MARKED_FOR_REMOVAL (0x01), UNBOUNDED (0x02)
} TextObject;
```

`textObjectAdd(obj, string, font, color, outlineColor, rect*)` — the main entry point called from `actions.cc` (e.g. `_show_damage_to_object` to display damage numbers in combat).

`textObjectFindPlacement` positions each new text object above the owner's tile and runs a collision check against all currently active text objects to prevent overlap.

Duration is computed from:
```
duration = gTextObjectsBaseDelay + (lineCount - 1) × gTextObjectsLineDelay
```
- `gTextObjectsBaseDelay` defaults to 3500 ms; configurable via `textObjectsSetBaseDelay(value)` which reads `settings.preferences.text_base_delay` (range 1.0–6.0 seconds).
- `gTextObjectsLineDelay = 1399 ms` per additional line beyond the first.

`textObjectsRenderInRect` is called each frame to blit active text objects into the main window buffer.

### 6.2 DH2 Equivalent

`src/floatText.ts` ports `textObjectAdd`: at most 20 messages; a new message of an owner replaces its old one (`textObjectsRemoveByOwner`); the text is word-wrapped at 200 px in the interface font (101, 103 for warnings), lines centred `lineHeight + 1` apart, drawn on black and outlined (`bufferOutline`); it stays on the tile the owner stood on, placed by `textObjectFindPlacement` (centred 60 px above the tile, else the fallback spots that fit the view). The display time is `text_base_delay` + the CE line delay × the wrapped line count (`gameTick.ts`). Callers use `addFloatMessage`.

---

## 7. Known Gaps

| ID | Description | Status |
|----|-------------|--------|
| S-CI5 | Preferences changed in the game are kept in `localStorage`, not written back to `fallout2.cfg` (a browser can't write the file). | browser limit |
| S-CI10 | CE `[system]` keys for DAT paths, art cache, `times_run` … have no meaning with pre-baked assets. | N/A (by design) |
| — | `mouse_sensitivity` is stored and shown but doesn't scale the browser's pointer. | browser limit |

Fixed since the last audit: fallout2.cfg reading (S-CI1), separate game / combat difficulty (S-CI2), violence level (S-CI2b), combat speed (S-CI3, C50), running default (S-CI4), speech volume (S-CI6), item highlight (S-CI7), text delays (S-CI8), three-state target highlight (S-CI9), CANCEL / DEFAULT (S-PR1/2), combat messages / looks / taunts (S-PR3), brightness (S-PR4), language filter and running burning guy (S-PR5); 2026-10-18: CE defaults for violence (3) and target highlight (targeting only), DEFAULT sets combat messages to verbose and resets the volumes, float text as `textObjectAdd`. <!-- audited: 2026-10-18 -->
