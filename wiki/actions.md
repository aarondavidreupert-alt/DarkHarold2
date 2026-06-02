# Action Dispatch System — DarkHarold2 Reference

> **Source anchor:** `raw/fallout2-ce/src/actions.cc`, `actions.h`
> **DH2 files:** `src/combat.ts`, `src/object.ts`, `src/scripting.ts`
> **Last audited:** 2026-06-02

---

## 1. Overview

`actions.cc` is the CE layer between high-level game commands ("attack that critter", "pick up that item", "use skill on that door") and the low-level animation queue (`reg_anim_begin / reg_anim_end` in `animation.cc`). Every user-visible action routes through one of its entry points; none of the functions here execute immediately — they build an animation sequence that unspools over multiple frames.

Key exported functions:

| Function | Description |
|----------|-------------|
| `_action_attack(Attack*)` | Dispatch melee or ranged attack based on animation code |
| `actionPickUp(critter, item)` | Walk to, animate, and pick up an item |
| `_action_loot_container(critter, container)` | Walk to and open a dead critter's inventory |
| `actionUseSkill(user, target, skill)` | Walk to target and apply skill (lockpick, doctor, steal, etc.) |
| `actionTalk(a1, a2)` | Walk adjacent and start dialogue |
| `actionExplode(tile, elev, min, max, src, animate)` | Explosion radius damage |
| `actionDamage(tile, elev, min, max, type, animated, bypassArmor)` | Direct tile-point damage (used by scripts) |
| `actionKnockdown(obj, anim*, maxDist, rotation, delay)` | Physics knockdown slide |

---

## 2. Attack Dispatch (`_action_attack`)

Entry point for all combat attacks. Located at `actions.cc:573`.

```cpp
int anim = critterGetAnimationForHitMode(attacker, hitMode);
if (anim < ANIM_FIRE_SINGLE && anim != ANIM_THROW_ANIM)
    return _action_melee(attack, anim);
else
    return _action_ranged(attack, anim);
```

`critterGetAnimationForHitMode` maps `hitMode` → FRM animation code. `ANIM_FIRE_SINGLE` is the threshold between melee (unarmed/swing/thrust/kick) and ranged (burst/single/throw) paths.

Before dispatching, `_action_attack` calls `reg_anim_clear` on attacker, defender, and all extras — cancelling any in-progress animations so the attack sequence starts clean.

---

## 3. Melee Attack (`_action_melee`, `actions.cc:598`)

1. `reg_anim_begin(ANIMATION_REQUEST_RESERVED)` — opens an animation block
2. `artLock(fid, &cache)` to get the attack FRM and read `actionFrame` (the sync point for SFX)
3. `animationRegisterRotateToTile(attacker, defender->tile)` — snap attacker facing
4. Build weapon SFX name via `sfxBuildWeaponName(WEAPON_SOUND_EFFECT_ATTACK, ...)` or critter punch/kick via `sfxBuildCharName`
5. Fire `_combatai_msg(attacker, attack, AI_MESSAGE_TYPE_ATTACK, 0)` — queues AI taunt floating text
6. **Hit path** (`DAM_HIT` set):
   - `animationRegisterPlaySoundEffect(attacker, attackSfx, 0)` at frame 0
   - `animationRegisterAnimate(attacker, anim, 0)` — play attack animation
   - Impact SFX at `actionFrame` offset
   - `_show_damage(attack, anim, 0)` — queue damage display, knockback, and death selection
7. **Miss path**:
   - If defender has `ANIM_DODGE_ANIM` FRM, interleave dodge animation timed against attack `actionFrame`
   - Otherwise just play attacker strike with no defender reaction
8. `_combatai_msg(AI_MESSAGE_TYPE_HIT or MISS, -1)` — attacker hit/miss taunt
9. `reg_anim_end()` — submit the animation block
10. `_show_damage_extras(attack)` — handle splash / extra targets after primary sequence

---

## 4. Ranged Attack (`_action_ranged`, `actions.cc:692`)

Similar structure to `_action_melee` but adds:

- Projectile spawning: creates a temporary projectile `Object*` with a bullet/bolt FRM (`buildFid(OBJ_TYPE_MISC, ...)`)
- `animationRegisterMoveObjectToObject` — flies the projectile from attacker to defender tile
- `animationRegisterHideObject` — hides projectile after impact
- For **burst** (`DAM_HIT_AGAIN` flags): loops through `attack->extras[]` to build additional impact animations for bystanders caught in burst
- For **area weapons** (grenades, rockets): `_report_explosion` queues a radius blast after the projectile lands
- Projectiles are cleaned up by `hideProjectile` callback

---

## 5. Damage Display (`_show_damage`, `_show_damage_to_object`)

`_show_damage(attack, attackerAnimation, delay)` — `actions.cc:530`

Iterates `attack->defender` and `attack->extras[]`; for each, calls `_show_damage_to_object`.

`_show_damage_to_object(defender, damage, flags, weapon, hitFromFront, knockbackDistance, knockbackRotation, attackerAnimation, attacker, delay)` — `actions.cc:292`

Steps:
1. If `DAM_DEAD`: call `_pick_death` to select the death animation; `_show_death` queues it
2. If `DAM_KNOCKED_DOWN` / `DAM_KNOCKED_OUT`: call `actionKnockdown` 
3. If critter injured but alive: play a `ANIM_HIT_FRONT` or `ANIM_HIT_BACK` reaction anim
4. `textObjectAdd(defender, damageString, ...)` — display the numeric damage as a floating text label
5. If knockback > 0: slide defender `knockbackDistance` tiles in `knockbackRotation` direction

---

## 6. Death Animation Selection (`_pick_death`, `_check_death`)

`_pick_death(attacker, defender, weapon, damage, attackerAnim, hitFromFront)` — `actions.cc:183`

Selects a death animation from two static tables:

```cpp
// Normal violence level
static const int gNormalDeathAnimations[DAMAGE_TYPE_COUNT] = {
    ANIM_DANCING_AUTOFIRE, ANIM_SLICED_IN_HALF, ANIM_CHARRED_BODY,
    ANIM_CHARRED_BODY, ANIM_ELECTRIFY, ANIM_FALL_BACK, ANIM_BIG_HOLE,
};

// Maximum blood
static const int gMaximumBloodDeathAnimations[DAMAGE_TYPE_COUNT] = {
    ANIM_CHUNKS_OF_FLESH, ANIM_SLICED_IN_HALF, ANIM_FIRE_DANCE,
    ANIM_MELTED_TO_NOTHING, ANIM_ELECTRIFIED_TO_NOTHING, ANIM_FALL_BACK,
    ANIM_EXPLODED_TO_NOTHING,
};
```

Logic (simplified):
- `violence_level == NONE` → always `ANIM_FALL_BACK / FALL_FRONT`
- `VIOLENCE_LEVEL_MINIMAL` → plain fall
- `VIOLENCE_LEVEL_NORMAL` + damage ≥ 15 → `gNormalDeathAnimations[damageType]`
- `VIOLENCE_LEVEL_MAXIMUM_BLOOD` + damage ≥ 45 (or Bloody Mess perk) → `gMaximumBloodDeathAnimations[damageType]`
- Molotov Cocktail and Pyromaniac perk lower the damage thresholds
- `CRITTER_SPECIAL_DEATH` flag overrides everything → `ANIM_EXPLODED_TO_NOTHING`

`_check_death` then validates the selected animation FRM exists for this critter; falls back to `ANIM_FALL_BACK` / `ANIM_FALL_FRONT` if the critter lacks the art.

---

## 7. Knockdown (`actionKnockdown`, `actions.cc:102`)

`actionKnockdown(obj, anim*, maxDistance, rotation, delay)` — slides a critter `maxDistance` tiles in `rotation` direction using `animationRegisterMoveToTile` calls, capped at the first blocking tile. Updates `anim` to the appropriate fall animation (`ANIM_FALL_FRONT`/`ANIM_FALL_BACK`).

Called from `_show_damage_to_object` when `attack->defenderKnockback > 0`.

---

## 8. Item Pickup (`actionPickUp`, `actions.cc:1157`)

1. Walk/run to within 5 tiles of item (`animationRegisterMoveToObject` or `animationRegisterRunToObject`)
2. `animationRegisterCallbackForced(_is_next_to, -1)` — validates adjacency
3. For plain items: `animationRegisterAnimate(ANIM_MAGIC_HANDS_GROUND, 0)` + SFX at `actionFrame`; `_obj_pickup` callback fires at `actionFrame`
4. For container items (`ITEM_TYPE_CONTAINER`): `ANIM_MAGIC_HANDS_MIDDLE` or `GROUND` depending on `openFlags`; calls `_obj_use_container` to open the container, then `scriptsRequestLooting`

---

## 9. Skill Use (`actionUseSkill`, `actions.cc:1325`)

Validates skill/target compatibility before queueing:

| Skill | Target required | Combat allowed |
|-------|----------------|----------------|
| First Aid / Doctor | Critter | No |
| Lockpick | Item or Scenery | No |
| Steal | Item or Critter (not self) | No |
| Traps | Non-critter | No |
| Science / Repair | Critter (robot/brahmin only) or non-critter | No |
| Sneak | — | Yes (toggles `DUDE_STATE_SNEAKING` immediately, no animation) |

If a party member is better at the skill, CE delegates to them as `performer` (except Steal, which is dude-only). The party member's `textObjectAdd` displays a generic response message.

After validation: walk to target, `animationRegisterAnimate(MAGIC_HANDS_MIDDLE or GROUND)`, `animationRegisterCallback3(_obj_use_skill_on, ...)`.

---

## 10. Explosion (`actionExplode`, `actions.cc:1582`)

`actionExplode(tile, elevation, minDamage, maxDamage, sourceObj, animate)`:

1. Creates an invisible temporary attacker object at `tile`
2. Finds all objects within explosion radius (`objectFindAllObjectsAtElevation`, `tileGetTileInDirection` spiral)
3. For each target: `_compute_explosion_damage(min, max, target, &knockback)` — applies armor DR and returns final damage
4. If `animate`: queues the explosion FRM (`ANIM_FIRE_DANCE` or similar) and `_report_explosion` callback
5. `_report_explosion` fires `SCRIPT_PROC_DAMAGE` on each hit target

---

## 11. Direct Damage (`actionDamage`, `actions.cc:1890`)

Script-callable equivalent of `actionExplode` for a single tile:
- Creates temporary invisible attacker at `tile`, finds the blocking critter
- `_compute_dmg_damage(min, max, defender, &knockback, damageType)` — flat damage ignoring most armor if `bypassArmor`
- If `animated`: queues appropriate animation from `gMaximumBloodDeathAnimations[damageType]`
- Called from `scripting.ts explosion()` and `damage_force_attack` opcodes

---

## 12. DH2 Status and Known Gaps

DH2 does not have an equivalent of `actions.cc`. Combat attacks are handled inline in `src/combat.ts`; pickup is in `src/object.ts:Obj.pickup`; skill use is in `src/main.ts:useSkill`.

| ID | Gap | CE ref | DH2 location | Sev | Status |
|----|-----|--------|--------------|-----|--------|
| AC1 | **Knockback not implemented.** `actionKnockdown` slides critters physically along the tile grid after high-damage hits. DH2's `critterDamage` applies HP loss only; `attack.defenderKnockback` is computed by the damage formula but never used. | `actions.cc:102 actionKnockdown` | `combat.ts` | major | missing |
| AC2 | **Death animation not selected by damage type / violence level.** `_pick_death` chooses from 7 death FRMs based on `damageType`, `violence_level` preference, and per-critter art availability. DH2 `critterKill` always calls `staticAnimation('dead')` — a single generic death. | `actions.cc:183 _pick_death` | `combat.ts:critterKill` | major | missing |
| AC3 | **`CRITTER_SPECIAL_DEATH` flag not checked.** CE checks `critter_flag_check(CRITTER_SPECIAL_DEATH)` in `_pick_death` and forces `ANIM_EXPLODED_TO_NOTHING`. DH2 never reads this flag. | `actions.cc:209` | — | minor | missing |
| AC4 | **Hit-from-front vs hit-from-back not tracked for death anim direction.** `_is_hit_from_front` (`actions.cc:1512`) checks attacker/defender rotation to pick `FALL_FRONT` vs `FALL_BACK`. DH2 always uses the same fall direction. | `actions.cc:1512 _is_hit_from_front` | — | low | missing |
| AC5 | **AI combat taunts not queued.** `_combatai_msg(attacker, attack, AI_MESSAGE_TYPE_ATTACK/HIT/MISS)` fires critter voice-line float text at attack and hit/miss events. DH2 never calls `combatai_msg`. | `actions.cc:667,689` | — | minor | missing |
| AC6 | **`actionUseSkill` party-member delegation not implemented.** CE uses `partyMemberGetBestInSkill(skill)` to potentially delegate skill use to a better party member and display their response text. DH2's `useSkill` always uses the player. | `actions.cc:1374` | `main.ts:useSkill` | minor | missing |
| AC7 | **`actionExplode` is a stub with TODO comment.** `scripting.ts:1680` has `explosion(tile, elev, damage)` with a TODO noting the min/max damage are hardcoded to `0, 100`. The radius, per-target damage calc, and `_report_explosion` SCRIPT_PROC_DAMAGE callbacks are absent. | `actions.cc:1582` | `scripting.ts:1680` | major | partial |
| AC8 | **Damage floating text uses different system.** CE calls `textObjectAdd` per hit to display numeric damage as a palette-rendered sprite above the defender. DH2 uses `globalState.floatMessages[]` rendered in WebGL text — same concept but no collision avoidance, fixed font, and no outline color. | `actions.cc:_show_damage_to_object` | `combat.ts:1044`, `renderer.ts:207` | low | partial |

<!-- audited: 2026-06-02 -->
