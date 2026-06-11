# DarkHarold2 — Pip-Boy UI & Holodisk System

**Audited:** 2026-06-02  
**CE ref:** `raw/fallout2-ce/src/pipboy.cc` (`pipboyOpen`, `pipboyWindowInit`, `pipboyWindowFree`,
`pipboyWindowHandleStatus`, `pipboyWindowRenderQuestLocationList`, `pipboyWindowRenderHolodiskList`,
`pipboyRenderHolodiskText`, `pipboyWindowHandleAutomaps`, `_PrintAMList`, `_PrintAMelevList`,
`pipboyHandleVideoArchive`, `pipboyHandleAlarmClock`, `pipboyWindowRenderRestOptions`,
`pipboyDrawHitPoints`, `pipboyRenderScreensaver`, `questInit`, `holodiskInit`, `holodiskFree`),
`raw/fallout2-ce/src/automap.cc` (`AutomapHeader`, `automapSaveCurrent`, `automapGetHeader`,
`_automapDisplayMap`),
`raw/fallout2-ce/src/proto_instance.cc` (`_obj_use_misc_item`, `_protinst_default_use_item`),
`raw/fallout2-ce/src/proto_types.h` (item type enum),
`raw/fallout2-ce/src/game_vars.h` (GVAR constants),
`raw/fallout2-ce/src/interpreter_extra.cc` (`opSetGlobalVar`, `opAddObjectToInventory`)  
**DH2 ref:** `src/ui_pipboy/shell.ts` (`openPipBoy`, `closePipBoy`, `togglePipBoy`),
`src/ui_pipboy/tabs/status.ts` (`renderStatusTab`),
`src/ui_pipboy/tabs/automaps.ts` (`renderAutomapsTab`),
`src/ui_pipboy/tabs/archives.ts` (`renderArchivesTab`),
`src/automapData.ts` (`markSeenAt`, `getArchivedMaps`,
`drawAutomapInto`, `snapshotCurrentMapObjects`), `src/ui_automap.ts`,
`src/input.ts` (keyboard trigger),
`src/object/Obj.ts` (`Obj.use()` — misc item use path),
`src/pro.ts` (`getPROSubTypeName` — misc subtype mapping),
`src/scripting.ts` (`add_obj_to_inven`, `obj_carrying_pid_obj`, `set_global_var`),
`src/questData.ts` (two quest entries referencing holodisks as quest items)  
**See also:** `wiki/quest_system.md` (ARCHIVES/quest log detail)

---

## 1. Opening and Closing

### 1.1 CE

`pipboyOpen(intent)` (`pipboy.cc:403`):

- Precondition: `wmMapPipboyActive()` must return true (i.e. the player has watched the
  suit movie, `MOVIE_VSUIT`, which is triggered by picking up the Vault Suit). If false,
  a dialog "You aren't wearing the pipboy!" is shown and the Pip-Boy does not open.
  A Sfall option (`SFALL_CONFIG_PIPBOY_AVAILABLE_AT_GAMESTART`) can bypass this check.
- On open: disables ISO mode, color cycling, and the indicator bar; locks the mouse cursor
  to arrow; plays `pipon` sound.
- On close: re-enables ISO mode, indicator bar, and color cycling; fires
  `scriptsExecMapUpdateProc()` to run `map_update_p_proc` scripts; plays no closing sound.
- Idle timeout: after `PIPBOY_IDLE_TIMEOUT` (120 000 ms = 2 minutes) with no mouse/key
  input, the screensaver fires (`pipboyRenderScreensaver`) — an animated nuclear-bomb
  sprite bouncing across the content area.
- Close keys: `P`, `p`, `Z`, `z`, `Escape`, `Enter`, event code 503.
- `intent` parameter: `PIPBOY_OPEN_INTENT_REST` (from rest hotspot click) opens directly
  to the alarm clock tab.

### 1.2 DH2

`togglePipBoy()` in `src/ui_pipboy/shell.ts`. Triggered by `Config.controls.pipboy` key in
`src/input.ts`. No availability check — the Pip-Boy is always available regardless of
game progress.

`openPipBoy()`:
- Appends a `640×480` div to `#uiStage` with `pip.png` as background.
- Creates four clickable red-dot tab buttons (STATUS, AUTOMAPS, ARCHIVES, CLOSE).
- Renders the date/time bar and opens on the STATUS tab.
- Resets automap navigation state to level 1.
- `makePanelDraggable()` allows dragging by the frame area.

`closePipBoy()`:
- Removes the container div; restores `UIMode.none`.

**Gaps vs CE:**
- No `wmMapPipboyActive` check.
- No `pipon` sound on open.
- No idle screensaver.
- `map_update_p_proc` is not called on close.

---

## 2. Tab Layout

CE has 4 physical tab buttons (index 1 is a spacer with no button):

| Button index | Key code | CE handler | CE label |
|---|---|---|---|
| 0 | 500 | `pipboyWindowHandleStatus` | STATUS |
| — | — | *(spacer — no button)* | — |
| 2 | 501 | `pipboyWindowHandleAutomaps` | MAPS |
| 3 | 502 | `pipboyHandleVideoArchive` | VIDEO ARCHIVES |
| 4 | 503 | `pipboyHandleAlarmClock` | ALARM CLOCK |

Plus a separate alarm bell button in the date/time bar at the top (key code 504), which
also opens the alarm clock / rest screen.

DH2 tab mapping:

| DH2 tab | CE equivalent | CE label | Status |
|---|---|---|---|
| STATUS | Button 0 | STATUS | ⚠️ Partially — CE STATUS shows quests+holodisks; DH2 shows HP/conditions |
| AUTOMAPS | Button 2 | MAPS | ✅ Functional — different rendering engine |
| ARCHIVES | Button 3 slot | (repurposed from VIDEO ARCHIVES) | ✅ Quest log only; no holodisks |
| CLOSE | Button 4 slot | ALARM CLOCK | ❌ Close only; no rest system |

---

## 3. STATUS Tab

### 3.1 CE

The CE STATUS tab (`pipboyWindowHandleStatus`) is **not a character health display** —
it is the combined quest/holodisk overview screen.

Content layout (two-column):

| Column | Content |
|---|---|
| Left | "STATUS" header + list of town names for all quests whose GVAR ≥ `displayThreshold` |
| Right | "DATA" header + names of holodisks whose GVAR ≠ 0 |

Clicking a town name → drills into quest detail for that location: shows the town name as
underlined header, then numbered quest descriptions (green for active, grey strikethrough
for completed). The `completedThreshold` / `displayThreshold` logic is the same as the
ARCHIVES display — see `wiki/quest_system.md §4`.

Clicking a holodisk name → shows the holodisk text content from `pipboy.msg`, paginated
at 35 lines per page with "MORE" / "DONE" navigation.

`pipboyDrawHitPoints()` shows "Hit Points X/Y" only on the **alarm clock / rest screen**,
not the STATUS tab. There is no HP bar, level, XP, conditions (poison/rad), addictions,
or any other character stat visible in the CE Pip-Boy content area.

### 3.2 DH2 (`renderStatusTab`, `ui_pipboy.ts–330`)

DH2 STATUS shows player conditions and time — a DH2-specific design with no CE equivalent:

| Field | Source |
|---|---|
| Hit Points (X / maxHP) | `player.getStat('HP')` / `player.getStat('Max HP')` |
| Poisoned (level) | `player.getStat('Poison Level')` — highlighted red when > 0 |
| Radiated (level) | `player.getStat('Radiation Level')` — highlighted red when > 0 |
| Day + time | `GameTime.getDay()`, `GameTime.getTimeString()` |
| Date | `GameTime.getDateString()` |
| Cycle | `GameTime.isNightTime()` → `'NIGHT'` or `'DAY'` |

**Gaps vs CE:**
- CE STATUS shows quest locations + holodisks; DH2 STATUS shows HP/conditions. The
  functions have different purposes sharing the same tab slot.
- Holodisk display is entirely absent from DH2.
- Level, XP, addictions, and party member status are not shown in either CE or DH2
  (CE shows none of them in the Pip-Boy at all; DH2 shows only HP/poison/rad).

---

## 4. AUTOMAPS Tab

### 4.1 CE

CE automaps use a dedicated binary database file: `MAPS\AUTOMAP.DB`.

`AutomapHeader` (`automap.cc:45`):
```c
struct AutomapHeader {
    uint8_t version;       // must be 1
    int dataSize;
    int offsets[AUTOMAP_MAP_COUNT][ELEVATION_COUNT];  // 160 maps × 3 elevations
};
```

`offsets[map][elevation]` is positive if that map+elevation has ever been visited
(nonzero offset = compressed tile data exists). This is how the Pip-Boy list knows
which maps to show.

`_PrintAMList` scans all 160 map slots; calls `_automapDisplayMap(map)` to check
if any elevation has data AND the map passes the display filter (from `_displayMapList[]`,
which gates maps behind story progress flags). Maps sharing a city (`_is_map_idx_same`)
are grouped under one city name. `qsort` alphabetises city names.

`_PrintAMelevList` drills into a city: lists each (map, elevation) entry by floor name,
then calls `automapRenderInPipboyWindow` to draw the actual FRM-based map thumbnail.

Map FRM data: the CE automap renderer draws wall/floor objects directly from
`obj.tile` coordinates into a scaled buffer. Two modes: **low detail** (object dots only)
and **high detail** (full object outlines); toggled by a button in the standalone automap
screen. The Pip-Boy view always uses a fixed render.

`automapSaveCurrent()` (`automap.cc:683`) is called when the player leaves a map: writes
the current map+elevation's tile data to AUTOMAP.DB and updates the header offsets.

### 4.2 DH2 (`renderAutomapsTab`, `ui_pipboy.ts–544`; `automapData.ts`)

DH2 does not have AUTOMAP.DB or the CE FRM-based renderer. Instead it tracks which hex
tiles the player has seen (`markSeenAt`) and renders them as coloured pixels on a canvas.

**Tracking** (`automapData.ts`):
- `markSeenAt(mapName, elevation, position, radius=5)`: on `playerMoved` event, marks
  all hexes within radius 5 as seen in `seenData: Map<string, Set<string>>`.
- `seenData` is key `"mapName:elevation"` → `Set<"x,y">`.
- Persisted to `localStorage` under key `darkfo.automap.v1`; flushed on map transitions
  and page unload.
- `snapshotCurrentMapObjects()`: on map load/unload, captures wall/door/scenery/item
  positions into `objectSnapshots` (keyed `mapName:elevation`), so the AUTOMAPS tab can
  overlay objects for previously-visited maps.

**Navigation hierarchy** (3 levels):

1. **Location list** — all locations grouped by `globalState.mapAreas` area name;
   shows count of visited maps per location.
2. **Map list** — maps within the selected location, filtered by seen-tile data.
3. **Rendered canvas** — 350×360 px canvas showing seen tiles (green squares), object
   overlay (walls=grey, doors=orange, scenery=blue, items=yellow, critters=red), player
   marker (yellow cross), zoom label, tile count, and legend.

Zoom/pan: `getAutomapZoom()` / `zoomIn()` / `zoomOut()` from `src/ui_automap.ts`;
drag-pan via `attachAutomapDragPan()`; mouse-wheel zoom via `attachAutomapWheelZoom()`.

**Gap vs CE:** DH2 has no AUTOMAP.DB; no FRM-based rendering; no high/low detail toggle.
The seen-tile approach means only hexes the player physically walked near are visible,
whereas CE's `automapSaveCurrent` captures the full level tile data on exit.

---

## 5. ARCHIVES Tab (Quest Log)

The ARCHIVES tab is the DH2 equivalent of clicking a town name in the CE STATUS tab.
Full documentation is in `wiki/quest_system.md`.

Brief summary:
- Calls `getActiveQuests()` from `questLog.ts`.
- Groups quests by location, renders location headers.
- Active quests: `color: #00FF00`. Completed quests: `color: #007700;
  text-decoration: line-through`.
- Debug section for unknown active GVARs when `Config.scripting.debugLogShowType.gvars`.

CE serves the same content through the STATUS tab's town-name click flow rather than a
dedicated ARCHIVES tab. The DH2 ARCHIVES tab also skips the top-level location overview
that CE requires (click town → see quests); DH2 shows all active quests at once, grouped.

**Not implemented:** holodisk reading (CE STATUS right column). No equivalent exists in DH2.

---

## 6. VIDEO ARCHIVES (CE-only)

`pipboyHandleVideoArchive` / `pipboyRenderVideoArchive` (`pipboy.cc:1673–1765`):

- Shows a list of movies (game cutscenes) that the player has seen (`gameMovieIsSeen`).
  Movies 2–15 (Elder Speech through Credits) are eligible; movie 1 is the intro, excluded.
- Clicking a title replays the `.mve` video via `gameMoviePlay`.
- The DH2 slot at this button position is repurposed as ARCHIVES (quest log).

**DH2 status:** Not implemented. `play_gmovie()` in `src/scripting.ts:1768` logs a skip
and does nothing. The tab slot is used for the quest log instead.

---

## 7. ALARM CLOCK / REST (CE) — Wait Menu (DH2)

### 7.1 CE

`pipboyHandleAlarmClock` / `pipboyWindowRenderRestOptions` (`pipboy.cc:1769–1840`):

- Opened by clicking the ALARM CLOCK tab button (key 503) or the bell button at the top
  of the Pip-Boy frame (key 504).
- Blocked by `_critter_can_obj_dude_rest()`: if the player is in combat, on a city map
  that disallows resting, or adjacent to enemies, shows "You cannot rest at this location!"
  and aborts.
- `pipboyDrawHitPoints()` is called here to show current `HP / maxHP` during rest.
- Rest options (message 302–315):
  - Fixed durations: 10 min, 30 min, 1 hr, 2 hr, 3 hr, 4 hr, 5 hr, 6 hr
  - Time-of-day: Until Morning (08:00), Until Noon (12:00), Until Evening (18:00),
    Until Midnight (00:00)
  - Condition-based: Until Healed (rests in increments until `HP == maxHP`),
    Until Party Healed (includes companion HP; shown only when party size > 1)
- Rest updates the game clock (animations, queued events, drug timers all process during
  rest).
- Party "Until Party Healed" option is shown only when `_getPartyMemberCount() > 1 &&
  partyIsAnyoneCanBeHealedByRest()`.

### 7.2 DH2

Bell button in the date/time bar → `toggleWaitMenu()` (`ui_pipboy.ts`).

- Shows a popup with 8 fixed durations: 10 MIN, 20 MIN, 30 MIN, 1 HR, 2 HR, 3 HR, 6 HR,
  1 DAY.
- Selecting a duration calls `advanceTime(minutes)` which calls `GameTime.advanceMinutes()`.
- No rest-location check.
- No `_critter_can_obj_dude_rest()` equivalent.
- No healing during rest.
- No condition-based rest ("Until Healed").
- No party-aware rest option.
- The CLOSE tab button at position 4 (CE's ALARM CLOCK button slot) just closes the
  Pip-Boy rather than opening a rest screen.

---

## 8. Holodisk System

Holodisks are displayed inside the Pip-Boy STATUS tab (CE DATA column). This section
covers the full holodisk data model, acquisition flow, Pip-Boy integration, and DH2
implementation status.

### 8.1 Item Classification

Holodisks are **not** a distinct item type in the proto system. They are
`ITEM_TYPE_MISC` (value 5, `proto_types.h:32`) items — the same type used for
Geiger Counters, Stealth Boys, and the Motion Sensor. The engine does not
distinguish holodisks from other misc items by type alone.

A holodisk item is identified by its individual PID (Prototype ID). Each
physical holodisk object in the game world has:
- A PRO file in `proto/items/` defining its FID, weight, and carry weight
- Optionally an attached script that runs `use_p_proc` when the item is used,
  which calls `set_global_var` to flip the holodisk's Pip-Boy GVAR

The physical item and the Pip-Boy display are **decoupled**: the Pip-Boy only
checks the GVAR — it never inspects the player's inventory. A holodisk can be
shown in the Pip-Boy without the player having the item, and a holodisk item
can be in inventory without showing in the Pip-Boy (if its GVAR is never set).

### 8.2 holodisk.txt — The Master Registry

`data\holodisk.txt` is the flat text file that tells the engine which holodisks
exist. Loaded once at Pip-Boy init by `holodiskInit()` (`pipboy.cc:2525`):

```
# Format: gvar_index  name_msg_id  description_msg_id_base
```

Each non-comment, non-blank line contains three whitespace/comma-delimited tokens:

| Token | Field | Meaning |
|---|---|---|
| 1 | `gvar` | Index into `gGameGlobalVars[]`; nonzero = holodisk acquired |
| 2 | `name` | Message ID in `pipboy.msg` — the display name |
| 3 | `description` | Base message ID in `pipboy.msg` for the text content |

The parsed result is stored in `gHolodiskDescriptions[gHolodisksCount]` as
`HolodiskDescription { int gvar; int name; int description; }` (`pipboy.cc:169`).

### 8.3 HolodiskDescription Struct

```c
typedef struct HolodiskDescription {
    int gvar;         // GVAR index (into gGameGlobalVars)
    int name;         // pipboy.msg ID for the holodisk name
    int description;  // pipboy.msg base ID for page 1 line 1
} HolodiskDescription;
```

(`pipboy.cc:169`)

### 8.4 Text Content Format

Text is stored as sequential message IDs in `pipboy.msg`, starting at
`holodisk->description`. Reading iterates forward one ID at a time until the
sentinel string `"**END-DISK**"` is found, or 500 IDs have been consumed
(`pipboy.cc:1286`). Each message ID is one line of rendered text.

Pagination:
- 35 lines per page (`PIPBOY_HOLODISK_LINES_MAX = 35`, `pipboy.cc:62`)
- Page 0 shows the holodisk name as an underlined centered header, then text
- Subsequent pages show the page indicator `"X of Y"` at top-right
- `gPipboyHolodiskLastPage` tracks the last page index

### 8.5 CE Acquisition Flow

There is no single "holodisk acquisition" function. Scripts set the GVAR
directly using `set_global_var` (opcode `0x80C6`, `interpreter_extra.cc:1219`).
The physical item and the GVAR set are two separate acts that scripts perform
in the same procedure.

**Typical pattern in a map or NPC script:**

1. Player loots a container or has dialogue with an NPC.
2. Script calls `add_obj_to_inven(gDude, holodisk_item)` (opcode `0x80D8`) to
   put the item in the player's inventory.
3. Script calls `set_global_var(GVAR_HOLODISK_XXX, 1)` to mark it as available
   in the Pip-Boy.

Some holodisks are "virtual" — the GVAR is set but no item object is created;
the player gets the information without a physical holodisk. Some dialogue
scenes set the GVAR directly without giving an item (e.g. an NPC reads the disk
aloud and the Pip-Boy records the content).

**What happens when the player uses a holodisk item:**

Using a misc item dispatches to `_protinst_default_use_item()` in
`proto_instance.cc`, which for `ITEM_TYPE_MISC` calls the chain:

1. `_obj_use_book(item)` — checks if item is a readable book; returns -1 if not
2. `_obj_use_flare(critter, item)` — checks if item is a flare; returns -1 if not
3. **`_obj_use_misc_item(item)`** (`proto_instance.cc:986`) — hardcoded PID
   switch for a small set of misc items (Ramirez Box, Raiders Map, Cat's Paw
   Issue 5, Pip-Boy Enhancers, Survey Map). If the item's PID matches, it runs
   the item's `use_p_proc` script.
4. If none match: "That does nothing" message.

Holodisk items are **not** in the hardcoded PID switch inside `_obj_use_misc_item`.
Instead, they reach this function via `_protinst_default_use_item` → back to
using the item's attached script if it has one. An NPC or container script
typically sets the GVAR *before* the item even enters the inventory, so using
the item a second time would be redundant. In practice, holodisk items in
inventory are passive carry-weight items — their script fires on pickup/dialogue,
not on player use.

### 8.6 CE Pip-Boy Integration (STATUS Tab)

The holodisk list appears in the **DATA column** (right side) of the STATUS tab.
Quests appear in the QUESTS column (left side). Both share the same tab handler
`pipboyWindowHandleStatus()` at `pipboy.cc:874`.

**Building the list:**

On STATUS tab entry (`a1 == 1024`):
1. `gPipboyWindowHolodisksCount` is reset to 0.
2. The engine scans `gHolodiskDescriptions[0..gHolodisksCount-1]`; for each
   where `gGameGlobalVars[holodisk->gvar] != 0`, increments the count
   (`pipboy.cc:894`).
3. `pipboyWindowRenderHolodiskList(-1)` renders all acquired holodisk names in
   the DATA column, using `pipboy.msg` ID `holodisk->name` for each
   (`pipboy.cc:1419`).
4. The function returns the count of rendered holodisks.
5. Buttons are created for: all quest locations + all holodisks + 1 (back
   button): `pipboyWindowCreateButtons(2, questCount + holodiskCount + 1, false)`
   (`pipboy.cc:912`).

**Selecting a holodisk:**

When the player clicks a holodisk name in the DATA column
(`gPipboyMouseX > 429`):
1. The engine searches `gHolodiskDescriptions` for the Nth acquired holodisk
   (matching by button click index), stores its array index in `_holodisk`
   (`pipboy.cc:934`).
2. `_holo_flag = 1` — marks that holodisk text view is active.
3. `_view_page = 0` — resets to page 1.
4. `pipboyRenderHolodiskText()` renders the text content (`pipboy.cc:961`).

**Paging:**

Page Up / Page Down in the open Pip-Boy window (`pipboy.cc:470`):
- Page Up: decrements `_view_page` if `_view_page > 0`, calls `pipboyRenderHolodiskText()`
- Page Down: increments `_view_page` if `_view_page <= gPipboyHolodiskLastPage`,
  calls `pipboyRenderHolodiskText()`

**DATA column header:**

Rendered only when at least one holodisk is acquired, using pipboy.msg ID 211
("DATA") as an underlined, centered column header (`pipboy.cc:1432`).

### 8.7 Known Holodisks in Fallout 2

GVAR constants from `game_vars.h` that correspond to holodisk entries in
`holodisk.txt`:

| GVAR constant | Location | Description |
|---|---|---|
| `GVAR_HOLODISK_SIERRA_EVACUATION` | Sierra Army Depot | Evacuation orders |
| `GVAR_HOLODISK_SIERRA_MED_LOG` | Sierra Army Depot | Medical log |
| `GVAR_HOLODISK_SIERRA_EXP_LOG` | Sierra Army Depot | Experiment log |
| `GVAR_SIERRA_GNN_HOLODISK` | Sierra Army Depot | GNN broadcast |
| `GVAR_SIERRA_MISSION_HOLODISK` | Sierra Army Depot | Mission briefing |
| `GVAR_NCR_FAKE_VAULT13_HOLODISK` | NCR | Fake Vault 13 map |
| `GVAR_HOLODISK_MB_OUTSIDE` | Military Base | Level 0 (surface) |
| `GVAR_HOLODISK_MB_LEVEL_1` | Military Base | Level 1 |
| `GVAR_HOLODISK_MB_LEVEL_2` | Military Base | Level 2 |
| `GVAR_HOLODISK_MB_LEVEL_3` | Military Base | Level 3 |
| `GVAR_HOLODISK_MB_LEVEL_4` | Military Base | Level 4 |
| `GVAR_ELRON_HOLODISK` | San Francisco | Shi-related |
| `GVAR_HOLODISK_ENCLAVE_SECURITY` | Enclave Oil Rig | Security protocol |
| `GVAR_HOLODISK_ENCLAVE_STATE` | Enclave Oil Rig | State department |
| `GVAR_HOLODISK_ENCLAVE_WORD` | Enclave Oil Rig | Codebook |
| `GVAR_HOLODISK_ENCLAVE_CHEMICAL` | Enclave Oil Rig | Chemical formula |
| `GVAR_HOLODISK_ENCLAVE_ATOMIC` | Enclave Oil Rig | Atomic protocols |
| `GVAR_VAULT_CITY_DESIGNER_NOTES` | Vault City | Designer notes |

Quest-related (holodisk as a carried quest item, not Pip-Boy readable):

| GVAR constant | Description |
|---|---|
| `GVAR_VAULT_DELIVER_HOLODISK` | Vault City delivery quest — tracking GVAR |
| `GVAR_QUEST_DELIVER_HOLODISK` | Vault City delivery quest — Pip-Boy quest entry |

### 8.8 DH2 Implementation Status

**Proto layer (`pro.ts`):** `getPROSubTypeName()` maps item subtype 5 to `'misc'`
(matching CE's `ITEM_TYPE_MISC = 5`). Holodisk items in `proto/items/` load correctly
as misc items with `obj.subtype = 'misc'`. No crash, no gap here — the proto layer
works. ✅

**Inventory addition (`scripting.ts`):** `add_obj_to_inven` (scripting.ts:734,
vm_bridge.ts wired at `0x80D8`) adds items to `obj.inventory`. Scripts that call
`add_obj_to_inven(gDude, holodisk_item)` will place the holodisk item in the player's
inventory correctly. ✅

`obj_carrying_pid_obj` (scripting.ts:740, wired at `0x810D`) checks whether an
object carries an item with a given PID. This works for holodisk items. ✅

`set_global_var` (scripting.ts, wired at `0x80C6`) sets GVARs. Scripts that
call `set_global_var(GVAR_HOLODISK_XXX, 1)` will set the GVAR correctly. ✅

**Misc item use (`object.ts`):** `Obj.use()` (`object.ts`) dispatches based on
`this.subtype`. Misc items (`subtype === 'misc'`) fall through to the default
`this.singleAnimation()` path — they play their idle animation and do nothing else at
the engine level. For holodisk items that have a script with `use_p_proc`, the script
fires first (line 731). If the script calls `set_global_var`, the GVAR is set. This
mirrors CE's behaviour (CE holodisk use also goes to the item's script). ✅

**Pip-Boy DATA column (`ui_pipboy.ts`):** Not implemented. `ui_pipboy.ts` has no
holodisk data, no `holodisk.txt` loading, no GVAR scan for holodisk visibility, and no
DATA column renderer. The ARCHIVES tab (`renderArchivesTab()`, `ui_pipboy.ts`)
renders the quest log — it is a remap of CE's VIDEO ARCHIVES tab, not CE's STATUS DATA
column. There is no equivalent to CE's STATUS tab DATA column in DH2. ❌

**Text content (`pipboy.msg`):** `pipboy.msg` (or its DH2 equivalent) is not loaded
anywhere in DH2. The holodisk text content stored as sequential entries in `pipboy.msg`
is not accessible. ❌

### 8.9 Implementation Notes (if adding holodisk support)

Minimum viable path following CE architecture:

1. **Data file**: Ship `data/holodisk.json` (converted from `holodisk.txt` by the
   asset pipeline) with entries `[gvar, nameId, descBase]`.
2. **Text file**: Load `pipboy.msg` entries into a `Map<number, string>` at
   startup — same map used for quest names and holodisk text.
3. **Registry**: On Pip-Boy open, scan holodisk entries where
   `globalState.gvars[entry.gvar] !== 0` to build the visible list.
4. **ui_pipboy.ts**: Add DATA column to `renderStatusTab()` (currently renders
   HP/conditions, which is itself a gap from CE — see §9 Gap #1).
   Alternatively add a new HOLODISKS tab.
5. **Text view**: Add a holodisk reader sub-screen to ui_pipboy.ts with
   pagination at 35 lines per page, navigable via button clicks or keyboard.

---

## 9. DH2 Status Summary

| Feature | CE source | DH2 status |
|---|---|---|
| Pip-Boy open/close key | `pipboy.cc:403,453` | ✅ `Config.controls.pipboy` → `togglePipBoy` |
| Date/time bar | `pipboy.cc:563–565` | ✅ renders day, month, year, HH:MM from `GameTime` |
| STATUS: quest+holodisk overview | `pipboyWindowHandleStatus` | ❌ DH2 STATUS shows HP/conditions (gap #1) |
| STATUS: HP/conditions display | *(CE: alarm clock only)* | ✅ DH2 shows HP, poison, rad (non-CE design) |
| STATUS: quest detail (click town) | `pipboyWindowHandleStatus` | ✅ DH2 ARCHIVES tab covers this |
| STATUS: holodisk list + reader | `pipboyWindowRenderHolodiskList` | ❌ not implemented (gap #2) |
| AUTOMAPS: map database (AUTOMAP.DB) | `automap.cc` | ❌ replaced by seen-tile localStorage approach |
| AUTOMAPS: location+map navigation | `_PrintAMList`, `_PrintAMelevList` | ✅ 3-level hierarchy in DH2 |
| AUTOMAPS: FRM tile rendering | `automapRenderInPipboyWindow` | ❌ DH2 uses canvas pixel renderer |
| AUTOMAPS: zoom/pan | — | ✅ DH2 adds zoom+drag (CE has no equivalent) |
| ARCHIVES: quest log | CE: STATUS tab click flow | ✅ dedicated ARCHIVES tab |
| VIDEO ARCHIVES | `pipboyHandleVideoArchive` | ❌ not implemented; tab slot repurposed (gap #3) |
| ALARM CLOCK: rest system | `pipboyHandleAlarmClock` | ❌ replaced by simple wait menu (gap #4) |
| ALARM CLOCK: rest-location check | `_critter_can_obj_dude_rest` | ❌ no rest location check |
| ALARM CLOCK: heal during rest | `pipboyRest`, `_AddHealth` | ❌ time advances but no healing |
| ALARM CLOCK: HP display during rest | `pipboyDrawHitPoints` | ❌ wait menu shows no HP |
| Idle screensaver | `pipboyRenderScreensaver` | ❌ not implemented |
| Pip-Boy availability gate | `wmMapPipboyActive` | ❌ always available in DH2 (gap #5) |
| `pipon` sound on open | `pipboy.cc:699` | ❌ no open sound |
| `map_update_p_proc` on close | `pipboyWindowFree:709` | ❌ not called on Pip-Boy close |
| Holodisk proto/inventory layer | `proto_instance.cc`, `interpreter_extra.cc` | ✅ misc item type, add_obj_to_inven, set_global_var all work |
| holodisk.txt loading | `holodiskInit()` `pipboy.cc:2525` | ❌ not implemented (gap #6) |
| pipboy.msg text store | `pipboyRenderHolodiskText` | ❌ not loaded in DH2 (gap #7) |
| GVAR → holodisk visibility scan | `pipboyWindowHandleStatus` `pipboy.cc:894` | ❌ not implemented (gap #8) |
| Holodisk text pagination | `pipboy.cc:470,1286` | ❌ not implemented (gap #9) |

---

## 10. Known Gaps

### Gap #1 — STATUS tab content mismatch
CE's STATUS tab shows quests + holodisks. DH2's STATUS tab shows HP/poison/rad/time.
These serve different information needs. In DH2, quest viewing is on the ARCHIVES tab
rather than STATUS, so the end-to-end quest access is preserved but at a different tab.
The HP/conditions display in DH2 STATUS has no CE equivalent in the Pip-Boy.

### Gap #2 — Holodisk list and reader absent from Pip-Boy
CE's holodisk system (DATA column in STATUS tab, paginated text reader) is not
implemented in DH2. Items that grant holodisk GVARs exist in the game world but their
text content cannot be read via the Pip-Boy.

### Gap #3 — Video Archives absent
CE allows replaying viewed cutscenes. `play_gmovie` in `scripting.ts` is a stub no-op,
so even if the tab were present it would have nothing to play.

### Gap #4 — Rest system replaced by time-advance only
CE rest heals the player and party over time and checks location eligibility. DH2's
wait menu only advances game time with no healing, no eligibility check, and no
condition-based durations ("Until Healed").

### Gap #5 — Pip-Boy always available
CE gates Pip-Boy access on `MOVIE_VSUIT` (the Vault Suit pickup cutscene). DH2 makes
it available from game start. Early-game access to the Pip-Boy's quest log and automaps
is therefore always granted in DH2.

### Gap #6 — No holodisk.txt loading
CE loads `data\holodisk.txt` at Pip-Boy init (`holodiskInit()`). DH2 has no
equivalent. The `HolodiskDescription` registry (GVAR index → name msg ID →
text base msg ID) does not exist in DH2. To implement: load `data/holodisk.txt`
(or its JSON equivalent) at startup; populate a holodisk registry.

### Gap #7 — No pipboy.msg text store
CE renders holodisk text by reading `pipboy.msg` entries
`holodisk->description` through `"**END-DISK**"`. DH2 does not load `pipboy.msg`.
To implement: load `pipboy.msg` and make it queryable by message ID
(same infrastructure needed for quest/holodisk display in CE STATUS tab).

### Gap #8 — GVAR → holodisk visibility never checked
Even if GVARs are correctly set by map scripts, nothing in DH2 reads them to
determine holodisk availability. The scan loop in `pipboyWindowHandleStatus()`
(`gGameGlobalVars[holodisk->gvar] != 0`) has no DH2 equivalent.

### Gap #9 — Holodisk text pagination not implemented
CE paginates holodisk text at 35 lines per page and supports Page Up / Page Down
within the Pip-Boy. DH2 has no pagination infrastructure for Pip-Boy content.

<!-- audited: 2026-06-02 -->
