# DarkHarold2 — Pip-Boy UI

**Audited:** 2026-06-01  
**CE ref:** `raw/fallout2-ce/src/pipboy.cc` (`pipboyOpen`, `pipboyWindowInit`, `pipboyWindowFree`,
`pipboyWindowHandleStatus`, `pipboyWindowRenderQuestLocationList`, `pipboyWindowRenderHolodiskList`,
`pipboyRenderHolodiskText`, `pipboyWindowHandleAutomaps`, `_PrintAMList`, `_PrintAMelevList`,
`pipboyHandleVideoArchive`, `pipboyHandleAlarmClock`, `pipboyWindowRenderRestOptions`,
`pipboyDrawHitPoints`, `pipboyRenderScreensaver`, `questInit`, `holodiskInit`),
`raw/fallout2-ce/src/automap.cc` (`AutomapHeader`, `automapSaveCurrent`, `automapGetHeader`,
`_automapDisplayMap`)  
**DH2 ref:** `src/ui_pipboy.ts` (`openPipBoy`, `closePipBoy`, `togglePipBoy`, `renderStatusTab`,
`renderAutomapsTab`, `renderArchivesTab`), `src/automapData.ts` (`markSeenAt`, `getArchivedMaps`,
`drawAutomapInto`, `snapshotCurrentMapObjects`), `src/ui_automap.ts`,
`src/main.ts` (keyboard trigger at line 899)  
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

`togglePipBoy()` in `src/ui_pipboy.ts:726`. Triggered by `Config.controls.pipboy` key at
`src/main.ts:899`. No availability check — the Pip-Boy is always available regardless of
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

### 3.2 DH2 (`renderStatusTab`, `ui_pipboy.ts:307–330`)

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

### 4.2 DH2 (`renderAutomapsTab`, `ui_pipboy.ts:401–544`; `automapData.ts`)

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

Bell button in the date/time bar → `toggleWaitMenu()` (`ui_pipboy.ts:161`).

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

## 8. Holodisks (CE-only)

CE loads `data\holodisk.txt` in `holodiskInit()` (`pipboy.cc:2524`). Format: 3 tokens per
line — `gvarIndex nameMessageId descriptionStartMessageId`. Each holodisk is gated by a
GVAR: when `gGameGlobalVars[gvar] != 0`, the holodisk is "found" and appears in the
STATUS tab DATA column.

Holodisk content is stored in `pipboy.msg` as sequential message IDs starting at
`description` and terminated by the sentinel string `"**END-DISK**"`. Paragraphs are
separated by `"**END-PAR**"` (adds a blank line). Content is paginated at 35 lines per
page with More/Done navigation.

**DH2 status:** Not implemented. No `holodisk.txt` parsing, no holodisk DATA column in
the STATUS tab, no holodisk text reader.

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

### Gap #1 — STATUS tab content mismatch
CE's STATUS tab shows quests + holodisks. DH2's STATUS tab shows HP/poison/rad/time.
These serve different information needs. In DH2, quest viewing is on the ARCHIVES tab
rather than STATUS, so the end-to-end quest access is preserved but at a different tab.
The HP/conditions display in DH2 STATUS has no CE equivalent in the Pip-Boy.

### Gap #2 — Holodisks absent
CE's holodisk system (DATA column in STATUS, paginated text reader) is not implemented
in DH2. Items that grant holodisk GVARs exist in the game world but their text content
cannot be read via the Pip-Boy.

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
<!-- audited: 2026-06-01 -->
