# Car System (Highwayman) — Deep-Dive Audit

> Last audited: 2026-09-23
> Sources: `raw/fallout2-ce/src/worldmap.cc`, `worldmap.h`, `proto_instance.cc`, `proto_types.h`, `interpreter_extra.cc`, `game_vars.h`
> DH2 sources: `src/map/mapLoader.ts`, `lut/car_parking.json`, `src/worldmap.ts` (barrel), `src/worldmap/Worldmap.ts`, `src/scripting.ts`, `src/object/Obj.ts`, `src/object/factories.ts`, `src/main.ts`
> Cross-reference: [worldmap.md](worldmap.md) §"Car Movement"/Gap #12 — **note: that document predates the W8 fix (2026-09-13/14/16) and still describes DH2 as having "no car system"**. Treat this doc as authoritative for car-specific behavior; `worldmap.md`'s car sections are stale and not corrected as part of this pass (out of scope — flagged here only).

---

## 1. Overview

The Highwayman car is modeled at two independent layers in both CE and DH2:

1. **Worldmap-level state** — a set of flags/counters that exist independent of any
   local map: whether the party currently has the car (`GVAR_PLAYER_GOT_CAR`),
   whether the party is *currently driving* it on the worldmap (`isInCar`),
   remaining fuel (`carFuel`), and which town-area the car is parked at
   (`currentCarAreaId`). This state persists across save/load and across every
   local-map visit.
2. **Local-map object(s)** — when the car is parked at a town, the town's local
   map must contain a physical, clickable car body (scenery) that the player can
   walk up to and "use" to re-open the worldmap, and (in the DH2 design) a
   separate trunk container object the player can loot/refuel independently.
   CE spawns these via each town's compiled `map_enter_p_proc` script; DH2
   injects them programmatically in `mapLoader.ts` based on the worldmap-level
   state.

The two layers only interact at scripted boundaries: entering a car-body object
flips `isInCar` and reopens the worldmap; arriving at a town by car (worldmap
travel ends inside an area) parks the car and records which local map/area it's
parked at, so the *next* local-map load knows to inject the body/trunk.

---

## 2. fallout2-ce Reference Table

| CE File / Function | What it does | Lines |
|---|---|---|
| `proto_types.h` — `PROTO_ID_CAR_TRUNK` | `enum { ... PROTO_ID_CAR_TRUNK = 455, ... }` — trunk item/container proto ID (decimal 455 / 0x1C7). | `proto_types.h:184` |
| `proto_types.h` — `PROTO_ID_CAR` | `#define PROTO_ID_CAR 0x20003F1` — car body scenery proto ID (decimal 33555441). | `proto_types.h:195` |
| `worldmap.h` — `CAR_FUEL_MAX` | `#define CAR_FUEL_MAX (80000)` — max fuel tank capacity, in the same units `wmCarUseGas`/`wmCarFillGas` operate on. | `worldmap.h:8` |
| `worldmap.cc` — main worldmap loop, car step/fuel block | While `wmGenData.isWalking`: calls `wmPartyWalkingStep()` once (base foot/car step), then **while `isInCar`**, three more unconditional `wmPartyWalkingStep()` calls (base car = 4 steps per outer loop iteration), plus one extra step each if `GVAR_CAR_BLOWER`, `GVAR_NEW_RENO_CAR_UPGRADE` are set, plus three extra steps if `GVAR_NEW_RENO_SUPER_CAR` is set (up to 9 steps/iteration with every upgrade). **`wmCarUseGas(100)` is called exactly once per outer-loop iteration, after all the step calls** — i.e. fuel cost is flat 100/iteration regardless of how many upgrade-driven extra steps were taken. | `worldmap.cc:3025–3052` |
| `worldmap.cc` — `wmCarUseGas(int amount)` | Subtracts `amount` from `wmGenData.carFuel`, clamped ≥ 0. | `worldmap.cc:5984` |
| `worldmap.cc` — `wmCarFillGas(int amount)` | Adds `amount` to `carFuel`, clamped to `CAR_FUEL_MAX`. | `worldmap.cc:6010` |
| `worldmap.cc` — `wmCarIsOutOfGas()` | Returns `carFuel <= 0`. | `worldmap.cc:6031` |
| `worldmap.cc` — `wmCarGiveToParty()` | Sets `isInCar = true` (or equivalent flow), used by `METARULE_GIVE_CAR_TO_PARTY`. | `worldmap.cc:6043` |
| `worldmap.cc` — `wmCarCurrentArea()` | `return wmGenData.currentCarAreaId;` — used by `METARULE_CAR_CURRENT_TOWN`. | `worldmap.cc:6037–6039` |
| `worldmap.cc` — fuel bar render ratio | `ratio = (WM_WINDOW_CAR_FUEL_BAR_HEIGHT * carFuel) / CAR_FUEL_MAX`, then rounded down to an even number (`if (ratio & 1) ratio -= 1`) before being drawn in 2px segments. | `worldmap.cc:6221–6240` |
| `worldmap.cc` — `currentCarAreaId` persistence | Saved/loaded as part of the worldmap generic-data block (`wmGenData`); set to `-1` on new game/reset, set to `CITY_CAR_OUT_OF_GAS` when the car runs dry mid-travel, matched to the destination area via `wmMatchAreaContainingMapIdx` on arrival. | `worldmap.cc:918,970,1083,1160,3064,3078,3113,3165–3167,3206,6654` |
| `interpreter_extra.cc` — METARULE enum | `METARULE_CAR_CURRENT_TOWN = 30`, `METARULE_GIVE_CAR_TO_PARTY = 31`, `METARULE_GIVE_CAR_GAS = 32`, `METARULE_SET_CAR_CARRY_AMOUNT = 52`, `METARULE_GET_CAR_CARRY_AMOUNT = 53`. | `interpreter_extra.cc:67–69,81–82` |
| `interpreter_extra.cc` — `opMetarule` dispatch, car IDs 30/31/32 | `case METARULE_CAR_CURRENT_TOWN` / `GIVE_CAR_TO_PARTY` / `GIVE_CAR_GAS` — thin wrappers calling `wmCarCurrentArea()`, `wmCarGiveToParty()`, `wmCarFillGas()` respectively. | `interpreter_extra.cc:3234–3241` |
| `interpreter_extra.cc` — `METARULE_SET_CAR_CARRY_AMOUNT` | `protoGetProto(PROTO_ID_CAR_TRUNK, &proto); proto->item.data.container.maxSize = param.integerValue;` — writes the trunk's cargo capacity **directly on the shared proto** (affects the trunk's max carry weight/size for the rest of the session). | `interpreter_extra.cc:3331–3338` (proto write at `:3334`) |
| `interpreter_extra.cc` — `METARULE_GET_CAR_CARRY_AMOUNT` | `protoGetProto(PROTO_ID_CAR_TRUNK, &proto); result = proto->item.data.container.maxSize;` — reads the same field back. | `interpreter_extra.cc:3340–3347` (proto read at `:3343`) |
| `proto_instance.cc` — examining the car body | `if (target->pid == PROTO_ID_CAR)`: shows message 549 ("The car is running at %d%% power.") if `GVAR_PLAYER_GOT_CAR != 0`, else message 548 ("The car doesn't look like it's working right now."). | `proto_instance.cc:465–479` (approx., block starts `:465`) |
| `proto_instance.cc` — using an ammo/energy-cell item on the car or trunk | `case ITEM_TYPE_AMMO: if (targetObj->pid == PROTO_ID_CAR \|\| targetObj->pid == PROTO_ID_CAR_TRUNK) rc = _obj_use_power_on_car(item);` — sfall comment explicitly notes this is a fix so refueling isn't restricted to clicking the car body only; **the trunk is an equally valid refuel target in CE**. | `proto_instance.cc:1215–1226` (car/trunk check at `:1218`) |

### Absence of per-map placement code in engine source — corrected 2026-09-23

There is **no per-map hardcoded car-tile table anywhere in the fallout2-ce engine
source**. `map.cc` and `scripts.cc` only contain the generic script-procedure
dispatch machinery (`map_enter_p_proc`, `map_exit_p_proc`, etc.) — they do not
know about the car specifically. The actual "spawn the Highwayman at tile X in
Den" logic lives inside each town's compiled `map_enter_p_proc` bytecode
(one `.int` file per map, e.g. `denbus1.int`), which DH2 has as raw compiled
files under `data/scripts/*.int`.

**This section originally (first pass of this audit) claimed these `.int` files
were not citable with file/line because DH2 has no decompiler for them. That
was wrong** — DH2 already ships everything needed to statically disassemble
them: `src/intfile.ts` (header/procedure-table parser) and `src/vm.ts` +
`src/vm_bridge.ts` (the full opcode table, since DH2's own scripting engine
executes this exact bytecode format for gameplay). A standalone static
disassembler built from those references successfully extracted real,
verified car-placement tiles for 10 towns — see §7. This is a correction to
the audit's own earlier claim, flagged per this project's convention of
surfacing source/wiki discrepancies rather than silently editing over them.

---

## 3. DH2 Implementation Table

| DH2 File / Function | What it does | Lines |
|---|---|---|
| `src/map/mapLoader.ts` — `PROTO_ID_CAR` / `PROTO_ID_CAR_TRUNK` constants | `const PROTO_ID_CAR = 0x020003F1`, `const PROTO_ID_CAR_TRUNK = 455` — mirrors the CE constants exactly (see §2). | `mapLoader.ts:39–42` |
| `src/map/mapLoader.ts` — `getCarParkingEntry(mapName)` | Lazily loads and caches `lut/car_parking.json` (strips the `_doc` comment key), returns the `{carTile, trunkTile}` entry for a lowercase map name or `null` if the map isn't in the table. | `mapLoader.ts:49–61` |
| `src/map/mapLoader.ts` — `resolveCarPos(mapName, mapObj)` | If the data-file entry has `carTile >= 0`, converts it via `fromTileNum`. Otherwise falls back to a **runtime heuristic**: the map's area entrance tile (`areaContainingMap` + `entrances.find(e => e.mapName === mapName)`) offset `+3` in x, or the map's `startPosition` offset `+3` in x if no entrance tile is recorded. | `mapLoader.ts:66–84` |
| `src/map/mapLoader.ts` — `resolveTrunkPos(mapName, carPos)` | Same data-file-first pattern; heuristic fallback is `carPos.x + 2` (2 tiles east of the car). | `mapLoader.ts:86–94` |
| `src/map/mapLoader.ts` — `loadMap()` dirty-cache branch, car re-injection | When revisiting a map that's in `globalState.dirtyMapCache` (already visited this session) **and** the car is parked there (`!Worldmap.getIsInCar() && Worldmap.getCarMapName() === this.name`): re-creates the car body via `Scenery.fromPID(PROTO_ID_CAR)`, marks it `_transient = true`, attaches a synthetic `use_p_proc` that calls `Worldmap.setIsInCar(true)`, `Worldmap.updateCarUI()`, and emits `Events.emit('openWorldmap')`. The trunk is **not** re-created here — it survives via normal `deserialize()` because it isn't `_transient`. | `mapLoader.ts:153–177` |
| `src/map/mapLoader.ts` — `loadNewMap()` clean-load branch, car + trunk injection | Same parked-car guard, but on a **first/clean** load: injects both the car body (`Scenery.fromPID(PROTO_ID_CAR)`, transient, same synthetic `use_p_proc`) and the trunk (`Obj.fromPID(PROTO_ID_CAR_TRUNK)`, **not** transient) via `resolveCarPos`/`resolveTrunkPos`, pushed onto `this.objects[_carElev]` where `_carElev = this.currentElevation` at the time of injection. | `mapLoader.ts:344–379` |
| `src/map/GameMap.ts` — `serialize()` transient filter | `objects: this.objects.map(level => arrayWithout(level, globalState.player).filter(obj => !obj._transient).map(obj => obj.serialize()))` — strips `_transient`-flagged objects (the car body) from the dirty-map-cache snapshot before caching, which is what makes the dirty-cache re-injection in `loadMap()` necessary and prevents duplicate car bodies from accumulating across repeated visits. The trunk, not being transient, IS included in the snapshot and comes back with its inventory intact. | `GameMap.ts:611–614` |
| `lut/car_parking.json` | Per-map override table, 15 seeded map entries (`denbus1`, `denbus2`, `broken1`, `broken2`, `kladwtwn`, `klamall`, `modmain`, `ncr1`, `ncr2`, `sfchina`, `gecksetl`, `newr1`, `newr2`, `reddown`, `navarro`). **Every entry is currently `{"carTile": -1, "trunkTile": -1}`** — no map has been tuned yet, so all 15 candidate towns fall back to the entrance-offset heuristic. | `lut/car_parking.json:3–17` |
| `src/main.ts` — `window.debugCarTile()` console helper | Prints the player's current `tileNum` (`y*200+x`) and current map name, for pasting into `lut/car_parking.json` while manually scouting parking spots in-browser. | `main.ts:851–857` |
| `src/worldmap/Worldmap.ts` — `CAR_FUEL_MAX` | `export const CAR_FUEL_MAX = 80000` — matches CE `worldmap.h:8` exactly. | `Worldmap.ts:44–45` |
| `src/worldmap/Worldmap.ts` — car state variables | Module-level `_isInCar`, `_carFuel`, `_carMapName` (DH2-only — see §4), plus `currentCarAreaId` equivalent tracked via `getCarAreaId`/`setCarAreaId` (re-exported through the `Worldmap` namespace in `src/worldmap.ts`). | `Worldmap.ts:51–60` |
| `src/worldmap/Worldmap.ts` — `getIsInCar` / `setIsInCar` / `getCarFuel` / `setCarFuel` / `addCarFuel` / `fillCarFuel` / `getCarMapName` / `setCarMapName` / `updateCarUI` | Accessor/mutator set for the module-level state; `setIsInCar`/`setCarFuel`/`addCarFuel`/`fillCarFuel` also push the value onto the live `worldmapPlayer` object when one exists, so the worldmap UI and the travel-loop read consistent state. | `Worldmap.ts:192–228` |
| `src/worldmap/Worldmap.ts` — `updateWorldmapPlayer()` speed/fuel block | `inCar = worldmapPlayer.isInCar && worldmapPlayer.carFuel > 0`; `carMult = inCar ? 4 : 1` (flat, no upgrade tiers); fuel consumed at a flat **100 units per tick** while `inCar`, with a `dbg`/`console.warn` when it hits 0. Comment at this call site (`"Base: 400/tick. Here we consume 100/tick"`) mischaracterizes CE's actual rate — see §4. | `Worldmap.ts:520–568` |
| `src/worldmap/Worldmap.ts` — fuel bar UI ratio | `ratio = Math.floor((70 * carFuel) / CAR_FUEL_MAX)` — matches CE's `(WM_WINDOW_CAR_FUEL_BAR_HEIGHT * carFuel) / CAR_FUEL_MAX` proportional formula (CE's bar height constant is 70px). | `Worldmap.ts:229–230` |
| `src/main.ts` — `window.giveCar([fuel])` console helper | Test-only command: sets `carFuel`, `GVAR_PLAYER_GOT_CAR`, and either parks the car at the player's current area/map (`isInCar=false`, `carMapName` set) or puts the party directly into travel mode (`isInCar=true`), depending on whether the player is currently on the worldmap or a local map. | `Worldmap.ts:81–113` |
| `src/scripting.ts` — `metarule()` car cases | `case 30`: returns `Worldmap.getCarAreaId()`. `case 31`: sets `isInCar=true`, calls `fillCarFuel()`, sets `GVAR_PLAYER_GOT_CAR=1`, opens the worldmap UI. `case 32`: adds gas via `target` amount. `case 52`/`case 53` (`SET_CAR_CARRY_AMOUNT`/`GET_CAR_CARRY_AMOUNT`): **hardcoded no-ops** — `return 0` with a comment "no car system"; does not touch the trunk proto's `maxSize` field the way CE does. | `scripting.ts:717–741` |
| `src/object/Obj.ts` — `isContainer` getter | `return this.type === 'item' && this.pro.extra.subType === 1` (SUBTYPE_CONTAINER). Works for the trunk because `Obj.fromPID_()` sets `obj.type = getPROTypeName(pidType)` **generically from the PID's high byte**, regardless of which subclass constructed the instance — so even a bare `Obj.fromPID(455)` ends up with `type: 'item'`, `subtype: 'container'`. | `Obj.ts:377–399`, getter at `:803–805` |
| `src/object/factories.ts` — normal PID dispatch convention | `objFromMapObject`/`createObjectWithPID` branch on `pidType`: `pidType === 0` (items) dispatches to `WeaponObj.fromPID` or `Item.fromPID` depending on subtype, producing a proper `Item`-typed instance. `mapLoader.ts`'s trunk injection bypasses this and calls the generic `Obj.fromPID(PROTO_ID_CAR_TRUNK)` directly instead of `Item.fromPID` — functionally equivalent today (nothing currently narrows on `instanceof Item` for container logic) but stylistically inconsistent with the codebase's own dispatch convention. | `factories.ts:27–48` |

---

## 4. Explicit Diff / Gap List

1. **Car body tiles now verified for 10 towns; trunk tile remains heuristic
   everywhere.** Updated 2026-09-23 via bytecode extraction (§7):
   `lut/car_parking.json` now carries real `carTile` values for `denbus1`,
   `broken1`, `kladwtwn`, `modmain`, `gecksetl`, `newr1`, `reddown`, `navarro`,
   `sfchina`, plus two towns missing from the original 15-entry table entirely
   (`ncrent`, `vctyctyd` — see §7). `denbus2`, `broken2`, `klamall`, `ncr1`,
   `ncr2`, `newr2` were confirmed via the same extraction to have **no**
   direct car-placement call in their scripts at all — `klamall`/`ncr1`/`ncr2`
   were wrong map-name guesses (the real submaps are `kladwtwn`/`ncrent`); the
   other three genuinely don't support parking. The **trunk tile is still
   unverified for every map** — the original game computes it at runtime
   relative to the car body (§7), not from a second literal, so there is no
   fixed value to extract; DH2's `carTile + 2` fallback remains a heuristic
   approximation with **zero collision or passability checking**. The car
   body's extracted tiles are ground-truth and need no further verification;
   the trunk offset does.

2. **Trunk built via generic `Obj.fromPID` instead of `Item.fromPID`.**
   Harmless today (see §3's `isContainer` note) but bypasses the
   `pidType`-dispatch convention used everywhere else in the codebase
   (`factories.ts`). A future feature that does `instanceof Item` type
   narrowing on inventory/container objects would silently miss the trunk.

3. **`METARULE_SET_CAR_CARRY_AMOUNT` / `METARULE_GET_CAR_CARRY_AMOUNT` (metarule
   52/53) are no-ops in DH2**, always returning `0`, whereas CE actually reads
   and writes the trunk proto's `item.data.container.maxSize` field
   (`interpreter_extra.cc:3334,3343`). Any script/quest that adjusts the car's
   cargo capacity at runtime (e.g. a "bigger trunk" upgrade) would have no
   effect in DH2. DH2's `lut/pro/items/00000455.json` does define
   `"data": {"maxSize": 1, ...}` as a static value, but there's no live
   read/write path to it from scripting.

4. **Car speed is flat 4× with no upgrade tiers.** CE ties three additional
   *free* speed boosts to GVARs — `GVAR_CAR_BLOWER` (+1 step),
   `GVAR_NEW_RENO_CAR_UPGRADE` (+1 step), `GVAR_NEW_RENO_SUPER_CAR` (+3 steps) —
   on top of the base 4 steps/iteration, for up to 9 steps/iteration, **at the
   same flat 100-fuel-per-iteration cost** (`worldmap.cc:3025–3052`). DH2's
   `carMult` in `Worldmap.ts:537` is hardcoded to `4` with no reference to any
   of these GVARs anywhere in the codebase — the New Reno car-upgrade
   questline content, if/when implemented, would have no mechanical hook to
   attach to.

5. **Fuel-consumption code comment is inaccurate (but the resulting behavior
   happens to match CE).** The comment at `Worldmap.ts:558–559` claims CE's
   "Base" rate is "400/tick" and that DH2 deliberately consumes "100/tick" as
   a scaled-down equivalent. Re-reading CE source: `wmCarUseGas(100)` is
   called **exactly once per outer-loop iteration** regardless of how many
   `wmPartyWalkingStep()` calls happened inside that same iteration
   (`worldmap.cc:3025–3052`) — so CE's real baseline is **100 fuel per
   iteration**, not 400, and upgrade-driven extra steps are "free" distance,
   not extra fuel cost. DH2's actual flat 100/tick consumption is therefore
   *closer* to CE than the comment suggests, but for the wrong reason (DH2
   has no upgrade steps to make free in the first place — see gap #4). The
   comment should be corrected in a future pass; not fixed here per the
   documentation-only scope of this audit.

6. **No cross-elevation parking awareness.** `loadNewMap()`'s injection block
   always uses `_carElev = this.currentElevation` — i.e. whatever elevation
   the player happens to load into — rather than the elevation the car was
   actually parked on. For any candidate map with more than one elevation
   reachable by different entrances, a car parked (conceptually) on elevation
   0 could end up re-injected on elevation 1 if the player re-enters via a
   different door. None of the currently-seeded 15 maps are flagged as
   multi-elevation in this audit, but the injection logic itself has no guard
   against it.

7. **No duplicate-injection bug found.** Verified as *not* a gap: the car body
   is correctly stripped from dirty-map-cache snapshots via the `_transient`
   filter in `GameMap.ts:613`, and re-injected exactly once per dirty-cache
   revisit (`mapLoader.ts:153–177`). The trunk is never re-injected on a
   dirty-cache revisit (it survives via normal deserialization with its
   inventory intact) and is only created once, on the clean-load path.
   Repeated map transitions in/out of a parked-car town were traced through
   both code paths and do not produce duplicate car or trunk objects.

8. **Design choice: single authoritative per-map record vs. CE's two
   independently-placed objects.** See §6 — this is intentional, not a bug.

---

## 5. Findings From Real Map File Inspection

A full scan of all 307 files in `maps/*.json` (every level's `objects[]`
array, matching `pid === 33555441` for the car body and `pid === 455` for the
trunk) returns **zero hits for both PIDs, in every single map** — including
every currently-listed `lut/car_parking.json` candidate town. Spot-checked
directly for this document (independent of the full scan):

| Map | Car body (`pid=33555441`) found? | Trunk (`pid=455`) found? |
|---|---|---|
| `denbus1` (Den) | not found | not found |
| `denbus2` (Den) | not found | not found |
| `ncr1` (NCR) | not found | not found |
| `ncr2` (NCR) | not found | not found |
| `newr1` (New Reno) | not found | not found |
| `newr2` (New Reno) | not found | not found |
| `klamall` (Klamath) | not found | not found |
| `broken1` (Broken Hills) | not found | not found |
| `gecksetl` (GECK / Navarro area) | not found | not found |
| `navarro` | not found | not found |

**This is the expected finding, not a bug.** As established in §2, neither
fallout2-ce's engine source nor DH2's extracted map JSON ever contained
static car/trunk placements — in the original game, these objects are spawned
at runtime by each town's compiled `map_enter_p_proc` script. DH2's
`mapLoader.ts` injection logic exists specifically to fill this gap at
runtime, the same way CE's scripts do — it is not something that should ever
show up in a static map-file scan. (Unlike the `.map` JSON, the compiled
`.int` scripts themselves *do* turn out to be statically auditable — see §7,
which corrects §2's original claim to the contrary.)

---

## 6. Known Original-Game Bug For Context

The original Fallout 2 has a documented Highwayman/trunk desync issue: because
the car body and the trunk are two *independently* placed objects (each
spawned by its own script call inside `map_enter_p_proc`, with no shared
coordinate record), it is possible — through a combination of alternate
entrances, corrective GVAR states, or edited saves — for the car and its
trunk to end up rendered in visibly different parts of the same town, with no
in-game mechanism to reconcile them. Because CE is a faithful decompilation of
the original engine, this same object-independence exists in
`proto_instance.cc`'s treatment of `PROTO_ID_CAR` and `PROTO_ID_CAR_TRUNK` as
two unrelated PIDs (see the ammo/refuel handler at `proto_instance.cc:1218`,
which treats them as a pair only for the refuel special-case, not for
positioning).

**Confirmed directly in `sfchina.int` (§7):** the trunk's `create_object_sid`
call at offset `0x13a6` takes its tile argument from `fetch_global(3)` — a
GVAR that was populated earlier in the same procedure via `tile_num_in_dir()`
relative to wherever the car body ended up, not from a second literal
constant. This is the actual mechanism behind the desync bug: the trunk's
position is *derived* from the car's at placement time, but the two objects
are never re-linked afterward, so any code path that moves, deletes, or
re-creates just one of them (a bad save edit, a modded script, a bug) leaves
the other stranded with no way to detect or correct the mismatch.

DH2's design intentionally avoids replicating this bug: `lut/car_parking.json`
stores car and trunk tiles **together, in a single per-map record**
(`{carTile, trunkTile}`), and both `resolveCarPos`/`resolveTrunkPos` derive
from the same entry (or the same heuristic base position) at injection time.
This means it is structurally impossible for DH2's car and trunk to diverge
onto different parts of a town the way the original engine's independent
placement calls could — a deliberate, minor deviation from "faithful
recreation" that this audit recommends keeping (do not "fix" this by
splitting car/trunk position data back into unrelated records).

---

## 7. Bytecode Extraction: Methodology And Verified Findings

*(Added 2026-09-23, second pass of this audit — this is a data extraction
task, not a code change; `lut/car_parking.json` was updated as its direct
output. See git history for the diff.)*

### Method

A standalone Node.js static disassembler (not committed to the repo — a
scratch tool) was built from three DH2 source files:
- `src/intfile.ts` — `.int` header / procedure-table / identifier-table /
  string-table parser (ported directly; the format is self-contained and
  independent of any browser/game-engine state).
- `src/vm.ts` — the core opcode table, confirming `0xc001` (`op_push_d`) is
  the literal 32-bit integer push and `0x9001` are the only two opcodes that
  consume inline operand bytes; every other opcode (including all game
  intrinsics from `vm_bridge.ts`) is a bare 2-byte opcode whose arguments are
  already on the VM's data stack from prior pushes.
- `src/vm_bridge.ts` — confirms `0x80B7` is `create_object_sid`
  (`pid, tile, elev, sid`, argc=4), and that `bridged()` pops args in reverse
  then un-reverses them, so push order matches declaration order.

The tool does **not** execute the VM (no game state is faked). It linearly
decodes each `.int` file's code section from `codeOffset` to EOF — valid
because jump targets reference offsets within the same contiguous byte range;
they don't reorder bytes, so a straight-line decode still visits every real
instruction exactly once, in file order.

**First attempt (discarded):** a general backward stack-effect scanner that
walked back from every `create_object_sid` call collecting the "last 4
stack-producing instructions" as arguments. This produced 254 hits, almost
all false positives — manual verification against `cave01.int` showed the
top hits came from a generic, widely-reused `placeCritter`-style helper
procedure whose `pid` argument is a **local variable fetch** (`op_fetch`,
`0x8032`), not a literal. The scanner's backward walk incorrectly skipped
past the fetch instruction (treating it as stack-neutral) and misattributed
an unrelated, coincidentally-matching literal from further back as the "pid."
This was caught by manually dumping the raw instruction window and reading it
by hand — not by trusting the tool's output.

**Working method:** a strict pattern match — exactly 4 consecutive `0xc001`
(literal push) instructions immediately followed by `0x80B7`
(`create_object_sid`), with zero intervening instructions. This unambiguously
selects only direct, fully-hardcoded calls and correctly excludes
variable/computed-argument calls like `placeCritter`. Manually verified
against `sfchina.int`'s real car placement before trusting it at scale:

```
0xb1e PUSH 33555441   ; pid = PROTO_ID_CAR
0xb24 PUSH 31699      ; tile
0xb2a PUSH 0          ; elev
0xb30 PUSH 304        ; sid
0xb36 CREATE_OBJECT_SID
```

### Findings

Running the strict scanner across all 1443 files in `data/scripts/*.int` and
filtering to `pid ∈ {33555441 (CAR), 455 (TRUNK)}` found real per-town car
placements in **10 towns relevant to DH2's candidate list** (full results:
`denbus1`×2, `broken1`, `kladwtwn`, `modmain`, `gecksetl`, `newr1`, `reddown`,
`navarro`, `sfchina`, `ncrent`, `vctyctyd` — see `lut/car_parking.json`'s
per-entry `_source` field for exact file/offset citations). All share an
**identical gating template**, confirmed by manually diffing 9 of the 10
call sites:

```
!metarule(22, 0) && (global_var(18) != 0 || cur_map_index == 6)
  → create_object_sid(PID_CAR, <literal tile>, 0, 304)
```

(`global_var(18)` is almost certainly `GVAR_PLAYER_GOT_CAR`; `metarule(22,…)`
is very likely the CE-side "is the car parked at a different town" check,
matching `wmCarCurrentArea`'s role — not confirmed against CE source by name,
only by behavior.) `sid=304` and `elev=0` are constant across every hit.

**`denbus1` has two call sites** (`tile=11687` at one door, `tile=24548` at
another), both behind the identical gate — the original game places the car
near whichever entrance the player used, a level of per-entrance precision
`lut/car_parking.json`'s one-record-per-map schema doesn't capture. The first
value was used; this is a known simplification, not an error.

**`denbus2`, `broken2`, `klamall`, `ncr1`, `ncr2`, `newr2` have zero direct
literal hits** — confirmed by checking `create_object_sid` call counts per
file (`newr2.int`/`klamall.int`: 0 calls to this opcode at all). Cross-checking
map names against `data/scripts/*.int` revealed DH2's original candidate list
had **guessed wrong submap names** for two towns: the real Klamath
car-parking script is `kladwtwn.int`, not `klamall.int`; the real NCR one is
`ncrent.int`, not `ncr1.int`/`ncr2.int`. Both corrections and two entirely
new entries (`ncrent`, `vctyctyd` — Vault City was missing from the candidate
list altogether) are now reflected in `lut/car_parking.json`.

**The trunk tile could not be extracted as a literal** — confirmed (see §6)
it's computed via `tile_num_in_dir()` relative to the car's own placement at
runtime, using a GVAR that's written earlier in the same procedure. Tracing
the exact `(direction, distance)` arguments per town would require the same
manual per-call verification done for `sfchina` above, repeated for each
town — not done in this pass; `trunkTile` remains `-1` (heuristic fallback)
for all 15 entries.

**Caveat on the raw literal:** an unfiltered scan (any occurrence of the
literal PID anywhere, not just as a direct `create_object_sid` argument)
matched 72 files, most of them `cave*`/`rnd*` random-encounter scripts and
Vault-interior scripts (`v13ent`, `v15ent`) unrelated to car parking —
`PID_CAR` (33555441) is very likely reused as a generic decorative "wrecked
car" scenery prop scattered across wasteland random encounters, separate
from its use as the drivable Highwayman in town scripts. This is inferred
from the pattern (many placements per file, identical `sid=304`, no paired
trunk) and from the `pro_scen.msg` text lookup (`{100900}{}{Car}` — a bare
generic name, distinct from message `101000`/`101001`, `"Chrysalis Motors
Car"` / `"This Chrysalis Motors Highwayman..."`, a **different**, adjacent
proto ID not used by any `create_object_sid` call found in this scan). Only
the 10 town-script hits above, verified against the strict pattern and a
plausible car-ownership gate, were treated as ground truth.

---

## 8. Recommended Next Steps

*(Documentation/data only — no `src/` code changes are proposed or made as
part of this pass; `lut/car_parking.json` was updated as verified data, see
§7.)*

- The 10 towns with extracted `carTile` values are ready to use as-is — no
  further verification needed, they're the original developers' own values.
- For the remaining unresolved maps (`denbus2`, `broken2`, `klamall`, `ncr1`,
  `ncr2`, `newr2` — now understood to genuinely not support car parking, or
  to have been wrong map-name guesses with no substitute identified) and for
  the trunk offset on every map, manually walk in browser using
  `window.debugCarTile()` and populate real values — verifying by eye that
  neither tile collides with a wall, blocking scenery, or an NPC spawn point.
- Consider extracting the near-duplicated car-body-injection block that
  currently exists in both `loadMap()`'s dirty-cache branch
  (`mapLoader.ts:153–177`) and `loadNewMap()`'s clean-load branch
  (`mapLoader.ts:344–379`) into one shared helper, since both construct the
  same `Scenery.fromPID(PROTO_ID_CAR)` + synthetic `use_p_proc` object.
- Consider switching the trunk's construction from `Obj.fromPID(PROTO_ID_CAR_TRUNK)`
  to `Item.fromPID(PROTO_ID_CAR_TRUNK)` (or routing it through
  `factories.ts`'s `createObjectWithPID`) for consistency with the rest of the
  codebase's PID-dispatch convention, even though it is functionally
  equivalent today.
