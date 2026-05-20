# TODO

Developer task list. For high-level status and roadmap rationale see README.md.
Priority order within each section: **[P1]** blocks playability, **[P2]** visible gap, **[P3]** polish/correctness.

---

## Scripting stubs (scripting.ts)

~37 active `stub()` calls. Most quest scripts fail silently because of these.

| Priority | Opcode | Notes |
|---|---|---|
| P1 | `critter_heal` | NPC healing scripts; ref: `critter.ts::critterHeal()` exists, just not wired |
| P1 | `critter_injure` | Used by damage scripts; ref: fallout2-ce `critter.cc::critterInjure()` |
| P1 | `play_sfx` | Scripted sound cues; `audio.ts` has infra |
| P1 | `mark_area_known` | Quest completion writes worldmap areas; `ui_worldmap.ts` consumes `knownAreas` |
| P1 | `gfade_out` / `gfade_in` | Screen fade; most cutscene transitions; simple CSS/WebGL overlay |
| P1 | `reg_anim_func` | Scripted animations; many object scripts depend on this |
| P2 | `obj_art_fid` | Returns FRM ID of object; proto data already loaded |
| P2 | `art_anim` | Converts art+anim enum to FRM ID; ref: fallout2-ce `art.cc::artAlias()` |
| P2 | `obj_item_subtype` | Returns item subtype (weapon/ammo/armor/etc.) from proto |
| P2 | `tile_contains_pid_obj` | Spatial tile query; `map.ts::getObjects()` usable as base |
| P2 | `tile_is_visible` | Visibility check; lightmap data available |
| P2 | `set_exit_grids` | Dynamic exit grid override; `map.ts` stores exit grids |
| P2 | `gdialog_set_barter_mod` | Barter modifier during dialogue; `ui_barter.ts` has the slot |
| P2 | `gSay_Start` | Dialogue opener; `ui_dialogue.ts` exists |
| P2 | `game_ui_disable` / `game_ui_enable` | Lock input during cutscenes |
| P2 | `wm_area_set_pos` | Moves a worldmap area marker; `ui_worldmap.ts` |
| P3 | `get_poison` / `poison` | Poison stat read/write; no decay loop yet (see below) |
| P3 | `radiation_dec` | Radiation stat decrease |
| P3 | `do_check` | Skill/stat roll with result codes |
| P3 | `using_skill` | Returns skill being used in skill_use_p_proc context |
| P3 | `inven_cmds` | Inventory command dispatching |
| P3 | `critter_attempt_placement` | Try to place critter near tile |
| P3 | `anim` (fallback branch) | Animation dispatch in the `else` branch |
| P3 | `metarule` variants | Several METARULE sub-cases unimplemented; see scripting.ts:493 |

---

## Perk system

- **[P1] Perk selection UI** (`ui_character.ts`, `player.ts`)
  - `pendingPerkPick` flag is set on level-up (player.ts) but no screen exists
  - Character screen already lists perks — add a selection modal triggered by the flag
  - Wire chosen perk into the existing perk application logic in `perks.ts`
- **[P2] Perk prerequisite checks** (`perks.ts`)
  - No SPECIAL/skill/level prerequisites enforced at selection time
  - Ref: fallout2-ce `perk.cc::perkGetPerkAvailableFlag()`
- **[P2] Perk rank tracking** (`player.ts`, `perks.ts`)
  - Multi-rank perks (e.g. Bonus HtH Attacks) don't track current rank

---

## Character creation

- **[P1] Trait selection** (`ui_charactercreator.ts`)
  - 2-trait slot exists conceptually; no selection UI; `player.ts` never receives trait choices
  - Only Gifted and Good Natured affect calculations (char.ts)
- **[P2] Name / age / sex entry** (`ui_charactercreator.ts`) — incomplete

---

## Combat

- **[P2] AI team targeting** (`object.ts:1173`, `combat.ts:1044`)
  - `teamNum = -1` is a TODO; AI picks nearest critter regardless of faction
  - Ref: fallout2-ce `ai.cc::aiGetAttackTarget()`
- **[P2] Perk crit bonuses** (`combat.ts:475`)
  - `bonusCrit = 0` — Better Criticals, Slayer perk bonuses not applied
- **[P2] Melee critical table** (`criticalEffects.ts:49`)
  - Currently uses a single crit table; melee weapons use a separate one in FO2
  - Ref: fallout2-ce `combat.cc::rollCriticalHit()`
- **[P2] `damage_p_proc` call** (`critter.ts:567`)
  - Critter scripts' damage procedure not called on damage
- **[P3] DAM_DROP** — weapon drop on critical failure not implemented
- **[P3] Unarmed special moves** — Haymaker, etc. not in combat
- **[P3] Move within range before attacking** (`main.ts:248`) — TODO comment, AI walks into melee

---

## Map system

- **[P2] Spatial triggers** (`map.ts:35, 449, 464`)
  - `spatials` deserialization is stubbed; spatial_p_proc never fires
- **[P2] `destroy_p_proc` on object removal** (`map.ts:120`)
  - Script procedure not called when objects are removed from map
- **[P2] Object removal queue** (`map.ts:99`)
  - Direct removal causes indexing issues; needs a deferred removal queue
- **[P3] `map_enter_p_proc` on elevation change** (`map.ts:481`)
  - Unclear if it should fire; verify against fallout2-ce `map.cc`
- **[P3] Spatial deserialization in save/load** (`map.ts:612`)

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

Stat fields and scripting stubs exist; no tick-based loops:
- Poison decay and damage per tick
- Radiation accumulation and symptom thresholds
- Drug/chem effect timers, stat modifications, addiction rolls, withdrawal

Implement only when explicitly tasked.

---

## Dialogue

- **[P2] `end_dialogue`** is a stub in scripting.ts — dialogue can't be closed by script
- **[P2] `gsay_message` UI** — some integration paths incomplete in `ui_dialogue.ts`

---

## Skills

- **[P3] Healer perk** not applied in First Aid / Doctor handlers (`skillUse.ts`)
- **[P3] Expanded Lockpick set** not modelled (`skillUse.ts`)
- **[P3] Facing check on Steal** missing (`skillUse.ts`)
- **[P3] Gambling / Outdoorsman** — no interactive handler, only passive modifiers

---

## Time system (`gametime.ts`, `events.ts`)

- **[P2]** `events.ts:39` — `TURN_DURATION_MS` duplicated; should import from `gametime.ts`
- **[P2]** `get_month` and `get_day` opcodes hardcoded to return 1 / 0 (scripting.ts)
- **[P3]** Combat time advancement uses wall-clock duration, not turn count (`events.ts:45`)

---

## Type hygiene (`object.ts`, `globalState.ts`)

Low priority but accumulating:
- `Obj.type`, `Obj.pro`, `Obj.art`, `Obj.extra`, `Obj.anim` — all `any` with TODO type annotations
- `globalState.proMap: any` — needs a typed proto map interface
- `Critter.weapon: any` — melee weapon handling needs a proper type
- Door/Container should be subclasses of `Obj` (object.ts:143)

---

## Misc

- **[P2] Worldmap area entrance positions** — misplaced on area screens (README note)
- **[P2] Encounter difficulty adjustment** — easy +5 / hard -5 roll modifier missing (`encounters.ts:300`)
- **[P2] Cautious Nature perk** encounter roll bonus missing (`encounters.ts:349`)
- **[P3]** Save slot screenshots not implemented (`saveload.ts`)
- **[P3]** Karma title computation, town reputation, faction tracking — `get_pc_stat` / `mod_pc_stat` wired but no title logic
- **[P3]** `char.ts:27` — "Melee Weapons" skill named "Melee" in PRO; naming mismatch
