# DarkHarold2 — Quest System (GVAR State Tracking & Pip-Boy)

**Audited:** 2026-06-01  
**CE ref:** `raw/fallout2-ce/src/pipboy.cc` (`questInit`, `questFree`, `questDescriptionCompare`,
`pipboyWindowRenderQuestLocationList`, quest display loop ~lines 1162–1197),
`raw/fallout2-ce/src/interpreter_extra.cc` (`opGetGlobalVar` 0x80C5, `opSetGlobalVar` 0x80C6,
`opGiveExpPoints` 0x80A1), `raw/fallout2-ce/src/game.cc` (`gGameGlobalVars`, `gGameGlobalVarsLength`,
`gameSetGlobalVar`)  
**DH2 ref:** `src/questData.ts`, `src/questLog.ts`, `src/ui_pipboy.ts`, `src/scripting.ts`,
`src/saveload.ts`  
**See also:** `wiki/karma_reputation.md` (GVAR 0 = player karma), `wiki/save_load.md` (full save format)

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

DH2 does not ship `quests.txt` or `quests.msg`. All ~90 quest definitions are inlined
in TypeScript with their human-readable description strings:

```typescript
// [locationId, descMsgId, gvarIndex, displayThreshold, completedThreshold, description]
const RAW_QUESTS: RawQuest[] = [
    [1500, 100,   9, 2, 6, "Kill the evil plants that infest Hakunin's garden."],
    // ... ~90 entries across 17 locations
]
```

Location IDs map to town names: 1500=Arroyo, 1501=Klamath, 1502=Den, 1503=Modoc,
1504=Vault City, 1505=Gecko, 1506=Broken Hills, 1507=New Reno, 1508=Vault 15,
1509=NCR, 1510=Vault 13, 1511=San Francisco, 1512=Navarro, 1513=Abbey, 1514=Primitive Tribe,
1515=Raiders, 1516=The Enclave.

`questGvarSet: Set<number>` is exported for debug use (shows which GVARs are quest-tracked).

### 8.2 Quest Log — `src/questLog.ts`

`getActiveQuests()` (lines 18–45):

```typescript
const gvars = Scripting.getGlobalVars()
for (const q of questDefs) {
    const val = Number(gvars[q.gvarIndex] ?? 0)
    if (val >= q.displayThreshold) {
        result.push({ ..., isCompleted: val >= q.completedThreshold })
    }
}
```

Threshold logic exactly matches the CE display loop. Location grouping is done at
render time in `ui_pipboy.ts` rather than via qsort.

`getUnknownActiveGvars()` returns non-zero GVARs not in `questGvarSet` — a debug aid
for spotting GVARs that scripts write but no quest definition covers.

### 8.3 Pip-Boy — ARCHIVES Tab (`src/ui_pipboy.ts:550–616`)

- Calls `getActiveQuests()`.
- Groups results by location; renders a location header for each group.
- Active: `color: #00FF00` (matches CE green).
- Completed: `color: #007700; text-decoration: line-through` (matches CE grey strikethrough).
- When `Config.scripting.debugLogShowType.gvars` is true, unknown active GVARs appear
  below the quest list as a debug section.

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
| Pip-Boy location grouping | `pipboy.cc:questDescriptionCompare` | ✅ correct (`ui_pipboy.ts`) |
| Active (green) / done (strikethrough) colours | `pipboy.cc` | ✅ correct |
| `get_global_var` / `set_global_var` opcodes | `interpreter_extra.cc` | ✅ wired (`vm_bridge.ts`) |
| `give_exp_points` | `interpreter_extra.cc:0x80A1` | ✅ wired |
| GVAR save/load round-trip | `game.cc`, `vault13.gam` | ✅ correct (`saveload.ts:104,224`) |
| Quest definitions from `quests.txt` | `pipboy.cc:questInit` | ❌ DH2 inlines in `questData.ts` (gap #1) |
| Quest text from `quests.msg` | `pipboy.cc:questInit` | ❌ DH2 inlines description strings (gap #1) |
| `gvars.json` initial state | — | ❌ file absent; all GVARs start 0 (gap #2) |
| Quest-completion XP (engine-level) | — | N/A — CE has none; script-driven only |
| Quest-completion callbacks | — | ❌ no `on_quest_complete` hook exists in CE or DH2 |

### Gap #1 — Inlined definitions vs. data files
`questData.ts` replaces both `quests.txt` (structure) and `quests.msg` (text). This
is intentional: it avoids runtime MSG file loading and allows TypeScript type-checking
of the quest table. The threshold logic and display are unaffected. Adding new quests
or modding requires editing `questData.ts` rather than data files.

### Gap #2 — `gvars.json` absent
The repository has no `data/gvars.json`, so all GVARs start at 0 on a fresh game.
In CE, `vault13.gam` pre-sets some GVARs to non-zero values for specific story
conditions (e.g. which Village Elder was chosen, which NPCs are alive). Without this
file, any script that checks a GVAR against a non-zero default initial value will see
0 instead. Scripts that only check for "has been set by player action" (all values
starting at 0 = not started) work correctly.
<!-- audited: 2026-06-01 -->
