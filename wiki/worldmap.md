# World Map & Random Encounters Reference

> Last audited: 2026-10-18 — travel loop, fog of war and random encounters ported from CE (known_bugs C55)
> CE sources: `raw/fallout2-ce/src/worldmap.cc` (`wmWorldMapFunc`, `wmConfigInit`, `wmParseTerrainTypes`, `wmParseSubTileInfo`, `wmParseEncounterTableIndex`, `wmParseEncounterSubEncStr`, `wmReadEncBaseType`, `wmParseEncBaseSubTypeStr`, `wmParseItemType`, `wmRndEncounterOccurred`, `wmRndEncounterPick`, `wmSetupRandomEncounter`, `wmSetupCritterObjs`, `wmSetupRndNextTileNumInit`, `wmSetupRndNextTileNum`, `wmEvalTileNumForPlacement`, `wmPartyWalkingStep`, `wmPartyInitWalking`, `wmGameTimeIncrement`, `wmCarUseGas`, `wmEvalConditional`, `wmAreaIsKnown`, `wmAreaVisitedState`, `wmAreaMarkVisited`, `wmAreaMarkVisitedState`, `wmAreaSetVisibleState`, `wmMapIsKnown`, `wmMapMarkVisited`, `wmAreaSetWorldPos`, `wmGetPartyCurArea`, `wmTeleportToArea`, `wmGrabTileWalkMask`, `wmSubTileMarkRadiusVisited`, `wmBlinkRndEncounterIcon`), `raw/fallout2-ce/src/worldmap.h`, `raw/fallout2-ce/src/map.cc` (`mapHandleTransition`), `raw/fallout2-ce/src/interpreter_extra.cc`
> DH2 sources: `src/worldmap/parser.ts` (`parseWorldmap`, `parseSquare`), `src/worldmap/encounterData.ts` (CE encounter parsers), `src/worldmap/encounters.ts` (roll, pick, setup), `src/worldmap/Worldmap.ts` (travel loop, fog, areas, car), `src/encounters/conditionLang.ts` (conditions), `src/data.ts`, `src/scripting.ts`, `src/vm_bridge.ts`, `src/map/GameMap.ts` (`attemptPlacement`), `src/map/pathfinder.ts`
> Data files: `data/data/worldmap.txt`, `data/data/city.txt`

---

## Overview

The world map is a scrollable pixel image showing the Fallout 2 overworld. The player's party travels across it in real time; the engine rolls for random encounters per terrain square and advances in-game time per step. Named areas (cities) are hotspots that lead to local maps.

Both CE and DH2 parse `data/data/worldmap.txt` as the single source of truth for terrain types, encounter tables, and encounter groups. Area metadata (positions, names, entrances) comes from `data/data/city.txt`.

This document is organised in two halves: the worldmap navigation/travel/area system (§1–§7), then the random-encounter system that runs on top of it (§8–§16). A single unified Known Gaps table appears at the end (§17).

---

## 1. World Map Structure

### Tile / Subtile Grid

| Dimension | CE constant | Value |
|-----------|------------|-------|
| Tile pixel width | `WM_TILE_WIDTH` | 350 px |
| Tile pixel height | `WM_TILE_HEIGHT` | 300 px |
| Horizontal tiles | `wmNumHorizontalTiles` | 4 |
| Vertical tiles | `wmMaxTileNum / 4` | 5 |
| Total tiles | | 20 |
| Subtile size | `WM_SUBTILE_SIZE` | 50 px |
| Subtiles per tile | `SUBTILE_GRID_WIDTH × SUBTILE_GRID_HEIGHT` | 7 × 6 = 42 |
| Total subtile grid | | 28 × 30 = 840 |
| Full map image | `1400 × 1500 px` | 4 × 350, 5 × 300 |
| Viewport | `WM_VIEW_WIDTH × WM_VIEW_HEIGHT` | 450 × 443 px |
| Player start (world px) | `wmGenData.worldPosX/Y` | (173, 122) |

The full world map (4 tiles wide × 5 tiles tall):

- Width = 4 × 350 = **1400 px**
- Height = 5 × 300 = **1500 px**
- Subtile grid = 28 × 30 = **840 subtiles**

`worldPosX` / `worldPosY` are the player's position in this pixel grid.

DH2 matches CE exactly except `SQUARE_SIZE = 51 px` (vs CE's 50), a cosmetic rounding artefact from the HTML layout.

### CE Coordinate Conversions

Tile index from position:
```c
tileIndex = (y / WM_TILE_HEIGHT) * wmNumHorizontalTiles + (x / WM_TILE_WIDTH) % wmNumHorizontalTiles;
```

Subtile within tile:
```c
column = (y % WM_TILE_HEIGHT) / WM_SUBTILE_SIZE;  // 0–5
row    = (x % WM_TILE_WIDTH)  / WM_SUBTILE_SIZE;  // 0–6
```

(`worldmap.cc:3535–3540`)

### worldmap.txt Format (Overview)

Parsed by `parseWorldmap()` in `src/worldmap/parser.ts` and `wmConfigInit()` in `worldmap.cc`. (See §2 for the full CE field-by-field format.)

```
[Data]
terrain_types=mountain:4,ocean:15,desert:1,city:1,...
none=0
rare=5
uncommon=10
common=15
frequent=20
forced=100

[Tile 0]
encounter_difficulty=-20
0_0=mountain,no_fill,uncommon,0,0,mtn_enc
0_1=desert,no_fill,rare,0,0,desert_enc
...

[Encounter Table 0]
lookup_name=mtn_enc
maps=rndmtn1,rndmtn2
enc_0=chance:10,enc:(1-3) raiders ambush player
enc_1=chance:20,enc:(2-4) wolves fighting (1-2) raiders
...

[Encounter: raiders]
type_0=Pid:16,Ratio:3,Item:7(wielded)
position=Surrounding,5
```

DH2 `Square` interface (`worldmap.ts`):

```typescript
interface Square {
    terrainType: string       // "mountain" | "ocean" | "desert" | "city" | ...
    fillType: string          // "no_fill" | "fill_w" | "fill_s" … (trimmed, lower case)
    frequencies: string[]     // morning / afternoon / night: "forced" | "frequent" | "common" | "uncommon" | "rare" | "none"
    encounterType: string     // encounter table lookup name
    difficulty: number        // tile-level encounter_difficulty modifier (from [Tile N] header)
    state: number             // fog-of-war: 0=UNDISCOVERED, 1=DISCOVERED, 2=SEEN
}
```

Fields parsed from worldmap.txt (columns 0–5 of each subtile entry):

| Index | Field | CE counterpart |
|-------|-------|----------------|
| 0 | `terrainType` | `SubtileInfo.terrain` (index into `wmTerrainTypeList`) |
| 1 | `fillType` | `SubtileInfo.fill` (`SubtileFill` enum) |
| 2 | `frequencies[0]` | `SubtileInfo.encounterChance[0]` (morning) |
| 3 | `frequencies[1]` | `SubtileInfo.encounterChance[1]` (afternoon) |
| 4 | `frequencies[2]` | `SubtileInfo.encounterChance[2]` (night) |
| 5 | `encounterType` | `SubtileInfo.encounterType` (the table's lookup name) |
| header | `difficulty` | `TileInfo.encounterDifficultyModifier` (from `encounter_difficulty` line) |

CE stores three per-day-part encounter chances (`encounterChance[DAY_PART_COUNT]`) in each subtile; DH2's `Square.frequencies` keeps all three (morning, afternoon, night).

`difficulty` is the `[Tile N]` `encounter_difficulty` (default 0), added to the Outdoorsman detection roll (§8.5) as in CE.

### Square State & Fog of War

Each subtile (DH2 "square", one global 28 × 30 grid of the 4 × 5 tiles' 7 × 6 subtiles) has CE's three states:

| CE | DH2 constant | Value | CSS class |
|----|--------------|-------|-----------|
| `SUBTILE_STATE_UNKNOWN` | `WORLDMAP_UNDISCOVERED` | 0 | `worldmapSquare-undiscovered` |
| `SUBTILE_STATE_VISITED` | `WORLDMAP_DISCOVERED` | 1 | `worldmapSquare-discovered` |
| `SUBTILE_STATE_KNOWN` | `WORLDMAP_SEEN` | 2 | `worldmapSquare-seen` |

`markSubTileRadiusVisited(x, y)` (`Worldmap.ts`) is CE `wmMarkSubTileRadiusVisited` / `wmSubTileMarkRadiusVisited`: every subtile within 1 (Scout: 2) becomes known (only while unknown), the party's subtile visited; `fill_s` also visits the subtiles above it in its tile, `fill_w` those to its left and the whole row of the tile to the left. Called every walking frame and when the worldmap opens. The states are saved (`subtiles` in the save, CE `wmWorldMap_save`).

### Player Start Position

`worldmapPlayer` starts on Arroyo (area 0, as CE `wmGenDataInit` 173,122); the position, `currentAreaId`, car state and subtile states come back from the save.

### Worldmap Public API (`src/worldmap.ts` barrel)

```typescript
Worldmap.init()                        // parse worldmap.txt + city.txt, build DOM, register events
Worldmap.start() / stop()              // the 60 fps travel loop (CE wmWorldMapFunc frames)
Worldmap.teleportToArea(id)            // CE wmTeleportToArea (map transitions)
Worldmap.getCurrentAreaId()            // CE wmGetPartyCurArea
Worldmap.areaVisitedState(id)          // CE wmAreaVisitedState
Worldmap.serializeSquareStates() / deserializeSquareStates()
Worldmap.serializeEncounters() / deserializeEncounters() / resetEncounters()
```

### city.txt — Area Metadata

CE `CityInfo` struct vs. DH2 `Area` interface:

| CE field | Type | DH2 field | Type | Notes |
|----------|------|-----------|------|-------|
| `name` | `char[40]` | `name` | `string` | |
| `areaId` | `int` | `id` | `number` | |
| `x`, `y` | `int` (world px) | `worldPosition` | `Point` | |
| `size` | `CitySize` enum | `size` | `string` | small/medium/large |
| `state` | `CityState` enum | `state` | `boolean` | CE: 4 states; DH2: on/off |
| `lockState` | `LockState` enum | `lockState` | `boolean` | city.txt `lock_state` (checked by the special-encounter reveal, as in CE) |
| `visitedState` | `int` (0/1/2) | `visitedState` | `number` | `wmAreaMarkVisitedState`; saved |
| `mapFid` | `int` | `mapArt` | `string` | town-map art |
| `labelFid` | `int` | `labelArt` | `string` | |
| `entrances[]` | `EntranceInfo[10]` | `entrances[]` | `AreaEntrance[]` | |

CE `CityState` enum:

| Value | Name | Meaning |
|-------|------|---------|
| 0 | `CITY_STATE_UNKNOWN` | Not shown on world map |
| 1 | `CITY_STATE_KNOWN` | Visible dot on map; party can travel to it |
| 2 | `CITY_STATE_VISITED` | Dot + town-map available (visitedState = 2 unlocks town map) |
| -66 | `CITY_STATE_INVISIBLE` | Completely hidden, cannot be made visible without force |

CE `visitedState`:
- `0` = never visited  
- `1` = known (subtile marked `SUBTILE_STATE_KNOWN`)  
- `2` = fully visited (town map available)

DH2 `area.state` is a boolean (known / unknown); `-66` (INVISIBLE) from `mark_area_known` hides the area. `visitedState` progresses with `wmAreaMarkVisitedState` / `wmMapMarkVisited`; both are saved.

### EntranceInfo (CE) / AreaEntrance (DH2)

Each area has up to 10 entrances. An entrance is a specific map + starting position within that area.

| CE field | DH2 field | Notes |
|----------|-----------|-------|
| `state` (0/1) | `startState` (string) | 0=locked, 1=unlocked |
| `x`, `y` | `x`, `y` | World-map pixel position of entrance marker |
| `map` | `mapName`, `mapLookupName` | Target map |
| `elevation` | `elevation` | Starting elevation |
| `tile` | `tileNum` | Starting tile |
| `rotation` | `orientation` | Facing direction |

`wmMapIsKnown(mapIdx)` in CE checks the specific entrance's `state == 1`. DH2 keeps each entrance's `state` (city.txt start state, metarule3 104) and saves it; the town map shows only the open ones.

### globalState worldmap fields

```typescript
globalState.mapAreas: AreaMap | null        // area ID → Area, loaded from city.txt
globalState.knownAreas: Set<number>         // area IDs visible on the world map
```

---

## 2. CE worldmap.txt Data Format (Full Reference)

`data\worldmap.txt` is an INI-style flat text file loaded once at world-map init
by `wmConfigInit()` (`worldmap.cc:1275`). All fields are case-insensitive.

### 2.1 `[Data]` Section

```ini
[Data]
terrain_types=desert:4, city:3, mountain:5, ocean:4, coast:3, special:1

none=0
rare=10
uncommon=20
common=25
frequent=35
forced=100
```

- `terrain_types`: comma-separated list of `name:difficulty` pairs, where
  `difficulty` controls movement speed (lower = faster; see §3.1). Parsed by
  `wmParseTerrainTypes()` (`worldmap.cc:1849`).
- Frequency names and their integer values: resolved by
  `wmFreqValues[ENCOUNTER_FREQUENCY_TYPE_*]`, populated from the named keys.
  (`worldmap.cc:1277`)

### 2.2 `[Tile Data]` Section

```ini
[Tile Data]
num_horizontal_tiles=4
```

Sets `wmNumHorizontalTiles`. The total tile count is inferred from the number of
`[Tile N]` sections present. The Fallout 2 world map is 4 tiles wide × 5 tiles
tall = 20 tiles total. (`worldmap.cc:1300`)

### 2.3 `[Tile N]` Sections

```ini
[Tile 0]
art_idx=3
encounter_difficulty=0
walk_mask_name=wm0000
0_0=desert, no_fill, common, uncommon, rare, desert_enc
0_1=desert, no_fill, rare, none, none, desert_enc
...
6_5=mountain, fill_e, uncommon, rare, rare, mountain_enc
```

- `art_idx`: FRM index for the tile's background image.
- `encounter_difficulty` (optional): integer modifier added to the player's
  Outdoorsman skill when checking detection in this tile. Stored in
  `tile->encounterDifficultyModifier`. (`worldmap.cc:1332`)
- `walk_mask_name` (optional): base name of a `.msk` file (300×44 bytes = 13200
  bytes) that marks impassable terrain. (`worldmap.cc:1337`, `wmGrabTileWalkMask`)
  **FIXED 2026-07-04 (W10)**: `parser.ts` captures this per tile into
  `Worldmap.walkMaskNames`; `Worldmap.ts` lazily fetches `data/{name}.msk` and
  `worldPosInvalid(x, y)` gates each worldmap movement step against it.
- `row_column` keys (`0_0` through `6_5`): each tile has a 7×6 grid of
  **subtiles** (SUBTILE_GRID_WIDTH=7, SUBTILE_GRID_HEIGHT=6), each 50×50 pixels.
  (`worldmap.cc:64–65`)

**Subtile value format** — 6 comma-separated tokens:

| Token | Field | Values |
|---|---|---|
| 1 | `terrain` | must match a name from `terrain_types` |
| 2 | `fill_type` | `no_fill`, `fill_n`, `fill_s`, `fill_e`, `fill_w`, `fill_nw`, `fill_ne`, `fill_sw`, `fill_se` |
| 3 | `morning_freq` | `none`, `rare`, `uncommon`, `common`, `frequent`, `forced` |
| 4 | `afternoon_freq` | same |
| 5 | `night_freq` | same |
| 6 | `encounter_table` | must match a `lookup_name` from an `[Encounter Table N]` section |

Parsed by `wmParseSubTileInfo()` (`worldmap.cc:1943`). The three frequency
tokens are resolved to `subtile->encounterChance[DAY_PART_MORNING/AFTERNOON/NIGHT]`.

### 2.4 `[Encounter Table N]` Sections

```ini
[Encounter Table 0]
lookup_name=Desert_Enc
maps=Rnd_Desert_1, Rnd_Desert_2, Rnd_Desert_3

enc_00=chance:40, enc:(4-8) desert_raiders ambush player, scenery:light
enc_01=chance:30, counter:3, enc:(2-4) desert_traders fighting (1-2) desert_bandits
enc_02=chance:20, special, map:Special_Rnd_Whale, chance:5, if(global(14) == 0)
enc_03=chance:10, enc:(1-3) desert_mercs ambush player, scenery:normal, if(player(level) > 5)
```

- `lookup_name`: identifier referenced by subtile `encounter_table` token.
- `maps` (optional): up to 6 map lookup names. If absent, the terrain's random
  map pool is used instead. (`worldmap.cc:1388`)
- `enc_NN`: encounter entries, parsed by `wmParseEncounterTableIndex()`:

**enc entry tokens:**

| Token | Meaning |
|---|---|
| `chance:N` | Integer weight in the weighted-random pick |
| `counter:N` (optional) | Max times this entry can fire; -1 = unlimited |
| `special` (optional) | This is a special (named-location) encounter |
| `map:MapName` (optional) | Override map for this specific entry |
| `enc:…` | Encounter group reference (see §2.5) |
| `scenery:type` | `none`, `light`, `normal`, `heavy` — spawn density modifier |
| `if(condition)` (optional) | Condition guarding this entry (see §2.6) |

### 2.5 Encounter Group Reference (`enc:` token)

Two forms:

1. **Ambush**: `enc:(minCount-maxCount) groupName ambush player`  
   — `groupName`'s critters attack the player.

2. **Fighting**: `enc:(min-max) groupA fighting (min-max) groupB`  
   — Two groups are fighting each other when the player arrives.

`groupName` must match a `[Encounter: GroupName]` section (§2.6).

### 2.6 `[Encounter: GroupName]` Sections

```ini
[Encounter: Desert_Raiders]
position=surrounding, 5
type_00=pid:24, script:3, Item:7(wielded), Item:(0-10)41, if(rand(50))
type_01=ratio:20, pid:25, script:3, dead
```

- `position`: formation type (`surrounding`, `straight_line`, `double_line`,
  `wedge`, `cone`, `huddle`) plus optional spacing value.
- `type_NN`: per-critter type entries parsed by `wmParseEncBaseSubTypeStr()`:

| Token | Meaning |
|---|---|
| `pid:N` | Critter prototype ID |
| `script:N` | Script index (override) |
| `ratio:N` | Percentage of the encounter count that should be this type |
| `dead` | Spawn already dead |
| `Item:N(wielded)` | Item PID to carry, mark as wielded |
| `Item:(min-max)N` | Item PID with quantity range |
| `if(condition)` | Condition on this critter type |

### 2.7 `[Random Maps: TerrainName]` Sections

```ini
[Random Maps: desert]
map_00=Rnd_Desert_1
map_01=Rnd_Desert_2
map_02=Rnd_Desert_5
```

Fallback map pool for encounter tables that have no `maps=` key.
(`worldmap.cc:1914`)

---

## 3. Travel Time Formula

### CE On-Foot Movement (`wmPartyWalkingStep`, `wmPartyInitWalking`, `wmGameTimeIncrement`)

`wmPartyInitWalking(x, y)` (`worldmap.cc:4266`) initialises Bresenham line
drawing parameters from the player's current `worldPos` to the click target.
Variables: `walkDistance` (pixels to travel), `walkLineDelta`, step
direction vectors for main and cross axes.

Movement is pixel-by-pixel using a Bresenham line algorithm between current and destination world positions. Each frame while walking, `wmPartyWalkingStep()` (`worldmap.cc:4312`) is called:

```c
_terrainCounter++;
if (_terrainCounter > 4) _terrainCounter = 1;

terrain = subtileAtCurrentPos->terrain;
terrainDifficulty = max(1, terrain->difficulty);

if (_terrainCounter / terrainDifficulty >= 1) {
    // advance one pixel along Bresenham path
    worldPosX +=  walkStep.x;
    worldPosY +=  walkStep.y;
    walkDistance--;
}
```

`_terrainCounter` cycles 1→4. Movement occurs when `_terrainCounter / terrainDifficulty >= 1`. So a terrain with `difficulty=4` moves once per 4 ticks — four times slower than `difficulty=1`. Terrain difficulty values come from `Terrain.difficulty` in `wmTerrainTypeList`, loaded from worldmap.txt.

Pseudocode for the per-main-loop view (≈33ms / 30fps):

```
Per main-loop iteration (≈33ms / 30fps):
  wmPartyWalkingStep()   ← called once for foot; 4–10× for car
    _terrainCounter++   (cycles 1 → 4, wraps to 1)
    terrainDifficulty = terrain.difficulty   (from worldmap.txt [Tile N])
    if _terrainCounter / terrainDifficulty >= 1:
        advance position by 1 pixel
        walkDistance -= 1

  wmGameTimeIncrement(18000)
    ticks = 18000
    if Pathfinder rank > 0:
        ticks -= ticks * rank * 0.25   (rank 1 → 25% reduction, rank 2 → 50%)
    gameTimeAddTicks(ticks)
```

### CE Car Movement

While `wmGenData.isInCar` is true, each game frame calls `wmPartyWalkingStep()`
multiple times:

| Condition | Additional calls per frame |
|---|---|
| Base (car without upgrades) | 4× |
| `GVAR_CAR_BLOWER` | +1 (5×) |
| `GVAR_NEW_RENO_CAR_UPGRADE` | +1 (6×) |
| `GVAR_NEW_RENO_SUPER_CAR` | +3 (9×) |

With all upgrades: 9 steps per frame vs. 1 step per frame on foot =
**~9× faster** than on foot on flat terrain. (`worldmap.cc:3028–3044`)

(Maximum effective multiplier observed as ×10 steps per loop with combined upgrades.)

**Fuel consumption**: `wmCarUseGas(100)` is called once per game frame in car
mode (`worldmap.cc:3052`). `wmCarUseGas` reduces by 100 per call, modified by:
- Super Car (`GVAR_NEW_RENO_SUPER_CAR`): −90% consumption
- Reno Car Upgrade (`GVAR_NEW_RENO_CAR_UPGRADE`): −10% consumption
- Fuel Cell Regulator (`GVAR_CAR_UPGRADE_FUEL_CELL_REGULATOR`): ÷2

`CAR_FUEL_MAX = 80000` (worldmap.h:8). Tank is filled to max on new game.
(`worldmap.cc:5984–6004`) Each step consumes ~100 car-fuel units.

When fuel reaches 0, the car stops in-place and `CITY_CAR_OUT_OF_GAS` is spawned
at the current world position. (`worldmap.cc:3054–3082`)

### CE Time Advancement (`wmGameTimeIncrement`)

Each walking frame calls `wmGameTimeIncrement(18000)` to advance in-game time by
18,000 ticks (`worldmap.cc:3103`). In Fallout 2 time units: 10 ticks = 1 second,
so 18,000 ticks = **30 minutes** per movement frame (at 600 ticks/minute standard
Fallout time).

**Pathfinder perk**: reduces time advancement. Each perk rank reduces
`ticksToAdd` by 25% of the total (not compounding):
```c
bonus = ticksToAdd * pathfinderRank * 0.25;
ticksToAdd -= (int)bonus;
```
One rank = 25% less time per frame; two ranks = 50% less.
(`worldmap.cc:4179–4182`)

### DH2 (`src/worldmap/Worldmap.ts:updateWorldmapPlayer`)

One call is one CE `wmWorldMapFunc` frame, scheduled every 1/60 s (CE's frame limiter):

1. `scriptsCheckGameEvents` (CE `wmCheckGameEvents`).
2. While walking: `partyWalkingStep()` — CE `wmPartyWalkingStep`: the Bresenham line set up by `partyInitWalking` (CE `wmPartyInitWalking`), one pixel when `terrainCounter / difficulty >= 1` (the counter cycles 1..4; worldmap.txt `terrain_types` difficulty); a walk-masked pixel ends the walk.
3. In the car: 4 steps (+1 blower, +1 New Reno upgrade, +3 super car), the car animation, `carUseGas(100)` once, out of gas → the party leaves the car (`CITY_CAR_OUT_OF_GAS`).
4. Once a second of real time: every party member heals its Healing Rate (`_partyMemberRestingHeal(3)`).
5. `markSubTileRadiusVisited`; at the end of the line the walk stops and `currentAreaId` is matched.
6. `gameTimeIncrement(18000)` — 30 game minutes per frame; Pathfinder takes 25 % per rank off with the remainder carried (sfall fix); the queued events fire as the time passes.
7. Still walking: `rndEncounterOccurred` (§8).

So the party walks ~60 px a real second on easy terrain and a game day passes every 48 frames, as in CE.

---

## 4. Area Flags — KNOWN, VISITED, Entrance State

### CE Functions

| Function | CE signature | Action |
|----------|-------------|--------|
| `wmAreaIsKnown` | `(areaIdx) → bool` | `visitedState != 0 && state == CITY_STATE_KNOWN` |
| `wmAreaVisitedState` | `(areaIdx) → int` | Returns visitedState (0/1/2) if area is known |
| `wmAreaMarkVisited` | `(areaIdx)` | Sets `visitedState = CITY_STATE_VISITED (2)` |
| `wmAreaMarkVisitedState` | `(areaIdx, state)` | Sets `visitedState` to explicit value |
| `wmAreaSetVisibleState` | `(areaIdx, state, force)` | Sets `city->state`; skips if `lockState == LOCKED` unless `force` |
| `wmMapIsKnown` | `(mapIdx) → bool` | Checks `entrance.state == 1` for the entrance matching `mapIdx` |
| `wmMapMarkVisited` | `(mapIdx)` | Sets `entrance.state = 1` for the matching entrance |
| `wmAreaSetWorldPos` | `(areaIdx, x, y)` | Updates city world-map pixel position |
| `wmGetPartyCurArea` | `(*areaIdxPtr)` | Returns `wmGenData.currentAreaId` |

### DH2 (`src/worldmap/Worldmap.ts`, `src/scripting.ts`)

Areas carry `state` (known), `visitedState`, `lockState` and per-entrance `state`; `areaIsKnown` / `areaVisitedState` / `setAreaVisible` / `setAreaVisitedState` / `markMapVisited` are the CE functions above. `globalState.knownAreas` mirrors the known areas for the endgame / Pip-Boy checks. `currentAreaId` (CE `wmGenData.currentAreaId`) is −1 while walking, the matched area when a walk ends, and the new map's area after an exit-grid / `load_map` transition (`mapTransition` event → `teleportToArea`).

`withinArea()` still matches by a circle (small 16 px, large 32 px) around the DH2 area centre, where CE `wmMatchWorldPosToArea` tests the sphere art's rectangle — see §17.

---

## 5. Worldmap Scripting Opcodes

### Direct opcodes

| Opcode | Name | Signature | CE function | DH2 |
|--------|------|-----------|-------------|-----|
| 0x80B2 | `mark_area_known` | `(areaType, areaID, state)` | `opMarkAreaKnown` | type 0: `-66` hides, else known + `wmAreaMarkVisitedState`; type 1: `wmMapMarkVisited` |
| 0x80E5 | `wm_area_set_pos` | `(area, x, y)` | `wmAreaSetWorldPos` | moves the area and its marker |
| 0x8108 | `world_map` | `()` | `opWorldmap → scriptsRequestWorldMap` | opens the worldmap |
| 0x80E4 | `load_map` | `(map, start)` | `opLoadMap` → `mapSetTransition` | loads the map, GVAR 27 = start; the party teleports to the map's area |

### Metarule worldmap entries

| Metarule ID | CE name | CE function | DH2 |
|-------------|---------|-------------|-----|
| 17 | `METARULE_AREA_KNOWN` | `wmAreaVisitedState(area)` | `Worldmap.areaVisitedState` |
| 30–32, 52–53 | car metarules | `wmCarCurrentArea`, `wmCarGiveToParty`, `wmCarGiveGas`, car trunk | implemented |
| 44 / 45 | `METARULE_GET_WORLDMAP_X/YPOS` | `wmGetPartyWorldPos` | implemented |
| 46 | `METARULE_CURRENT_TOWN` | `wmGetPartyCurArea` | `Worldmap.getCurrentAreaId()` (−1 in the wastes) |

---

## 6. How to Use — Worldmap Navigation Guidance

- **Area state:** `Worldmap.setAreaVisible(id, known)`, `setAreaVisitedState(id, n)`, `markMapVisited(mapName)`, `areaIsKnown(id)`, `areaVisitedState(id)` are the CE functions; markers refresh themselves (`refreshAreaMarkers`).
- **Party position:** `getPlayerWorldPos()` / `setPlayerWorldPos(x, y)`; a map transition calls `teleportToArea` through the `mapTransition` event (emit it when adding a new way to change maps).
- **Fog of war:** `markSubTileRadiusVisited(x, y)`; states per subtile in `worldmap.squares[x][y].state`, saved with `serializeSquareStates`.
- **Encounter data:** `getWorldmap().encounters` — `tables` (by CE index; a square's `encounterType` is a table `lookupName`), `baseTypes`, `terrains`, `freqValues`.
- **CE functions for a feature:** area queries `wmAreaIsKnown` / `wmAreaVisitedState` / `wmMapIsKnown`; mutations `wmAreaMarkVisitedState` / `wmAreaSetVisibleState` / `wmMapMarkVisited` / `wmAreaSetWorldPos`; travel `wmPartyInitWalking` / `wmPartyWalkingStep` / `wmGameTimeIncrement`; encounters `wmRndEncounterOccurred` / `wmRndEncounterPick` / `wmSetupRandomEncounter`.

---

# Random Encounters

The remaining sections cover the random-encounter system that runs on top of the worldmap travel loop described above.

---

## 7. Encounter Frequency Values (worldmap.txt `[Data]`)

Frequency string → numeric value mapping. **Note**: the stock CE `worldmap.txt`
values differ slightly from the illustrative table used in §1's example. The
authoritative stock values are:

| Name | Integer value | Approximate frequency |
|---|---|---|
| `none` | 0 | Never |
| `rare` | 10 | ~10% |
| `uncommon` | 20 | ~20% |
| `common` | 25 | ~25% |
| `frequent` | 35 | ~35% |
| `forced` | 100 | Always |

(The §1 example block used `rare=5, uncommon=10, common=15, frequent=20` as a
simplified illustration; the real stock file uses the values in this table. Both
are loaded from the same `[Data]` keys — see §2.1.)

---

## 8. CE Encounter Occurrence Check (`wmRndEncounterOccurred`)

Called every frame while the player is walking, after each `wmPartyWalkingStep`
group that produces actual movement. Source: `worldmap.cc:3322` (also referenced
~3380–3500).

### 8.1 Pre-checks (bail out early)

1. **Cooldown**: less than 1500ms real time since last check → skip.
   (`worldmap.cc:3325`)
2. **Minimum movement**: `|oldX − currentX| < 3` or `|oldY − currentY| < 3` → skip.
   Requires ≥3 pixel displacement since the last recorded encounter check position.
   (`worldmap.cc:3331`)
3. **On named area**: if `wmMatchWorldPosToArea()` returns a valid area index →
   skip (no encounters in city/location perimeter). (`worldmap.cc:3340`)
4. **Frank Horrigan**: if `gameTime / TICKS_PER_DAY > 35` and player has not
   yet met Horrigan → forced Horrigan encounter regardless of terrain or rolls.
   (`worldmap.cc:3345–3360`)
5. **Forced encounter** (`wmForceEncounterMapId != -1`): scripted force via
   `wmForceEncounter(mapId, flags)` → fire immediately. (`worldmap.cc:3367–3388`)

### 8.2 Day Part

```c
gameTimeHour = gameTimeGetHour(); // HHMM format, e.g. 830 = 8:30 AM
if   (gameTimeHour >= 1800 || gameTimeHour < 600)  dayPart = NIGHT;
elif (gameTimeHour >= 1200)                         dayPart = AFTERNOON;
else                                                dayPart = MORNING;
```

`gDayPartEncounterFrequencyModifiers[DAY_PART_COUNT] = { 40, 30, 0 }` — morning,
afternoon, night. Used only in the car-mode detection adjustment (§8.5).
(`worldmap.cc:570–573`)

### 8.3 Base Encounter Roll

```c
frequency = wmFreqValues[ currentSubtile->encounterChance[dayPart] ];
// e.g. frequency=25 for "common"

// Difficulty modifier (only when 0 < frequency < 100)
if (frequency > 0 && frequency < 100) {
    modifier = frequency / 15;
    if (EASY)  frequency -= modifier;
    if (HARD)  frequency += modifier;
}

chance = randomBetween(0, 100);
if (chance >= frequency) return 0;  // no encounter
```

(`worldmap.cc:3403–3419`)

**Example**: subtile has "common" morning frequency → `frequency = 25`.
- Easy: modifier = 1 → `frequency = 24` → ~24% encounter rate
- Normal: `frequency = 25` → ~25% encounter rate
- Hard: modifier = 1 → `frequency = 26` → ~26% encounter rate

### 8.4 Encounter Table Selection (`wmRndEncounterPick`)

Once the base roll passes, `wmRndEncounterPick()` (`worldmap.cc:3557`) selects
which encounter entry fires:

1. Get current subtile's `encounterType` → index into `wmEncounterTableList`.
2. Filter table entries: **condition must evaluate true** (`wmEvalConditional`)
   AND **counter > 0** (unlimited = -1 always passes).
3. `totalChance = sum of candidate.chance values`.
4. Roll:
   ```c
   effectiveLuck = critterGetStat(gDude, STAT_LUCK) - 5;
   roll = randomBetween(0, totalChance) + effectiveLuck;
   ```
5. Perk modifiers on `roll`:
   - `PERK_EXPLORER` (Good Natured): `+2`
   - `PERK_RANGER`: `+1`
   - `PERK_SCOUT`: `+1`
6. Difficulty modifier on `roll`:
   - Easy: `+5` (capped at `totalChance`)
   - Hard: `−5` (floored at 0)
7. Walk through candidates subtracting `entry.chance` until roll is consumed;
   selected entry is `candidates[index]`. (`worldmap.cc:3619–3627`)
8. Decrement selected entry's counter.
9. Select encounter map:
   - Entry has explicit `map` → use it.
   - Entry has no map + table has `maps` list → random from table's maps.
   - Else → random from terrain's `[Random Maps: terrainName]` pool.

(`worldmap.cc:3557–3654`)

### 8.5 Detection Check

After `wmRndEncounterPick()`:

```c
// Car mode: reduce effective frequency for detection
if (isInCar) {
    frequency -= gDayPartEncounterFrequencyModifiers[dayPart];
    // modifiers: morning=40, afternoon=30, night=0
}

if (frequency > chance) {
    // Player *might* detect the encounter early (Outdoorsman check)
    outdoorsman = partyGetBestSkillValue(SKILL_OUTDOORSMAN);
    if (player carries Motion Sensor && player is owner) outdoorsman += 20;
    if (outdoorsman > 95) outdoorsman = 95;
    outdoorsman += tile->encounterDifficultyModifier;

    if (randomBetween(1, 100) < outdoorsman) {
        randomEncounterIsDetected = true;
        xp = 100 - outdoorsman;  // XP for catching the encounter early
        if (xp > 0) pcAddExperience(xp);
    }
} else {
    // Car reduced frequency enough that auto-detection applies
    randomEncounterIsDetected = true;
}
```

(`worldmap.cc:3444–3497`)

Detection shows a dialog box: "You detect something up ahead. Do you wish to
encounter it?" (msg IDs 2999–3000+). If the player declines, the encounter is
abandoned (encounterMapId = -1). If detected or player chooses yes → return 1
and load the encounter map.

(Car reduces encounter chance, especially during day.)

---

## 9. CE Encounter Spawning (`wmSetupRandomEncounter`, `wmSetupCritterObjs`)

Called when the encounter map loads, via `mapLoadById` + `wmSetupRandomEncounter()`
(`worldmap.cc:3657`).

### 9.1 Critter Count

For each `EncounterTableSubEntry` in the selected encounter entry:

```c
critterCount = randomBetween(minimumCount, maximumCount);
if (EASY)  critterCount = max(critterCount - 2, minimumCount);
if (HARD)  critterCount += 2;
if (partyMemberCount > 2) critterCount += 2;
```

(`worldmap.cc:3693–3709`)

### 9.2 Critter Object Creation (`wmSetupCritterObjs`)

For each critter in the encounter group's entry list:
1. Evaluate the entry's condition; skip if false.
2. Compute count from `ratio * critterCount / 100` (or 1 if SINGLE mode).
3. `objectCreateWithPid(encounterEntry->pid)`.
4. Override team if specified.
5. Attach script override if `scriptIdx != -1`.
6. **Placement**: if formation is SURROUNDING → `_obj_attempt_placement(tile)`;
   else → `objectSetLocation(tile)`.
7. Set rotation to face the player.
8. Spawn items with quantity rolls; if item is PROTO_ID_MONEY and player has
   `PERK_FORTUNE_FINDER`, double the quantity.

(`worldmap.cc:3771–3921`)

### 9.3 Formation Placement

**SURROUNDING**: distance = `STAT_PERCEPTION + random(-2, +2)`.
If `PERK_CAUTIOUS_NATURE`: distance += 3.
Critters placed at `tileGetTileInDirection(playerTile, rotation, distance)`
around the player; rotation increments with each critter.
(`worldmap.cc:3976–4006`)

**STRAIGHT_LINE / DOUBLE_LINE**: Critters placed along a line from a center
point, alternating sides. (`worldmap.cc:4008–4027`)

**WEDGE**: V-formation. (`worldmap.cc:4028+`)

**CONE**: Cone forward. (`worldmap.cc:4040+`)

**HUDDLE**: All at the same point. (`worldmap.cc:4073+`)

### 9.4 Combat Initiation

If the encounter has **ambush player** type: `_scripts_request_combat_locked()`
starts combat immediately with the encounter critters targeting the player.
(`worldmap.cc:3731–3756`) The encounter group also sets `whoHitMe` cross-references
and queues combat.

If encounter is **fighting** (two groups): the first group is set to attack the
second group; combat starts between them (player can choose to join or avoid).
(`worldmap.cc:3720–3729`)

### 9.5 Special Encounters

Special encounters (`ENCOUNTER_ENTRY_SPECIAL` flag) create a named-location
marker on the world map and reveal it as `CITY_STATE_KNOWN`. The encounter map
is a unique, usually humorous location (whale, Tin Woodsman, Holy Hand Grenade
etc.). (`worldmap.cc:3425–3440`, worldmap.h:52–76)

Known special encounter map IDs (from worldmap.h):

| Map ID | Name |
|---|---|
| 96 | Sperm Whale |
| 97 | Tin Woodsman |
| 98 | Talking Heads |
| 99 | Federation Shuttle |
| 100 | Unwashed Villagers |
| 101 | Monty Python Bridge |
| 102 | Café of Broken Dreams |
| 103–104 | Holy Hand Grenade I/II |
| 105 | Guardian of Forever |
| 106 | Toxic Waste Dump |
| 107 | Pariah Dog |
| 108 | Mad Brahmin |

---

## 10. CE Encounter Condition System

`wmEvalConditional()` evaluates conditions attached to encounter table entries
and critter type entries. Supported condition types (`worldmap.cc:152–157`):

| Type | `EncounterConditionType` | Meaning |
|---|---|---|
| 0 | `NONE` | Always passes |
| 1 | `GLOBAL` | `gGameGlobalVars[param] OP value` |
| 2 | `NUMBER_OF_CRITTERS` | Critter count OP value |
| 3 | `RANDOM` | `rand(0,100) < value` |
| 4 | `PLAYER` | Player stat/level OP value |
| 5 | `DAYS_PLAYED` | `gameTime / TICKS_PER_DAY OP value` |
| 6 | `TIME_OF_DAY` | Hour of day OP value |

Operators: `==`, `!=`, `<`, `>` (`ENCOUNTER_CONDITIONAL_OPERATOR_*`).
Multiple conditions are joined by `and` / `or` (`ENCOUNTER_LOGICAL_OPERATOR_*`).

---

## 11. DH2 Encounter Implementation

### 11.1 Data (`src/worldmap/encounterData.ts`)

`parseEncounterData(ini)` ports `wmConfigInit`'s encounter part: the `[Data]` frequency values, `terrain_types` with each terrain's `[Random Maps: …]`, the `[Encounter Table N]` sections (`lookup_name`, up to 6 `maps`, up to 40 `enc_NN`) and every `[Encounter: Name]` section a table names (read on first use, as `wmReadEncBaseType`). Each line goes through a cursor that mirrors CE's `strParseIntWithKey` / `strParseStrFromList` / `strParseStrFromFunc`, so the quirks carry over: an entry like `Chance:1%,Special,If(…)` without `Enc:` stops parsing before its condition; the `situation` word (AMBUSH / FIGHTING / AND) is parsed but unused; `team_num` only reaches critter entries; `Item:8{Wielded}` and `(worn)` equip; `Dead` is parsed but, like CE, never used.

### 11.2 Roll, pick, setup (`src/worldmap/encounters.ts`)

`rndEncounterOccurred` is `wmRndEncounterOccurred` line by line (§8): 1.5 s real-time gate, 3 px in both axes since the last encounter, not in an area, Frank Horrigan after day 35 (`MAP_IN_GAME_MOVIE1`, saved flag), day-part frequency ± frequency / 15 by difficulty, `randomBetween(0, 100) < frequency`, the pick, a special entry's area moved to the party (and made known unless locked), the car's day-part modifier (40 / 30 / 0), the party's best Outdoorsman (+20 motion sensor, max 95, + the tile's difficulty), XP with misc.msg 8500, the YES / NO box (worldmap.msg 2999 + 3000 + 50 × table + entry). `Worldmap.ts` blinks the encounter icon (7 × 200 ms, `wmapfgt0/1` or `wmrnden2/3` for specials), asks if spotted, and loads the map.

`rndEncounterPick` is `wmRndEncounterPick`; `setupRandomEncounter` (called when the encounter map has loaded) is `wmSetupRandomEncounter` + `wmSetupCritterObjs` + the formation functions, using `GameMap.attemptPlacement` (`_obj_attempt_placement`) and the shoot-blocking path finder (`wmEvalTileNumForPlacement`). Combat is started only between the two groups of a two-group entry; a player ambush is left to the critters' scripts and AI, as in CE. The `Script:N` index is scripts.lst N − 1, as in CE (the raider entries of the vanilla worldmap.txt point one line early — data, kept).

Counters and the Horrigan flag are saved (`encounters`), and reset for a new game.

---

## 15. See Also (Other Wiki Docs)

- `wiki/known_bugs.md` — living list of stubs/TODOs; update when a gap here is fixed
- `wiki/time_clock.md` — in-game tick/minute/day conversion constants used by travel time
- `wiki/combat.md` — combat initiation for ambush/fighting encounters
- `wiki/companion_party.md` — party-size critter bonus and best-skill lookups
- `wiki/perks_traits.md` — Pathfinder, Scout, Ranger, Explorer, Cautious Nature, Fortune Finder
- `wiki/random_numbers.md` — RNG used by encounter rolls and critter counts

---

## 16. Reserved

(Intentionally left for future expansion of encounter data tables.)

---

## 17. Unified Known Gaps vs. CE

| # | Area | CE | DH2 |
|---|------|----|-----|
| 1 | Area hit test | `wmMatchWorldPosToArea`: the sphere art's rectangle from city.txt `world_pos` (window space, `WM_VIEW_X/Y` offset) | Circle of 16 / 32 px around the DH2 area centre |
| 2 | Special-encounter area position | `worldPos + hotspot / 2 + sphere / 2` (rectangle origin) | The area centre is put on the party (DH2 centres areas) |
| 3 | sfall forced encounters | `wmForceEncounter` (sfall opcodes) | Not available (no sfall opcodes beyond the two used) |
| 4 | Fade out before an encounter | `wmFadeOut` | The map loads without a palette fade |

Everything else in this doc — travel pace, fog of war, encounter roll / pick / setup, formations, items, car travel, Pathfinder, Horrigan, counters, save state — is ported. <!-- audited: 2026-10-18 -->
