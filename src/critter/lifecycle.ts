/*
Copyright 2014 darkf, Stratege
Copyright 2015 darkf

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// Critter lifecycle: critterKill / critterDamage +
// killCounts. Split out of critter.ts. See wiki/ts-split-refactor.md → §13.

import { Config } from '../config.js'
import globalState from '../globalState.js'
import { dbg, dbgWarn } from '../logger.js'
import { Obj } from '../object/Obj.js'
import type { Critter } from '../object/Critter.js'
import { Scripting } from '../scripting.js'
import * as Endgame from '../endgame.js'
import { hexDirectionTo, hexInDirection, HEX_GRID_SIZE } from '../geometry.js'
import { getRandomInt } from '../util.js'
import { ANIM, CHARACTER_SOUND_EFFECT, playCharAnimSfx } from '../sfxNames.js'
import {
    ANIM_BURNED_TO_NOTHING, ANIM_FALL_BACK, ANIM_FALL_FRONT, ANIM_FIRE_DANCE, MAXIMUM_BLOOD_DEATH_ANIMATIONS,
    animName, attackerAnimation, bloodAnim, checkDeath, corpseFrame, critterHasAnim, damageTypeIndex,
    isDeathFall, pickDeath, pickFall,
} from './deathAnim.js'

// CE ref: kills.cc killsGetByType() — per-type kill counters, persisted in save
// Key = killType number (proto.extra.killType), value = count
export const killCounts: Map<number, number> = new Map()

// How a kill is shown (CE has two paths):
//  - animate: actions.cc _show_damage_to_object — the death anim picked by _pick_death
//    (or the script-damage anim), its DIE sound, _pick_fall and the blood-pool fall.
//  - otherwise: critter.cc critterKill without animation (kill_critter, poison,
//    radiation, ...) — the corpse is the single-frame death `deathFrame` (a CE
//    ANIM_*_SF id, default LAST_SF_DEATH_ANIM).
export interface KillOptions {
    animate?: boolean
    damage?: number
    weapon?: Obj | null
    attackerAnim?: number
    scriptDamage?: boolean // critter_dmg → actionDamage's max-blood anim (actions.cc:1933)
    deathFrame?: number
}

export function critterKill(
    obj: Critter,
    source?: Critter,
    useScript?: boolean,
    options: KillOptions = {},
    damageType?: string,
    callback?: () => void
) {
    // Prevent re-triggering the death sequence on an already-dying critter.
    // critterDamage (e.g. burst fire overkill) or scripts can call this twice.
    if (obj.dead) return
    obj.dead = true
    obj.outline = null
    obj.critDeath = false
    // CE critter.cc:894 — critter->data.critter.hp = 0
    if (obj.stats.getBase('HP') > 0) obj.stats.setBase('HP', 0)

    // CE combat.cc _damage_object — killsIncByType only for kills by the player or the
    // player's team. (Karma for kills is handled by the critters' scripts, as in CE.)
    const player = globalState.player
    if (!obj.isPlayer && source && player && (source.isPlayer || source.teamNum === player.teamNum)) {
        const kt = obj.killType ?? 0
        killCounts.set(kt, (killCounts.get(kt) ?? 0) + 1)
    }

    if (useScript === undefined || useScript === true) {
        Scripting.destroy(obj, source)
    }

    const finalizeCallback = function () {
        obj.frame-- // freeze on the last frame of the death animation
        // Use 'dead' sentinel: updateAnim() returns immediately for this value,
        // keeping the corpse frozen on its last frame indefinitely.
        obj.anim = 'dead'
        if (callback) callback()

        // Player death: CE ref: critter.cc:912 — calls endgameSetupDeathEnding(REASON_DEATH)
        // then the death ending scene plays (narrator slide with voiceover).
        if (obj.isPlayer && typeof document !== 'undefined') {
            Endgame.setupDeathEnding(Endgame.DEATH_REASON_DEATH)
            Endgame.playDeathEnding().catch((e: unknown) => {
                dbgWarn('combat', `[death] playDeathEnding error: ${e}`)
            })
        }

        // Corpse auto-cleanup: remove empty corpses after a configurable timeout.
        // Corpses with loot are left on the map so the player can still loot them.
        const timeout = (Config.engine as any).corpseTimeout as number | undefined
        if (timeout && timeout > 0 && globalState.gMap) {
            const map = globalState.gMap
            setTimeout(() => {
                if (obj.inventory.length === 0 && globalState.gMap === map) {
                    globalState.gMap.destroyObject(obj)
                }
            }, timeout * 1000)
        }
    }

    // A critter lying on the ground from a knockdown (CE _critter_is_prone).
    const fallAnim = obj.anim === 'knockdownFront' ? ANIM_FALL_BACK
        : obj.anim === 'knockdownBack' ? ANIM_FALL_FRONT : null
    // Let a running knockdown finish first. (Its callback stays set after the last
    // frame, so inAnim() can't tell; compare against the frame count.)
    const whenReady = (fn: () => void) => {
        const frames = globalState.imageInfo[obj.art]?.numFrames ?? 0
        if (fallAnim !== null && obj.frame < frames - 1) obj.animCallback = fn
        else fn()
    }
    const play = (anim: number, next: () => void) => obj.staticAnimation(animName(anim), next, true)

    if (!options.animate) {
        whenReady(() => play(corpseFrame(obj, options.deathFrame, fallAnim), finalizeCallback))
        return
    }

    // actions.cc:410 — already prone: only the blood pool of the fall, no sound.
    if (fallAnim !== null) {
        whenReady(() => {
            const blood = bloodAnim(obj, fallAnim)
            if (blood !== null) play(blood, finalizeCallback)
            else finalizeCallback()
        })
        return
    }

    const hitFromFront = isHitFromFront(obj, source)
    let anim = options.scriptDamage
        ? checkDeath(obj, MAXIMUM_BLOOD_DEATH_ANIMATIONS[damageTypeIndex(damageType)], 3, hitFromFront)
        : pickDeath(obj, {
            attacker: source,
            weapon: options.weapon !== undefined ? options.weapon : source?.equippedWeapon ?? null,
            damage: options.damage ?? 0,
            damageType,
            attackerAnim: options.attackerAnim ?? attackerAnimation(source),
            hitFromFront,
        })
    dbg('combat', `[death] ${obj.name}: anim ${anim} (${damageType ?? 'Normal'}, violence ${Config.combat.violenceLevel})`)

    if (anim !== ANIM_FIRE_DANCE) {
        // actions.cc:321 — DIE sound for the picked anim, then _pick_fall and the
        // blood-pool variant of a fall (_action_blood).
        playCharAnimSfx(obj, anim, CHARACTER_SOUND_EFFECT.die)
        anim = pickFall(obj, anim)
        const blood = isDeathFall(anim) ? bloodAnim(obj, anim) : null
        play(anim, () => blood !== null ? play(blood, finalizeCallback) : finalizeCallback())
        return
    }

    // actions.cc:333 — fire dance (CE also runs the burning critter 2-5 hexes; DH2
    // dances in place), then burned to nothing.
    const burn = () => {
        if (!critterHasAnim(obj, ANIM_BURNED_TO_NOTHING)) return finalizeCallback()
        playCharAnimSfx(obj, ANIM_BURNED_TO_NOTHING)
        play(ANIM_BURNED_TO_NOTHING, finalizeCallback)
    }
    if (critterHasAnim(obj, ANIM_FIRE_DANCE)) {
        playCharAnimSfx(obj, ANIM_FIRE_DANCE)
        play(ANIM_FIRE_DANCE, burn)
    } else {
        burn()
    }
}

// CE ref: actions.cc:1512 _is_hit_from_front(attacker, defender) — compares the two
// facings: the hit is from behind when they face the same way (difference 0, 1 or 5).
function isHitFromFront(obj: Critter, source?: Critter): boolean {
    if (!source || source === obj) return true
    const diff = Math.abs((source.orientation ?? 0) - (obj.orientation ?? 0))
    return diff !== 0 && diff !== 1 && diff !== 5
}

export function critterDamage(
    obj: Critter,
    damage: number,
    source: Critter,
    useScript: boolean = true,
    useAnim: boolean = true,
    damageType?: string,
    callback?: () => void,
    killOptions: KillOptions = {}
) {
    obj.stats.modifyBase('HP', -damage)
    // CE combat.cc _damage_object: combat.damageLastTurn += damage
    if (damage > 0) (obj as any).damageLastTurn = ((obj as any).damageLastTurn ?? 0) + damage
    // FO2-CE ref: combat.cc attackComputeDamage() — damage_p_proc fires after HP reduction, before death check
    if (useScript && obj._script) {
        Scripting.damage(obj, obj, source, damage)
    }
    // A critical with DAM_DEAD kills whatever the HP (CE combat.cc _apply_damage).
    if (obj.getStat('HP') <= 0 || obj.critDeath) {
        return critterKill(obj, source, useScript, { animate: true, damage, ...killOptions }, damageType)
    }

    // CE ref: combat.cc:4633 attackComputeDamage — knockback damage/10 (/5 with
    // PERK_WEAPON_KNOCKBACK) for explosions, unarmed and ATTACK_TYPE_MELEE, never for
    // multihex or CRITTER_NO_KNOCKBACK (0x4000) critters; Stonewall (player) negates
    // half the time, else halves it. actions.cc actionKnockdown caps it at
    // MAX_KNOCKDOWN_DISTANCE (20).
    const _srcWep = source?.equippedWeapon
    const _srcAttackMode = ((_srcWep as any)?.pro?.extra?.attackMode ?? 0) & 0xf
    const _isMeleeOrExplode = damageType === 'Explosive' || !_srcWep || _srcWep.pid === undefined
        || _srcAttackMode === 3 || _srcAttackMode === 4 // swing / thrust = ATTACK_TYPE_MELEE
    const _multihex = (((obj as any).flags ?? 0) & 0x800) !== 0
    if (_isMeleeOrExplode && source && source !== obj && !_multihex && !((obj.pro?.extra?.flags ?? 0) & 0x4000)) {
        let kbDist = Math.trunc(damage / ((_srcWep as any)?.pro?.extra?.perk === 61 ? 5 : 10)) // PERK_WEAPON_KNOCKBACK
        if (obj === (globalState.player as Obj) && (obj as Critter).hasPerk?.('Stonewall')) {
            kbDist = getRandomInt(0, 100) < 50 ? 0 : Math.trunc(kbDist / 2)
        }
        kbDist = Math.min(kbDist, 20)
        if (kbDist > 0 && globalState.gMap) {
            const dir = hexDirectionTo(source.position, obj.position)
            let kbPos = obj.position
            for (let i = 0; i < kbDist; i++) {
                const next = hexInDirection(kbPos, dir)
                if (!next || next.x < 0 || next.y < 0 ||
                    next.x >= HEX_GRID_SIZE || next.y >= HEX_GRID_SIZE) break
                // stop if any non-critter blocking object occupies the tile
                const blocking = globalState.gMap.objectsAtPosition(next)
                    .some((o: Obj) => o !== obj && o.type !== 'critter' && o.blocks?.())
                if (blocking) break
                kbPos = next
            }
            if (kbPos !== obj.position) {
                obj.position = kbPos
            }
        }
    }

    // Front hit → hitFront/knockdownFront; rear → hitBack/knockdownBack.
    const _hitFromFront = isHitFromFront(obj, source)

    // Play a hit reaction if the critter isn't already mid-animation.
    // If a knockdown/knockout crit was applied this hit, play knockdownFront/Back and stay down;
    // otherwise pick the normal hit reaction (hitFront/hitBack).
    if (useAnim && !obj.inAnim()) {
        const kdAnim = _hitFromFront ? 'knockdownFront' : 'knockdownBack'
        const kdFallback = _hitFromFront ? 'knockdownBack' : 'knockdownFront'
        if (obj.isKnockedDown && (obj.hasAnimation(kdAnim) || obj.hasAnimation(kdFallback))) {
            obj.isKnockedDown = false
            const chosenKd = obj.hasAnimation(kdAnim) ? kdAnim : kdFallback
            obj.knockdownAnim = chosenKd // get-up anim follows the fall (Combat.nextTurn)
            // CE ref: actions.cc:402 — knocked out/down: sfxBuildCharName(defender,
            // hitFromFront ? ANIM_FALL_BACK : ANIM_FALL_FRONT, UNUSED).
            playCharAnimSfx(obj, _hitFromFront ? ANIM.fallBack : ANIM.fallFront)
            obj.staticAnimation(chosenKd, () => {
                // Stay on last frame — Combat.nextTurn() plays getUpFront when skipTurns reaches 0
            })
            obj.skipTurns = 1
        } else {
            obj.isKnockedDown = false // consume flag even if no knockdown animation available
            const preferredHit = _hitFromFront ? 'hitFront' : 'hitBack'
            const fallbackHit  = _hitFromFront ? 'hitBack'  : 'hitFront'
            // CE actions.cc:431 — a hit plays ANIM_HIT_FROM_FRONT/BACK, never a dodge.
            const hitAnim =
                obj.hasAnimation(preferredHit) ? preferredHit :
                obj.hasAnimation(fallbackHit)  ? fallbackHit  : null

            if (hitAnim !== null) {
                // CE ref: actions.cc:431 — sfxBuildCharName(defender, ANIM_HIT_FROM_FRONT/BACK, UNUSED).
                playCharAnimSfx(obj, hitAnim === 'hitFront' ? ANIM.hitFromFront : ANIM.hitFromBack)
                obj.staticAnimation(hitAnim, () => {
                    obj.clearAnim()
                    if (callback) callback()
                })
            }
        }
    }
}
