# Save & Load System

Reference doc for the Fallout 2 save/load system — CE savegame format, what state
is persisted, scripting opcodes, and DH2 implementation status.

Ground truth: `raw/fallout2-ce/src/loadsave.cc`, `loadsave.h`, `scripts.cc`, `game.cc`  
DH2 implementation: `src/saveload.ts`, `src/scripting.ts`, `src/vm_bridge.ts`, `src/map.ts`, `src/object.ts`

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

### DH2 (`src/scripting.ts:50, 177–446`)

MVARs live in a module-level `mapVars: any` dict in `scripting.ts`, keyed by script name then by var index. Initial defaults are loaded from `data/maps/<scriptName>.mvars.json`.

**MVARs are NOT persisted in DH2 saves.** `mapVars` is not included in `SerializedMap` (`src/map.ts:45–58`) and is not included in `SaveGame` (`src/saveload.ts:34–69`). On reload, `mapVars` is reset to `{}` by `Scripting.init()` (`scripting.ts:2201`) and re-initialized from `.mvars.json` defaults.

**Impact**: Any MVAR changes made during gameplay (quest flags, door states, one-time events tracked by MVARs) are **lost on page reload** and not restored when loading a save.

---

## 4. Critter State

### CE (handler 6: `critterSave` / `critterLoad`)

CE serializes per-critter fields into `SAVE.DAT` including: current HP, combat flags (DAM_* bitmask), AI package override, team number, script state. Each NPC critter's full stat block is read back on load. If party member protos were patched, the modified `.pro` files are also copied to the slot directory.

### DH2 (`src/object.ts:1862–1900`, `src/saveload.ts:88–91`)

Critters are serialized as part of the map objects within each `SerializedMap.objects` array. The `Critter.serialize()` method extends `Obj.serialize()` via `SERIALIZED_CRITTER_PROPS`:

```typescript
// src/object.ts:1896
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

### DH2 (`src/object.ts:990–1021`, `src/saveload.ts:86–88`)

Every `Obj` serializes its `inventory` array recursively via `obj.serialize()`:

```typescript
// src/object.ts:1011
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

**Spatial scripts** (`src/map.ts:629–635`) also serialize their LVARs:
```typescript
spatials: this.spatials.map(level => level.map((s: Spatial) => ({
    script: s.script,
    tileNum: s.tileNum,
    radius: s.radius ?? 0,
    lvars: s._script ? Object.assign({}, s._script.lvars) : undefined,
})))
```

**Map script LVARs** are persisted via `SerializedMap.mapScript` (`src/map.ts:624`).

**Status**: LVARs are fully persisted for all object/spatial/map scripts in DH2.

---

## 7. Addiction & Kill Count Persistence

### CE

- **Kill counts**: Handler 7 (`killsSave` / `killsLoad`) writes per-`KillType` counters from `stat.cc`
- **Addictions**: CE's `queue.cc` stores timed drug withdrawal events in the event queue (handler 24: `queueSave`/`queueLoad`); the `addictions` bitmask on the player proto is also saved

### DH2

- **Kill counts**: No `kills` or `killCounts` field in `SaveGame`. Kill counts are **not persisted**. There is no `kill_count` scripting opcode visible in `vm_bridge.ts`.
- **Addictions**: The `addictions: string[]` field on `Critter` is included in `SERIALIZED_CRITTER_PROPS` and is therefore saved with each critter including the player. Addiction state **is persisted** in DH2.
- **Timed drug events**: The scripting `timeEventList` (TimedEvent callbacks) is **not persisted**. Drug withdrawal timers are lost on reload.

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
| 0x810B  | `metarule(22, ...)`       | 2    | partial    | case 22 = `METARULE_IS_LOADGAME`; DH2 always returns 0 |

`METARULE_IS_LOADGAME` (metarule case 22) maps to CE's `_isLoadingGame()` in `interpreter_extra.cc:3232`. DH2 hardcodes `return 0` because there is no async load guard in the scripting VM.

Scripts that trigger saves in CE typically do so by calling into the `lsgSaveGame` / `lsgLoadGame` UI functions via engine events, not via script opcodes. DH2 save/load is triggered only through the UI layer.

---

## 9. DH2 Current State

### Storage Backend

DH2 uses the browser's **IndexedDB API** (`src/saveload.ts:291–308`):
- Database name: `darkfo`, schema version 1
- Object store: `saves`, `keyPath: 'id'`, autoincrement
- Initialized by `saveLoadInit()` on page load
- Data survives page reloads in the same browser profile

### What DH2 Saves (`gatherSaveData`, `src/saveload.ts:71–108`)

| Category | What's saved | Location in SaveGame |
|----------|-------------|---------------------|
| Identity | save name, timestamp, version | top-level fields |
| Map state | current map + all dirty maps (visited maps) | `savedMaps` |
| Objects | all critters, items, scenery on saved maps | inside `SerializedMap.objects` |
| Script LVARs | per-object and spatial script local vars | `SerializedObj._script.lvars` |
| Map scripts | map script instance + its LVARs | `SerializedMap.mapScript` |
| Player position | tile + orientation | `player.position/orientation` |
| Player inventory | full item tree | `player.inventory` |
| Player stats | HP, SPECIAL, derived stats | `playerState.stats` |
| Player skills | base + invested points | `playerState.skills` |
| Player traits | selected trait names | `playerState.traits` |
| Player perks | acquired perk names | `playerState.perks` |
| Player equipment | leftHand, rightHand, armor | `playerState.*Hand/armor` |
| Player meta | name, gender, activeHand, isSneaking | `playerState.*` |
| GVARs | all global variable values | `playerState.gvars` |
| Game time | in-game tick counter | `gameTickTime` |
| Party members | party objects | `party` |
| Event log | structured combat/event log | `eventLog` |
| Current elevation | current elevation index | `currentElevation` |

### What DH2 Does NOT Save

| Category | CE Handler | DH2 Gap |
|----------|-----------|---------|
| MVARs | map `.SAV` files | `mapVars` dict not in any serialized structure |
| Kill counts | handler 7 (`killsSave`) | no `kills` field in `SaveGame` |
| WorldMap state | handler 19 (`wmWorldMap_save`) | `globalState.knownAreas` not saved |
| Automap data | handler 16 (`automapSave`) | no automap persistence |
| Event queue | handler 24 (`queueSave`) | `timeEventList` not serialized |
| Drug timers | part of queue | timed withdrawal events lost on reload |
| Random seed | handler 9 (`randomSave`) | not saved; CE uses this for determinism |
| Preferences | handler 17 (`preferencesSave`) | game preferences not persisted in save |
| Skill usage | handler 22 (`skillsUsageSave`) | skill-use counters not persisted |
| Pip-Boy | handler 20 (`pipboySave`) | Pip-Boy quests/notes not persisted |
| Movies watched | handler 21 (`gameMoviesSave`) | movie-viewed flags not persisted |

---

## 10. Known Gaps vs CE

Listed in descending impact order:

| Gap | Impact | DH2 Source |
|-----|--------|-----------|
| **MVARs not persisted** | Critical: quest flags, door states, one-time events stored as MVARs are lost; loading a save silently resets them to `.mvars.json` defaults | `scripting.ts:50` — `mapVars` never written to `SaveGame` |
| **No unvisited-map state** | High: critters/objects on maps not yet visited in the current session load fresh from `maps/*.json`, not from CE `.SAV` equivalents | design limit: `dirtyMapCache` only covers visited maps |
| **Kill counts lost** | Medium: `critter_kill_count` opcodes return stale data after reload; affects quest scripts that check kill thresholds | no `kills` in `SaveGame` |
| **WorldMap / knownAreas not saved** | Medium: player loses discovered locations and worldmap position after reload | `globalState.knownAreas` not in `SaveGame` |
| **Timed event queue not saved** | Medium: all `TimedEvent` callbacks (drug timers, scripted delays, scheduled AI) are lost on reload | `timeEventList` in `scripting.ts` not serialized |
| **`is_game_loading` always false** | Medium: scripts that gate init behavior on `is_game_loading` may double-fire or skip load-time setup | `metarule` case 22 returns 0 always |
| **Automap not persisted** | Low: minimap/automap resets on reload | no automap data structure |
| **No save backup/restore** | Low: a failed save leaves the save slot in an inconsistent state | `save()` in `saveload.ts` is a single `IDBTransaction.put` with no rollback |
| **CE version check** | Informational: CE rejects saves with version ≠ 1.2R; DH2 has `version: 1` but no enforcement | `SaveGame.version` field never validated on load |
| **No save slot UI** | Informational: CE had 10 named slots; DH2 slots are auto-incremented IndexedDB entries | saves are written via `save(name, slot)` API; slot selection UI is external |
