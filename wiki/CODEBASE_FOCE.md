# fallout2-ce Codebase Map

Navigational reference for [fallout2-ce](https://github.com/alexbatalov/fallout2-ce) files relevant to DarkHarold2. All citations in DarkHarold2 source should name the `.cc`/`.h` file and function.

---

## Source Tree Overview

| Group | Files |
|-------|-------|
| Game Logic | `combat.cc`, `combat_ai.cc`, `critter.cc`, `proto.cc`, `map.cc`, `stat.cc`, `skill.cc`, `perk.cc`, `trait.cc`, `item.cc`, `object.cc`, `queue.cc`, `scripts.cc`, `actions.cc` |
| Scripting/VM | `interpreter.cc`, `interpreter.h`, `scripts.cc`, `scripts.h`, `game_dialog.cc` |
| Rendering | `draw.cc`, `art.cc`, `animation.cc`, `geometry.cc`, `color.cc`, `font_manager.cc` |
| UI/Interface | `interface.cc`, `character_editor.cc`, `automap.cc`, `pipboy.cc`, `dialog.cc` |
| Data/Files | `db.cc`, `cache.cc`, `datafile.cc`, `loadsave.cc` |
| Audio | `audio.cc`, `game_sound.cc` |
| World/Map | `map.cc`, `worldmap.cc`, `encounter.cc`, `tile.cc` |

---

## combat.cc

**What it does:** Turn-based combat loop — initiative order, AP tracking, attack resolution, end-of-combat cleanup.

**Key functions:**

| Signature | Purpose |
|-----------|---------|
| `int combatInit(void)` | One-time startup |
| `void _combat_begin(Object* attacker)` | Start a combat instance |
| `void _combat_sequence(void)` | Main turn loop |
| `int attackCompute(Attack* attack)` | Hit roll + crit determination; calls `attackComputeDamage` |
| `static void attackComputeDamage(Attack* attack, int ammoQuantity, int a3)` | Damage pipeline (lines 4578–4615 in CE) |
| `static void damageModCalculateGlovz(DamageCalculationContext* context)` | Glovz damage variant |
| `int calledShotSelectHitLocation(Object* critter, int* hitLocation, int hitMode)` | Called shot UI |

**Key structs:**

`Attack` — attack result bundle passed through the hit/damage pipeline.

`DamageCalculationContext`:

| Field | Type | Notes |
|-------|------|-------|
| `attack` | `Attack*` | back-pointer to the attack |
| `damagePtr` | `int*` | output damage value |
| `ammoQuantity` | `int` | rounds consumed |
| `damageResistance` | `int` | DR after mods |
| `damageThreshold` | `int` | DT after mods |
| `damageBonus` | `int` | flat bonus damage |
| `bonusDamageMultiplier` | `int` | multiplier |
| `combatDifficultyDamageModifier` | `int` | difficulty scaling |

`UnarmedHitDescription`:

| Field | Type |
|-------|------|
| `requiredLevel` | `int` |
| `requiredSkill` | `int` |
| `minDamage` | `int` |
| `maxDamage` | `int` |
| `bonusCriticalChance` | `int` |
| `actionPointCost` | `int` |
| `penetration` | `bool` |

**DarkHarold2 counterpart:** `src/combat.ts`

---

## combat_ai.cc

**What it does:** AI decision loop executed on each critter's turn.

**Decision sequence in `_combat_ai(Object* a1, Object* a2)`:**

1. Health check vs `min_hp` threshold → flee if injured
2. Drug usage via `_ai_check_drugs()`
3. Target selection via `_ai_danger_source()`
4. Distance adjustment via `_cai_perform_distance_prefs()`
5. Weapon selection via `_ai_switch_weapons()`
6. Attack via `_ai_try_attack()` → `_ai_attack()`

**Key functions:**

| Function | Purpose |
|----------|---------|
| `aiInit()` | Load AI packets from `data/AI.txt` |
| `_combat_ai_begin()` | Per-combat AI setup |
| `_ai_best_weapon()` | Score and select best weapon from inventory |
| `aiHaveAmmo()` | Check ammo availability for a weapon |

**DarkHarold2 counterpart:** `src/combat.ts` (AI class)

---

## critter.cc

**What it does:** Critter stat reads, HP/condition changes, death, poison, radiation, timed events.

**Key functions:**

| Signature | Purpose |
|-----------|---------|
| `int critterAdjustHitPoints(Object* critter, int hp)` | HP delta; kills at 0 |
| `int critterGetStat(Object* critter, int stat)` | Stat lookup with bonuses |
| `int critterAdjustPoison(Object* critter, int amount)` | Poison level change |
| `int critterAdjustRadiation(Object* obj, int amount)` | Radiation level change |
| `void critterKill(Object* critter, int anim, bool a3)` | Death + loot drop + XP |
| `bool critterIsActive(Object* critter)` | True if alive and conscious |
| `bool critterIsDead(Object* critter)` | True if dead |
| `bool critterIsCrippled(Object* critter)` | True if any limb crippled |
| `int sneakEventProcess(Object* obj, void* data)` | Timed sneak re-check |
| `int knockoutEventProcess(Object* obj, void* data)` | Timed knockout recovery |

**DarkHarold2 counterparts:** `src/critter.ts`, `src/object.ts`

---

## stat.cc / stat_defs.h

**What it does:** SPECIAL stats, derived stats, and per-critter stat value resolution (base + bonus + armor mods).

**STAT_* enum (stat_defs.h):**

| Value | Name | Value | Name |
|-------|------|-------|------|
| 0 | STR | 17 | DT_Normal |
| 1 | PER | 18 | DT_Laser |
| 2 | END | 19 | DT_Fire |
| 3 | CHA | 20 | DT_Plasma |
| 4 | INT | 21 | DT_Electrical |
| 5 | AGI | 22 | DT_EMP |
| 6 | LUK | 23 | DT_Explosion |
| 7 | Max HP | 24 | DR_Normal |
| 8 | Max AP | 25 | DR_Laser |
| 9 | AC | 26 | DR_Fire |
| 10 | Unarmed Damage | 27 | DR_Plasma |
| 11 | Melee Damage | 28 | DR_Electrical |
| 12 | Carry Weight | 29 | DR_EMP |
| 13 | Sequence | 30 | DR_Explosion |
| 14 | Healing Rate | 31 | Rad Resistance |
| 15 | Critical Chance | 32 | Poison Resistance |
| 16 | Better Criticals | 33 | Age |
| — | — | 34 | Gender |
| — | — | 35 | Current HP |
| — | — | 36 | Current Poison |
| — | — | 37 | Current Radiation |

**Key function:** `int statGetValue(Object* critter, int stat)` — reads base + bonus + armor mods.

**DarkHarold2 counterparts:** `src/char.ts` (StatSet), `src/skills.ts`

---

## skill.cc / skill_defs.h

**What it does:** 18 skills — get/set values, tagged-skill bonus, skill use resolution.

**SKILL_* enum:**

| Value | Name | Value | Name |
|-------|------|-------|------|
| 0 | Small Guns | 9 | Lockpick |
| 1 | Big Guns | 10 | Steal |
| 2 | Energy Weapons | 11 | Traps |
| 3 | Unarmed | 12 | Science |
| 4 | Melee Weapons | 13 | Repair |
| 5 | Throwing | 14 | Speech |
| 6 | First Aid | 15 | Barter |
| 7 | Doctor | 16 | Gambling |
| 8 | Sneak | 17 | Outdoorsman |

**Key functions:**

| Signature | Purpose |
|-----------|---------|
| `int skillGetValue(Object* critter, int skill)` | Effective skill value with all mods |
| `int skillUse(Object* obj, Object* target, int skill, int criticalChanceModifier)` | Attempt skill use, return result |

**DarkHarold2 counterparts:** `src/skills.ts`, `src/skillUse.ts`, `src/char.ts`

---

## perk.cc / perk_defs.h

**What it does:** 119 perks (PERK_COUNT); data-driven definitions, availability checks, stat bonuses.

**PERK_* enum (first 60 values):**

| Value | Name | Value | Name |
|-------|------|-------|------|
| 0 | AWARENESS | 30 | SNAKEATER |
| 1 | BONUS_HTH_ATTACKS | 31 | MR_FIXIT |
| 2 | BONUS_HTH_DAMAGE | 32 | MEDIC |
| 3 | BONUS_MOVE | 33 | MASTER_THIEF |
| 4 | BONUS_RANGED_DAMAGE | 34 | SPEAKER |
| 5 | BONUS_RATE_OF_FIRE | 35 | HEAVE_HO |
| 6 | EARLIER_SEQUENCE | 36 | FRIENDLY_FOE |
| 7 | FASTER_HEALING | 37 | PICKPOCKET |
| 8 | MORE_CRITICALS | 38 | GHOST |
| 9 | NIGHT_VISION | 39 | CULT_OF_PERSONALITY |
| 10 | PRESENCE | 40 | SCROUNGER |
| 11 | RAD_RESISTANCE | 41 | EXPLORER |
| 12 | TOUGHNESS | 42 | FLOWER_CHILD |
| 13 | STRONG_BACK | 43 | PATHFINDER |
| 14 | SHARPSHOOTER | 44 | ANIMAL_FRIEND |
| 15 | SILENT_RUNNING | 45 | SCOUT |
| 16 | SURVIVALIST | 46 | MYSTERIOUS_STRANGER |
| 17 | MASTER_TRADER | 47 | RANGER |
| 18 | EDUCATED | 48 | QUICK_POCKETS |
| 19 | HEALER | 49 | SMOOTH_TALKER |
| 20 | FORTUNE_FINDER | 50 | SWIFT_LEARNER |
| 21 | BETTER_CRITICALS | 51 | TAG |
| 22 | EMPATHY | 52 | MUTATE |
| 23 | SLAYER | 53–57 | Addiction perks |
| 24 | SNIPER | | |
| 25 | SILENT_DEATH | | |
| 26 | ACTION_BOY | | |
| 27 | MENTAL_BLOCK | | |
| 28 | LIFEGIVER | | |
| 29 | DODGER | | |

**DarkHarold2 counterpart:** `src/perks.ts`

---

## scripts.cc / scripts.h

**What it does:** Script VM host — loads `.INT` files, manages script instances, dispatches procedure calls.

**ScriptProc enum (procedure indices):**

| Index | Name | Index | Name |
|-------|------|-------|------|
| 0 | no_p_proc | 15 | map_enter_p_proc |
| 1 | start | 16 | map_exit_p_proc |
| 2 | spatial_p_proc | 17 | create_p_proc |
| 3 | description_p_proc | 18 | destroy_p_proc |
| 4 | pickup_p_proc | 21 | look_at_p_proc |
| 5 | drop_p_proc | 22 | timed_event_p_proc |
| 6 | use_p_proc | 23 | map_update_p_proc |
| 7 | use_obj_on_p_proc | 24 | push_p_proc |
| 8 | use_skill_on_p_proc | 26 | combat_is_starting_p_proc |
| 11 | talk_p_proc | 27 | combat_is_over_p_proc |
| 12 | critter_p_proc | | |
| 13 | combat_p_proc | | |
| 14 | damage_p_proc | | |

**Script struct key fields:**

| Field | Type | Notes |
|-------|------|-------|
| `sid` | `int` | Script instance ID |
| `flags` | `int` | State flags |
| `program` | `Program*` | Bytecode program |
| `ownerId` | `int` | Object that owns this script |
| `localVarsOffset` | `int` | LVAR base in save data |
| `localVarsCount` | `int` | Number of LVARs |
| `returnValue` | `int` | Last return value |
| `action` | `int` | Current action type |
| `fixedParam` | `int` | Fixed parameter for proc call |
| `owner` | `Object*` | Owning object pointer |
| `source` | `Object*` | Triggering source |
| `target` | `Object*` | Target object |
| `actionBeingUsed` | `int` | Action in progress |
| `scriptOverrides` | `int` | Override bitfield |
| `procs[28]` | `int[]` | Procedure offsets by index |

**Key function:** `int scriptExecProc(int sid, int proc)` — executes a named procedure on a script instance.

**DarkHarold2 counterparts:** `src/scripting.ts`, `src/vm.ts`, `src/vm_bridge.ts`

---

## interpreter.cc / interpreter.h

**What it does:** Bytecode VM — decodes and executes `.INT` opcodes independent of script intrinsics.

**VM opcode range 0x8000–0x804B (interpreter.h, partial):**

| Opcode | Name | Opcode | Name |
|--------|------|--------|------|
| 0x8000 | NOOP | 0x8039 | ADD |
| 0x8001 | PUSH | 0x803A | SUB |
| 0x8002 | ENTER_CRITICAL | 0x803B | MUL |
| 0x8003 | LEAVE_CRITICAL | 0x803C | DIV |
| 0x8004 | JUMP | — | — |
| 0x8005 | CALL | — | — |

Script intrinsics (game functions called from scripts) are registered separately at 0x80A0+.

**DarkHarold2 counterparts:** `src/vm.ts` (VM opcodes), `src/vm_bridge.ts` (intrinsic wiring)

---

## proto.cc / proto.h

**What it does:** Loads `.PRO` prototype files; provides the type system for all game objects.

**Object types (high byte of PID):**

| Value | Type |
|-------|------|
| 0 | item |
| 1 | critter |
| 2 | scenery |
| 3 | wall |
| 4 | tile |
| 5 | misc |

**Item subtypes:**

| Value | Subtype |
|-------|---------|
| 0 | armor |
| 1 | container |
| 2 | drug |
| 3 | weapon |
| 4 | ammo |
| 5 | misc |
| 6 | key |

**Scenery subtypes:**

| Value | Subtype |
|-------|---------|
| 0 | door |
| 1 | stairs |
| 2 | elevator |
| 3 | ladder_bottom |
| 4 | ladder_top |
| 5 | generic |

Data is stored in unions: `ItemDataMember`, `CritterDataMember`, `SceneryDataMember`, `WallDataMember`.

**DarkHarold2 counterparts:** `src/pro.ts`, `proto.py`

---

## map.cc

**What it does:** Map loading, multi-elevation object management, hex tile layout.

**Conventions:**
- 200×200 hex grid per elevation
- `tileNum = y * 200 + x`
- 3 elevations; objects stored per elevation

**Key functions:**

| Signature | Purpose |
|-----------|---------|
| `int mapLoad(const char* fileName)` | Load a `.MAP` file |
| `void mapExit()` | Unload current map |
| `Object* mapGetObjectAt(int tile, int elevation)` | Object lookup by tile |

**DarkHarold2 counterparts:** `src/map.ts`, `fomap.py`

---

## art.cc

**What it does:** FRM sprite loading, frame management, palette application.

**FID (Frame ID) encoding:**

| Bits | Field |
|------|-------|
| 27–24 | Art type (critters, items, scenery, etc.) |
| 23–16 | Animation index |
| 15–12 | Direction (0–5) |
| 11–0 | Entry index within LST |

**DarkHarold2 counterparts:** `src/images.ts`, `frmpixels.py`
