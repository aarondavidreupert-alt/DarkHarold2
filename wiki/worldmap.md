# World Map & Random Encounters Reference

> Last audited: 2026-06-02  
> CE sources: `raw/fallout2-ce/src/worldmap.cc` (`wmWorldMapFunc`, `wmConfigInit`, `wmParseTerrainTypes`, `wmParseSubTileInfo`, `wmParseEncounterTableIndex`, `wmParseEncBaseSubTypeStr`, `wmRndEncounterOccurred`, `wmRndEncounterPick`, `wmSetupRandomEncounter`, `wmSetupCritterObjs`, `wmPartyWalkingStep`, `wmPartyInitWalking`, `wmGameTimeIncrement`, `wmCarUseGas`, `wmEvalConditional`, `wmAreaIsKnown`, `wmAreaVisitedState`, `wmAreaMarkVisited`, `wmAreaMarkVisitedState`, `wmAreaSetVisibleState`, `wmMapIsKnown`, `wmMapMarkVisited`, `wmAreaSetWorldPos`, `wmGetPartyCurArea`, `wmGrabTileWalkMask`, `wmSubTileMarkRadiusVisited`), `raw/fallout2-ce/src/worldmap.h` (`City` enum, `Map` enum, car constants), `raw/fallout2-ce/src/interpreter_extra.cc`  
> DH2 sources: `src/worldmap/parser.ts` (`parseWorldmap`, `parseSquare`), `src/worldmap/Worldmap.ts` (`updateWorldmapPlayer`, `setSquareStateAt`, `withinArea`), `src/worldmap/encounters.ts` (`didEncounter`, `doEncounter`), `src/encounters/resolver.ts` (`pickEncounter`, `evalEncounter`, `positionCritters`), `src/encounters/conditionLang.ts` (`evalCond`), `src/data.ts`, `src/scripting.ts`, `src/vm_bridge.ts`, `src/globalState.ts`  
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
    fillType: string          // "no_fill" | "fill_w"
    frequency: string         // "forced" | "frequent" | "uncommon" | "common" | "rare" | "none"
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
| 2 | `frequency` | `SubtileInfo.encounterChance` (one value for all day-parts in DH2, vs 3 per CE) |
| 3 | *(unused)* | |
| 4 | *(unused)* | |
| 5 | `encounterType` | `SubtileInfo.encounterType` (index into encounter table) |
| header | `difficulty` | `TileInfo.encounterDifficultyModifier` (from `encounter_difficulty` line) |

CE stores three per-day-part encounter chances (`encounterChance[DAY_PART_COUNT]`) in each subtile. DH2 stores only one (the single `frequency` field from column 2), ignoring morning/afternoon/night splits.

`difficulty` is parsed per-tile from the `encounter_difficulty` value in `[Tile N]` headers, **not** per-subtile. In CE this modifies the Outdoorsman detection window; in DH2 it is stored on the square but **not used** by `didEncounter()` (no Outdoorsman mechanic).

### Square State & Fog of War

Each square tracks a three-state visibility value (`worldmap.ts–42`):

| Constant | Value | Meaning | CSS class |
|----------|-------|---------|-----------|
| `WORLDMAP_UNDISCOVERED` | 0 | Never entered; rendered as black overlay | `worldmapSquare-undiscovered` |
| `WORLDMAP_SEEN` | 1 | Adjacent to a visited square; dimmed overlay | `worldmapSquare-seen` |
| `WORLDMAP_DISCOVERED` | 2 | Player has entered this square; fully visible | `worldmapSquare-discovered` |

`setSquareStateAt(squarePos, newState, seeAdjacent)` (`worldmap.ts`):
- Transitions the square's CSS class
- **DISCOVERED → SEEN transition is blocked**: if `oldState === DISCOVERED`, upgrading to SEEN is skipped (line 360)
- When `seeAdjacent = true` (default): marks all 8 neighbors (N, S, E, W + 4 diagonals) as SEEN
- **`fill_w` stop**: if the current square's `fillType === 'fill_w'`, the eastward neighbor expansion is skipped (line 380). This prevents ocean-fill squares from revealing sea tiles beyond the edge.

On travel: as the player moves, `updateWorldmapPlayer` calls `setSquareStateAt(squarePos, WORLDMAP_DISCOVERED)` each tick (line 662). CE equivalent: `wmSubTileMarkRadiusVisited` with a configurable radius.

All squares start as `WORLDMAP_UNDISCOVERED` on init. The starting square (Arroyo) is immediately set to `WORLDMAP_DISCOVERED`.

### Player Start Position

`worldmapPlayer` is initialized to `globalState.mapAreas[0].worldPosition` (Arroyo, Area 0) on `Worldmap.init()`. This is hardcoded — no CE equivalent exists; CE restores party position from a save.

### worldmap.ts Public API

```typescript
Worldmap.init()                         // parse worldmap.txt + city.txt, build DOM
Worldmap.start()                        // begin 75ms travel timer loop
Worldmap.stop()                         // clearTimeout(worldmapTimer)
Worldmap.doEncounter()                  // trigger encounter at current square
Worldmap.didEncounter(): boolean        // roll for encounter at current square
Worldmap.getEncounterGroup(name)        // return EncounterGroup by lookup name
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
| `lockState` | `LockState` enum | *(missing)* | — | DH2 never locks areas |
| `visitedState` | `int` (0/1/2) | *(missing)* | — | DH2 has no visited progression |
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

DH2 `area.state` is a boolean: `start_state = on/off` from city.txt, set once at load. No runtime progression.

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

`wmMapIsKnown(mapIdx)` in CE checks the specific entrance's `state == 1`. DH2 uses `globalState.knownAreas` (a `Set<number>`) which only tracks area-level visibility, not per-entrance state.

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

Called via `setTimeout(updateWorldmapPlayer, 75)` — ~13 Hz. (`src/worldmap/Worldmap.ts`)

Each tick while `worldmapPlayer.target !== null`:

1. Compute direction vector toward target.
2. `speed = WORLDMAP_SPEED / worldmap.terrainSpeed[terrainType]` where
   `WORLDMAP_SPEED = 2` px/tick. (`worldmap.ts`)
3. Move player by `speed` pixels toward target; snap when within `speed`.
4. Advance in-game time: `~2 minutes * (1 / terrainSpeed[terrain])`. (`worldmap.ts`)
5. Update fog-of-war (mark current square as DISCOVERED).
6. Every 800ms (`WORLDMAP_ENCOUNTER_CHECK_RATE`): call `didEncounter()`.

```typescript
// Fires every 75ms
speed = WORLDMAP_SPEED(2) / terrainSpeed[terrainType]
worldmapPlayer.x += dx/len * speed   // continuous pixel movement
worldmapPlayer.y += dy/len * speed

travelScale = 1 / terrainSpeed[terrainType]
GameTime.advanceMinutes(Math.max(1, Math.round(2 * travelScale)))
```

`terrainSpeed` comes from worldmap.txt `[Data]terrain_types`. Higher values = faster terrain.

Divergences from CE:
- 75ms timer vs. CE's frame-rate-coupled loop
- Continuous (floating-point) movement vs. integer pixel steps
- No Pathfinder perk reduction
- No car system (no fuel tracking, no GVAR multipliers)
- No party healing during travel
- Time scale is approximated ("roughly 2 in-game minutes per update, scaled by terrain") — no formal ticks-per-step equivalent. CE is 30 min/frame.

See `wiki/time_clock.md` for the in-game tick/minute conversion constants.

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

### DH2 (`src/scripting.ts`, `src/globalState.ts`)

DH2 has no equivalent of `CityState`, `visitedState`, `lockState`, or per-entrance state. Area visibility is binary:

```typescript
globalState.knownAreas.add(areaID)     // mark known
globalState.knownAreas.has(areaID)     // query
globalState.knownAreas.delete(areaID)  // mark unknown
```

The `withinArea()` function in `src/worldmap/Worldmap.ts` uses `pointIntersectsCircle` to detect when the player is within an area's radius (small=16px, large=32px). Town map display is triggered when `$worldmapTarget` is clicked over a known area.

---

## 5. Worldmap Scripting Opcodes

### Direct opcodes

| Opcode | Name | Signature | CE function | DH2 status |
|--------|------|-----------|-------------|------------|
| 0x80B2 | `mark_area_known` | `(areaType, areaID, state)` | `opMarkAreaKnown` | PARTIAL |
| 0x80E5 | `wm_area_set_pos` | `(area, x, y)` | `opWorldmapCitySetPos → wmAreaSetWorldPos` | IMPLEMENTED |
| 0x8108 | `scripts_request_world_map` | `()` | `opWorldmap → scriptsRequestWorldMap` | MISSING |

#### `mark_area_known` (0x80B2)

**CE logic** (`interpreter_extra.cc:737–756`):

Args popped from stack (last arg first): `data[0]=state, data[1]=areaID, data[2]=areaType`

```c
if (data[2] == 0) {   // areaType 0: area-level visibility
    if (data[0] == CITY_STATE_INVISIBLE) {
        wmAreaSetVisibleState(data[1], 0, true);   // hide area
    } else {
        wmAreaSetVisibleState(data[1], 1, true);   // make visible
        wmAreaMarkVisitedState(data[1], data[0]);  // set visitedState
    }
} else if (data[2] == 1) {   // areaType 1: entrance-level
    wmMapMarkVisited(data[1]);   // data[1] = mapIdx (not areaIdx)
}
```

**DH2** (`scripting.ts:1774–1780`):

```typescript
mark_area_known(areaType: number, areaID: number, state: number) {
    if (state === 1) globalState.knownAreas.add(areaID)
    else globalState.knownAreas.delete(areaID)
}
```

DH2 divergences:
- `areaType=1` (entrance unlock) is silently ignored
- `CITY_STATE_INVISIBLE (-66)` is not recognized — will add ID −66 to knownAreas
- `visitedState` progression is not tracked; only known/unknown
- **DOM circle not created at runtime**: `Worldmap.init()` creates area `<div>` circles only for areas where `area.state === true` at load time. Calling `mark_area_known(0, id, 1)` for an initially-hidden area (`state=false`) updates `globalState.knownAreas` but does not append a DOM element — the area dot will not appear on the map. A full implementation needs a DOM insert in the opcode handler.

#### `wm_area_set_pos` (0x80E5)

**CE**: Validates `x` and `y` are within the full map bounds, then updates `city->x` and `city->y`.

**DH2** (`scripting.ts:1782–1788`):
```typescript
wm_area_set_pos(area: number, x: number, y: number) {
    globalState.mapAreas[String(area)].worldPosition = { x, y }
}
```

No bounds checking. Calling this will update the area's circle position in the running HTML worldmap, effective immediately.

#### `scripts_request_world_map` (0x8108) — MISSING

CE: `opWorldmap → scriptsRequestWorldMap()` — queues a transition to the world map screen from within a script (used by exit grids and script-triggered travel).

DH2: Not wired in `vm_bridge.ts`. Scripts that call this opcode will silently no-op.

### Metarule worldmap entries

Routed through `metarule(id, target)` (opcode `0x80A0`).

| Metarule ID | CE name | CE function | DH2 status |
|-------------|---------|-------------|------------|
| 17 | `METARULE_IS_AREA_KNOWN` | `wmAreaIsKnown(target)` | IMPLEMENTED |
| 46 | `METARULE_CURRENT_TOWN` | `wmGetPartyCurArea()` | IMPLEMENTED |

**Metarule 17** — is area known?

CE: `wmAreaIsKnown(areaIdx)` → `visitedState != 0 && state == CITY_STATE_KNOWN`

DH2 (`scripting.ts:480`):
```typescript
case 17:
    return globalState.knownAreas.has(target) ? 1 : 0
```

Simpler than CE — only checks Set membership, not `visitedState`.

**Metarule 46** — current town area index

CE: Returns `wmGenData.currentAreaId` (−1 if on open world, ≥0 if at a named area).

DH2 (`scripting.ts:497–506`):
```typescript
case 46: {
    const mapName = globalState.gMap?.name
    if (mapName && globalState.mapAreas) {
        for (const key of Object.keys(globalState.mapAreas)) {
            const area = globalState.mapAreas[key]
            if (area.entrances.some(e => e.mapName === mapName))
                return area.id
        }
    }
    return 0
}
```

DH2 iterates all areas every time instead of caching `currentAreaId`. Returns 0 (not −1) when not in any area — diverges from CE.

---

## 6. How to Use — Worldmap Navigation Guidance

**Adding a new worldmap opcode:**

1. Implement the method on the `Script` class in `src/scripting.ts`.
2. Wire it in `src/vm_bridge.ts`: `0xXXXX: bridged("methodName", argCount, false)`.
3. For area mutations, update `globalState.mapAreas` and/or `globalState.knownAreas`.

**Implementing `scripts_request_world_map` (0x8108):**

```typescript
// src/scripting.ts
scripts_request_world_map() {
    // CE: scriptsRequestWorldMap() → queues world map transition
    // DH2: open the world map overlay
    Worldmap.start()
    uiOpenWorldMap()   // or equivalent UI call
}
// src/vm_bridge.ts
0x8108: bridged("scripts_request_world_map", 0, false)
```

**Implementing visitedState progression:**

1. Add `visitedState: number` to the `Area` interface in `src/data.ts`.
2. Parse from city.txt (`start_state`) or default to 0.
3. In `mark_area_known`, set `visitedState` to `data[0]` when `areaType == 0`.
4. In metarule 46, use the visitedState to gate town-map access.

**Implementing entrance-level visibility (areaType=1):**

1. Add `state: number` to the `AreaEntrance` interface in `src/data.ts`.
2. In `mark_area_known` areaType=1: `areaID` is a **map index** (not area index). Find the entrance matching that map and set its `state = 1`.
3. In `wmMapIsKnown` equivalent: check `entrance.state == 1`.

**Cross-referencing encounter tables:**

- `worldmap.encounterTables[square.encounterType]` → the `EncounterTable` for that square
- `worldmap.encounterRates` → the percentage values for each frequency string
- `worldmap.terrainSpeed` → pixel-speed multipliers per terrain name
- `worldmap.squares[x][y]` → the `Square` at grid position (x, y); convert pixel pos to square with `positionToSquare(pos) = { x: floor(pos.x/51), y: floor(pos.y/51) }`

**Implementing runtime area reveal (fix `mark_area_known` DOM gap):**

When `mark_area_known(0, id, 1)` is called for an area that was initially hidden,
a DOM circle must be appended. Extract the circle-creation block from `Worldmap.init()`
into a helper, then call it from the opcode:

```typescript
// src/worldmap/Worldmap.ts
export function revealAreaCircle(area: Area): void {
    if (!$worldmap) return
    const $area = makeEl('div', { classes: ['area'] })
    // ... same logic as init() circle creation
    $worldmap.appendChild($area)
}

// src/scripting.ts — mark_area_known
if (state === 1) {
    globalState.knownAreas.add(areaID)
    const area = globalState.mapAreas?.[String(areaID)]
    if (area && !area.state) Worldmap.revealAreaCircle(area)
}
```

**Working with the fog-of-war grid:**

```typescript
// Convert world pixel position to square grid coordinate
const squarePos = { x: Math.floor(pos.x / 51), y: Math.floor(pos.y / 51) }
// Square states: 0=UNDISCOVERED, 1=DISCOVERED, 2=SEEN
const square = worldmap.squares[squarePos.x][squarePos.y]
```

`setSquareStateAt` is not exported — fog-of-war can only be mutated from within the
`Worldmap` module. If scripting ever needs to reveal squares, export `setSquareStateAt`
and call it from `mark_area_known` or a dedicated opcode.

**Looking up CE function for a worldmap feature:**

- Area state queries → `worldmap.cc:wmAreaIsKnown`, `wmAreaVisitedState`, `wmMapIsKnown`
- Area mutations → `wmAreaMarkVisitedState`, `wmAreaSetVisibleState`, `wmMapMarkVisited`, `wmAreaSetWorldPos`
- Encounter roll → `wmRndEncounterOccurred` (worldmap.cc ~3380), `wmRndEncounterPick` (~3360)
- Travel time → `wmPartyWalkingStep` (worldmap.cc:4312), `wmGameTimeIncrement` (worldmap.cc:4172)
- Opcode registration → `interpreter_extra.cc:interpreterRegisterOpcode` block (~line 4891)

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

## 11. DH2 Encounter Implementation (`worldmap.ts`, `encounters.ts`)

### 11.1 Data Loading

`Worldmap.init()` (`worldmap.ts`) reads `data/data/worldmap.txt` with
`getFileText()` and passes to `parseWorldmap()`.

`parseWorldmap()` (`worldmap.ts`) parses the INI via `parseIni()` from
`util.ts`:

- `[Tile N]` sections → `squares[x][y]` grid (28×30 = 840 entries)
- `[Encounter Table N]` sections → `encounterTables[name]`
- `[Encounter: GroupName]` sections → `encounterGroups[name]`
- `[Data]` → `encounterRates` (frequency name → integer) and `terrainSpeed`
  (terrain name → difficulty number)

### 11.2 Square Struct

```ts
interface Square {
    terrainType: string       // e.g. "desert"
    fillType: string          // e.g. "no_fill"
    frequency: string         // ONE frequency value (morning only)
    encounterType: string     // encounter table name
    difficulty: number        // tile's encounter_difficulty
    state: number             // 0=undiscovered, 1=discovered, 2=seen
}
```

**Gap**: `parseSquare()` (`worldmap.ts`) reads props[2] as `frequency` —
this is the **morning frequency token only**. The afternoon (props[3]) and night
(props[4]) frequency tokens are silently discarded. All DH2 encounter rolls use
the morning rate regardless of in-game time of day.
(`worldmap.ts–155`) See Gap #1 in §17.

### 11.3 Encounter Rate Check (`didEncounter`)

DH2's `didEncounter()` rolls for an encounter at the current square:

```ts
function didEncounter(): boolean {
    const encRate = worldmap.encounterRates[square.frequency];
    if (encRate === 0) return false;       // none
    if (encRate === 100) return true;      // forced
    return getRandomInt(0, 100) < encRate; // random
}
```

(`worldmap.ts–458`)

**Encounter check timing**: DH2 checks for encounters every
`WORLDMAP_ENCOUNTER_CHECK_RATE = 800` ms of real wall time (`worldmap.ts`),
guarded by `window.performance.now()`. This is decoupled from movement — the check
fires on the timer tick regardless of how far the player has moved. CE checks after
each discrete pixel-step group.

**Gap**: difficulty modifier not applied. CE applies `±(frequency/15)` for
Easy/Hard. DH2 has a TODO comment at line 447 but does not implement it. (Gap #2)

**Gap**: no minimum-movement requirement. CE requires ≥3px displacement since
the last check. DH2 checks only by wall-clock interval. (Gap #3)

**Gap**: no 1500ms cooldown (DH2 uses `WORLDMAP_ENCOUNTER_CHECK_RATE=800ms`
instead, which is faster than CE's minimum gap). (Gap #3)

### 11.4 Encounter Resolution (`doEncounter`, `Encounters.evalEncounter`)

DH2 `doEncounter()` → `Encounters.evalEncounter(encTable)`:
- Calls `src/encounters/resolver.ts` to evaluate the encounter table
- Loads the encounter map, spawns critters at formation positions (`Encounters.positionCritters`)
- Starts combat if encounter type is `'ambush'` and `Config.engine.doCombat === true`
- When an encounter is triggered, `worldmapTimer` is cleared (travel stops); `uiCloseWorldMap()` is called after 1 s

```ts
// worldmap.ts
function execEncounter(encTable: EncounterTable): void {
    const enc = Encounters.evalEncounter(encTable);
    globalState.gMap.loadMap(enc.mapName, ...);
    Encounters.positionCritters(enc.groups, player.position, map);
    // spawn critter objects, add to map
    if (enc.encounterType === 'ambush') Combat.start();
}
```

(`worldmap.ts–418`)

`Encounters.evalEncounter()` (`encounters.ts`):
1. Pick a random map from `encTable.maps`.
2. Call `pickEncounter(encTable.encounters)` → selected `Encounter`.
3. If special encounter: override `mapLookupName` with `encounter.special`.
4. Build encounter groups (`ambush` or `fighting`).
5. Return `{mapName, mapLookupName, encounter, encounterType, groups}`.

### 11.5 Encounter Entry Picker (`Encounters.pickEncounter`)

```ts
function pickEncounter(encounters: Encounter[]) {
    const succEncounters = encounters.filter(enc => evalConds(enc.cond));
    const totalChance = succEncounters.reduce((sum, x) => x.chance + sum, 0);
    const luck = player.getStat("LUK");
    let roll = getRandomInt(0, totalChance) + (luck - 5);

    // Difficulty modifier (matches CE exactly)
    const diff = Config.combat.difficultyModifier;
    roll += diff === 75 ? 5 : diff === 125 ? -5 : 0;

    // Perk modifiers (matches CE)
    if (player.perks?.includes('Scout'))    roll += 1;
    if (player.perks?.includes('Ranger'))   roll += 1;
    if (player.perks?.includes('Explorer')) roll += 2;

    // weighted-random selection
    let acc = roll;
    for (idx = 0; idx < succEncounters.length; idx++) {
        if (acc < succEncounters[idx].chance) break;
        acc -= succEncounters[idx].chance;
    }
    return succEncounters[idx];
}
```

(`encounters.ts–325`)

This matches CE's `wmRndEncounterPick()` algorithm exactly for the Luck,
difficulty, and perk modifiers. ✅

**Gap**: DH2 `pickEncounter` does not decrement `entry.counter`. CE's
`counter` limits how many times a special encounter can fire; DH2 ignores it. (Gap #6)

### 11.6 Formation Placement (`Encounters.positionCritters`)

| Formation | DH2 status |
|---|---|
| `surrounding` | Implemented — distance = PER + rand(−2, +2); +3 for Cautious Nature perk ✅ |
| `huddle` | Implemented — all critters at same point, stepping by `group.spacing` ✅ |
| `straight_line` | Stub — falls to default arbitrary layout ❌ |
| `double_line` | Stub ❌ |
| `wedge` | Stub ❌ |
| `cone` | Stub ❌ |

(`encounters.ts–388`)

### 11.7 Condition Evaluation (`Encounters.evalCond`)

| CE Condition | DH2 support |
|---|---|
| `global(N)` (GVAR check) | ✅ via `Scripting.getGlobalVar(N)` |
| `rand(N)` (random %) | ✅ `getRandomInt(0,100) <= N` |
| `player(level)` | ⚠️ always returns 0 |
| `time_of_day` | ⚠️ always returns 12 (noon) |
| `global(N) == value` | ✅ |
| `global(N) < value` | ✅ |
| `global(N) > value` | ✅ |
| `== !=` operators | ❌ not in the `op` map in `evalCond` |
| Encounter-level conditions | ✅ `parseEncounter` calls `Encounters.parseConds` |
| Critter-level conditions (`if` on `type_NN`) | ✅ `parseEncounterCritter` calls `parseConds` |

(`encounters.ts–227`)

### 11.8 CE Encounter Groups and Critter Spawning summary (`wmSetupRandomEncounter`)

After the encounter map is loaded, `wmSetupRandomEncounter` populates the map:
- Rolls `randomBetween(min, max)` critter count per sub-entry
- Applies difficulty modifier: EASY → −2 critters, HARD → +2 critters
- Party size > 2 → +2 critters
- Handles two-group "fighting" encounters by setting `whoHitMe` cross-references and queuing combat

(Full CE detail in §9.)

---

## 12. DH2 vs CE Encounter Roll Divergences (Quick Reference)

| Feature | CE | DH2 |
|---------|-----|-----|
| Day-part splits | 3 per subtile (morning/afternoon/night) | Single `frequency` value |
| Difficulty modifier | ±(frequency/15) | None |
| Outdoorsman detection | Skill check, XP reward, avoidance UI | None |
| Car encounter reduction | Reduces frequency by 30–40 during day | No car system |
| Encounter condition eval | GVAR, time-of-day, days-played conditions | Partial (via `encounters.ts`) |

---

## 13. DH2 Implementation Status Summary

| Subsystem | Status | Notes |
|---|---|---|
| `worldmap.txt` parsing | ✅ | All sections parsed; minor field differences (see below) |
| Tile/subtile grid | ✅ | 28×30 squares, 51px per square ≈ CE's 50px subtile |
| Day-part frequencies | ❌ Gap #1 | Only morning frequency stored; afternoon/night discarded |
| Encounter base roll | ✅ | `encounterRates[frequency]` roll implemented |
| Difficulty modifier on base roll | ❌ Gap #2 | TODO in code, not applied |
| Minimum movement before roll | ❌ Gap #3 | CE requires ≥3px displacement; DH2 uses time-only check |
| Frank Horrigan forced encounter | ❌ Gap #4 | No day-35 check |
| Script-forced encounters (`wmForceEncounter`) | ❌ Gap #5 | No opcode support |
| Encounter table entry picker | ✅ | Luck, perks, difficulty all match CE |
| Entry `counter` decrement | ❌ Gap #6 | Counter ignored; special encounters can fire infinitely |
| Detection / Outdoorsman check | ❌ Gap #7 | No outdoorsman check, no early-detection dialog |
| Encounter XP award | ❌ Gap #8 | CE awards up to 100 XP for catching encounter early |
| Map selection | ✅ | Random from table maps list |
| Terrain random map fallback | ✅ (partially) | Pool parsed but DH2 uses table maps; no terrain fallback |
| Critter spawning | ✅ | `createObjectWithPID`, added to map |
| Critter count Easy/Hard scaling | ❌ Gap #9 | CE ±2 critters per difficulty; DH2 not applied |
| Party size critter bonus | ❌ | CE adds 2 critters if party > 2 |
| Formation: surrounding | ✅ | PER-based distance, Cautious Nature perk |
| Formation: huddle | ✅ | |
| Formations: line/wedge/cone | ❌ Gap #10 | All fall to stub placement |
| Item equipping on spawn | ❌ Gap #11 | `// TODO: items & equipping` comment in code |
| Fortune Finder perk (double caps) | ❌ | Not implemented |
| Car travel | ❌ Gap #12 | No `isInCar` concept; no speed multiplier; no fuel |
| Car encounter rate reduction | ❌ | Car reduces detection in CE; DH2 has no car |
| Pathfinder perk (time reduction) | ❌ | DH2 time advance is fixed at ~2 min/tick |
| Special encounters | ✅ (partial) | Map override implemented; location pin on worldmap not added |
| Walk mask (impassable terrain) | ❌ | No `.msk` file loading or impassable-tile check |
| Fog of war | ✅ | Square states: undiscovered/discovered/seen |
| Area hotspots | ✅ | `withinArea` circle check for named locations |
| Time advancement | ⚠️ | ~2 min/tick, no perk support; CE is 30 min/frame |

---

## 14. How to Use — Encounter Guidance

**Cross-referencing encounter tables** (also listed in §6):

- `worldmap.encounterTables[square.encounterType]` → the `EncounterTable` for that square
- `worldmap.encounterRates` → the percentage values for each frequency string
- `worldmap.getEncounterGroup(name)` → the `EncounterGroup` for a `[Encounter: name]` section

**Adding a missing formation** (Gap #10): implement `straight_line`,
`double_line`, `wedge`, or `cone` in `Encounters.positionCritters`
(`encounters.ts–388`), mirroring CE's placement maths in §9.3.

**Implementing the Outdoorsman detection check** (Gap #7): after `didEncounter()`
returns true, run a `partyGetBestSkillValue(SKILL_OUTDOORSMAN)` check, add +20 for
a Motion Sensor, cap at 95, add `square.difficulty`, then `randomBetween(1,100)`
gates early detection. Award `100 − outdoorsman` XP on success (Gap #8).

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

This section merges the worldmap-navigation gaps and the encounter gaps into one
authoritative table. The numbered Gap #N entries below match the `Gap #N`
annotations used throughout §11 and §13.

### 17.1 Worldmap Navigation / Area / Travel Gaps

| Feature | CE | DH2 | Impact |
|---------|-----|-----|--------|
| `scripts_request_world_map` (0x8108) | `scriptsRequestWorldMap` | MISSING | Exit grids / scripts that try to open the world map silently fail |
| `mark_area_known` areaType=1 | Unlocks per-entrance state | Ignored | Individual entrance unlocking not tracked |
| `CITY_STATE_INVISIBLE` (-66) | Hides area completely | Not recognized | Scripts using -66 will add garbage ID to knownAreas |
| visitedState 0→1→2 progression | UNKNOWN→KNOWN→VISITED | Only known/unknown | Town map unlock logic and visited markers diverge |
| lockState | Prevents `mark_area_known` unless forced | Not implemented | Locked areas can always be made visible in DH2 |
| Metarule 46 returns 0 vs -1 | -1 when not in any area | 0 when not found | Scripts checking `== -1` will break |
| Pathfinder perk | 25%/50% travel time reduction | Not implemented | All perk-based travel speed is lost |
| Party healing during travel | ~1 HP/critter/sec wall time | None | No healing on long walks |
| Walk masks (.msk files) | Block passage over impassable terrain | Not implemented | Player can walk through mountains on the pixel level |
| Car system | Fuel, refueling, speed upgrades, area tracking | None | Entire vehicle mechanics absent |
| wmSubTileMarkRadiusVisited | Reveals subtiles around current pos | Partial (seeAdjacent flag) | DH2's reveal radius is always 1 square, not configurable |
| `mark_area_known` DOM update | CE updates game state only (no DOM) | DH2 `init()` pre-renders circles; runtime reveal has no DOM append | Area dots for initially-hidden areas won't appear after `mark_area_known` |
| Square fog of war | `wmSubTileGetVisitedState` query API | CSS class only; no query API | Scripts cannot read fog state; `setSquareStateAt` is DOM-only |
| `fill_w` subtiles | CE `fill_w` flag skips east neighbor in flood-fill | `fill_w` stops eastward expansion in `setSquareStateAt` | Functionally similar; CE uses full flood fill, DH2 only stops one neighbor |
| Time advancement | 30 min/frame, Pathfinder-aware | ~2 min/tick, fixed | Travel time and clock advance diverge from CE |

### 17.2 Encounter Gaps

| Feature | CE | DH2 | Impact |
|---------|-----|-----|--------|
| Day-part encounter splits | 3 frequencies per subtile | 1 value only | Night/day encounter rate variation absent |
| Encounter difficulty modifier | ±(frequency/15) on easy/hard | None | Easy mode does not reduce encounters |
| Outdoorsman detection | Skill check, avoidance option, XP reward | None | No detection mechanic; encounters are always ambushes |
| Car encounter reduction | 30–40% reduction during day | No car | Not applicable (car system absent) |
| Encounter check timing | Per walking step (≥3px move + 1500ms cooldown) | Every 800ms wall time | May fire between movement pixels; more or fewer checks on fast/slow machines |

### 17.3 Numbered Encounter Gaps (from worldmap_encounters)

#### Gap #1 — Morning-only encounter frequency

`parseSquare()` (`worldmap.ts`) reads `props[2]` for `frequency`. The
worldmap.txt subtile format is `terrain, fill, morning, afternoon, night, table`.
Props[2] is morning. Props[3] and [4] are afternoon and night — silently ignored.
DH2 always uses the morning rate.

#### Gap #2 — No difficulty modifier on base encounter rate

CE applies `±(frequency / 15)` to the base frequency based on
`settings.preferences.game_difficulty`. DH2 has a TODO comment at
`worldmap.ts` but the code is not present.

#### Gap #3 — No minimum-movement guard / cooldown

CE requires the player to have moved ≥3 pixels in both X and Y since the
last encounter check, plus a 1500ms real-time cooldown. DH2 fires encounter
checks purely on an 800ms wall-clock interval, even if the player is stationary.

#### Gap #4 — Frank Horrigan forced encounter not implemented

CE forces a `MAP_IN_GAME_MOVIE1` encounter after 35 in-game days if the player
has not met Frank Horrigan. There is no equivalent in DH2.

#### Gap #5 — No script-forced encounters

CE exposes `wmForceEncounter(mapId, flags)` for scripted events and an SFALL
opcode. DH2 has no equivalent.

#### Gap #6 — Encounter counter not decremented

CE tracks `EncounterTableEntry.counter` and decrements it each time the entry
fires (counter = -1 means unlimited). DH2's `pickEncounter` ignores the `counter`
field, so limited special encounters can fire any number of times.

#### Gap #7 — No Outdoorsman detection check

CE runs an Outdoorsman skill check after the base encounter roll passes: if
`random(1,100) < outdoorsman`, the player is warned early, gets XP, and sees a
dialog to accept or decline. DH2 immediately loads the encounter map without
any detection check or player choice.

#### Gap #8 — No early-encounter XP

CE awards `100 − outdoorsman` XP (1–5 XP typically) for catching encounters
early. No DH2 equivalent.

#### Gap #9 — No difficulty-based critter count scaling

CE adjusts the critter count per group by ±2 for Easy/Hard difficulty. DH2 uses
the raw `getRandomInt(min, max)` count with no difficulty adjustment. (CE also
adds 2 critters if party > 2; DH2 does not.)

#### Gap #10 — Four of six formations unimplemented

`straight_line`, `double_line`, `wedge`, and `cone` fall to the stub default
path in `positionCritters`, placing critters at a single position with a simple
x-decrement. Only `surrounding` and `huddle` are faithfully implemented.

#### Gap #11 — Items not equipped on spawn

CE calls `itemAdd(critter, item, quantity)` for each item in the critter's entry,
with a `wielded` flag. DH2 has `// TODO: items & equipping` in `execEncounter`
— critters spawn without gear. (CE also doubles money for Fortune Finder perk;
DH2 does not.)

#### Gap #12 — No car travel

CE's car mode: `isInCar` flag, 4× base movement speed (up to 9× with upgrades),
fuel tank (`CAR_FUEL_MAX=80000`), fuel consumption per step, fuel cell upgrades,
out-of-gas location spawned on empty. None of this exists in DH2. The car cannot
be driven on the world map.

<!-- audited: 2026-06-02 -->
