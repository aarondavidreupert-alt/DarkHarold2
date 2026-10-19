# Save & Load System

Reference doc for the Fallout 2 save/load system — CE savegame format, what state
is persisted, scripting opcodes, and DH2 implementation status.

Ground truth: `raw/fallout2-ce/src/loadsave.cc`, `loadsave.h`, `scripts.cc`, `game.cc`  
DH2 implementation: `src/saveload.ts`, `src/scripting.ts`, `src/vm_bridge.ts`, `src/map/GameMap.ts`, `src/object/Obj.ts`, `src/object/Critter.ts`

---

## 1. CE Savegame Structure

### Slot Layout

CE supports **10 save slots**. Each slot is a directory:

```
SAVEGAME/
  SLOT01/
    SAVE.DAT          — primary save file (binary, big-endian ints)
    *.SAV             — compressed per-map state files
    AUTOMAP.DB.SAV    — compressed automap state
    proto/critters/   — modified critter protos (if any)
    proto/items/      — modified item protos (if any)
    sfallgv.sav       — Sfall global vars (written by CE; not original FO2)
```

On save: `_SaveBackup()` renames the existing `SAVE.DAT` and `.SAV` files to `.BAK`.  
On failure: `_RestoreSave()` renames `.BAK` back to `.SAV`/`.DAT`.  
Source: `loadsave.cc:2782` (`_SaveBackup`), `loadsave.cc:2853` (`_RestoreSave`)

### SAVE.DAT Header

Defined by `LoadSaveSlotData` struct and written by `lsgSaveHeaderInSlot` (`loadsave.cc:1791`):

| Offset | Size  | Field           | Notes                                              |
|--------|-------|-----------------|----------------------------------------------------|
| 0      | 24    | signature       | `"FALLOUT SAVE FILE"` + null padding (18 + 6)      |
| 24     | 2     | versionMinor    | must be 1                                          |
| 26     | 2     | versionMajor    | must be 2                                          |
| 28     | 1     | versionRelease  | must be `'R'` (0x52)                               |
| 29     | 32    | characterName   | player's name, null-padded                         |
| 61     | 30    | description     | user-entered slot description                      |
| 91     | 2     | fileDay         | wall-clock day of save                             |
| 93     | 2     | fileMonth       | wall-clock month                                   |
| 95     | 2     | fileYear        | wall-clock year                                    |
| 97     | 4     | fileTime        | wall-clock hour+minute                             |
| 101    | 2     | gameMonth       | in-game month                                      |
| 103    | 2     | gameDay         | in-game day                                        |
| 105    | 2     | gameYear        | in-game year                                       |
| 107    | 4     | gameTime        | in-game tick counter (uint32)                      |
| 111    | 2     | elevation       | current elevation (0–2)                            |
| 113    | 2     | map             | current map index                                  |
| 115    | 16    | fileName        | map `.SAV` filename, null-padded                   |
| 131    | 29792 | preview         | 224×133 paletted thumbnail (8bpp, 1 byte/pixel)    |
| 29923  | 128   | padding         | zeroed                                             |

Total header size: **30051 bytes** before subsystem blocks.

Thumbnail is seeked to at offset 131 by `_LoadTumbSlot` (`loadsave.cc:2143`).

### 27 Subsystem Save/Load Handlers

Defined by `_master_save_list` / `_master_load_list` arrays (`loadsave.cc:211–270`). Each handler receives the open `SAVE.DAT` file stream and writes/reads its subsystem block sequentially.

| Index | Save handler                  | Load handler                  | What it persists                                            |
|-------|-------------------------------|-------------------------------|-------------------------------------------------------------|
| 0     | `_DummyFunc`                  | `_PrepLoad`                   | Save: no-op. Load: `gameReset()`, sets game time from header |
| 1     | `_SaveObjDudeCid`             | `_LoadObjDudeCid`             | Player's `cid` (script instance ID) — 4 bytes               |
| 2     | `scriptsSaveGameGlobalVars`   | `scriptsLoadGameGlobalVars`   | All GVARs (int32 array; count from `vault13.gam`)           |
| 3     | `_GameMap2Slot`               | `_SlotMap2Game`               | Current map → `.SAV`, copies all map files to slot          |
| 4     | `scriptsSaveGameGlobalVars`   | `scriptsSkipGameGlobalVars`   | GVARs again (duplicate; load skips this copy)               |
| 5     | `_obj_save_dude`              | `_obj_load_dude`              | Player object state (position, FID, flags, inventory)       |
| 6     | `critterSave`                 | `critterLoad`                 | Critter state (HP, conditions, AI, team)                    |
| 7     | `killsSave`                   | `killsLoad`                   | Kill counts per `KillType` (stat.cc)                        |
| 8     | `skillsSave`                  | `skillsLoad`                  | Skill levels, skill points                                  |
| 9     | `randomSave`                  | `randomLoad`                  | Random number generator seed                                |
| 10    | `perksSave`                   | `perksLoad`                   | Per-perk counts                                             |
| 11    | `combatSave`                  | `combatLoad`                  | Combat state (active combat, turn order)                    |
| 12    | `aiSave`                      | `aiLoad`                      | AI package overrides                                        |
| 13    | `statsSave`                   | `statsLoad`                   | Derived stats (HP, AC, etc.)                                |
| 14    | `itemsSave`                   | `itemsLoad`                   | Item instance state (ammo, condition, charges)              |
| 15    | `traitsSave`                  | `traitsLoad`                  | Selected traits (bitmask)                                   |
| 16    | `automapSave`                 | `automapLoad`                 | Automap discovered-tile data                                |
| 17    | `preferencesSave`             | `preferencesLoad`             | Game preferences (combat speed, subtitles, etc.)            |
| 18    | `characterEditorSave`         | `characterEditorLoad`         | Character creation screen state                             |
| 19    | `wmWorldMap_save`             | `wmWorldMap_load`             | Worldmap state (current position, known areas, car fuel)    |
| 20    | `pipboySave`                  | `pipboyLoad`                  | Pip-Boy state (known quests, notes)                         |
| 21    | `gameMoviesSave`              | `gameMoviesLoad`              | Which intro/ending movies have been watched                 |
| 22    | `skillsUsageSave`             | `skillsUsageLoad`             | Skill usage counters (for skill-point awards)               |
| 23    | `partyMembersSave`            | `partyMembersLoad`            | Party member PIDs, state, inventory                         |
| 24    | `queueSave`                   | `queueLoad`                   | Scripting event queue (timed callbacks)                     |
| 25    | `interfaceSave`               | `interfaceLoad`               | Interface bar state (active weapon slot, etc.)              |
| 26    | `_DummyFunc`                  | `_EndLoad`                    | Save: no-op. Load: music start, HUD refresh, tile refresh   |

---

## 2. GVAR Persistence

### CE (`scripts.cc:1729–1753`, `game.cc:1029`)

`gGameGlobalVars` is an `int32[]` array allocated at game init from `data/vault13.gam`. `gGameGlobalVarsLength` is set to the count of entries in that file.

```c
// scripts.cc:1729
int scriptsSaveGameGlobalVars(File* stream) {
    return fileWriteInt32List(stream, gGameGlobalVars, gGameGlobalVarsLength);
}
// scripts.cc:1735
int scriptsLoadGameGlobalVars(File* stream) {
    return fileReadInt32List(stream, gGameGlobalVars, gGameGlobalVarsLength);
}
```

GVARs are written twice (handler indexes 2 and 4). On load, handler 2 reads them, handler 4 calls `scriptsSkipGameGlobalVars` which allocates a temp buffer, reads the second copy, and discards it.

### DH2 (`src/scripting.ts:51–165`)

GVARs live in a module-level `globalVars: any = {}` dict within the `Scripting` namespace.

- Initial defaults are loaded from `data/gvars.json` (pre-extracted from `vault13.gam`) by `loadGlobalVars()` at first access
- `getGlobalVars()` returns the dict; `setGlobalVars(vars)` replaces it
- `gatherSaveData()` in `src/saveload.ts:104` saves them: `gvars: Object.assign({}, Scripting.getGlobalVars())`
- On load: `Scripting.setGlobalVars(ps.gvars)` restores them (`src/saveload.ts:224`)

**Status**: GVARs are fully persisted in DH2 saves.

---

## 3. MVAR Persistence

### CE

MVARs (map variables) are stored **within the per-map `.SAV` files**, not in `SAVE.DAT`. Each map's save data includes its MVAR block. `_GameMap2Slot` (`loadsave.cc:2435`) saves the current map to `MAPS/*.SAV` then compresses all `.SAV` files into the slot directory.

### DH2

MVARs live in `Scripting`'s `mapVars` (keyed by map script, defaults from `data/maps/<script>.mvars.json`) and are saved as `SaveGame.mvars`; they survive map transitions and are reset only by a new game or a load (M8).

---

## 4. Critter State

### CE (handler 6: `critterSave` / `critterLoad`)

CE serializes per-critter fields into `SAVE.DAT` including: current HP, combat flags (DAM_* bitmask), AI package override, team number, script state. Each NPC critter's full stat block is read back on load. If party member protos were patched, the modified `.pro` files are also copied to the slot directory.

### DH2 (`src/object/Critter.ts`, `src/saveload.ts:88–91`)

Critters are serialized as part of the map objects within each `SerializedMap.objects` array. The `Critter.serialize()` method extends `Obj.serialize()` via `SERIALIZED_CRITTER_PROPS`:

```typescript
// src/object/Critter.ts
const SERIALIZED_CRITTER_PROPS = [
    'stats', 'skills', 'aiNum', 'teamNum', 'hostile', 'isPlayer', 'dead',
    'anim', 'crippledLeftArm', 'crippledRightArm', 'crippledLeftLeg', 'crippledRightLeg',
    'poisonLevel', 'radiationLevel', 'addictions',
]
```

Full per-critter state persisted: stats (HP, derived stats), skills, AI number, team, hostile flag, dead flag, crippled limbs, anim state, poison/radiation levels, drug addictions.

Critters on the **current map** and all **dirty maps** (previously visited maps in `globalState.dirtyMapCache`) are saved. Critters on unvisited maps are loaded fresh from `maps/*.json`.

---

## 5. Inventory Serialization

### CE (subsystem 14: `itemsSave` / `itemsLoad`)

CE serializes item instance data (charges, ammo, condition) into `SAVE.DAT`. Inventory items are stored both as part of the object tree in map `.SAV` files and as player/party member data in `SAVE.DAT`.

### DH2 (`src/object/Obj.ts`, `src/saveload.ts:86–88`)

Every `Obj` serializes its `inventory` array recursively via `obj.serialize()`:

```typescript
// src/object/Obj.ts
inventory: this.inventory.map((obj) => obj.serialize()).filter(...)
```

`SerializedObj` fields persisted per item:
- `uid`, `pid`, `pidID`, `type`, `pro` (full PRO data)
- `flags`, `art`, `frmPID`, `orientation`, `visible`
- `extra` (weapon charges, ammo type, item-specific fields)
- `script`, `_script` (script name + serialized LVARs)
- `name`, `subtype`, `invArt`, `frame`, `amount`
- `position`, nested `inventory` (containers)
- `lightRadius`, `lightIntensity`

Player inventory is saved separately in `SaveGame.player.inventory`. Equipped items (left hand, right hand, armor) are saved in `SaveGame.playerState`.

---

## 6. Script Local Variables (LVARs)

### CE

Each script instance attached to a map object persists its LVARs as part of the object's save block in the map `.SAV` file.

### DH2 (`src/scripting.ts:347–349, 1817–1824`)

Script instances serialize their LVARs via `Script._serialize()`:

```typescript
// src/scripting.ts:1817
_serialize(): SerializedScript {
    return { name: this.scriptName, lvars: Object.assign({}, this.lvars) }
}
```

`SerializedScript` (`{ name: string, lvars: { [lvar: number]: any } }`) is embedded in each `SerializedObj._script` field. This means LVARs for objects (critters, items, scenery) on saved maps are fully persisted.

**Spatial scripts** (`src/map/GameMap.ts`) also serialize their LVARs:
```typescript
spatials: this.spatials.map(level => level.map((s: Spatial) => ({
    script: s.script,
    tileNum: s.tileNum,
    radius: s.radius ?? 0,
    lvars: s._script ? Object.assign({}, s._script.lvars) : undefined,
})))
```

**Map script LVARs** are persisted via `SerializedMap.mapScript` (`src/map/GameMap.ts`).

**Status**: LVARs are fully persisted for all object/spatial/map scripts in DH2.

---

## 7. Addiction & Kill Count Persistence

### CE

- **Kill counts**: Handler 7 (`killsSave` / `killsLoad`) writes per-`KillType` counters from `stat.cc`
- **Addictions**: CE's `queue.cc` stores timed drug withdrawal events in the event queue (handler 24: `queueSave`/`queueLoad`); the `addictions` bitmask on the player proto is also saved

### DH2

- **Kill counts**: `SaveGame.kills` (CE `killsSave`), read by `critter_kill_count` / the character screen's KILLS folder.
- **Addictions**: saved with the critter (`addictions`), and the withdrawal / drug-effect timers are part of the saved event queue (`timedEvents`).

---

## 8. Save/Load Scripting Opcodes

FO2 scripts do not have direct `game_save` / `game_load` opcodes for triggering the save/load UI. However, several script opcodes interact with the save/load system:

| Opcode  | CE Name / Context          | Args | DH2 Status | Notes |
|---------|---------------------------|------|-----------|-------|
| 0x80C5  | `global_var`              | 1    | implemented | reads from `globalVars` dict |
| 0x80C6  | `set_global_var`          | 2    | implemented | writes to `globalVars` dict |
| 0x80C3  | `map_var`                 | 1    | implemented | reads `mapVars[scriptName][mvar]` |
| 0x80C4  | `set_map_var`             | 2    | implemented | writes `mapVars[scriptName][mvar]` |
| 0x80C1  | `local_var`               | 1    | implemented | reads `this.lvars[lvar]` |
| 0x80C2  | `set_local_var`           | 2    | implemented | writes `this.lvars[lvar]` |
| 0x810B  | `metarule(22, ...)`       | 2    | implemented | case 22 = `METARULE_IS_LOADGAME`: 1 while a loaded game's map runs its procs (C61) |

`METARULE_IS_LOADGAME` (metarule case 22) is CE's `_isLoadingGame()`. As in CE, loading a game runs every script's `start`, then `map_enter_p_proc` and `map_update_p_proc` with the flag set (`GameMap.runLoadGameProcs`); `create_object`, `destroy_object` on critters, `set_obj_visibility`, `kill_critter_type` and the team trait refuse meanwhile.

Scripts that trigger saves in CE typically do so by calling into the `lsgSaveGame` / `lsgLoadGame` UI functions via engine events, not via script opcodes. DH2 save/load is triggered only through the UI layer.

---

## 9. DH2 Current State

### Storage Backend

DH2 uses the browser's **IndexedDB API** (`src/saveload.ts:291–308`):
- Database name: `darkfo`, schema version 1
- Object store: `saves`, `keyPath: 'id'`, autoincrement
- Initialized by `saveLoadInit()` on page load
- Data survives page reloads in the same browser profile

### What DH2 Saves (`gatherSaveData`, `src/saveload.ts`)

| Category | Field |
|----------|-------|
| Identity, screenshot | `name`, `timestamp`, `version`, `screenshot` |
| Current map + every visited map (objects with script LVARs, spatials, map script, last visit time) | `savedMaps`, `currentMap`, `currentElevation` |
| Player: position, inventory, stats, skills, traits, perks, hands, armor, active hand, sneaking | `player`, `playerState` |
| GVARs / MVARs | `playerState.gvars`, `mvars` |
| Game time | `gameTickTime` |
| Party and its level-up state | `party`, `partyLevels` |
| Event queue (scripts' timers, drugs, withdrawal, radiation, poison, knockout, sneak …) | `timedEvents` |
| Worldmap: known areas, area states, position, square states, current area, car, encounter state | `knownAreas`, `areaStates`, `worldPos`, `subtiles`, `currentAreaId`, `isInCar`, `carFuel`, `currentCarAreaId`, `encounters` |
| Automap | `automap` |
| Kill counts | `kills` |
| Skill use slots | `skillUsage` |
| Movies seen | `seenMovies` |
| Event log | `eventLog` |

Not saved, as in CE or by design: the random generator (CE `randomSave` only resets the roll counter), preferences (CE keeps them in fallout2.cfg; DH2 in `localStorage`, S-CI5).

---

## 10. Known Gaps vs CE

| Gap | Note |
|-----|------|
| Storage | IndexedDB records instead of SAVE.DAT + MAPS/*.SAV — same content, not file-compatible with CE saves |
| Unvisited maps | Load fresh from `maps/*.json` — the same as CE, which loads them from the master .MAP |

Everything the former table listed (MVARs, kill counts, worldmap, event queue, automap, `is_loading_game`, the slot UI — `ui_saveload.ts` is CE's LOADSAVE screen) is implemented. <!-- audited: 2026-10-18 -->
