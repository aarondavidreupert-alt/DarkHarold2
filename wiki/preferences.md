# DarkHarold2 — Preferences / Game Options

**Audited:** 2026-06-01  
**CE ref:** `raw/fallout2-ce/src/preferences.cc` (`preferencesInit`, `preferencesSetDefaults`,
`_SetSystemPrefs`, `_JustUpdate_`, `_SavePrefs`, `preferencesSave`, `preferencesLoad`,
`doPreferences`, `_DoThing`, `_UpdateThing`, `brightnessIncrease`, `brightnessDecrease`)  
**DH2 ref:** `src/config.ts` (all Config fields and defaults),
`src/ui_options.ts` (`buildPrefsPanel`, `loadPreferences`, `savePreferences`, `SavedPreferences`),
`src/main.ts` (consumption of `Config.engine.doAlwaysRun`),
`src/combat.ts` (consumption of `Config.combat.difficultyModifier`),
`src/skills.ts` (consumption of `Config.combat.difficultyModifier` as game difficulty),
`src/encounters.ts` (consumption of `Config.combat.difficultyModifier`)

---

## 1. CE Preference System Overview

CE stores all preferences in two places:

1. **`fallout2.cfg` / `fallout.cfg`** (text INI file, `[preferences]` and `[sound]` sections):
   loaded at startup by `settingsLoad()`, flushed on DONE by `_SavePrefs(save=true)`.
2. **Save slot binary** (`preferencesSave` / `preferencesLoad`): preferences are embedded
   in each save file so they travel with the save. On load, `_SavePrefs(save=false)` copies
   them back to `settings` without re-writing the config file.

Three button types in the Preferences window:

| Type | Controls | Range |
|---|---|---|
| Primary (4-way rotary knob) | Game Difficulty, Combat Difficulty, Violence Level, Target Highlight, Combat Looks | 0–2 or 0–3 |
| Secondary (2-way toggle switch) | Combat Messages, Combat Taunts, Language Filter, Running, Subtitles, Item Highlight | 0–1 |
| Range (continuous slider) | Combat Speed, Text Base Delay, volumes × 4, Brightness, Mouse Sensitivity | continuous |
| Special checkbox | Player Speedup | 0–1 |

`preferencesSetDefaults(true)` resets all preferences to their factory values and immediately
applies them. CANCEL restores the previous session's values via `_RestoreSettings()`.
On DONE, `_changed` flag triggers `_SavePrefs(1)` + `_JustUpdate_()` + `_combat_highlight_change()`.

---

## 2. Full Preference Table

### 2.1 Primary Preferences (4-way rotary knob)

| CE key (`settings.preferences.*`) | Values | Default | CE gameplay effect |
|---|---|---|---|
| `game_difficulty` | 0=Easy, 1=Normal, 2=Hard | **1 (Normal)** | Skill modifier: Easy +20%, Normal 0%, Hard -10% on specific skills (First Aid, Doctor, Sneak, Lockpick, Steal, Traps, Science, Repair, Outdoorsman). Applied via `skillGetGameDifficultyModifier()` in `skill.cc`. |
| `combat_difficulty` | 0=Easy, 1=Normal, 2=Hard | **1 (Normal)** | Damage dealt to player and enemy HP modifiers. Easy = player takes less; Hard = player takes more. Separate from game difficulty. |
| `violence_level` | 0=None, 1=Minimum Blood, 2=Normal, 3=Maximum Blood | **3 (Maximum Blood)** | Controls death animation and gore: 0=no gore, 1=minimal, 2=normal, 3=full mutilation animations. CE checks this before playing violent animation FIDs. |
| `target_highlight` | 0=Off, 1=Targeting Only, 2=All | **1 (Targeting Only)** | Whether enemies glow/highlight when targeted. Targeting Only = only during combat targeting; All = always; Off = never. `_combat_highlight_change()` fires on change. |
| `combat_looks` | 0=Off, 1=On | **0 (Off)** | When On, hovering the cursor over critters in combat shows an info string (HP, description). |

### 2.2 Secondary Preferences (2-way toggle)

Note: `combat_messages` storage is inverted in the source — stored value 0 = verbose, 1 = brief.
The UI XORs the value when drawing the switch position. All others: 0 = left/first label, 1 = right/second label.

| CE key | Labels | Default stored value | CE gameplay effect |
|---|---|---|---|
| `combat_messages` | Verbose / Brief | **1 (Brief)** | Verbose: full text description of every hit ("You hit the Radscorpion in the eyes for 14 damage!"). Brief: shortened one-line combat roll. `_scr_message_free()` reloads message cache on change. |
| `combat_taunts` | Off / On | **1 (On)** | When On, critters voice combat taunts during battle. `aiMessageListReloadIfNeeded()` called via `_JustUpdate_`. |
| `language_filter` | Off / On | **0 (Off)** | When On, censors profanity in all message text. `_scr_message_free()` reloads on change. |
| `running` | Walk / Run | **0 (Walk)** | 0 = default movement is walk; 1 = default is run. Does not prevent the player from manually switching. |
| `subtitles` | Off / On | **0 (Off)** | When On, displays subtitle text for speech audio. In CE, speech files must be present; subtitles render from `.msg` text. |
| `item_highlight` | Off / On | **1 (On)** | When On, pressing Tab highlights interactable items on the ground. `gameMouseLoadItemHighlight()` called on change. |

### 2.3 Range Preferences (continuous slider)

| CE key | Range | Default | CE gameplay effect |
|---|---|---|---|
| `combat_speed` | 0–50 (int) | **0** | Millisecond delay added per combat animation step. 0 = no delay (fastest); 50 = maximum pause. Applies after each hit, death, and movement step in combat. |
| `text_base_delay` | 1.0–6.0 (float) | **3.5** | Base duration in seconds for floating text messages above critters. Calls `textObjectsSetBaseDelay()`. Derived `text_line_delay = (base - 1.0) × 0.4`, clamped [0, 2]. |
| `master_volume` | 0–32767 | **22281** (~68%) | Master gain applied to all audio channels. `gameSoundSetMasterVolume()`. |
| `music_volume` | 0–32767 | **22281** | Background music gain. `backgroundSoundSetVolume()`. |
| `sndfx_volume` | 0–32767 | **22281** | Sound effects gain. `soundEffectsSetVolume()`. Plays `butin1` sample while dragging. |
| `speech_volume` | 0–32767 | **22281** | Speech / voice-over gain. `speechSetVolume()`. Plays `narrator\options` sample while dragging. |
| `brightness` | 1.0–1.18 | **1.0** | Palette brightness multiplier. `colorSetBrightness()` adjusts colour palette entries in-engine. Also adjustable at any time via `+`/`-` keys. |
| `mouse_sensitivity` | 1.0–2.5 | **1.0** | Mouse movement multiplier. `mouseSetSensitivity()`. |

### 2.4 Special Checkbox

| CE key | Default | CE effect |
|---|---|---|
| `player_speedup` | **0 (Off)** | "Affect Player Speed" — when On, the player character moves at animation speed in sync with combat animation delay rather than always at full walk speed. Checkbox only; no CE default change. |

---

## 3. CE Config File Keys

`settings.preferences.*` keys in `[preferences]` section of `fallout2.cfg`:

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

`settings.sound.*` keys in `[sound]` section:
```
master_volume = 22281
music_volume = 22281
sndfx_volume = 22281
speech_volume = 22281
```

---

## 4. DH2 Preferences — `src/ui_options.ts` + `src/config.ts`

### 4.1 Persisted Options Panel

DH2's preferences are stored in `localStorage` under key `dh2_preferences` as JSON
(`src/ui_options.ts:savePreferences`). The panel is built lazily via `buildPrefsPanel()`,
opened from the Options menu (Preferences button or `P` key), and closed on DONE.
`loadPreferences()` is called at startup to restore from `localStorage`.

There is no CANCEL equivalent — changes take effect immediately. There is no DEFAULT button.

The panel exposes 10 controls:

| DH2 label | CE equivalent | DH2 Config field | Values | Default |
|---|---|---|---|---|
| Game Difficulty | `game_difficulty` + `combat_difficulty` | `Config.combat.difficultyModifier` | 75=Easy, 100=Normal, 125=Hard | 100 |
| Combat Speed | `combat_speed` | `Config.combat.combatSpeed` | 1=Slow, 2=Normal, 4=Fast | 2 |
| Violence Level | `violence_level` | `Config.combat.violenceLevel` | 0–3 | 2 |
| Target Highlight | `target_highlight` | `Config.ui.targetHighlight` | true/false | true |
| Combat Messages | `combat_messages` | `Config.ui.combatMessages` | 'brief'/'verbose' | 'verbose' |
| Running | `running` | `Config.engine.doAlwaysRun` | true/false | true |
| Subtitles | `subtitles` | `Config.ui.subtitles` | true/false | false |
| Master Volume | `master_volume` | audioEngine (0–100) | 0–100 | 100 |
| Music Volume | `music_volume` | audioEngine (0–100) | 0–100 | 100 |
| SFX Volume | `sndfx_volume` | audioEngine (0–100) | 0–100 | 100 |

### 4.2 Config Fields Not Exposed in Preferences Panel

Several `Config` fields map to CE preferences but are not accessible in the panel:

| Config field | CE equivalent | Status |
|---|---|---|
| `Config.combat.damageCalculationType` | *(no CE equivalent — DH2-only)* | Hardcoded 0=Vanilla; not a user option |
| `Config.engine.doAlwaysRun` | `running` | ✅ wired (in panel) |
| `Config.ui.showRoof`, `showFloor`, `showObjects`, etc. | *(debug toggles)* | Dev-only, keyboard shortcuts in `main.ts` |
| `Config.scripting.debugLogShowType.*` | *(no CE equivalent)* | Dev-only logging flags |
| `Config.controls.*` | *(key bindings)* | Hardcoded; no UI to remap |

---

## 5. Consumption of Preferences in DH2

How each setting's stored value actually affects gameplay:

| CE preference | DH2 Config field | Consumed in | Effect |
|---|---|---|---|
| `game_difficulty` + `combat_difficulty` | `Config.combat.difficultyModifier` | `skills.ts:187` (skill modifier), `combat.ts:634,699` (damage), `encounters.ts:302` (encounter rate) | 75=Easy: +20% on difficulty-affected skills, reduced incoming combat damage. 125=Hard: -10% skills, increased damage. ✅ Fully wired. |
| `running` | `Config.engine.doAlwaysRun` | `main.ts:190,213,231`, `object.ts:1853` | Controls whether player walks or runs by default when moving. ✅ Fully wired. |
| `violence_level` | `Config.combat.violenceLevel` | *(not consumed)* | Stored in Config; no code reads it for death animation gating. ❌ No effect. |
| `combat_speed` | `Config.combat.combatSpeed` | *(not consumed)* | Stored in Config; no combat loop reads it for delays. ❌ No effect. |
| `target_highlight` | `Config.ui.targetHighlight` | *(not consumed)* | Stored in Config; nothing reads it to control enemy highlighting. ❌ No effect. |
| `combat_messages` | `Config.ui.combatMessages` | *(not consumed)* | Stored in Config; combat log message formatting does not read it. ❌ No effect. |
| `subtitles` | `Config.ui.subtitles` | *(not consumed)* | Stored in Config; `Config.ui.subtitles = false` is noted in CODEBASE.md as "no speech `.acm` playback path exists". ❌ No effect. |
| `master_volume`, `music_volume`, `sndfx_volume` | `audioEngine.setVolume()` | `audio.ts` Web Audio API gain nodes | ✅ Fully wired. Volumes affect all sounds immediately. |
| `speech_volume` | *(not in SavedPreferences)* | — | ❌ Not persisted. CE speech volume separate from SFX; DH2 has no speech audio. |

---

## 6. DH2 Status and Known Gaps

| CE preference | DH2 status |
|---|---|
| Game Difficulty (0–2) | ⚠️ Merged with Combat Difficulty into single `difficultyModifier` (gap #1) |
| Combat Difficulty (0–2) | ⚠️ See gap #1 |
| Violence Level (0–3) | ✅ Stored; ❌ no death animation gating implemented (gap #2) |
| Target Highlight (0–2 in CE; bool in DH2) | ✅ Stored; ❌ never read (gap #3) |
| Combat Looks (0–1) | ❌ Not in panel or Config |
| Combat Messages (0–1) | ✅ Stored; ❌ never read (gap #3) |
| Combat Taunts (0–1) | ❌ Not in panel or Config |
| Language Filter (0–1) | ❌ Not in panel or Config |
| Running (0–1) | ✅ Stored and consumed (`Config.engine.doAlwaysRun`) |
| Subtitles (0–1) | ✅ Stored; ❌ no speech audio path (gap #4) |
| Item Highlight (0–1) | ❌ Not in panel or Config |
| Combat Speed (0–50 in CE; 1/2/4 in DH2) | ✅ Stored; ❌ never read (gap #3) |
| Text Base Delay (1.0–6.0) | ❌ Not in panel or Config; DH2 uses fixed `floatMessageDuration = 3s` |
| Master Volume | ✅ Stored and consumed |
| Music Volume | ✅ Stored and consumed |
| SFX Volume | ✅ Stored and consumed |
| Speech Volume | ❌ Not applicable (no speech audio) |
| Brightness (1.0–1.18) | ❌ Not in panel; WebGL has no palette-level brightness (gap #5) |
| Mouse Sensitivity (1.0–2.5) | ❌ Not in panel (browser handles mouse, no CE-style scaling needed) |
| Player Speedup checkbox | ❌ Not in panel or Config |

### Gap #1 — Game Difficulty vs Combat Difficulty merged

CE has two independent dials: `game_difficulty` (affects skill modifiers for 9 skills) and
`combat_difficulty` (affects damage calculation). DH2 merges both into `Config.combat.difficultyModifier`
(75/100/125), which is consumed as both a skill modifier (`skills.ts`) and a damage modifier
(`combat.ts`). Setting Easy (75) makes both skills easier AND combat damage lower; CE allowed
mixing (e.g. Hard game difficulty with Easy combat difficulty). DH2 defaults to 100 (Normal);
CE defaults game_difficulty=Normal, combat_difficulty=Normal, so for the default case they match.

### Gap #2 — Violence Level stored but not gated

`Config.combat.violenceLevel` is set by the panel and persisted, but no code in DH2
checks it before playing death animations or gore FX. All deaths render with full animation
regardless of the setting.

### Gap #3 — Target Highlight, Combat Messages, Combat Speed stored but ignored

These three preferences are persisted to localStorage and present in `Config`, but no system
reads them at runtime. Combat messages always use verbose-style formatting; enemies are
never highlighted; combat animations have no per-step delay.

### Gap #4 — Subtitles field exists but no speech audio

CE subtitles render from `.msg` text files when speech `.acm` files play. DH2 has no speech
audio path and no subtitle rendering. `Config.ui.subtitles = false` is the hardcoded default
with a note in CODEBASE.md that the feature is absent.

### Gap #5 — Brightness has no WebGL equivalent

CE `brightness` adjusts the global colour palette via `colorSetBrightness()`, a palette-level
operation. DH2 uses WebGL 2.0 with per-tile colour LUTs (`lut/color_lut.json`); there is
no global brightness knob. Implementing it would require a uniform in the fragment shader.

### DH2-Specific Options With No CE Equivalent

These `Config` fields appear in `config.ts` with no CE preference panel equivalent:

| Config field | Purpose |
|---|---|
| `Config.combat.damageCalculationType` | Selects damage formula variant (Vanilla/Glovz/YAAM). Hardcoded 0; no UI. |
| `Config.engine.doFloorLighting` / `floorLightingMode` | Floor lighting toggle and GPU/CPU/auto backend selector. |
| `Config.ui.scrollPadding` | Edge-scroll activation zone width in pixels. |
| `Config.ui.floatMessageDuration` | Floating message display time (seconds). CE equivalent is `text_base_delay`. |
| `Config.controls.*` | Full keyboard binding map; CE uses hardcoded keys + its own key binding system. |
| `Config.scripting.debugLogShowType.*` | Per-category engine/script debug logging flags. |
| `Config.engine.debug` | Enables `src/debug.ts` cheat console. |
<!-- audited: 2026-06-01 -->
