# TODO

Developer task list. For high-level status and roadmap rationale see README.md.
Priority order within each section: **[P1]** blocks playability, **[P2]** visible gap, **[P3]** polish/correctness.

---

## Scripting stubs (scripting.ts)

~32 active `stub()` calls. Most quest scripts fail silently because of these.

| Priority | Opcode | Notes |
|---|---|---|
| P1 | `reg_anim_func` | Scripted animation registration; stub only; `reg_anim_animate` (separate) is partial — plays animation but ignores the delay param |
| P2 | `play_gmovie` | FO2 `.mve` movie playback; logs and skips gracefully; no video infrastructure exists |
| P2 | `obj_art_fid` | Returns FRM ID of object; always returns 0; proto data already loaded |
| P2 | `art_anim` | Converts art+anim enum to FRM ID; always returns 0; ref: fallout2-ce `art.cc::artAlias()` |
| P2 | `obj_item_subtype` | Returns item subtype (weapon/ammo/armor/etc.) from proto; always returns null |
| P2 | `tile_contains_pid_obj` | Partial — logic exists and runs but `stub()` still logs; verify correctness then remove log |
| P2 | `tile_is_visible` | Always returns 1; lightmap data available |
| P2 | `set_exit_grids` | Dynamic exit grid override; `map.ts` stores exit grids |
| P2 | `gdialog_set_barter_mod` | Barter modifier during dialogue; `ui_barter.ts` has the slot |
| P2 | `gSay_Start` | Dialogue opener; `ui_dialogue.ts` exists |
| P2 | `game_ui_disable` / `game_ui_enable` | Lock input during cutscenes |
| P2 | `wm_area_set_pos` | Moves a worldmap area marker; `ui_worldmap.ts` |
| P3 | `proto_data` for critters | Item fields (24 cases) are fully mapped; critter fields return 0 for all cases except `CRITTER_KILL_TYPE` |
| P3 | `get_poison` / `poison` | Poison stat read/write; no decay loop (see Status effects below) |
| P3 | `radiation_dec` | Radiation stat decrease; deferred |
| P3 | `do_check` | Skill/stat roll with result codes; always returns 1 |
| P3 | `using_skill` | Returns skill in skill_use_p_proc context; always returns 0 |
| P3 | `inven_cmds` | Inventory command dispatching |
| P3 | `critter_attempt_placement` | Calls `move_to()` directly; does not search adjacent tiles when occupied |
| P3 | `anim` (fallback branch) | Animation dispatch in the `else` branch |
| P3 | `metarule` variants | Several METARULE sub-cases unimplemented; see scripting.ts:493 |

---

## Combat

- **[P2] AI team targeting** (`object.ts:1173`, `combat.ts:1044`)
  - `teamNum = -1` everywhere; AI picks nearest critter regardless of faction
  - Ref: fallout2-ce `ai.cc::aiGetAttackTarget()`
- **[P2] Perk crit bonuses** (`combat.ts:475`)
  - `bonusCrit = 0` — Better Criticals, Slayer perk bonuses not applied
- **[P2] Melee critical table** (`criticalEffects.ts:49`)
  - Uses a single crit table; melee weapons use a separate one in FO2
  - Ref: fallout2-ce `combat.cc::rollCriticalHit()`
- **[P2] `damage_p_proc` call** (`critter.ts:567`)
  - `Scripting.damage()` exists but is never invoked; critter scripts' damage procedure never fires
- **[P3] DAM_DROP** — weapon drop on critical failure not implemented
- **[P3] Unarmed special moves** — `unarmed.ts` defines modes but no Haymaker/etc. combat logic
- **[P3] Move within range before attacking** (`main.ts:248`) — AI walks into melee range without proper range check

---

## Map system

- **[P2] Spatial triggers — save/load** (`map.ts:612`)
  - `spatial_p_proc` fires correctly during play; spatials are deserialized from map JSON
  - But on save/load, `this.spatials = [[], [], []]` — spatial triggers are lost after loading a save
- **[P2] `destroy_p_proc` on object removal** (`map.ts:120`)
  - `Scripting.destroy()` exists but is never called; script procedure doesn't fire on object removal
- **[P2] Object removal queue** (`map.ts:99`)
  - Direct `splice()` removal causes indexing issues during iteration; needs a deferred removal queue
- **[P3] `map_enter_p_proc` on elevation change** (`map.ts:481`)
  - Unclear if it should fire on elevation change; verify against fallout2-ce `map.cc`

---

## Party / companions (`party.ts`)

Deliberately deferred — not on critical path. Shell only: add/remove/enumerate.
When this becomes a priority:
- CHA-based party size cap
- Follow/formation pathfinding
- Companion inventory access
- Companion level-up
- Dismissal dialogue hooks

---

## Status effects (deliberately deferred)

Stat fields and scripting stubs exist; no tick-based loops anywhere in the engine:
- Poison decay and damage per tick
- Radiation accumulation and symptom thresholds
- Drug/chem effect timers, stat modifications, addiction rolls, withdrawal

Implement only when explicitly tasked.

---

## Dialogue

- **[P2] `gsay_message`** (`scripting.ts:1394`) — implementation is bitrotted; old code is commented out and the method is effectively a no-op. `gsay_reply` works; `gsay_message` does not.

---

## Skills

- **[P3] Healer perk** not applied in First Aid / Doctor handlers (`skillUse.ts:227`)
- **[P3] Expanded Lockpick set** not modelled (`skillUse.ts`)
- **[P3] Facing check on Steal** missing (`skillUse.ts`)
- **[P3] Gambling / Outdoorsman** — no interactive handler, only passive modifiers

---

## Time system (`gametime.ts`, `vm_bridge.ts`)

- **[P2]** `get_month` (opcode `0x8118`) and `get_day` (`0x8119`) both hardcoded in `vm_bridge.ts:51,55` — `get_month` always returns 1, `get_day` always returns 0; neither reads from the game tick counter
- **[P3]** Combat time advancement uses wall-clock duration, not turn count (`events.ts:45`)

---

## Type hygiene (`object.ts`, `globalState.ts`)

Low priority but accumulating:
- `Obj.type`, `Obj.pro`, `Obj.art`, `Obj.extra`, `Obj.anim` — all `any` with TODO type annotations (`object.ts:281–301`)
- `globalState.proMap: any` — needs a typed proto map interface (`globalState.ts:109`)
- `Critter.weapon: any` — melee weapon handling needs a proper type (`critter.ts:199`)
- `WeaponObj.getAttackSkin()` throws `'TODO'` when no attackOne mode (`critter.ts:383`)
- Door/Container should be subclasses of `Obj` (`object.ts:143`)
- `Obj.serialize()` doesn't call subclass-specific serialization (`object.ts:974`)
- `WeaponObj` (de)serialization incomplete — leftHand/rightHand fields commented out (`object.ts:1828`)
- Ladder destination ignores elevation/map bits, reads tile only (`object.ts:775`)

---

## Misc

- **[P2] Worldmap area entrance positions** — misplaced on area screens (README note)
- **[P2] Encounter difficulty adjustment** — easy +5 / hard -5 roll modifier missing (`encounters.ts:300`)
- **[P2] Cautious Nature perk** encounter roll bonus missing (`encounters.ts:349`)
- **[P3]** Save slot screenshots not implemented (`saveload.ts`)
- **[P3]** Karma title computation, town reputation, faction tracking — `get_pc_stat` / `mod_pc_stat` wired but no title logic
- **[P3]** `char.ts:27` — "Melee Weapons" skill named "Melee" in PRO; naming mismatch
