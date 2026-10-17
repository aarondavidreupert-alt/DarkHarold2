# DarkHarold2 — Quest System (GVAR State Tracking & Pip-Boy)

**Audited:** 2026-06-01  
**CE ref:** `raw/fallout2-ce/src/pipboy.cc` (`questInit`, `questFree`, `questDescriptionCompare`,
`pipboyWindowRenderQuestLocationList`, quest display loop ~lines 1162–1197),
`raw/fallout2-ce/src/interpreter_extra.cc` (`opGetGlobalVar` 0x80C5, `opSetGlobalVar` 0x80C6,
`opGiveExpPoints` 0x80A1), `raw/fallout2-ce/src/game.cc` (`gGameGlobalVars`, `gGameGlobalVarsLength`,
`gameSetGlobalVar`)  
**DH2 ref:** `src/questData.ts`, `src/questLog.ts`, `src/ui_pipboy/tabs/status.ts`, `src/scripting.ts`,
`src/saveload.ts`  
**See also:** `wiki/faction_reputation.md` (GVAR 0 = player karma), `wiki/save_load.md` (full save format)

---

## 1. CE Architecture Overview

Fallout 2 has **no dedicated quest engine**. Quests are raw integers stored in the global
variable array (`gGameGlobalVars[]`). A quest exists only as a threshold definition in
`quests.txt`; script opcodes (`set_global_var` / `get_global_var`) are the only mechanism
for advancing quest state. The Pip-Boy reads the same GVAR values at display time and
applies the thresholds to decide what to show.

There is no `quest.cc` — quest logic lives entirely in `pipboy.cc`.

---

## 2. `QuestDescription` Struct

Defined in `pipboy.cc:155–164`:

```c
typedef struct QuestDescription {
    int location;            // message ID in map.msg (town name)
    int description;         // message ID in quests.msg (quest text)
    int gvar;                // index into gGameGlobalVars[]
    int displayThreshold;    // GVAR value at which quest becomes visible
    int completedThreshold;  // GVAR value at which quest is marked done
} QuestDescription;
```

The engine allocates `gQuestDescriptions[]` and `gQuestDescriptionCount` after loading.

---

## 3. `quests.txt` Format

`questInit()` (`pipboy.cc:2405`) loads quest definitions from `data\quests.txt`. File
conventions:

- Lines beginning with `#` are comments (skipped).
- Each non-comment line has exactly **5 tokens**, whitespace- or comma-delimited:

```
locationMsgId  descMsgId  gvarIndex  displayThreshold  completedThreshold
```

Example (Arroyo garden quest):
```
1500  100  9  2  6
```

Meaning: town name is message 1500 from `map.msg`, quest text is message 100 from
`quests.msg`, watch GVAR index 9, show quest when GVAR ≥ 2, mark done when GVAR ≥ 6.

After parsing, `qsort` orders all entries by `location` so town groups appear contiguous
in the Pip-Boy list. The Pip-Boy renders the town name once per group.

---

## 4. Quest State Machine

There is no engine-level state machine. A "quest state" is simply an integer value in
`gGameGlobalVars[gvar]`. Scripts write to this integer to advance the quest; the display
thresholds interpret the current value:

| Condition | Pip-Boy behaviour |
|---|---|
| `GVAR < displayThreshold` | Quest not listed |
| `displayThreshold ≤ GVAR < completedThreshold` | Quest shown, **active** (green text) |
| `GVAR ≥ completedThreshold` | Quest shown, **done** (grey strikethrough) |

Display logic (`pipboy.cc:1162–1197`):

```c
if (gGameGlobalVars[questDescription->gvar] >= questDescription->displayThreshold) {
    if (gGameGlobalVars[questDescription->gvar] < questDescription->completedThreshold) {
        flags = 0;
        color = _colorTable[992];       // active: green
    } else {
        flags = PIPBOY_TEXT_STYLE_STRIKE_THROUGH;
        color = _colorTable[8804];      // done: grey
    }
}
```

---

## 5. Script-Driven State Advancement

Scripts advance quest state via the standard GVAR opcodes — there is no dedicated
`quest_set_state` intrinsic:

| Opcode | Value | CE function | Effect |
|---|---|---|---|
| `get_global_var` | 0x80C5 | `opGetGlobalVar` | Reads `gGameGlobalVars[index]` |
| `set_global_var` | 0x80C6 | `opSetGlobalVar` | Writes `gGameGlobalVars[index]` |

Typical quest script pattern:
```ssl
// Advance quest from "accepted" (2) to "completed" (6)
set_global_var(GVAR_HAKUNIN_GARDEN, 6);
give_exp_points(500);
```

`gGameGlobalVars[]` is initialized from `data\vault13.gam` at game start
(`game.cc::gameLoad`). The array covers all GVARs in the game (~700 entries).

---

## 6. XP Rewards

There is **no engine mechanism for quest-completion XP**. The `gQuestDescriptions`
struct has no XP field. All XP is awarded by scripts explicitly via:

| Opcode | Value | CE function |
|---|---|---|
| `give_exp_points` | 0x80A1 | `opGiveExpPoints` |

The script author decides when and how much XP to grant; nothing automatic fires when
a GVAR crosses `completedThreshold`.

---

## 7. GVAR Persistence

### 7.1 CE

`gGameGlobalVars[]` is saved as part of `data\vault13.gam` (the global save file,
separate from the slot save files). Every slot save re-serializes this array.
`gameSetGlobalVar` in `game.cc` handles a special case for `GVAR_PLAYER_REPUTATION`
(index 0) — it also updates the Sfall karma display. All other indices write directly
to the array.

### 7.2 DH2

`scripting.ts` (lines 51–171):

```typescript
var globalVars: any = {}          // sparse JS object; missing keys default to 0
export function getGlobalVar(gvar: number): any {
    return globalVars[gvar] !== undefined ? globalVars[gvar] : 0
}
```

On startup, `loadGlobalVars()` optionally reads `data/gvars.json`; if the file is
absent (which it is in the repository), all GVARs start at 0.

`saveload.ts` serializes GVARs in the `PlayerState`:

```typescript
// save (saveload.ts:104):
gvars: Object.assign({}, Scripting.getGlobalVars())

// load (saveload.ts:224):
Scripting.setGlobalVars(ps.gvars)
```

The round-trip is correct. Any non-zero GVAR is included; the receiver treats missing
keys as 0, matching the sparse-object convention.

---

## 8. DH2 Implementation

### 8.1 Quest Definitions — `src/questData.ts`

As CE `pipboy.cc questInit` (2026-10-17, known_bugs C40): `getQuestDefs()` reads `data/data/quests.txt` (location, description, gvar, display threshold, completed threshold; `#` lines skipped, `strtok(" 	,")`), takes the texts from `quests.msg` and the location names from `map.msg`, and sorts by location (`questDescriptionCompare`). `getHolodiskDefs()` reads `data/data/holodisk.txt` the same way (`holodiskInit`). `getQuestGvarSet()` lists the quest GVARs (debug).

### 8.2 Quest Log — `src/questLog.ts`

`getActiveQuests()` returns every quest whose GVAR has reached its display threshold, `isCompleted` at the completed threshold — the CE display test. `getUnknownActiveGvars()` lists non-zero GVARs no quest covers (debug aid).

### 8.3 Pip-Boy — STATUS page (`src/ui_pipboy/tabs/status.ts`)

As CE `pipboyWindowHandleStatus`: the locations with a shown quest, then per location "<location> <pipboy.msg 210>" and its numbered quests; completed ones struck through in dark green (`_colorTable[8804]`). See `wiki/pipboy.md` §3.

### 8.4 XP — `src/scripting.ts`

`give_exp_points` (opcode 0x80A1) is wired in `vm_bridge.ts` and calls
`player.addExperience(amount)` — correctly matches CE. Level-up is triggered when
the XP threshold is crossed.

---

## 9. DH2 Status and Known Gaps

| Feature | CE source | DH2 status |
|---|---|---|
| GVAR integer state (no state machine) | `pipboy.cc`, `game.cc` | ✅ correct |
| displayThreshold / completedThreshold display | `pipboy.cc:1162–1197` | ✅ correct (`questLog.ts`) |
| Pip-Boy location grouping | `pipboy.cc:questDescriptionCompare` | ✅ correct (`questData.ts` sort, `tabs/status.ts`) |
| Active (green) / done (strikethrough) colours | `pipboy.cc` | ✅ correct |
| `get_global_var` / `set_global_var` opcodes | `interpreter_extra.cc` | ✅ wired (`vm_bridge.ts`) |
| `give_exp_points` | `interpreter_extra.cc:0x80A1` | ✅ wired |
| GVAR save/load round-trip | `game.cc`, `vault13.gam` | ✅ correct (`saveload.ts:104,224`) |
| Quest definitions from `quests.txt` | `pipboy.cc:questInit` | ✅ (C40) |
| Quest text from `quests.msg` | `pipboy.cc:questInit` | ✅ (C40) |
| Initial GVARs | `vault13.gam` | ✅ `data/gvars.json` (pipeline `parse_gam`) |
| Quest-completion XP (engine-level) | — | N/A — CE has none; script-driven only |
| Quest-completion callbacks | — | ❌ no `on_quest_complete` hook exists in CE or DH2 |

No open gaps.
<!-- audited: 2026-10-17 -->
