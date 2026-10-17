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
import { hexInDirection, HEX_GRID_SIZE, Point } from '../geometry.js'
import { randomBetween } from '../random.js'
import { toTileNum } from '../tile.js'
import {
    critterIsProne, removeKnockoutEvents, setNewResults,
    DAM_DEAD, DAM_KNOCKED_DOWN, DAM_KNOCKED_OUT, DAM_ON_FIRE,
} from '../combat/results.js'
import { ANIM, CHARACTER_SOUND_EFFECT, playCharAnimSfx } from '../sfxNames.js'
import {
    ANIM_BURNED_TO_NOTHING, ANIM_ELECTRIFIED_TO_NOTHING, ANIM_EXPLODED_TO_NOTHING, ANIM_FALL_BACK, ANIM_FALL_FRONT,
    ANIM_FIRE_DANCE, MAXIMUM_BLOOD_DEATH_ANIMATIONS,
    animName, attackerAnimation, bloodAnim, checkDeath, corpseFrame, critterHasAnim, damageTypeIndex,
    isDeathFall, pickDeath, pickFall,
} from './deathAnim.js'

// CE ref: kills.cc killsGetByType() — per-type kill counters, persisted in save
// Key = killType number (proto.extra.killType), value = count
export const killCounts: Map<number, number> = new Map()

const CRITTER_NO_DROP = 0x40 // proto critter flags (obj_types.h)
const CRITTER_SPECIAL_DEATH = 0x1000
const CRITTER_NO_KNOCKBACK = 0x4000

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
    // The hit's DAM_* results and knockback (CE _show_damage_to_object arguments)
    flags?: number
    knockback?: number
    knockbackRotation?: number
    hitFromFront?: boolean
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
    // CE critter.cc:894 — critter->data.critter.hp = 0; DAM_DEAD replaces the other results
    if (obj.stats.getBase('HP') > 0) obj.stats.setBase('HP', 0)
    removeKnockoutEvents(obj)
    obj.injuryFlags = (obj.injuryFlags | DAM_DEAD) >>> 0

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

    let deathAnim: number | null = null
    const finalizeCallback = function () {
        obj.frame-- // freeze on the last frame of the death animation
        // Use 'dead' sentinel: updateAnim() returns immediately for this value,
        // keeping the corpse frozen on its last frame indefinitely.
        obj.anim = 'dead'
        // CE actions.cc _show_death: electrified / exploded to nothing drops everything
        // carried (unless CRITTER_SPECIAL_DEATH or CRITTER_NO_DROP).
        const protoFlags = (obj.pro as any)?.extra?.flags ?? 0
        if ((deathAnim === ANIM_ELECTRIFIED_TO_NOTHING || deathAnim === ANIM_EXPLODED_TO_NOTHING)
            && (protoFlags & (CRITTER_SPECIAL_DEATH | CRITTER_NO_DROP)) === 0) {
            itemDropAll(obj)
        }
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
    const fallAnim = obj.anim === 'knockdownFront' || obj.anim === animName(ANIM_FALL_BACK) ? ANIM_FALL_BACK
        : obj.anim === 'knockdownBack' || obj.anim === animName(ANIM_FALL_FRONT) ? ANIM_FALL_FRONT : null
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

    const hitFromFront = options.hitFromFront ?? isHitFromFront(obj, source)
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
        const knockback = options.knockback ?? 0
        if (knockback !== 0 && (anim === ANIM_FALL_FRONT || anim === ANIM_FALL_BACK)) {
            // actions.cc:318 — knocked back while dying: slide with the fall, then blood.
            const fall = actionKnockdown(obj, anim, knockback, options.knockbackRotation ?? 0, () => {
                const blood = bloodAnim(obj, fall)
                if (blood !== null) play(blood, finalizeCallback)
                else finalizeCallback()
            })
            deathAnim = fall
            return
        }
        // actions.cc:321 — DIE sound for the picked anim, then _pick_fall and the
        // blood-pool variant of a fall (_action_blood).
        playCharAnimSfx(obj, anim, CHARACTER_SOUND_EFFECT.die)
        anim = pickFall(obj, anim)
        deathAnim = anim
        const blood = isDeathFall(anim) ? bloodAnim(obj, anim) : null
        play(anim, () => blood !== null ? play(blood, finalizeCallback) : finalizeCallback())
        return
    }

    // actions.cc:333 — the burning critter runs 2-5 hexes in a random direction (not
    // across an exit grid, a clear straight path), then burns to nothing.
    deathAnim = ANIM_BURNED_TO_NOTHING
    const burn = () => {
        if (!critterHasAnim(obj, ANIM_BURNED_TO_NOTHING)) return finalizeCallback()
        playCharAnimSfx(obj, ANIM_BURNED_TO_NOTHING)
        play(ANIM_BURNED_TO_NOTHING, finalizeCallback)
    }
    if (critterHasAnim(obj, ANIM_FIRE_DANCE)) {
        playCharAnimSfx(obj, ANIM_FIRE_DANCE)
        const target = fireDanceTarget(obj)
        if (target) moveStraight(obj, animName(ANIM_FIRE_DANCE), target.path, burn)
        else play(ANIM_FIRE_DANCE, burn)
    } else {
        burn()
    }
}

// CE actions.cc:363 — pick the fire-dance run: random distance 2-5 and rotation; the
// first tile (shortening the distance, then turning) off any exit grid with a clear
// straight path.
function fireDanceTarget(obj: Critter): { path: Point[] } | null {
    const randomDistance = randomBetween(2, 5)
    const randomRotation = randomBetween(0, 5)
    let rotation = randomRotation
    let distance = randomDistance
    for (;;) {
        const dir = (rotation + randomRotation) % 6
        const path = straightHexes(obj.position, dir, distance)
        const end = path[path.length - 1] ?? obj.position
        if (!isExitGridAt(end) && path.every((t) => !blockedTile(obj, t))) return path.length ? { path } : null
        if (distance > 0) distance--
        else if (rotation < 6) { rotation++; distance = randomDistance }
        else return null
    }
}

function straightHexes(from: Point, dir: number, distance: number): Point[] {
    const out: Point[] = []
    let cur = from
    for (let i = 0; i < distance; i++) {
        const next = hexInDirection(cur, dir)
        if (!next || next.x < 0 || next.y < 0 || next.x >= HEX_GRID_SIZE || next.y >= HEX_GRID_SIZE) break
        out.push(next)
        cur = next
    }
    return out
}

function blockedTile(obj: Critter, t: Point): boolean {
    return !!globalState.gMap?.blockingObjectAt(toTileNum(t), obj.elevation, 0, obj)
}

function isExitGridAt(t: Point): boolean {
    const objs = globalState.gMap?.objectsAtPosition(t) ?? []
    return objs.some((o: Obj) => o.type === 'misc' && (o as any).extra?.exitMapID !== undefined)
}

// CE animation.cc animationRegisterMoveToTileStraight — the critter slides along `path`
// while `anim` plays (one hex per frame at the FRM's fps), keeping its last frame if
// the slide outlasts it.
function moveStraight(obj: Critter, anim: string, path: Point[], then: () => void): void {
    let index = 0
    let animDone = false
    let slideDone = path.length === 0
    const finish = () => { if (animDone && slideDone) then() }
    obj.staticAnimation(anim, () => { animDone = true; finish() }, true)
    if (slideDone) return
    const fps = globalState.imageInfo[obj.art]?.fps || 10
    const step = () => {
        if (obj.dead && index === 0 && !globalState.gMap) return
        obj.move({ ...path[index++] }, undefined, false)
        if (index >= path.length) { slideDone = true; finish(); return }
        setTimeout(step, 1000 / fps)
    }
    setTimeout(step, 1000 / fps)
}

// CE actions.cc actionKnockdown — knockback slide: up to MAX_KNOCKDOWN_DISTANCE (20)
// hexes in `rotation`, stopping before a blocker or an exit grid (with CE's extra step
// back), playing the fall (FALL_FRONT falls back to FALL_BACK without art) with its
// KNOCKDOWN sound. Returns the fall anim used.
function actionKnockdown(obj: Critter, anim: number, maxDistance: number, rotation: number, then: () => void): number {
    if ((((obj.pro as any)?.extra?.flags ?? 0) & CRITTER_NO_KNOCKBACK) !== 0) {
        obj.staticAnimation(animName(anim), then, true)
        return anim
    }
    if (anim === ANIM_FALL_FRONT && !critterHasAnim(obj, ANIM_FALL_FRONT)) anim = ANIM_FALL_BACK
    if (maxDistance > 20) maxDistance = 20
    let distance: number
    for (distance = 1; distance <= maxDistance; distance++) {
        const tile = straightHexes(obj.position, rotation, distance)
        const t = tile[tile.length - 1]
        if (!t || tile.length < distance || blockedTile(obj, t)) { distance--; break }
        if (isExitGridAt(t)) { distance--; break }
    }
    playCharAnimSfx(obj, anim, CHARACTER_SOUND_EFFECT.knockdown)
    distance--
    const path = distance > 0 ? straightHexes(obj.position, rotation, distance) : []
    moveStraight(obj, animName(anim), path, then)
    return anim
}

// CE critter.cc itemDropAll — everything carried lands on the critter's tile.
function itemDropAll(obj: Critter): void {
    const gMap = globalState.gMap
    if (!gMap) return
    const self = obj as any
    const items: Obj[] = [...obj.inventory]
    obj.inventory.length = 0
    for (const slot of ['leftHand', 'rightHand', 'armor']) {
        const item = self[slot]
        if (item && item.pid !== undefined && !items.includes(item)) items.push(item)
        if (slot === 'armor') { if (self.armor) self.armor = null }
        else if (item && item.pid !== undefined) self[slot] = undefined
    }
    for (const item of items) {
        gMap.addObject(item)
        item.move({ ...obj.position }, gMap.getObjects().length - 1, false)
    }
}

// CE ref: actions.cc:1512 _is_hit_from_front(attacker, defender) — compares the two
// facings: the hit is from behind when they face the same way (difference 0, 1 or 5).
function isHitFromFront(obj: Critter, source?: Critter): boolean {
    if (!source || source === obj) return true
    const diff = Math.abs((source.orientation ?? 0) - (obj.orientation ?? 0))
    return diff !== 0 && diff !== 1 && diff !== 5
}

// CE combat.cc _apply_damage → _set_new_results + _damage_object, and actions.cc
// _show_damage_to_object for the reaction. `killOptions.flags` are the hit's DAM_*
// results; `knockback` / `knockbackRotation` the knockback distance and direction.
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
    const flags = killOptions.flags ?? 0
    // _show_damage_to_object looks at the critter before this hit's results apply.
    const wasProne = critterIsProne(obj)
    setNewResults(obj, flags)
    if ((flags & DAM_DEAD) !== 0) obj.critDeath = true

    if (damage > 0) {
        obj.stats.modifyBase('HP', -damage)
        // CE combat.cc _damage_object: combat.damageLastTurn += damage
        ;(obj as any).damageLastTurn = ((obj as any).damageLastTurn ?? 0) + damage
        // CE _damage_object: damage_p_proc only for damage that landed
        if (useScript && obj._script) Scripting.damage(obj, obj, source, damage)
    }
    // A critical with DAM_DEAD kills whatever the HP (CE combat.cc _apply_damage).
    if (obj.getStat('HP') <= 0 || obj.critDeath) {
        return critterKill(obj, source, useScript, { animate: useAnim, damage, ...killOptions }, damageType)
    }
    if (!useAnim || wasProne) return

    const knockback = (((obj.pro as any)?.extra?.flags ?? 0) & CRITTER_NO_KNOCKBACK) !== 0 ? 0 : (killOptions.knockback ?? 0)
    const rotation = killOptions.knockbackRotation ?? 0
    const hitFromFront = killOptions.hitFromFront ?? isHitFromFront(obj, source)
    const done = () => { if (callback) callback() }

    if ((flags & (DAM_KNOCKED_OUT | DAM_KNOCKED_DOWN)) !== 0) {
        // Knocked out / down: the fall (hit from the front → on the back), its sound,
        // the knockback slide; the critter stays down.
        let fall = hitFromFront ? ANIM_FALL_BACK : ANIM_FALL_FRONT
        playCharAnimSfx(obj, fall, CHARACTER_SOUND_EFFECT.unused)
        if (knockback !== 0) {
            fall = actionKnockdown(obj, fall, knockback, rotation, done)
        } else {
            fall = pickFall(obj, fall)
            obj.staticAnimation(animName(fall), done, true)
        }
        obj.knockdownAnim = fall === ANIM_FALL_BACK ? 'knockdownFront' : 'knockdownBack'
        return
    }
    if ((flags & DAM_ON_FIRE) !== 0 && critterHasAnim(obj, ANIM_FIRE_DANCE)) {
        // Set on fire but alive: the fire dance, then standing again.
        obj.staticAnimation(animName(ANIM_FIRE_DANCE), () => { obj.clearAnim(); done() }, true)
        return
    }
    if (knockback !== 0) {
        // Knocked back without falling over: slide with the fall, then get up.
        const fall = actionKnockdown(obj, hitFromFront ? ANIM_FALL_BACK : ANIM_FALL_FRONT, knockback, rotation, () => {
            const getUp = fall === ANIM_FALL_BACK ? 'getUpFront' : 'getUpBack'
            if (obj.hasAnimation(getUp)) obj.staticAnimation(getUp, () => { obj.clearAnim(); done() })
            else { obj.clearAnim(); done() }
        })
        return
    }
    if (obj.inAnim()) return
    // CE actions.cc:431 — a hit plays ANIM_HIT_FROM_FRONT/BACK (front when there is no
    // back art), never a dodge.
    const hitAnim = hitFromFront || !obj.hasAnimation('hitBack') ? 'hitFront' : 'hitBack'
    if (obj.hasAnimation(hitAnim)) {
        playCharAnimSfx(obj, hitAnim === 'hitFront' ? ANIM.hitFromFront : ANIM.hitFromBack)
        obj.staticAnimation(hitAnim, () => {
            obj.clearAnim()
            done()
        })
    }
}
