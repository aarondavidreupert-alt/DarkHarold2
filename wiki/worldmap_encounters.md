# DarkHarold2 — World Map & Random Encounters

**Audited:** 2026-06-01  
**CE ref:** `raw/fallout2-ce/src/worldmap.cc` (`wmWorldMapFunc`, `wmConfigInit`,
`wmRndEncounterOccurred`, `wmRndEncounterPick`, `wmSetupRandomEncounter`,
`wmSetupCritterObjs`, `wmPartyWalkingStep`, `wmGameTimeIncrement`,
`wmPartyInitWalking`, `wmCarUseGas`),
`raw/fallout2-ce/src/worldmap.h` (`City` enum, `Map` enum, car constants)  
**DH2 ref:** `src/worldmap.ts` (`parseWorldmap`, `updateWorldmapPlayer`,
`didEncounter`, `doEncounter`), `src/encounters.ts` (`pickEncounter`,
`evalEncounter`, `positionCritters`, `evalCond`)

---

## 1. CE worldmap.txt Data Format

`data\worldmap.txt` is an INI-style flat text file loaded once at world-map init
by `wmConfigInit()` (`worldmap.cc:1275`). All fields are case-insensitive.

### 1.1 `[Data]` Section

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

### 1.2 `[Tile Data]` Section

```ini
[Tile Data]
num_horizontal_tiles=4
```

Sets `wmNumHorizontalTiles`. The total tile count is inferred from the number of
`[Tile N]` sections present. The Fallout 2 world map is 4 tiles wide × 5 tiles
tall = 20 tiles total. (`worldmap.cc:1300`)

### 1.3 `[Tile N]` Sections

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

### 1.4 `[Encounter Table N]` Sections

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
| `enc:…` | Encounter group reference (see §1.5) |
| `scenery:type` | `none`, `light`, `normal`, `heavy` — spawn density modifier |
| `if(condition)` (optional) | Condition guarding this entry (see §1.6) |

### 1.5 Encounter Group Reference (`enc:` token)

Two forms:

1. **Ambush**: `enc:(minCount-maxCount) groupName ambush player`  
   — `groupName`'s critters attack the player.

2. **Fighting**: `enc:(min-max) groupA fighting (min-max) groupB`  
   — Two groups are fighting each other when the player arrives.

`groupName` must match a `[Encounter: GroupName]` section (§1.7).

### 1.6 `[Encounter: GroupName]` Sections

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

### 1.7 `[Random Maps: TerrainName]` Sections

```ini
[Random Maps: desert]
map_00=Rnd_Desert_1
map_01=Rnd_Desert_2
map_02=Rnd_Desert_5
```

Fallback map pool for encounter tables that have no `maps=` key.
(`worldmap.cc:1914`)

---

## 2. CE World Map Coordinate System

The world map is a pixel grid:

| Constant | Value | Meaning |
|---|---|---|
| `WM_TILE_WIDTH` | 350 px | Width of one world-map tile |
| `WM_TILE_HEIGHT` | 300 px | Height of one world-map tile |
| `WM_SUBTILE_SIZE` | 50 px | Width and height of one subtile |
| `SUBTILE_GRID_WIDTH` | 7 | Columns of subtiles per tile |
| `SUBTILE_GRID_HEIGHT` | 6 | Rows of subtiles per tile |

The full world map (4 tiles wide × 5 tiles tall):

- Width = 4 × 350 = **1400 px**
- Height = 5 × 300 = **1500 px**
- Subtile grid = 28 × 30 = **840 subtiles**

`worldPosX` / `worldPosY` are the player's position in this pixel grid.

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

---

## 3. CE Travel Mechanics

### 3.1 On-Foot Movement (`wmPartyWalkingStep`, `wmPartyInitWalking`)

`wmPartyInitWalking(x, y)` (`worldmap.cc:4266`) initialises Bresenham line
drawing parameters from the player's current `worldPos` to the click target.
Variables: `walkDistance` (pixels to travel), `walkLineDelta`, step
direction vectors for main and cross axes.

Each frame while walking, `wmPartyWalkingStep()` (`worldmap.cc:4312`) is called:

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

`_terrainCounter` cycles 1→4. Movement occurs when `_terrainCounter / terrainDifficulty >= 1`. So a terrain with `difficulty=4` moves once per 4 ticks — four times slower than `difficulty=1`.

### 3.2 Car Movement

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

**Fuel consumption**: `wmCarUseGas(100)` is called once per game frame in car
mode (`worldmap.cc:3052`). `wmCarUseGas` reduces by 100 per call, modified by:
- Super Car (`GVAR_NEW_RENO_SUPER_CAR`): −90% consumption
- Reno Car Upgrade (`GVAR_NEW_RENO_CAR_UPGRADE`): −10% consumption
- Fuel Cell Regulator (`GVAR_CAR_UPGRADE_FUEL_CELL_REGULATOR`): ÷2

`CAR_FUEL_MAX = 80000` (worldmap.h:8). Tank is filled to max on new game.
(`worldmap.cc:5984–6004`)

When fuel reaches 0, the car stops in-place and `CITY_CAR_OUT_OF_GAS` is spawned
at the current world position. (`worldmap.cc:3054–3082`)

### 3.3 Time Advancement (`wmGameTimeIncrement`)

Each walking frame calls `wmGameTimeIncrement(18000)` to advance in-game time by
18,000 ticks (`worldmap.cc:3103`). In Fallout 2 time units: 10 ticks = 1 second,
so 18,000 ticks = 30 minutes per movement frame.

**Pathfinder perk**: reduces time advancement. Each perk rank reduces
`ticksToAdd` by 25% of the total (not compounding):
```c
bonus = ticksToAdd * pathfinderRank * 0.25;
ticksToAdd -= (int)bonus;
```
One rank = 25% less time per frame; two ranks = 50% less.
(`worldmap.cc:4179–4182`)

---

## 4. CE Encounter Occurrence Check (`wmRndEncounterOccurred`)

Called every frame while the player is walking. Source: `worldmap.cc:3322`.

### 4.1 Pre-checks (bail out early)

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

### 4.2 Day Part

```c
gameTimeHour = gameTimeGetHour(); // HHMM format, e.g. 830 = 8:30 AM
if   (gameTimeHour >= 1800 || gameTimeHour < 600)  dayPart = NIGHT;
elif (gameTimeHour >= 1200)                         dayPart = AFTERNOON;
else                                                dayPart = MORNING;
```

`gDayPartEncounterFrequencyModifiers[DAY_PART_COUNT] = { 40, 30, 0 }` — morning,
afternoon, night. Used only in the car-mode detection adjustment (§4.5).
(`worldmap.cc:570–573`)

### 4.3 Base Encounter Roll

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

### 4.4 Encounter Table Selection (`wmRndEncounterPick`)

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

### 4.5 Detection Check

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

---

## 5. CE Encounter Spawning (`wmSetupRandomEncounter`, `wmSetupCritterObjs`)

Called when the encounter map loads, via `mapLoadById` + `wmSetupRandomEncounter()`
(`worldmap.cc:3657`).

### 5.1 Critter Count

For each `EncounterTableSubEntry` in the selected encounter entry:

```c
critterCount = randomBetween(minimumCount, maximumCount);
if (EASY)  critterCount = max(critterCount - 2, minimumCount);
if (HARD)  critterCount += 2;
if (partyMemberCount > 2) critterCount += 2;
```

(`worldmap.cc:3693–3709`)

### 5.2 Critter Object Creation (`wmSetupCritterObjs`)

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

### 5.3 Formation Placement

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

### 5.4 Combat Initiation

If the encounter has **ambush player** type: `_scripts_request_combat_locked()`
starts combat immediately with the encounter critters targeting the player.
(`worldmap.cc:3731–3756`)

If encounter is **fighting** (two groups): the first group is set to attack the
second group; combat starts between them (player can choose to join or avoid).
(`worldmap.cc:3720–3729`)

### 5.5 Special Encounters

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

## 6. CE Encounter Condition System

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

## 7. CE Encounter Frequency Values (worldmap.txt `[Data]`)

Default values from stock `worldmap.txt`:

| Name | Integer value | Approximate frequency |
|---|---|---|
| `none` | 0 | Never |
| `rare` | 10 | ~10% |
| `uncommon` | 20 | ~20% |
| `common` | 25 | ~25% |
| `frequent` | 35 | ~35% |
| `forced` | 100 | Always |

---

## 8. DH2 worldmap.ts Implementation

### 8.1 Data Loading

`Worldmap.init()` (`worldmap.ts:465`) reads `data/data/worldmap.txt` with
`getFileText()` and passes to `parseWorldmap()`.

`parseWorldmap()` (`worldmap.ts:140`) parses the INI via `parseIni()` from
`util.ts`:

- `[Tile N]` sections → `squares[x][y]` grid (28×30 = 840 entries)
- `[Encounter Table N]` sections → `encounterTables[name]`
- `[Encounter: GroupName]` sections → `encounterGroups[name]`
- `[Data]` → `encounterRates` (frequency name → integer) and `terrainSpeed`
  (terrain name → difficulty number)

### 8.2 Square Struct

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

**Gap**: `parseSquare()` (`worldmap.ts:145`) reads props[2] as `frequency` —
this is the **morning frequency token only**. The afternoon (props[3]) and night
(props[4]) frequency tokens are silently discarded. All DH2 encounter rolls use
the morning rate regardless of in-game time of day.
(`worldmap.ts:146–155`)

### 8.3 Travel Loop (`updateWorldmapPlayer`)

Called via `setTimeout(updateWorldmapPlayer, 75)` — ~13 Hz.
(`worldmap.ts:687`)

Each tick while `worldmapPlayer.target !== null`:

1. Compute direction vector toward target.
2. `speed = WORLDMAP_SPEED / worldmap.terrainSpeed[terrainType]`
   where `WORLDMAP_SPEED = 2` px/tick. (`worldmap.ts:626`)
3. Move player by `speed` pixels toward target; snap when within `speed`.
4. Advance in-game time: `~2 minutes * (1 / terrainSpeed[terrain])`.
   (`worldmap.ts:651`)
5. Update fog-of-war (mark current square as DISCOVERED).
6. Every 800ms (`WORLDMAP_ENCOUNTER_CHECK_RATE`): call `didEncounter()`.

### 8.4 Encounter Rate Check (`didEncounter`)

```ts
function didEncounter(): boolean {
    const encRate = worldmap.encounterRates[square.frequency];
    if (encRate === 0) return false;       // none
    if (encRate === 100) return true;      // forced
    return getRandomInt(0, 100) < encRate; // random
}
```

(`worldmap.ts:429–458`)

**Gap**: difficulty modifier not applied. CE applies `±(frequency/15)` for
Easy/Hard. DH2 has a TODO comment at line 447 but does not implement it.

**Gap**: no minimum-movement requirement. CE requires ≥3px displacement since
the last check. DH2 checks only by wall-clock interval.

**Gap**: no 1500ms cooldown (DH2 uses `WORLDMAP_ENCOUNTER_CHECK_RATE=800ms`
instead, which is faster than CE's minimum gap).

### 8.5 Encounter Resolution (`doEncounter`, `Encounters.evalEncounter`)

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

(`worldmap.ts:394–418`)

`Encounters.evalEncounter()` (`encounters.ts:391`):
1. Pick a random map from `encTable.maps`.
2. Call `pickEncounter(encTable.encounters)` → selected `Encounter`.
3. If special encounter: override `mapLookupName` with `encounter.special`.
4. Build encounter groups (`ambush` or `fighting`).
5. Return `{mapName, mapLookupName, encounter, encounterType, groups}`.

### 8.6 Encounter Entry Picker (`Encounters.pickEncounter`)

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

(`encounters.ts:284–325`)

This matches CE's `wmRndEncounterPick()` algorithm exactly for the Luck,
difficulty, and perk modifiers. ✅

**Gap**: DH2 `pickEncounter` does not decrement `entry.counter`. CE's
`counter` limits how many times a special encounter can fire; DH2 ignores it.

### 8.7 Formation Placement (`Encounters.positionCritters`)

| Formation | DH2 status |
|---|---|
| `surrounding` | Implemented — distance = PER + rand(−2, +2); +3 for Cautious Nature perk ✅ |
| `huddle` | Implemented — all critters at same point, stepping by `group.spacing` ✅ |
| `straight_line` | Stub — falls to default arbitrary layout ❌ |
| `double_line` | Stub ❌ |
| `wedge` | Stub ❌ |
| `cone` | Stub ❌ |

(`encounters.ts:327–388`)

### 8.8 Condition Evaluation (`Encounters.evalCond`)

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

(`encounters.ts:186–227`)

---

## 9. DH2 Implementation Status Summary

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

## 10. Known Gaps

### Gap #1 — Morning-only encounter frequency

`parseSquare()` (`worldmap.ts:152`) reads `props[2]` for `frequency`. The
worldmap.txt subtile format is `terrain, fill, morning, afternoon, night, table`.
Props[2] is morning. Props[3] and [4] are afternoon and night — silently ignored.
DH2 always uses the morning rate.

### Gap #2 — No difficulty modifier on base encounter rate

CE applies `±(frequency / 15)` to the base frequency based on
`settings.preferences.game_difficulty`. DH2 has a TODO comment at
`worldmap.ts:447` but the code is not present.

### Gap #3 — No minimum-movement guard

CE requires the player to have moved ≥3 pixels in both X and Y since the
last encounter check. DH2 fires encounter checks purely on a 800ms wall-clock
interval, even if the player is stationary.

### Gap #4 — Frank Horrigan forced encounter not implemented

CE forces a `MAP_IN_GAME_MOVIE1` encounter after 35 in-game days if the player
has not met Frank Horrigan. There is no equivalent in DH2.

### Gap #5 — No script-forced encounters

CE exposes `wmForceEncounter(mapId, flags)` for scripted events and an SFALL
opcode. DH2 has no equivalent.

### Gap #6 — Encounter counter not decremented

CE tracks `EncounterTableEntry.counter` and decrements it each time the entry
fires (counter = -1 means unlimited). DH2's `pickEncounter` ignores the `counter`
field, so limited special encounters can fire any number of times.

### Gap #7 — No Outdoorsman detection check

CE runs an Outdoorsman skill check after the base encounter roll passes: if
`random(1,100) < outdoorsman`, the player is warned early, gets XP, and sees a
dialog to accept or decline. DH2 immediately loads the encounter map without
any detection check or player choice.

### Gap #8 — No early-encounter XP

CE awards `100 − outdoorsman` XP (1–5 XP typically) for catching encounters
early. No DH2 equivalent.

### Gap #9 — No difficulty-based critter count scaling

CE adjusts the critter count per group by ±2 for Easy/Hard difficulty. DH2 uses
the raw `getRandomInt(min, max)` count with no difficulty adjustment.

### Gap #10 — Four of six formations unimplemented

`straight_line`, `double_line`, `wedge`, and `cone` fall to the stub default
path in `positionCritters`, placing critters at a single position with a simple
x-decrement. Only `surrounding` and `huddle` are faithfully implemented.

### Gap #11 — Items not equipped on spawn

CE calls `itemAdd(critter, item, quantity)` for each item in the critter's entry,
with a `wielded` flag. DH2 has `// TODO: items & equipping` in `execEncounter`
— critters spawn without gear.

### Gap #12 — No car travel

CE's car mode: `isInCar` flag, 4× base movement speed (up to 9× with upgrades),
fuel tank (`CAR_FUEL_MAX=80000`), fuel consumption per step, fuel cell upgrades,
out-of-gas location spawned on empty. None of this exists in DH2. The car cannot
be driven on the world map.

<!-- audited: 2026-06-01 -->
