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
`src/encounters.ts` (barrel; `src/encounters/{conditionLang,resolver}.ts`) (consumption of `Config.combat.gameDifficultyModifier`, encounter rate)

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

DH2 has **no fallout2.cfg**. All configuration lives in a hard-coded in-memory TypeScript object (`src/config.ts`) with a separate localStorage layer for the subset of settings exposed in the in-game preferences panel. There is no `configRead()` or `configWrite()`. `Config` is also exposed as `window.Config` for browser DevTools inspection and live-mutation.

```typescript
// config.ts:141
if (typeof window !== 'undefined') {
    ;(window as any).Config = Config
}
```

### 4.2 Config Structure

| DH2 namespace | CE section | Purpose |
|---------------|-----------|---------|
| `Config.ui` | `preferences` (partial) | Display, overlays, combat messages |
| `Config.engine` | `system` + `preferences` (partial) | Feature flags, script/render toggles |
| `Config.combat` | `preferences` (partial) | Difficulty, speed, violence |
| `Config.controls` | — (no CE equivalent) | Keyboard bindings |
| `Config.scripting.debugLogShowType` | `debug` (partial) | Per-category log flags |

### 4.3 Key-by-Key Mapping

**Gameplay-relevant preferences:**

| CE key | CE section | DH2 field | DH2 default | Notes |
|--------|-----------|-----------|-------------|-------|
| `game_difficulty` | preferences | `Config.combat.gameDifficultyModifier` | `100` | DH2 encodes as modifier: 75=Easy, 100=Normal, 125=Hard. **FIXED 2026-07-04 (S-CI2)**: now a field separate from combat_difficulty, driving skill checks + encounter rate. |
| `combat_difficulty` | preferences | `Config.combat.difficultyModifier` | `100` | Same 75/100/125 encoding; damage multiplier only. Separate field from `game_difficulty` as of the S-CI2 fix. |
| `violence_level` | preferences | `Config.combat.violenceLevel` | `2` | CE values match: 0=None, 1=Minimal, 2=Normal, 3=Maximum. DH2 default is 2 (Normal); CE default is 3 (Maximum Blood). |
| `target_highlight` | preferences | `Config.ui.targetHighlight` | `true` | DH2 uses bool; CE uses 0/1/2. CE's "Targeting Only" mode has no DH2 equivalent (see §7 gap S-CI9). |
| `combat_messages` | preferences | `Config.ui.combatMessages` | `'verbose'` | CE: 0=Verbose, 1=Brief (stored inverted). DH2 uses string literals. |
| `running` | preferences | `Config.engine.doAlwaysRun` | `true` | CE default is false (walk). DH2 default is true (always run) — see §7 gap S-CI4. |
| `subtitles` | preferences | `Config.ui.subtitles` | `false` | Match. DH2 has no speech audio, so this is moot. |
| `combat_speed` | preferences | `Config.combat.combatSpeed` | `2` | CE: 0–50 integer, 0=slowest, 50=fastest. DH2: discrete values 1/2/4 where 1=Slow, 4=Fast. Inverse-scale semantics — see §7 gap S-CI3. |
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

### 4.4 SavedPreferences (localStorage Persistence)

The subset of preferences exposed in the in-game preferences panel (`ui_options.ts`) is serialised to JSON and stored in `localStorage` under key `'dh2_preferences'` (`ui_options.ts:52`). Read back by `loadPreferences()` on the next session.

Persisted fields:

| localStorage key | Config target |
|-----------------|--------------|
| `difficultyModifier` | `Config.combat.difficultyModifier` |
| `gameDifficultyModifier` | `Config.combat.gameDifficultyModifier` |
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

### 4.5 Persisted Options Panel Controls

DH2's in-game preferences panel (`UIMode.options` = 15) is built lazily via `buildPrefsPanel()`, opened from the Options menu (Preferences button or `P` key), and closed on DONE. `loadPreferences()` is called at startup to restore from `localStorage`. There is no CANCEL equivalent — changes take effect immediately. There is no DEFAULT button.

The panel exposes 10 controls:

> **Note (2026-07-04):** `buildPrefsPanel()` has been substantially rewritten
> since this table was last fully audited (2026-06-02) — it now positions
> controls at exact CE pixel coordinates via `primaryKnob`/`checkboxBtn`/
> `redButton` helpers and has more than 10 rows. Only the Game/Combat
> Difficulty row below has been re-verified as part of the S-CI2 fix; the
> rest of this table may be stale and needs a full re-pass.

| DH2 label | CE equivalent | DH2 Config field | Values | Default |
|-----------|--------------|-----------------|--------|---------|
| Game Difficulty | `game_difficulty` | `Config.combat.gameDifficultyModifier` | 75=Easy, 100=Normal, 125=Hard | 100 |
| Combat Difficulty | `combat_difficulty` | `Config.combat.difficultyModifier` | 75=Easy, 100=Normal, 125=Hard | 100 |
| Combat Speed | `combat_speed` | `Config.combat.combatSpeed` | 1=Slow, 2=Normal, 4=Fast | 2 |
| Violence Level | `violence_level` | `Config.combat.violenceLevel` | 0–3 | 2 |
| Target Highlight | `target_highlight` | `Config.ui.targetHighlight` | true/false | true |
| Combat Messages | `combat_messages` | `Config.ui.combatMessages` | 'brief'/'verbose' | 'verbose' |
| Running | `running` | `Config.engine.doAlwaysRun` | true/false | true |
| Subtitles | `subtitles` | `Config.ui.subtitles` | true/false | false |
| Master Volume | `master_volume` | audioEngine (0–100) | 0–100 | 100 |
| Music Volume | `music_volume` | audioEngine (0–100) | 0–100 | 100 |
| SFX Volume | `sndfx_volume` | audioEngine (0–100) | 0–100 | 100 |

### 4.6 Config Fields Not Exposed in Panel

Several `Config` fields map to CE preferences but are not accessible in the panel:

| Config field | CE equivalent | Status |
|-------------|--------------|--------|
| `Config.combat.damageCalculationType` | *(no CE equivalent — DH2-only)* | Hardcoded 0=Vanilla; not a user option |
| `Config.engine.doAlwaysRun` | `running` | Wired (in panel) |
| `Config.ui.showRoof`, `showFloor`, `showObjects`, etc. | *(debug toggles)* | Dev-only, keyboard shortcuts in `main.ts` |
| `Config.scripting.debugLogShowType.*` | *(no CE equivalent)* | Dev-only logging flags |
| `Config.controls.*` | *(key bindings)* | Hardcoded; no UI to remap |

### 4.7 Consumption of Preferences in DH2

How each setting's stored value actually affects gameplay:

| CE preference | DH2 Config field | Consumed in | Effect |
|--------------|-----------------|-------------|--------|
| `game_difficulty` | `Config.combat.gameDifficultyModifier` | `skills.ts:187` (skill modifier), `encounters.ts` (encounter rate) | 75=Easy: +20% on difficulty-affected skills, reduced encounter rate. 125=Hard: -10% skills, increased encounter rate. **FIXED 2026-07-04 (S-CI2)**: now a field separate from `combat_difficulty`. |
| `combat_difficulty` | `Config.combat.difficultyModifier` | `combat/Combat.ts:333,398` (damage) | 75=Easy: reduced incoming combat damage. 125=Hard: increased damage. Separate field from `game_difficulty` as of the S-CI2 fix. |
| `running` | `Config.engine.doAlwaysRun` | `main.ts:190,213,231`, `object.ts` | Controls whether player walks or runs by default when moving. Fully wired. |
| `violence_level` | `Config.combat.violenceLevel` | *(not consumed)* | Stored in Config; no code reads it for death animation gating. No effect — see §7 gap S-CI2b. |
| `combat_speed` | `Config.combat.combatSpeed` | *(not consumed)* | Stored in Config; no combat loop reads it for delays. No effect — see §7 gap S-CI3. |
| `target_highlight` | `Config.ui.targetHighlight` | *(not consumed)* | Stored in Config; nothing reads it to control enemy highlighting. No effect — see §7 gap S-CI9. |
| `combat_messages` | `Config.ui.combatMessages` | *(not consumed)* | Stored in Config; combat log message formatting does not read it. No effect. |
| `subtitles` | `Config.ui.subtitles` | *(not consumed)* | Stored in Config; no speech audio path exists. No effect — see §7 gap S-CI8. |
| `master_volume`, `music_volume`, `sndfx_volume` | `audioEngine.setVolume()` | `audio.ts` Web Audio API gain nodes | Fully wired. Volumes affect all sounds immediately. |
| `speech_volume` | *(not in SavedPreferences)* | — | Not persisted. CE speech volume separate from SFX; DH2 has no speech audio. |

### 4.8 URL Query Parameter

`init.ts:45` reads `location.search` to determine the startup map:

```typescript
const mapFromQuery = location.search !== '' ? location.search.slice(1) : null
// Usage: http://localhost/?artemple  → loads artemple directly, bypassing main menu
```

This is a developer shortcut with no CE equivalent.

---

## 5. CE Options Window (`options.cc`)

CE `options.cc` implements the in-game pause/options overlay — a separate window from the Preferences window in `preferences.cc`. It is opened when the player presses Escape or clicks the Menu button on the HUD.

The Options window presents a row of 6 action buttons plus the same 5 audio sliders that appear in the Preferences window:

| Button | Action |
|--------|--------|
| Done | Close the overlay and resume play |
| Save Game | Open the save-game screen |
| Load Game | Open the load-game screen |
| Preferences | Open the Preferences window (launches `doPreferences()`) |
| Credits | Play the credits sequence |
| Exit to DOS | Quit the game entirely |

Audio sliders (Master, Music, SFX, Speech, Brightness) are inline copies of the Preferences sliders, sharing the same `settings.sound.*` / `settings.preferences.brightness` storage.

### 5.1 DH2 Equivalent

`UIMode.options` (= 15) panel in `src/ui_options.ts`, opened via the "Menu" HUD button (wired in `src/ui.ts`). The panel is a `WindowFrame` overlay built by `buildPrefsPanel()`.

DH2 collapses the Options overlay and Preferences window into a single panel; CE keeps them as separate windows.

**DH2 gaps vs CE `options.cc`:**
- No CANCEL button: changes to sliders are applied immediately; CE reverts on Cancel via `_RestoreSettings()`.
- No DEFAULT / reset-to-defaults button: CE's Preferences sub-window has a DEFAULT button that calls `preferencesSetDefaults(true)`.
- No Credits button: credits sequence not implemented.
- No Exit to DOS equivalent beyond closing the browser tab.

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

| CE component | DH2 equivalent | Location |
|-------------|---------------|---------|
| `TextObject` pool (max 20) | `globalState.floatMessages[]` array | `src/globalState.ts:74` |
| `textObjectsRenderInRect` | Float message render loop | `src/renderer.ts:207–216` |
| Duration / expiry check | `main.ts:1011–1013` | Compared against `Config.ui.floatMessageDuration` |
| `float_msg` opcode (0x810A) | `Script.float_msg()` | `src/scripting.ts`; wired in `src/vm_bridge.ts` |

`Config.ui.floatMessageDuration` is fixed at 3 seconds (equivalent to CE's base delay default of 3.5 s, but not configurable at runtime).

### 6.3 DH2 Gaps vs CE

| Gap | CE behaviour | DH2 behaviour |
|-----|-------------|--------------|
| Configurable duration | `text_base_delay` preference (1–6 s) fed into `textObjectsSetBaseDelay()` | Fixed 3 s (`Config.ui.floatMessageDuration`); preference not wired |
| Per-line delay | `gTextObjectsLineDelay = 1399 ms` × extra lines | Not implemented; all messages use the flat duration |
| Collision avoidance | `textObjectFindPlacement` checks active objects and shifts upward to avoid overlap | No placement logic; messages may stack on the same pixel |
| Font / color / outline | `textObjectAdd` accepts font, foreground color, and outline color; each message can differ | Font/color/outline ignored; DH2 renders plain HTML text |
| Maximum concurrent | Hard cap of 20 via `TEXT_OBJECTS_MAX_COUNT` | No cap; array grows unbounded (small in practice) |

---

## 7. Known Gaps

Gaps prefixed `S-CI` were originally `CI` in `config_ini.md`; prefixed `S-PR` were originally from `preferences.md`.

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| S-CI1 | **No fallout2.cfg — all config is hardcoded.** DH2 has no file-based config; defaults are baked into `Config` in `src/config.ts`. User cannot change settings by editing a file between sessions. | `src/config.ts` | `config.cc:273 configRead()`; `game_config.h:8` | minor | missing |
| S-CI2 | ✅ FIXED 2026-07-04 — `Config.combat.gameDifficultyModifier` (skill checks, `skill.cc:1129`; encounter rate, `worldmap.cc:3406`) is now separate from `Config.combat.difficultyModifier` (damage only, `combat.cc:4552-4572`). The two can now be mixed independently (e.g. Hard game difficulty with Easy combat difficulty), matching CE. No CE loot/XP effect from `game_difficulty` was actually found in source — that part of the original gap description didn't hold up. | `src/config.ts`; `src/skills.ts`; `src/worldmap/encounters.ts`; `src/ui_options.ts`; `src/ui_options/preferences.ts` | `settings.h:29-31`; `skill.cc:1129`; `worldmap.cc:3406`; `combat.cc:4552-4572` | minor | fixed |
| S-CI2b | **Violence Level stored but not gated.** `Config.combat.violenceLevel` is set by the panel and persisted, but no code checks it before playing death animations or gore FX. All deaths render with full animation regardless of setting. | `src/combat.ts` | `preferences.cc` violence_level checks | minor | missing |
| S-CI3 | **`combat_speed` uses inverse/incompatible scale.** CE: integer 0–50 where 0=slowest (maximum ms-per-frame delay) and 50=fastest. DH2: discrete values 1/2/4 where 1=Slow, 4=Fast. Semantics are reversed and not directly translatable. Additionally, `Config.combat.combatSpeed` is not consumed at runtime — no combat loop reads it. | `src/config.ts:67` | `preferences.cc:382`; `game_config.h:44` | low | bug |
| S-CI4 | **`running` defaults differ.** CE default is `false` (walk by default); DH2 `doAlwaysRun` defaults to `true` (always run). Affects feel for new players. | `src/config.ts:41` | `settings.h:38` | low | bug |
| S-CI5 | **Preferences stored in localStorage, not fallout2.cfg.** On platforms where localStorage is cleared (private browsing, cache clear), preferences reset. CE writes back to fallout2.cfg on exit. | `src/ui_options/preferences.ts` | `settings.cc:118 settingsToConfig()`; `config.cc:313 configWrite()` | minor | missing |
| S-CI6 | **`speech_volume` not persisted.** The CE `speech_volume` key is loaded and saved. DH2 `savePreferences()` omits `sfxVolume`'s speech equivalent entirely. | `src/ui_options/preferences.ts` | `settings.cc:93` | low | bug |
| S-CI7 | **`item_highlight` setting absent.** CE lets users toggle item-highlighting on cursor hover. DH2 has no `item_highlight` Config field or UI toggle. | `src/config.ts` | `game_config.h:37`; `settings.h:33` | low | missing |
| S-CI8 | **No `text_base_delay` / `text_line_delay`.** CE auto-expires floating text after a configurable delay (default 3.5s). DH2 uses a fixed `floatMessageDuration = 3s` with no per-line delay and no collision avoidance (see §6.3 for full gap list). | `src/config.ts` | `game_config.h:46-47`; `settings.h:42-43`; `text_object.cc` | low | missing |
| S-CI9 | **`target_highlight` loses "Targeting Only" mode.** CE has three states (Off/Targeting Only/All). DH2 collapses this to a boolean; the intermediate "Targeting Only" state is unavailable. Also, `Config.ui.targetHighlight` is not consumed at runtime — enemies are never highlighted regardless of setting. | `src/ui_options.ts` | `game_config.h:36`; `game_config.h:111-115 TargetHighlight enum` | low | bug |
| S-CI10 | **CE system keys entirely absent.** `master_dat`, `master_patches`, `critter_dat`, `language`, `art_cache_size`, `times_run`, etc. have no DH2 equivalents — assets are pre-baked and paths are hard-coded in the asset pipeline. | `src/config.ts` | `settings.h:10-26` | — | N/A (by design) |
| S-PR1 | **No CANCEL in preferences panel.** CE `_RestoreSettings()` reverts the session's values on Cancel. DH2 applies all changes immediately with no revert path. | `src/ui_options.ts` | `preferences.cc _RestoreSettings()` | low | missing |
| S-PR2 | **No DEFAULT button.** CE `preferencesSetDefaults(true)` resets all settings to factory values. DH2 has no equivalent. | `src/ui_options.ts` | `preferences.cc preferencesSetDefaults()` | low | missing |
| S-PR3 | **`combat_messages` and `combat_looks` and `combat_taunts` not consumed.** Stored in Config / panel, but the combat log and AI message systems do not read them at runtime. | `src/combat.ts` | `preferences.cc` | low | missing |
| S-PR4 | **`brightness` has no WebGL equivalent.** CE adjusts the global colour palette via `colorSetBrightness()`, a palette-level operation. DH2 uses WebGL 2.0 with per-tile colour LUTs; there is no global brightness knob. Implementing it would require a uniform in the fragment shader. | `src/config.ts` | `preferences.cc brightnessIncrease/Decrease` | low | missing |
| S-PR5 | **`language_filter`, `running_burning_guy` absent.** These CE preferences have no DH2 Config field or panel equivalent. | `src/config.ts` | `settings.h` | low | missing |

<!-- audited: 2026-06-02 -->
