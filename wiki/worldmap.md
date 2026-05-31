# World Map System Reference

> Last audited: 2026-05-31  
> Sources: `raw/fallout2-ce/src/worldmap.cc`, `worldmap.h`, `interpreter_extra.cc`  
> DH2 sources: `src/worldmap.ts`, `src/data.ts`, `src/scripting.ts`, `src/vm_bridge.ts`  
> Data files: `data/data/worldmap.txt`, `data/data/city.txt`

---

## Overview

The world map is a scrollable pixel image showing the Fallout 2 overworld. The player's party travels across it in real time; the engine rolls for random encounters per terrain square and advances in-game time per step. Named areas (cities) are hotspots that lead to local maps.

Both CE and DH2 parse `data/data/worldmap.txt` as the single source of truth for terrain types, encounter tables, and encounter groups. Area metadata (positions, names, entrances) comes from `data/data/city.txt`.

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

DH2 matches CE exactly except `SQUARE_SIZE = 51 px` (vs CE's 50), a cosmetic rounding artefact from the HTML layout.

### worldmap.txt Format

Parsed by `parseWorldmap()` in `src/worldmap.ts` and `wmConfigInit()` in `worldmap.cc`.

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

DH2 `Square` fields parsed from worldmap.txt (columns 0–5 of each subtile entry):

| Index | Field | CE counterpart |
|-------|-------|----------------|
| 0 | `terrainType` | `SubtileInfo.terrain` (index into `wmTerrainTypeList`) |
| 1 | `fillType` | `SubtileInfo.fill` (`SubtileFill` enum) |
| 2 | `frequency` | `SubtileInfo.encounterChance` (one value for all day-parts in DH2, vs 3 per CE) |
| 3 | *(unused)* | |
| 4 | *(unused)* | |
| 5 | `encounterType` | `SubtileInfo.encounterType` (index into encounter table) |

CE stores three per-day-part encounter chances (`encounterChance[DAY_PART_COUNT]`) in each subtile. DH2 stores only one (the single `frequency` field from column 2), ignoring morning/afternoon/night splits.

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

## 2. Travel Time Formula

### CE (`worldmap.cc:wmPartyWalkingStep`, `wmGameTimeIncrement`)

Movement is pixel-by-pixel using a Bresenham line algorithm between current and destination world positions.

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

18000 game ticks = **30 in-game minutes** per step (at 600 ticks/minute standard Fallout time).

Terrain difficulty values come from `Terrain.difficulty` in `wmTerrainTypeList`, loaded from worldmap.txt. A difficulty of 4 means only 1 in 4 counter ticks produces actual movement — walking through mountains is 4× slower than flat terrain.

**Car multiplier** (when `wmGenData.isInCar`):
- Base: ×4 steps per loop
- GVAR_CAR_BLOWER: +1 step
- GVAR_NEW_RENO_CAR_UPGRADE: +1 step
- GVAR_NEW_RENO_SUPER_CAR: +3 steps
- Maximum: ×10 steps per loop
- Each step consumes 100 car-fuel units (max `CAR_FUEL_MAX = 80000`)

### DH2 (`src/worldmap.ts:updateWorldmapPlayer`)

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
- Time scale is approximated ("roughly 2 in-game minutes per update, scaled by terrain") — no formal ticks-per-step equivalent

---

## 3. Encounter Tables

### CE Encounter Roll (`worldmap.cc:wmRndEncounterOccurred`, lines 3380–3500)

Called once after each `wmPartyWalkingStep` group that produces actual movement.

```
1. Determine time-of-day part:
   hour = gameTimeGetHour()
   if hour >= 1800 OR hour < 600: dayPart = NIGHT
   elif hour >= 1200:             dayPart = AFTERNOON
   else:                          dayPart = MORNING

2. frequency = wmFreqValues[subtile.encounterChance[dayPart]]
   wmFreqValues loaded from [Data] section of worldmap.txt:
     none=0, rare=5, uncommon=10, common=15, frequent=20, forced=100

3. Difficulty modifier (if 0 < frequency < 100):
   modifier = frequency / 15
   EASY: frequency -= modifier
   HARD: frequency += modifier

4. Roll: chance = randomBetween(0, 100)
   if chance >= frequency: no encounter

5. Pick encounter: wmRndEncounterPick()
   Iterates EncounterTableEntries matching current terrain
   Evaluates per-entry conditions (GVAR checks, time-of-day, days played, etc.)
   Selects map, sets wmGenData.encounterMapId/TableId/EntryId

6. Detection window (if frequency > chance):
   outdoorsman = best party Outdoorsman skill
   if Motion Sensor equipped: outdoorsman += 20
   outdoorsman capped at 95
   outdoorsman += tile.encounterDifficultyModifier
   if randomBetween(1, 100) < outdoorsman: player sees encounter icon, can avoid

7. Car modifier: frequency -= gDayPartEncounterFrequencyModifiers[dayPart]
   Modifiers: MORNING=40, AFTERNOON=30, NIGHT=0
   (Car reduces encounter chance, especially during day)
```

Frequency string → numeric value mapping (from worldmap.txt `[Data]`):

| String | Typical CE value | Meaning |
|--------|-----------------|---------|
| `none` | 0 | Never |
| `rare` | 5 | 5% per check |
| `uncommon` | 10 | 10% |
| `common` | 15 | 15% |
| `frequent` | 20 | 20% |
| `forced` | 100 | Always |

### CE Encounter Groups and Critter Spawning (`wmSetupRandomEncounter`)

After the encounter map is loaded, `wmSetupRandomEncounter` populates the map:
- Rolls `randomBetween(min, max)` critter count per sub-entry
- Applies difficulty modifier: EASY → −2 critters, HARD → +2 critters
- Party size > 2 → +2 critters
- Handles two-group "fighting" encounters by setting `whoHitMe` cross-references and queuing combat

### DH2 Encounter Roll (`src/worldmap.ts:didEncounter`)

```typescript
encRate = encounterRates[square.frequency]  // from [Data] section
if encRate === 0:  return false
if encRate === 100: return true
roll = getRandomInt(0, 100)
return roll < encRate
```

DH2 `doEncounter()` → `Encounters.evalEncounter(encTable)`:
- Calls `src/encounters.ts` to evaluate the encounter table
- Loads the encounter map, spawns critters at formation positions
- Starts combat if encounter type is `'ambush'`

Divergences from CE:

| Feature | CE | DH2 |
|---------|-----|-----|
| Day-part splits | 3 per subtile (morning/afternoon/night) | Single `frequency` value |
| Difficulty modifier | ±(frequency/15) | None |
| Outdoorsman detection | Skill check, XP reward, avoidance UI | None |
| Car encounter reduction | Reduces frequency by 30–40 during day | No car system |
| Encounter condition eval | GVAR, time-of-day, days-played conditions | Partial (via `encounters.ts`) |

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

The `withinArea()` function in `src/worldmap.ts` uses `pointIntersectsCircle` to detect when the player is within an area's radius (small=16px, large=32px). Town map display is triggered when `$worldmapTarget` is clicked over a known area.

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

## 6. Known Gaps vs. CE

| Feature | CE | DH2 | Impact |
|---------|-----|-----|--------|
| `scripts_request_world_map` (0x8108) | `scriptsRequestWorldMap` | MISSING | Exit grids / scripts that try to open the world map silently fail |
| `mark_area_known` areaType=1 | Unlocks per-entrance state | Ignored | Individual entrance unlocking not tracked |
| `CITY_STATE_INVISIBLE` (-66) | Hides area completely | Not recognized | Scripts using -66 will add garbage ID to knownAreas |
| visitedState 0→1→2 progression | UNKNOWN→KNOWN→VISITED | Only known/unknown | Town map unlock logic and visited markers diverge |
| lockState | Prevents `mark_area_known` unless forced | Not implemented | Locked areas can always be made visible in DH2 |
| Metarule 46 returns 0 vs -1 | -1 when not in any area | 0 when not found | Scripts checking `== -1` will break |
| Day-part encounter splits | 3 frequencies per subtile | 1 value only | Night/day encounter rate variation absent |
| Encounter difficulty modifier | ±(frequency/15) on easy/hard | None | Easy mode does not reduce encounters |
| Outdoorsman detection | Skill check, avoidance option, XP reward | None | No detection mechanic; encounters are always ambushes |
| Car encounter reduction | 30–40% reduction during day | No car | Not applicable (car system absent) |
| Pathfinder perk | 25%/50% travel time reduction | Not implemented | All perk-based travel speed is lost |
| Party healing during travel | ~1 HP/critter/sec wall time | None | No healing on long walks |
| Walk masks (.msk files) | Block passage over impassable terrain | Not implemented | Player can walk through mountains on the pixel level |
| Car system | Fuel, refueling, speed upgrades, area tracking | None | Entire vehicle mechanics absent |
| wmSubTileMarkRadiusVisited | Reveals subtiles around current pos | Partial (seeAdjacent flag) | DH2's reveal radius is always 1 square, not configurable |

---

## 7. How to Use — Guidance for Future Prompts

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

**Looking up CE function for a worldmap feature:**

- Area state queries → `worldmap.cc:wmAreaIsKnown`, `wmAreaVisitedState`, `wmMapIsKnown`
- Area mutations → `wmAreaMarkVisitedState`, `wmAreaSetVisibleState`, `wmMapMarkVisited`, `wmAreaSetWorldPos`
- Encounter roll → `wmRndEncounterOccurred` (worldmap.cc ~3380), `wmRndEncounterPick` (~3360)
- Travel time → `wmPartyWalkingStep` (worldmap.cc:4312), `wmGameTimeIncrement` (worldmap.cc:4172)
- Opcode registration → `interpreter_extra.cc:interpreterRegisterOpcode` block (~line 4891)
