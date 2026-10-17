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

`togglePipBoy()` / `openPipBoy()` in `src/ui_pipboy/shell.ts`, triggered by `Config.controls.pipboy` (`src/input.ts`) or the HUD button.

- CE `pipboyOpen` gate: until the Vault Suit movie (`MOVIE_VSUIT`) has been seen, "You aren't wearing the pipboy!" (misc.msg 7000) and nothing opens. The sfall option `pipboy_available_at_game_start` is `fallout2.cfg [dh2] pipboy_available_at_game_start=1` (`Config.engine.pipboyAvailableAtStart`).
- Appends a `640×480` div with `pip.png`, the red-dot tab buttons (STATUS, AUTOMAPS, ARCHIVES, CLOSE), the date/time bar; opens on STATUS; resets `_rest_time`.
- `closePipBoy()` runs `map_update_p_proc` (CE `pipboyWindowFree` → `scriptsExecMapUpdateProc`).

Not ported: the idle screensaver; the `pipon` sound (not in the extracted F2 data).

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

### 3.2 DH2 (`src/ui_pipboy/tabs/status.ts`)

As CE `pipboyWindowHandleStatus` (2026-10-17):
- Left: STATUS (pipboy.msg 202) and the quest locations (map.msg names) with at least one quest at or past its display threshold; "no quests" (203) when there are none.
- Right: DATA (211) and the holodisks whose GVAR is non-zero (`data/data/holodisk.txt`).
- A location opens "<location> <210>" and its numbered quests; completed ones (GVAR ≥ completed threshold) struck through in dark green; BACK (201).
- A holodisk opens its text (`pipboyRenderHolodiskText`): pipboy.msg lines from `description` to `**END-DISK**`, `**END-PAR**` as an empty line, 35 lines a page, the title on the first page, "N of M" (212) with more than one page, BACK (201) and MORE (200) / DONE (214); Page Up / Page Down.

Quests come from `data/data/quests.txt` + `quests.msg` (`src/questData.ts`, CE `questInit`, sorted by location) — no longer an inlined table.

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

## 5. ARCHIVES Tab — Video Archives

The ARCHIVES dot opens CE's VIDEO ARCHIVES (`pipboyHandleVideoArchive` / `pipboyRenderVideoArchive`, `pipboy.cc:1673–1765`; `src/ui_pipboy/tabs/archives.ts`): every movie 2–15 the player has seen (pipboy.msg 500 + movie, header 206); clicking one replays it with FADE_IN | FADE_OUT | PAUSE_MUSIC. The quest log is on the STATUS page, as in CE (§3).

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

Bell button in the date/time bar → `toggleWaitMenu()` (`src/ui_pipboy/shell.ts`), ported 2026-10-17:
- `critterCanDudeRest()` (CE `_critter_can_obj_dude_rest`): a living critter whose `whoHitMe` is the dude blocks resting; where maps.txt `can_rest_here` forbids it for the elevation (`mapCanRestHere`, `src/data.ts`), every living critter of another team blocks it too → `iisxxxx1` + "You cannot rest at this location!" (215).
- ALARM CLOCK (300), "Hit Points cur/max" (301), options 302–314; 315 (until the party is healed) only with a party member rest can heal (living, visible, not a robot, wounded).
- `pipboyRest(hours, minutes, duration)`: the CE frame loop (≈20 fps over `minutes / 1440 × 3.5 + 0.25` s), time set per frame so queued events fire on the way; `_Check4Health`: every 180 minutes rested, `_partyMemberRestingHeal` — the dude and every party member heal their Healing Rate. "Until healed": `wound / Healing Rate × 3` hours in ≤ 24 h chunks, then 3-hour steps until the dude (and with 315 the party) is full.
- ESC stops the rest. Combat starting, the dude dying or a dialogue / barter / worldmap opening during it ends the rest and closes the Pip-Boy (CE `_proc_bail_flag`).
- `_ClacTime` ported literally (until 08:00 / 12:00 / 18:00 / 00:00).

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

Implemented 2026-10-17 (§3.2): `data/data/holodisk.txt` is read as CE `holodiskInit` (`getHolodiskDefs()`, `src/questData.ts`); a holodisk shows in the DATA column once its GVAR is non-zero; its text comes from pipboy.msg. The item side was already CE: holodisk items are misc items whose `use_p_proc` / pickup scripts set the GVAR.

---

## 9. DH2 Status Summary

| Feature | CE source | DH2 status |
|---|---|---|
| Pip-Boy open/close key | `pipboy.cc:403,453` | ✅ |
| Availability gate (`MOVIE_VSUIT`) | `pipboyOpen`, `wmMapPipboyActive` | ✅ (sfall option as `[dh2] pipboy_available_at_game_start`) |
| Date/time bar | `pipboyDrawDate` | ✅ |
| STATUS: quest locations + quests | `pipboyWindowHandleStatus` | ✅ from quests.txt / quests.msg / map.msg |
| STATUS: holodisk list + reader | `pipboyWindowRenderHolodiskList`, `pipboyRenderHolodiskText` | ✅ 35 lines a page |
| AUTOMAPS | `automap.cc` | ✅ hierarchy; DH2 canvas renderer instead of AUTOMAP.DB (see §4) |
| VIDEO ARCHIVES | `pipboyRenderVideoArchive` | ✅ (ARCHIVES dot) |
| ALARM CLOCK: rest, location check, healing, party option | `pipboyHandleAlarmClock`, `pipboyRest`, `_critter_can_obj_dude_rest` | ✅ |
| `map_update_p_proc` on close | `pipboyWindowFree` | ✅ |
| Idle screensaver | `pipboyRenderScreensaver` | ❌ not ported (cosmetic) |
| `pipon` sound | `pipboyWindowInit` | ❌ not in the extracted data |

---

## 10. Known Gaps

- **Idle screensaver** (`pipboyRenderScreensaver`) — not ported; cosmetic.
- **Automap renderer** — DH2 draws the seen tiles on a canvas instead of CE's AUTOMAP.DB FRM rendering (§4).
- **Rest interruption** — CE bails out when any queued event's process returns true; DH2 stops on the observable results (combat, death, a dialogue / barter / worldmap).

<!-- audited: 2026-10-17 -->
