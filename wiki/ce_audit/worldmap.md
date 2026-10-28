# CE parity audit — worldmap (worldmap.cc / worldmap.h)

Scope: `raw/fallout2-ce/src/worldmap.cc` (6674 lines) + `worldmap.h`. DH2 code checked: `src/worldmap/Worldmap.ts`, `src/worldmap/encounters.ts`, `src/worldmap/encounterData.ts`, `src/worldmap/parser.ts`, `src/encounters/conditionLang.ts`, `src/uiWorldmap.ts`, the parts of `src/data.ts` that parse city.txt and maps.txt, the worldmap opcodes in `src/scripting.ts` (metarule / metarule3 / mark_area_known / wm_area_set_pos), `src/audio.ts` (ambient sfx), `src/gametime.ts` / `src/gameTick.ts` (time passing). Audited 2026-10-24.

Wiki hints used: `wiki/worldmap.md` (§17 gaps), `wiki/car_system.md`, `wiki/known_bugs.md` C55, W1–W17. Every finding below was checked against the code, not taken from the wiki.

## Summary

| Status | Count |
|---|---|
| ✅ MATCH | 77 |
| ⚠️ DIFFERS | 14 |
| 🟡 PARTIAL | 7 |
| ❌ MISSING | 6 |
| 🚫 N/A | 10 |

(Counted per table row. Trivial helpers that are grouped count as one row.)

The C55 port of travel, the encounter roll, the pick, critter setup, formations and the worldmap.txt parser is very close to CE. The remaining gaps sit around it: the town map, the map-entrance state, the subtile-state opcodes and the script-facing metarules.

Top findings, by severity:

1. **WM-01 (HIGH, NEW)**: `metarule3(105)` METARULE3_WM_SUBTILE_STATE is a stub that always returns 1. `vcstark` (Vault City, Stark's scouting job) checks `> 1` (visited) on 8 subtiles, so in DH2 the "already scouted" dialogue options never appear. DH2 tracks the subtile state already but never exposes it. Its numbering is also swapped against CE: DH2 uses 1 = visited and 2 = known; CE uses 1 = known and 2 = visited.
2. **WM-02 (HIGH, NEW)**: the engine never opens town-map entrances on its own. CE calls `wmMapMarkMapEntranceState(map, elevation, 1)` on every map load (`map.cc:1029`), on every elevation change (`map.cc:376`) and on every exit-grid use (`object.cc:1434`, `proto_instance.cc:1530/1564/1598`). DH2 changes an entrance's state only through metarule3 104, so entrances that start "Off" in city.txt stay hidden on the town map after the player has walked into them.
3. **WM-03 (HIGH, NEW)**: the town-map rule is missing. CE opens the town map only when `visitedState == 2 && mapFid != -1`; otherwise `wmAreaFindFirstValidMap` loads the first open entrance directly and sets `visitedState = 2`. DH2 always shows the area view. Areas with `townmap_art_idx=-1` (Enclave, Abbey, Primitive Tribe, EPA, Ghost Farm, Car Outta Gas, Destroyed Arroyo, Toxic Caves, …) get a blank `undefined.png` background and auto-placed entrance buttons.
4. **WM-04 (MED, NEW)**: metarule3 104 (`wmMapMarkMapEntranceState`) does not follow CE's matching. DH2 clamps city.txt entrance elevation −1 to 0 and compares it exactly, so CE's −1 wildcard on either side is lost. DH2 also skips the MAP_SAVED check and changes every matching entrance instead of the first one.
5. **WM-05 (MED, NEW)**: METARULE_MAP_KNOWN (19) compares a maps.txt index (number) with entrance map names (strings). It always returns 0. CE `wmMapIsKnown` returns the entrance's `state`. This affects `nccody` (a dialogue line variant), `mitrpdor` and `osvdrcmp`.
6. **WM-06 (MED, NEW)**: the town map hides nothing and labels nothing the way CE does. CE skips entrances with x or y = −1 and labels each hotspot with worldmap.msg `200 + 10·area + index`. DH2 shows the −1/−1 entrances in an auto-placed row and labels every hotspot with the raw maps.txt lookup name.
7. **WM-07 (MED, NEW)**: no worldmap music. CE `wmInterfaceInit` plays `20car` (in the car) or `23world` (`_gsound_background_play_level_music`). DH2 plays nothing on the worldmap.
8. **WM-08 (MED, NEW)**: `wmAreaMarkVisitedState` side effects are missing. When a known area gets a visited state, CE clears the fog around it (`wmMarkSubTileRadiusVisited(city.x, city.y)`) and, for state 1, marks its subtile known. `mark_area_known` in DH2 changes only the area.
9. **WM-09 (MED, NEW)**: four city.txt entrances have elevation −1 and a real tile (Broken Hills 2, NCR: Downtown, San Fran Dock, Destroyed Arroyo Bridge). CE `mapLoad` replaces the whole entering location with the map header's when the elevation is −1. DH2 clamps the elevation to 0 and puts the player on that tile.
10. **WM-10 (LOW, documented in worldmap.md §17 #1)**: sfall `wmForceEncounter` is missing. Also missing: `wmCheckGameAreaEvents` (the Fake Vault 13 A→B swap on map load, LOW, NEW), metarule3 101 MARK_SUBTILE (a no-op although the fog grid now exists; used by `bhrnddst`, LOW, NEW), the night-time bird-to-cricket ambient sfx remap (LOW, NEW), and the worldmap keys T / Home / Ctrl+F1–F7 / Ctrl+↑↓ plus the town-map keys 1–9 and Esc (LOW).

## Function table

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| `cityIsValid` | implicit `globalState.mapAreas?.[id]` checks | ✅ | — | |
| `wmSetFlags` | `data.ts parseMapInfo` booleans | 🚫 | — | Bit helper. DH2 stores map flags as booleans. |
| `wmWorldMap_init` | `Worldmap.ts:698 init`, `data.ts:166 loadAreas` | 🚫 | — | CE allocates and saves the worldmap.dat temp file; DH2 parses the text files. |
| `wmGenDataInit` | `Worldmap.ts:814` (party at 173,122), `resetWorldmap` | ✅ | — | Fuel, car area, Horrigan flag, current area: the CE defaults. |
| `wmGenDataReset` | `Worldmap.ts:617 resetWorldmap`, `encounters.ts:470 resetEncounters` | ✅ | — | |
| `wmWorldMap_exit` | — | 🚫 | — | Frees memory. |
| `wmWorldMap_reset` | `Worldmap.ts:617` | ✅ FIXED (2026-10-26) | LOW | `gGameTimeIncRemainder = 0` (the sfall Pathfinder remainder) is not reset; `gameTimeIncRemainder` survives NEW GAME and load. `wmMarkAllSubTiles(0)` is matched by reparsing worldmap.txt. — **2026-10-26:** gameTimeIncRemainder is reset with the world map (new game / load). |
| `wmWorldMap_save` | `saveload.ts:217-231`, `serializeAreaStates:588`, `serializeSquareStates:413`, `serializeEncounters encounters.ts:455` | ✅ | — | JSON in place of the binary format. `encounterMapId/TableId/EntryId` and `encounterIconIsVisible` are not saved; DH2 clears them after setup, so nothing is lost. |
| `wmWorldMap_load` | `saveload.ts:389-400` | ✅ | — | `wmInterfaceCenterOnParty` happens when the worldmap opens. |
| `wmWorldMapSaveTempData` / `wmWorldMapLoadTempData` | `resetWorldmap` (re-reads city.txt / worldmap.txt) | 🚫 | — | |
| `wmConfigInit` | `parser.ts:25 parseWorldmap`, `encounterData.ts:325 parseEncounterData` | ✅ | — | Frequencies, terrain types, encounter tables, tiles, `encounter_difficulty`, `walk_mask_name`. |
| `wmReadEncounterType` | `encounterData.ts:350-370` | ✅ | — | `maps` up to 6, `enc_NN` up to 40. |
| `wmParseEncounterTableIndex` | `encounterData.ts:280 parseTableEntry` | ✅ | — | Keeps CE's `special` +7/+8 consumption fix. |
| `wmParseEncounterSubEncStr` | `encounterData.ts:201 parseSubEncStr` | ✅ | — | |
| `wmParseFindSubEncTypeMatch` / `wmFindEncBaseTypeMatch` | `encounterData.ts:242 findSubEncType` | ✅ | — | |
| `wmReadEncBaseType` | `encounterData.ts:251 readBaseType` | ✅ | — | Without `team_num`, CE leaves `team` uninitialized; DH2 keeps the proto team (documented in the code comment). |
| `wmParseEncBaseSubTypeStr` | `encounterData.ts:177 parseBaseSubType` | ✅ | — | ratio / dead / pid / distance / tilenum / 10 items / script / condition. |
| `wmEncBaseTypeSlotInit`, `wmEncBaseSubTypeSlotInit`, `wmEncounterSubEncSlotInit`, `wmEncounterTypeSlotInit`, `wmEncounterTableSlotInit`, `wmTileSlotInit`, `wmTerrainTypeSlotInit`, `wmConditionalDataInit` | object literals in `encounterData.ts` | ✅ | — | Same defaults (ratio 100, pid −1, tile −1, scenery NORMAL, counter −1, spacing 1, distance −1). |
| `wmParseTerrainTypes` | `encounterData.ts:336`, `parser.ts:95 terrainSpeed` | ✅ | — | Two parallel tables: `terrainSpeed` for walking, `terrains` for random maps. |
| `wmParseTerrainRndMaps` | `encounterData.ts:340-345` | ✅ | — | |
| `wmParseSubTileInfo` | `parser.ts:30 parseSquare` | ✅ | — | DH2 is more lenient: a missing day-part frequency falls back to the first one; CE fails the load. |
| `wmParseFindEncounterTypeMatch` / `wmParseFindTerrainTypeMatch` | name lookups at use time (`encounters.ts:187`, `:230`) | ✅ | — | Resolved by lower-case name on every roll instead of once at parse time. |
| `wmParseEncounterItemType` / `wmParseItemType` | `encounterData.ts:161`, `:135` | ✅ | — | `{wielded}`/`(wielded)`/`{worn}`/`(worn)`. |
| `wmParseConditional` | `encounterData.ts:118 parseConditional` → `conditionLang.ts:139 parseConds` | 🚫 N/A (2026-10-26) | LOW | CE stores at most 3 sub-conditions joined by `and`/`or`; its `strstr` searches the rest of the line. DH2 uses a general expression parser. It has no `or` token, and it accepts `<=`/`>=`, which CE does not. Vanilla worldmap.txt uses only `And` and at most 3 terms, so the outcome is the same there. — **2026-10-26:** the same outcome on the shipped worldmap.txt (the row says so). |
| `wmParseSubConditional` / `wmParseConditionalEval` | `conditionLang.ts:46 tokenizeCond`, `:79 parseCond` | ✅ | — | rand / global / player(level) / days_played / time_of_day / enctr(num_critters); ops `==` `!=` `<` `>`. |
| `wmAreaSlotInit` / `wmAreaInit` | `data.ts:88 parseAreas` | ✅ FIXED (WM-04, WM-09) | MED | Entrance elevation is clamped `Math.max(0, …)` (`data.ts:141`), which breaks WM-04 and WM-09. CE stops at the first missing `entrance_N`; DH2 reads every `entrance_*` key. lock_state, size and art indexes match. |
| `wmParseFindMapIdxMatch` | `data.ts:341 mapIndexFromLookup` | ✅ | — | |
| `wmEntranceSlotInit` / `wmMapSlotInit` / `wmMapInit` / `wmRStartSlotInit` | `data.ts:283 parseMapInfo` | ✅ | — | Lookup name, music, ambient sfx, random start points, saved, dead_bodies_age, can_rest_here (not deep-audited here; owned by the maps audit). |
| `wmMapMaxCount`, `wmMapIdxToName`, `wmMapMatchNameToIdx` | `data.ts lookupMapName`, `mapIndexOf` | ✅ | — | |
| `wmMapIdxIsSaveable` / `wmMapIsSaveable` | `data.ts:396 mapIsSaved` | ✅ | — | |
| `wmMapDeadBodiesAge` | `data.ts:402` | ✅ | — | |
| `wmMapCanRestHere` | `data.ts:408` | ✅ | — | |
| `wmMapPipboyActive` | `uiPipBoy/shell.ts:515-517` | ✅ | — | DH2 option `pipboyAvailableAtStart` (DH2-only). |
| `wmMapMarkVisited` | `Worldmap.ts:568 markMapVisited` (on `loadMapPost`, mark_area_known type 1) | ✅ | — | Saved maps only, then `wmAreaMarkVisited`. The `wmAreaMarkVisitedState` side effects are missing (WM-08). |
| `wmMatchEntranceFromMap` / `wmMatchEntranceElevFromMap` / `wmMatchAreaFromMap` | inline in `scripting.ts:959-975`, `:794-805` | ✅ FIXED (WM-04) | MED | No −1 elevation wildcard; every match changed instead of the first (WM-04). |
| `wmMapMarkMapEntranceState` | `scripting.ts:959 metarule3 104` only | ✅ FIXED (WM-02, WM-04) | HIGH | Not called from map load, elevation change or exit grids (WM-02); matching differs (WM-04). |
| `wmWorldMap` | `uiWorldmap.ts:60 uiWorldMap` | ✅ | — | |
| `wmWorldMapFunc` | `Worldmap.ts:1136 updateWorldmapPlayer` (+ `init` click handlers) | ✅ FIXED (WM-03) | MED | The walking frame matches (steps, car steps, fuel, out of gas, healing, fog, end of walk, 18000 ticks, encounter). Gaps: hotspot click ignores the town-map rule (WM-03); keys T / Home / Ctrl+F1–F7 / Ctrl+↑↓ are missing; arrow keys pan 2 px a frame only while stopped (CE: 20 px a press, also while walking); the mouse wheel over the map does not scroll it (CE 20 px). Out of gas: CE matches the area at the mouse (`worldX/worldY`, a CE bug); DH2 uses the party position. |
| `wmCheckGameAreaEvents` | — | ✅ FIXED (2026-10-26) | LOW | CE `mapLoad` hides CITY_FAKE_VAULT_13_A (45) and shows / visits B (46) while the party is at A. NEW. — **2026-10-26:** the Fake Vault 13 swap. |
| `wmInterfaceCenterOnParty` | `applyPan(x − 222, y − 219)` at `Worldmap.ts:850, 1164` | 🚫 N/A (2026-10-26) | LOW | CE offsets are −203/−200 and it is bound to Home. DH2 centers on the 445×438 view and recenters every walking frame; CE scrolls 1 px a step, so the party keeps its place on screen. — **2026-10-26:** DH2 centres on its own view; following the party while walking is a DH2 choice. |
| `wmCheckGameEvents` | `Worldmap.ts:1138 scriptsCheckGameEvents` | ✅ | — | |
| `wmRndEncounterOccurred` | `encounters.ts:95 rndEncounterOccurred` | ✅ | — | 1.5 s gate, 3 px in both axes, no roll inside an area, Horrigan after day 35 (special blink, no question), frequency ±freq/15 by difficulty, roll 0–100, special area put at the party and made known unless locked, car day-part modifier [40,30,0], best party Outdoorsman + motion sensor 20, cap 95, + tile difficulty, XP 100 − skill and misc.msg 8500, worldmap.msg 2999 / 3000+50t+e. The sfall forced-encounter branch is missing (see `wmForceEncounter`). The motion sensor is looked for in the top-level inventory only; CE also requires `owner == gDude`, so the outcome is the same. |
| `wmPartyFindCurSubTile` / `wmFindCurSubTileFromPos` / `wmFindCurTileFromPos` | `Worldmap.ts:1044 squareAt`, `parser.ts` (difficulty copied onto each square) | ✅ | — | One global 28×30 grid in place of 20 tiles × 7×6; the same for positions in range. |
| `wmRndEncounterPick` | `encounters.ts:185 rndEncounterPick` | ✅ | — | Conditions and counter, chance + (LK − 5) + Explorer 2 / Ranger 1 / Scout 1, ±5 with clamps by difficulty, last-candidate fallback, counter decrement, map from the entry, else the table, else the terrain. With no candidates, CE indexes `candidates[-1]` (undefined behaviour); DH2 cancels. |
| `wmSetupRandomEncounter` | `encounters.ts:243 setupRandomEncounter` | ✅ | — | worldmap.msg 2998 + description on one line (sfall); count ±2 by difficulty, +2 with more than 2 party members; with exactly 2 groups they fight each other (maxDamage 500). DH2 also needs `Config.engine.doCombat` (DH2-only switch). On a `wmSetupCritterObjs` failure CE calls `scriptsRequestWorldMap()`; DH2 has nothing to fail. The "attack the dude" branch is dead code in CE too. |
| `wmSetupCritterObjs` | `encounters.ts:405 setupCritterObjs` | ✅ | — | Ratio / single count, script index (`lookupScriptName` does the −1), team, attempt placement for SURROUNDING, rotation toward the dude, items with min/max, Fortune Finder ×2 money, wield. CE's `_obj_attempt_placement(object, tile, 0, 0)` passes elevation 0 (a CE quirk); DH2 uses the current elevation. Random encounter maps are on elevation 0, so no difference. |
| `wmSetupRndNextTileNumInit` | `encounters.ts:301` | ✅ | — | `wmRndIndex` is not reset, as in CE. |
| `wmSetupRndNextTileNum` | `encounters.ts:337` | ✅ | — | All 6 formations; give up after more than 25 attempts or more than 25 hexes. |
| `wmEvalTileNumForPlacement` | `encounters.ts:327` | ✅ | — | Blocking (dude excluded) + shoot-blocking path. DH2 accepts the dude's own tile without a path; whether CE's pathfinder accepts from == to is unverified (LOW). |
| `wmEvalConditional` | `conditionLang.ts:244 evalConds` | ✅ | — | AND-only data gives the same result. CE OR semantics (the last term decides) are not reproduced; vanilla data has no OR. |
| `wmEvalSubConditional` | `conditionLang.ts:223-238` | ✅ | — | DH2 adds `<=`, `>=`, `or` (unused by the data). |
| `wmGameTimeIncrement` | `Worldmap.ts:1076 gameTimeIncrement` → `GameTime.advanceTicks` → `gameTick.ts processTimeJump` | ✅ | — | Pathfinder 25 % a rank with the carried remainder (sfall). CE's per-event split has an inverted test (`nextEventTime >= gameTime ? ticksToAdd`), so it also adds everything at once. Due events then fire in order. CE stops if `queueProcessEvents` returns true; DH2 has no such stop. |
| `wmGrabTileWalkMask` | `Worldmap.ts:63 loadWalkMask` | ✅ | — | Lazy, cached; `data/data/<name>.msk`. |
| `wmWorldPosInvalid` | `Worldmap.ts:82 worldPosInvalid` | ✅ | — | CE bit formula including its "TODO: Check math" quirk. |
| `wmPartyInitWalking` | `Worldmap.ts:990 partyInitWalking` | ✅ | — | Bresenham set-up the same as CE. CE centers the view if the cursor is not visible; DH2 always centers. DH2 debug `instantTravel` added (DH2-only). |
| `wmPartyWalkingStep` | `Worldmap.ts:1052 partyWalkingStep` | ✅ | — | Terrain counter 1..4, difficulty ≥ 1, walk-mask stop. When blocked, CE matches the area with `(worldPosX, worldPosX)` (a CE typo); DH2 uses the correct (x, y). |
| `wmInterfaceScrollTabsStart` / `Stop` / `Update` | `uiWorldmap.ts:35 setLabelScroll` | 🚫 N/A (2026-10-26) | LOW | 27 px a step; CE animates 7×delta over several frames and disables the tab buttons while scrolling. DH2 jumps. — **2026-10-26:** the same end position; the animation is cosmetic. |
| `wmInterfaceInit` | `uiWorldmap.ts:60 uiWorldMap`, `Worldmap.ts:873 start` | ✅ FIXED (WM-07) | MED | Resets the encounter timer. Missing: worldmap music `20car`/`23world` (WM-07), `_map_save_in_game(true)` before the worldmap opens (not verified whether the DH2 map cache covers it), `scriptsDisable` (DH2 pauses the game loop through uiMode). |
| `wmInterfaceExit` | `uiWorldmap.ts:50 uiCloseWorldMap`, `Worldmap.ts:879 stop` | ✅ | — | Encounter fields cleared after setup. |
| `wmInterfaceScroll` / `wmInterfaceScrollPixel` | `Worldmap.ts:204 applyPan`, `:1183-1191` | 🚫 N/A (2026-10-26) | LOW | Step 20 px (CE) vs 2 px a frame; panning is disabled while walking. — **2026-10-26:** DH2 pans smoothly; the step size is cosmetic. |
| `wmMouseBkProc` | `Worldmap.ts:858 _onWMMouseMove` | 🚫 N/A (2026-10-26) | LOW | CE: the screen-edge pixel, 20 px every 50 ms, scroll cursors (and "can't scroll" cursors). DH2: a 20 px band inside the view, 2 px a frame, no cursor change. — **2026-10-26:** as wmInterfaceScroll: DH2 pans smoothly inside a band. |
| `wmMarkSubTileOffsetVisited` / `wmMarkSubTileOffsetKnown` / `wmMarkSubTileOffsetVisitedFunc` | `Worldmap.ts:373 markSquare` | ✅ | — | "Known only while unknown" rule kept. The numbers are swapped against CE (WM-01). |
| `wmMarkSubTileRadiusVisited` | `Worldmap.ts:391 markSubTileRadiusVisited` | ✅ | — | Radius 1 / Scout 2; `fill_s`, `fill_w` (including the CE `subtileX-- >= 0` step into the left tile). |
| `wmSubTileMarkRadiusVisited` (script) | `scripting.ts:945 metarule3 101` | ✅ FIXED (2026-10-25) | LOW | Returns 0 and does nothing; the implementation exists but has a fixed radius (Scout) and is not exported. Used by `bhrnddst`. NEW. — **Fixed 2026-10-25:** metarule3 101 marks the subtiles. |
| `wmSubTileGetVisitedState` | `scripting.ts:977 metarule3 105` | ✅ FIXED (WM-01) | HIGH | Always returns 1 (WM-01). |
| `wmTileGrabArt` | CSS background tiles | 🚫 | — | |
| `wmInterfaceRefresh` | DOM: `refreshAreaMarkers:472`, square classes, `placePartyMarker:963` | ✅ | — | Areas whose state is not UNKNOWN are drawn; unknown subtiles are hidden and known ones dimmed (CSS). |
| `wmInterfaceRefreshDate` | `Worldmap.ts:243 updateDate` | ✅ | — | |
| `wmMatchWorldPosToArea` | `Worldmap.ts:893 withinArea` | ✅ | — | Rectangle + WM_VIEW offset; the first known area. |
| `wmInterfaceDrawCircleOverlay` | `refreshAreaMarkers` + `areaLabelText:464` | ✅ | — | map.msg 1500+id when known, else worldmap.msg 1004. CE's translucent blend is approximated with CSS (documented in worldmap.md §17 #3). CE skips the name below y 464 − line height; cosmetic. |
| `wmInterfaceDrawSubTileRectFogged` / `wmInterfaceDrawSubTileList` | CSS `.worldmapSquare-*` | 🚫 | — | |
| `wmDrawCursorStopped` | `placePartyMarker:963`, hotspot `#worldmapTarget` | ✅ | — | |
| `wmCursorIsVisible` | — | 🚫 | — | DH2 always centers (see `wmPartyInitWalking`). |
| `wmGetAreaName` / `wmGetAreaIdxName` | `getMessage('map', 1500 + id)` | ✅ | — | |
| `wmAreaIsKnown` | `Worldmap.ts:562 areaIsKnown` | ✅ | — | |
| `wmAreaVisitedState` | `Worldmap.ts:535 areaVisitedState` | ✅ | — | |
| `wmMapIsKnown` | `scripting.ts:794 metarule 19` | ✅ FIXED (WM-05) | MED | Always 0 (WM-05). |
| `wmAreaMarkVisited` | `setAreaVisitedState(id, 2)` | ✅ | — | |
| `wmAreaMarkVisitedState` | `Worldmap.ts:521 setAreaVisitedState` | ✅ FIXED (WM-08) | MED | The 2→1 first-visit rule is kept; the fog reveal and the subtile-known side effects are missing (WM-08). |
| `wmAreaSetVisibleState` | `Worldmap.ts:512 setAreaVisible` | ✅ | — | Callers implement `force`/`lockState` (special encounter checks `lockState`; mark_area_known forces). |
| `wmAreaSetWorldPos` | `scripting.ts:3179 wm_area_set_pos`, internal assignments | ✅ FIXED (2026-10-26) | LOW | CE refuses x/y outside 0…1400 / 0…1500 (returns −1, with a script error in `opWmAreaSetPos`); DH2 accepts any value. — **2026-10-26:** wm_area_set_pos refuses x/y outside 0..1399 / 0..1499. |
| `wmGetPartyWorldPos` | `Worldmap.ts:345 getPlayerWorldPos` | ✅ | — | DH2 rounds; positions are integers anyway. Returns 0,0 (metarule 44/45) before the worldmap is initialised. |
| `wmGetPartyCurArea` | `Worldmap.ts:531 getCurrentAreaId` | ✅ | — | |
| `wmMarkAllSubTiles` | `resetWorldmap` re-parse | ✅ | — | |
| `wmTownMap` | `uiWorldmap.ts:60 uiWorldMap(true)` (scripts `town_map` / map.cc transition) | ✅ | — | |
| `wmTownMapFunc` | `uiWorldmap.ts:123 uiWorldMapShowArea`, `:147 hotspot onclick` | ✅ FIXED (WM-03, WM-09) | HIGH | Shown whatever the visited state or `mapFid` (WM-03). Number keys 1..n, Esc, T/W, Ctrl+F1–F7 are missing. Car parking on entry matches. mapSetEnteringLocation differs for elevation −1 (WM-09). |
| `wmTownMapInit` | `uiWorldMapShowArea:132-192` | ✅ FIXED (WM-06) | MED | CE skips entrances with x or y = −1; DH2 auto-places them (WM-06). |
| `wmTownMapRefresh` | `uiWorldMapShowArea:168` | ✅ FIXED (WM-06) | MED | Entrance label: worldmap.msg `200+10·area+index` (CE) vs the maps.txt lookup name (WM-06). |
| `wmTownMapExit` | `uiWorldMapWorldView` | 🚫 | — | |
| `wmCarUseGas` | `Worldmap.ts:196 carUseGas` | ✅ | — | Super car −90 %, NR upgrade −10 %, regulator /2, clamp 0. |
| `wmCarFillGas` | `Worldmap.ts:289 addCarFuel`, `scripting.ts:907 metarule 32` | ✅ FIXED (2026-10-26) | LOW | CE returns the amount that does not fit; DH2 metarule returns 1. DH2 ignores negative amounts; CE subtracts them. — **2026-10-26:** CE's amount and result. |
| `wmCarGasAmount` | `getCarFuel` | ✅ | — | |
| `wmCarIsOutOfGas` | `scripting.ts:1024 metarule3 110` | ✅ FIXED (2026-10-26) | LOW | CE `carFuel <= 0` whether or not the party is in the car; DH2 also requires `isInCar`. Not used by name in the vanilla scripts. — **2026-10-26:** metarule3 110: carFuel <= 0, in the car or not. |
| `wmCarCurrentArea` | `getCarAreaId`, metarule 30 | ✅ | — | |
| `wmCarGiveToParty` | `scripting.ts:890 metarule 31` | ✅ | — | Empty-tank message 1502 and −1; isInCar; worldmap; CAR_OUT_OF_GAS reset. DH2 opens the worldmap at once instead of through a −2 map transition at the end of the frame. |
| `wmSfxMaxCount` / `wmSfxRollNextIdx` | `audio.ts:301 rollNextSfx` | ✅ | — | |
| `wmSfxIdxName` | `audio.ts` (sfx name used as is) | ✅ FIXED (2026-10-26) | LOW | Night remap `brdchir1` → `cricket`, `brdchirp` → `cricket1` (hour ≤ 600 or ≥ 1800) is missing. NEW. — **2026-10-26:** the night cricket remap. |
| `wmRefreshInterfaceOverlay` | static DOM chrome | 🚫 | — | |
| `wmInterfaceRefreshCarFuel` | `Worldmap.ts:336-341` | ✅ | — | 70 px, rounded down to even. |
| `wmRefreshTabs` | `uiWorldmap.ts:195 uiWorldMapLabels` | ✅ | — | |
| `wmMakeTabsLabelList` | `uiWorldmap.ts:205-207` | ✅ | — | Known + label art. |
| `wmTabsCompareNames` | `localeCompare` | ✅ | — | CE `stricmp` on city.txt `area_name`; the order of the vanilla names is the same. |
| `wmFreeTabsLabelList` | — | 🚫 | — | |
| `wmRefreshInterfaceDial` / `wmInterfaceDialSyncTime` | `Worldmap.ts:217 updateDial` | ✅ | — | |
| `wmAreaFindFirstValidMap` | — | ✅ FIXED (WM-03) | HIGH | Part of WM-03. |
| `wmMapMusicStart` | `map/GameMap.ts` map-load music | ✅ | — | Owned by the sound/maps audit. |
| `wmSetMapMusic` | `data.ts:389 setMapMusicOverride` | ✅ FIXED (2026-10-26) | LOW | CE restarts the music at once when the index is the current map; DH2 only stores it for the next load. — **2026-10-26:** the current map's music restarts. |
| `wmMatchAreaContainingMapIdx` | `Worldmap.ts:911 areaIdContainingMap` | ✅ | — | 0 when nothing matches, as in CE. |
| `wmTeleportToArea` | `Worldmap.ts:543 teleportToArea` | ✅ | — | Sphere centre − WM_VIEW (sfall fix). |
| `wmFadeOut` / `wmFadeIn` / `wmFadeReset` | `mapFade.ts beginMapFade/endMapFade` | 🚫 N/A (2026-10-26) | LOW | Black overlay around map loads, not a palette fade; nothing before the encounter blink (documented in worldmap.md §17 #2). — **2026-10-26:** documented in worldmap.md §17 #2. |
| `wmBlinkRndEncounterIcon` | `Worldmap.ts:1098 blinkEncounterIcon` | ✅ | — | 7 × 200 ms, FIDs 154/155 (wmapfgt0/1) and 438/439 (wmrnden2/3). |
| `wmSetPartyWorldPos` | `Worldmap.ts:351 setPlayerWorldPos` | ✅ | — | DH2 also stops a walk and resets the marker (harmless). |
| `wmCarSetCurrentArea` | `setCarAreaId` (`set_car_current_town`) | ✅ | — | |
| `wmForceEncounter` | — | ✅ FIXED (2026-10-25) | LOW | sfall `force_encounter` / `force_encounter_with_flags` (`sfall_opcodes.cc:158/589`) and the branch in `wmRndEncounterOccurred`. Documented in worldmap.md §17 #1. — **Fixed 2026-10-25:** force_encounter / _with_flags (SCR-12). |

## Detailed findings

### WM-01 — Subtile-state query is a stub; the state numbers are swapped — **FIXED 2026-10-24 (PA21)**
- CE: `worldmap.cc:5125 wmSubTileGetVisitedState`, `interpreter_extra.cc:1995 METARULE3_WM_SUBTILE_STATE`; enum `SUBTILE_STATE_UNKNOWN 0 / KNOWN 1 / VISITED 2` (`worldmap.cc:188-190`).
- DH2: `src/scripting.ts:977-983` returns 1; `src/worldmap/Worldmap.ts:36-38` defines `WORLDMAP_DISCOVERED = 1` (used for visited) and `WORLDMAP_SEEN = 2` (used for known).
- CE behaviour: returns the subtile's state at world pixel (x, y): 0 unknown, 1 known, 2 visited.
- DH2 behaviour: always 1. The subtile grid exists (`worldmap.squares[x][y].state`), but its values mean the opposite of CE's 1 and 2.
- Impact: `vcstark.lua` (Vault City, Stark) checks `metarule3(105, x, y, 0) > 1` on 8 subtiles for the scouting job ("No problem. I've already scouted out the area." / "Yes. I've already scouted out the area, though."). The test is never true in DH2, so those options and the completion path that depends on them are unreachable. HIGH (quest content).
- Fix: export a `getSubtileState(x, y)` from Worldmap.ts that maps DH2 states to CE numbers (UNDISCOVERED→0, SEEN→1, DISCOVERED→2), or renumber the DH2 constants to CE's. Renumbering needs a save migration, because `serializeSquareStates` writes the raw values.
- Ref: NEW.

### WM-02 — Entrances are never opened by map load, elevation change or exit grid — **FIXED 2026-10-24 (PA21)**
- CE: `map.cc:1029` (mapLoad) `wmMapMarkMapEntranceState(gMapHeader.index, gElevation, 1)`; `map.cc:376` (mapSetElevation); `object.cc:1434`, `proto_instance.cc:1530/1564/1598` (exit grids and their transitions).
- DH2: `src/scripting.ts:959` (metarule3 104) is the only writer of `entrance.state` apart from load and reveal; `Worldmap.ts:700` handles `loadMapPost` with `markMapVisited` only.
- CE behaviour: any map or elevation the player reaches opens its town-map entrance. For example, walking into the Klamath Trapper Town or the Den business district by exit grid adds that hotspot to the town map.
- DH2 behaviour: only entrances that start "On" in city.txt or that a script opens show on the town map.
- Impact: the town-map quick entry points that CE grants on discovery are missing. Players must walk through exit grids every time. HIGH (navigation; the saved entrance state also diverges from CE).
- Fix: port `wmMapMarkMapEntranceState` as a Worldmap function with CE matching (see WM-04). Call it from the `loadMapPost` handler (map index plus current elevation), from elevation changes and from exit-grid transitions (target map and elevation). Route metarule3 104 through it.
- Ref: NEW.

### WM-03 — The town map is always shown; `wmAreaFindFirstValidMap` is missing — **FIXED 2026-10-24 (PA21)**
- CE: `worldmap.cc:3141-3172` (hotspot release) and `:3192` (T key): `if (city->visitedState == 2 && city->mapFid != -1) wmTownMapFunc(&map) else { wmAreaFindFirstValidMap(&map); city->visitedState = 2; }`. `worldmap.cc:6460 wmAreaFindFirstValidMap`: the first entrance with state ≠ 0; if none, entrance 0 is opened and used. The map is loaded with no entering location, so the map header's start is used.
- DH2: `src/worldmap/Worldmap.ts:763-768` calls `uiWorldMapShowArea(area)` for any area; `src/uiWorldmap.ts:123`.
- Impact: the first visit to a town shows its town map instead of entering it. Areas without town-map art (`townmap_art_idx=-1`: Enclave, Abbey, Primitive Tribe, EPA, Ghost Farm, Car Outta Gas, Destroyed Arroyo, Klamath Toxic Caves and the random-encounter / special areas) show `url('undefined.png')` with auto-placed entrance buttons, where CE goes straight onto the map. HIGH (visible UI break in every special encounter re-visit and several story areas).
- Fix: in the hotspot handler, test `area.visitedState === 2 && area.mapArt`. Otherwise pick the first entrance with `state` set (else open entrance 0), set `visitedState = 2`, do the car parking, and `loadMap(entrance.mapName)` with no position override.
- Ref: NEW.

### WM-04 — metarule3 104 entrance matching differs — **FIXED 2026-10-24 (PA21)**
- CE: `worldmap.cc:2940 wmMapMarkMapEntranceState`: requires MAP_SAVED; takes the first area containing the map (`wmMatchAreaContainingMapIdx`) and the first entrance of that area with `entrance->map == mapIdx && (elevation == -1 || entrance->elevation == -1 || elevation == entrance->elevation)`; sets `state` on that one entrance and returns 0/−1.
- DH2: `src/scripting.ts:959-975` changes every entrance in every area whose map name matches and whose `elevation === elevIdx`; `src/data.ts:141` stores entrance elevation as `Math.max(0, parseInt(s[4]))`, so −1 becomes 0. There is no MAP_SAVED check, and it always returns 0.
- Impact: a script call with elevation 1 or 2 for an entrance whose city.txt elevation is −1 (most entrances) does nothing in DH2. A call with elevation −1 matches nothing. MED.
- Fix: keep the raw elevation (−1) in `AreaEntrance` and clamp only where it is used for loading. Implement the CE matching (see WM-02 for the shared function).
- Ref: NEW.

### WM-05 — METARULE_MAP_KNOWN always returns 0 — **FIXED 2026-10-25**
- CE: `worldmap.cc:5612 wmMapIsKnown(mapIdx)`: the first area or entrance whose `map == mapIdx`; returns `entrance->state == 1`.
- DH2: `src/scripting.ts:794-805` compares `e.mapName === target`, but `target` is a maps.txt index (number), so nothing matches; it also tests area visit instead of the entrance state.
- Impact: `nccody.lua` (`giq_option(…, 211 + metarule(METARULE_MAP_KNOWN, 58), …)`) always shows the "unknown" line variant; `mitrpdor` and `osvdrcmp` use it only in debug messages. MED.
- Fix: `lookupMapName(target)`, find the first matching entrance, return `entrance.state ? 1 : 0`.
- Ref: NEW. (`wiki/scripting_reference.md:400` lists case 19 as handled.)

### WM-06 — Town-map entrances with −1 coordinates are shown; labels are lookup names — **FIXED 2026-10-25**
- CE: `worldmap.cc:5862 wmTownMapInit` / `:5915 wmTownMapRefresh`: skips `state == 0` and also `x == -1 || y == -1`; labels each hotspot with worldmap.msg `200 + 10 * area + index`, centred under it.
- DH2: `src/uiWorldmap.ts:139-192`: "orphaned" entrances (x−22 ≤ 5 and y−21 ≤ 5, which includes −1/−1) are placed in rows of 3 below the art; `:168` labels with `entrance.mapLookupName`.
- Impact: any −1/−1 entrance that a script opens (Desert Encounter 2–10 are "On" with −1/−1; In Game Movie Map 1, Bess Dead) appears as a clickable button that CE never shows. Labels read like "Destroyed Arroyo Bridge" / "Den Residential 1" rather than the localized worldmap.msg names. MED.
- Fix: skip x or y = −1; use `getMessage('worldmap', 200 + 10 * area.id + index)` as the label.
- Ref: NEW (W9 fixed only the offset).

### WM-07 — No worldmap music — **FIXED 2026-10-24 (PA23)**
- CE: `worldmap.cc:4459-4460 wmInterfaceInit`: `_gsound_background_play_level_music(isInCar ? "20car" : "23world", 12)`. On exit, the next map's `wmMapMusicStart` takes over.
- DH2: neither name appears in `src/`; `uiWorldMap` / `Worldmap.start` play nothing, so the local map's music keeps playing or stops.
- Impact: audible difference on every trip. MED.
- Fix: in `uiWorldMap`, `audioEngine.playMusic(getIsInCar() ? '20car' : '23world')`.
- Ref: NEW.

### WM-08 — Area visited state has no fog side effects — **FIXED 2026-10-25**
- CE: `worldmap.cc:5641 wmAreaMarkVisitedState`: if the city is known and `state != 0`, `wmMarkSubTileRadiusVisited(city->x, city->y)` (radius 1, Scout 2, at the sphere's world_pos). For `state == 1`, the city's own subtile becomes KNOWN; `2` on a never-visited city becomes `1`.
- DH2: `src/worldmap/Worldmap.ts:521 setAreaVisitedState` keeps only the 2→1 rule.
- Impact: towns revealed by `mark_area_known` (for example, a town a character tells you about) appear inside unrevealed fog instead of in a small cleared patch. MED (cosmetic, but on the main map).
- Fix: when `area.state && state !== 0`, call `markSubTileRadiusVisited(area.worldPosition.x, area.worldPosition.y)`. For state 1, `markSquare(…, SEEN)` at that point.
- Ref: NEW.

### WM-09 — Entrance elevation −1 with a tile: player placed on the tile instead of the header start — **FIXED 2026-10-24 (PA21)**
- CE: `ui → wmTownMapFunc → mapSetEnteringLocation(elevation, tile, rotation)`; `map.cc:860`: `if (gEnteringElevation == -1) mapSetEnteringLocation(header elevation, header tile, header rotation)`. The tile is discarded.
- DH2: `src/data.ts:141` clamps the elevation to 0; `src/uiWorldmap.ts:161-163` treats `elevation >= 0 && tileNum >= 0` as an own location.
- Impact: Broken Hills 2 (21948), NCR: Downtown (12316), San Fran Dock (26900) and Destroyed Arroyo Bridge (26719) put the player on that tile at elevation 0 instead of the map's default start. MED (the tiles may well be valid, but they are not where CE places you).
- Fix: keep the raw −1 and use an own location only when `elevation >= 0`.
- Ref: NEW.

## DH2-only behaviour

- Debug helpers (console, `play.html#dev`, `src/devConsole/`): `giveCar([fuel])` (Worldmap.ts), `revealWorldmap()` / `setInstantTravel()` (`revealAll`, instant travel with no time or encounters; devConsole/toggles.ts), the `worldmap` dev key `l` (input.ts:560, dev keys only).
- WASD as well as arrow keys for panning; mouse-edge band of 20 px inside the view.
- `Config.engine.doEncounters` turns encounter rolls off; `Config.engine.doCombat` gates the fighting-groups combat start.
- Condition language accepts `<=`, `>=` and `or` (no vanilla data uses them; the CE semantics of OR are different).
- `parseSquare` falls back to the first frequency when a subtile lists fewer than 3.
- Entrance buttons for entrances without coordinates (auto-row layout); see WM-06.
- Party marker click outside an area loads map 0 (CE does the same); the car-parking logic on town entry is the CE one.
- `pipboyAvailableAtStart` option bypasses `wmMapPipboyActive`.
- DH2 day/night light curve (gametime.ts) is outside worldmap.cc but runs during travel.
