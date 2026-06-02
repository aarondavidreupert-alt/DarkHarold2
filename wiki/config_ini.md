# Config & INI System

Cross-references: `wiki/preferences.md` (in-game preferences UI), `wiki/sound_system.md` (volume keys), `wiki/save_load.md` (localStorage persistence).

---

## 1. Overview

Fallout 2 persists all user and system settings in `fallout2.cfg`, a standard INI file. The CE engine reads it at startup via `configRead()` (`config.cc:273`) and writes it back on exit via `configWrite()` (`config.cc:313`).

DH2 has **no fallout2.cfg**. All configuration lives in a hard-coded in-memory TypeScript object (`src/config.ts`) with a separate localStorage layer for the subset of settings exposed in the in-game preferences panel.

---

## 2. CE File Format and Parser

### 2.1 File names

| Mode | File |
|------|------|
| Game | `fallout2.cfg` (`DEFAULT_GAME_CONFIG_FILE_NAME`, `game_config.h:8`) |
| Mapper | `mapper2.cfg` (`MAPPER_CONFIG_FILE_NAME`, `game_config.h:9`) |

### 2.2 INI grammar

```ini
; comment (semicolon truncates the rest of the line)
[section]
key=value     ; both key and value are whitespace-trimmed
```

`configParseLine()` (`config.cc:378`): finds `;` and truncates; if line starts with `[`, stores section name in `gConfigLastSectionKey`; otherwise splits on first `=` and stores the key-value pair under the current section. Lines without `=` outside a section throw no error — they're skipped.

### 2.3 C++ data structure

```c
// config.h:12-18
typedef Dictionary Config;         // key=section name, value=ConfigSection*
typedef Dictionary ConfigSection;  // key=INI key, value=char**
```

`Config` is a flat dictionary of sections; each section is a dictionary of `char*` values. No typed coercion at storage time — all values are raw strings.

### 2.4 API surface

| Function | Signature | Notes |
|----------|-----------|-------|
| `configGetString` | `(config, section, key, char** out)` | Returns `false` if not found |
| `configGetInt` | `(config, section, key, int* out, base=0)` | Uses `strtol`; ignores trailing non-digit chars |
| `configGetDouble` | `(config, section, key, double* out)` | Uses `strtod` |
| `configGetBool` | `(config, section, key, bool* out)` | `int != 0` |
| `configGetIntList` | `(config, section, key, int* arr, count)` | Comma-separated list |
| `configSetString/Int/Double/Bool` | write variants | Used before `configWrite()` |

### 2.5 Command-line overrides

`configParseCommandLineArguments()` (`config.cc:79`) accepts arguments in the format `[section]key=value` and injects them before `settingsFromConfig()` reads them. No DH2 equivalent.

---

## 3. CE Sections and Keys

All keys read in `settingsFromConfig()` (`settings.cc:44`). Defaults defined in `settings.h`.

### 3.1 `[system]`

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

### 3.2 `[preferences]`

| Key | CE default | Type | Valid range / values | Description |
|-----|-----------|------|---------------------|-------------|
| `game_difficulty` | `1` | int | 0=Easy, 1=Normal, 2=Hard | Loot/XP/shop multipliers |
| `combat_difficulty` | `1` | int | 0=Easy, 1=Normal, 2=Hard | Enemy HP and to-hit modifiers |
| `violence_level` | `3` | int | 0=None, 1=Minimal, 2=Normal, 3=Maximum Blood | Limb fly-off, blood pool, death animations |
| `target_highlight` | `2` | int | 0=Off, 1=On, 2=Targeting only | Highlight enemies in targeting cursor mode |
| `item_highlight` | `1` | bool | 0/1 | Highlight items on cursor hover |
| `combat_looks` | `0` | bool | 0/1 | Enable "look" in combat |
| `combat_messages` | `1` | bool | 0=Brief, 1=Verbose | Combat log verbosity |
| `combat_taunts` | `1` | bool | 0/1 | Allow NPC combat taunts |
| `language_filter` | `0` | bool | 0/1 | Bleep profanity |
| `running` | `0` | bool | 0=Walk, 1=Run | Default movement speed |
| `subtitles` | `0` | bool | 0/1 | Show subtitles for speech |
| `combat_speed` | `0` | int | 0–50 | Combat animation delay: 0=slowest (longest pause per frame), 50=fastest |
| `player_speed` | `0` | bool | 0/1 | Player speed-up cheat |
| `text_base_delay` | `3.5` | double | 1.0–6.0 | Seconds before dialogue text auto-advances |
| `text_line_delay` | `1.4` | double | — | Per-line delay for multi-line dialogue |
| `brightness` | `1.0` | double | 1.0–1.18 | Display brightness multiplier |
| `mouse_sensitivity` | `1.0` | double | 1.0–2.5 | Mouse speed multiplier |
| `running_burning_guy` | `1` | bool | 0/1 | Allow burning NPCs to run |

### 3.3 `[sound]`

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

### 3.4 `[debug]`

| Key | CE default | Type | Description |
|-----|-----------|------|-------------|
| `mode` | `"environment"` | string | Debug output destination |
| `show_tile_num` | `0` | bool | Overlay tile numbers on map |
| `show_script_messages` | `0` | bool | Print script debug_message() to log |
| `show_load_info` | `0` | bool | Log file-load operations |
| `output_map_data_info` | `0` | bool | Print map statistics on load |

### 3.5 `[mapper]`

Mapper-only keys — not relevant to the game engine. Loaded by `settingsFromConfig()` but ignored unless CE was launched in mapper mode.

---

## 4. DH2 Config System

### 4.1 Architecture

DH2 has no INI file. The `Config` object (`src/config.ts:3`) is a plain TypeScript `const` with hard-coded defaults. There is no `configRead()` or `configWrite()`. `Config` is also exposed as `window.Config` for browser DevTools inspection and live-mutation.

```typescript
// config.ts:141
if (typeof window !== 'undefined') {
    ;(window as any).Config = Config
}
```

### 4.2 Config structure

| DH2 namespace | CE section | Purpose |
|---------------|-----------|---------|
| `Config.ui` | `preferences` (partial) | Display, overlays, combat messages |
| `Config.engine` | `system` + `preferences` (partial) | Feature flags, script/render toggles |
| `Config.combat` | `preferences` (partial) | Difficulty, speed, violence |
| `Config.controls` | — (no CE equivalent) | Keyboard bindings |
| `Config.scripting.debugLogShowType` | `debug` (partial) | Per-category log flags |

### 4.3 Key-by-key mapping

**Gameplay-relevant preferences:**

| CE key | CE section | DH2 field | DH2 default | Notes |
|--------|-----------|-----------|-------------|-------|
| `game_difficulty` | preferences | `Config.combat.difficultyModifier` | `100` | DH2 encodes as modifier: 75=Easy, 100=Normal, 125=Hard. CE separates game_difficulty from combat_difficulty; DH2 conflates both. |
| `combat_difficulty` | preferences | *(same as above)* | — | No separate field in DH2 |
| `violence_level` | preferences | `Config.combat.violenceLevel` | `2` | CE values match: 0=None, 1=Minimal, 2=Normal, 3=Maximum. DH2 default is 2 (Normal); CE default is 3 (Maximum Blood). |
| `target_highlight` | preferences | `Config.ui.targetHighlight` | `true` | DH2 uses bool; CE uses 0/1/2. CE's "targeting only" mode has no DH2 equivalent. |
| `combat_messages` | preferences | `Config.ui.combatMessages` | `'verbose'` | CE: 0=Brief, 1=Verbose. DH2 uses string literals. |
| `running` | preferences | `Config.engine.doAlwaysRun` | `true` | CE default is false (walk). DH2 default is true (always run). |
| `subtitles` | preferences | `Config.ui.subtitles` | `false` | Match. DH2 has no speech audio, so this is moot. |
| `combat_speed` | preferences | `Config.combat.combatSpeed` | `2` | CE: 0–50 integer, 0=slowest, 50=fastest. DH2: 1=Slow, 2=Normal, 4=Fast. Inverse-scale semantics; see §CI3. |
| `master_volume` | sound | `audioEngine.masterVolume` | — | DH2 uses 0–100 float via Web Audio GainNode; CE uses 0–32767 integer. |
| `music_volume` | sound | `audioEngine.musicVolume` | — | Same scale difference. |
| `sndfx_volume` | sound | `audioEngine.sfxVolume` | — | Same scale difference. |

**Debug/render toggles (DH2-only, no CE key):**

| DH2 field | Default | Description |
|-----------|---------|-------------|
| `Config.ui.showHexOverlay` | `false` | Hex grid overlay |
| `Config.ui.showCoordinates` | `false` | Tile coordinates on hex grid |
| `Config.ui.showPath` | `false` | Player path visualization |
| `Config.ui.showBoundingBox` | `false` | Object bounding boxes |
| `Config.engine.debug` | `true` | Enable `src/debug.ts` utilities |
| `Config.engine.doDisasmOnUnimplOp` | `true` | Disassemble script on unknown opcode |
| `Config.engine.doLogLazyLoads` | `false` | Log image lazy-loads |
| `Config.engine.corpseTimeout` | `0` | Seconds until empty corpse removal (0=never) |
| `Config.combat.damageCalculationType` | `0` | 0=Vanilla, 1=Glovz, 2=Glovz+MultTweak, 5=YAAM |

### 4.4 Preferences persistence (localStorage)

The subset of preferences exposed in the in-game preferences panel (`ui_options.ts`) is serialised to JSON and stored in `localStorage` under key `'dh2_preferences'` (`ui_options.ts:52`). Read back by `loadPreferences()` on the next session.

Persisted fields:

| localStorage key | Config target |
|-----------------|--------------|
| `difficultyModifier` | `Config.combat.difficultyModifier` |
| `combatSpeed` | `Config.combat.combatSpeed` |
| `violenceLevel` | `Config.combat.violenceLevel` |
| `targetHighlight` | `Config.ui.targetHighlight` |
| `combatMessages` | `Config.ui.combatMessages` |
| `doAlwaysRun` | `Config.engine.doAlwaysRun` |
| `subtitles` | `Config.ui.subtitles` |
| `masterVolume` | `audioEngine.masterVolume` |
| `musicVolume` | `audioEngine.musicVolume` |
| `sfxVolume` | `audioEngine.sfxVolume` |

`speech_volume` is not persisted. Game and combat difficulty modifiers are separate CE concepts mapped to the same `difficultyModifier` value.

### 4.5 URL query parameter

`init.ts:45` reads `location.search` to determine the startup map:

```typescript
const mapFromQuery = location.search !== '' ? location.search.slice(1) : null
// Usage: http://localhost/?artemple  → loads artemple directly, bypassing main menu
```

This is a developer shortcut with no CE equivalent.

---

## 5. Known Gaps

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| CI1 | **No fallout2.cfg — all config is hardcoded.** DH2 has no file-based config; defaults are baked into `Config` in `src/config.ts`. User cannot change settings by editing a file between sessions. | `src/config.ts` | `config.cc:273 configRead()`; `game_config.h:8` | minor | missing |
| CI2 | **`game_difficulty` and `combat_difficulty` conflated.** CE has separate settings: `game_difficulty` affects skill checks, loot, XP; `combat_difficulty` affects enemy stats. DH2 maps both to a single `difficultyModifier` that only affects combat damage scaling. | `src/config.ts:62`; `src/ui_options.ts:205` | `settings.h:29-31`; `preferences.cc:371-372` | minor | missing |
| CI3 | **`combat_speed` uses inverse/incompatible scale.** CE: integer 0–50 where 0=slowest (maximum ms-per-frame delay) and 50=fastest. DH2: discrete values 1/2/4 where 1=Slow, 4=Fast. Semantics are reversed and not directly translatable. | `src/config.ts:67` | `preferences.cc:382`; `game_config.h:44` | low | bug |
| CI4 | **`running` defaults differ.** CE default is `false` (walk by default); DH2 `doAlwaysRun` defaults to `true` (always run). Affects feel for new players. | `src/config.ts:41` | `settings.h:38` | low | bug |
| CI5 | **Preferences stored in localStorage, not fallout2.cfg.** On platforms where localStorage is cleared (private browsing, cache clear), preferences reset. CE writes back to fallout2.cfg on exit. | `src/ui_options.ts:332` | `settings.cc:118 settingsToConfig()`; `config.cc:313 configWrite()` | minor | missing |
| CI6 | **`speech_volume` not persisted.** The CE `speech_volume` key is loaded and saved. DH2 `savePreferences()` omits `sfxVolume`'s speech equivalent entirely. | `src/ui_options.ts:315` | `settings.cc:93` | low | bug |
| CI7 | **`item_highlight` setting absent.** CE lets users toggle item-highlighting on cursor hover. DH2 has no `item_highlight` Config field or UI toggle. | `src/config.ts` | `game_config.h:37`; `settings.h:33` | low | missing |
| CI8 | **No `text_base_delay` / `text_line_delay`.** CE auto-advances dialogue after a configurable delay (default 3.5s/line). DH2 has no auto-advance for dialogue text. | `src/config.ts` | `game_config.h:46-47`; `settings.h:42-43` | low | missing |
| CI9 | **`target_highlight` loses "targeting only" mode.** CE has three states (Off/On/Targeting-only). DH2 collapses this to a boolean. | `src/ui_options.ts:232-237` | `game_config.h:36`; `game_config.h:111-115 TargetHighlight enum` | low | bug |
| CI10 | **CE system keys entirely absent.** `master_dat`, `master_patches`, `critter_dat`, `language`, `art_cache_size`, `times_run`, etc. have no DH2 equivalents — assets are pre-baked and paths are hard-coded in the asset pipeline. | `src/config.ts` | `settings.h:10-26` | — | N/A (by design) |

Last audited: 2026-06-02
