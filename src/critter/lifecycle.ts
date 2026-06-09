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

// Critter lifecycle: critterKill / critterDamage / deathAnimForDamageType +
// killCounts. Split out of critter.ts. See wiki/ts-split-refactor.md → §13.

import { Config } from '../config.js'
import globalState from '../globalState.js'
import { lazyLoadImage } from '../images.js'
import { Obj } from '../object/Obj.js'
import type { Critter } from '../object/Critter.js'
import { Scripting } from '../scripting.js'
import * as Endgame from '../endgame.js'
import { hexDirectionTo, hexInDirection, HEX_GRID_SIZE } from '../geometry.js'
import { getRandomInt } from '../util.js'

// CE ref: kills.cc killsGetByType() — per-type kill counters, persisted in save
// Key = killType number (proto.extra.killType), value = count
export const killCounts: Map<number, number> = new Map()

export function deathAnimForDamageType(damageType: string): string {
    switch (damageType) {
        case 'Fire':        return 'death-fire'
        case 'Plasma':      return 'death-plasma'
        case 'Laser':       return 'death-laser'
        case 'Electrical':
        case 'EMP':         return 'death-electro'
        case 'Explosive':   return 'death-explode'
        default:            return 'death'
    }
}

export function critterKill(
    obj: Critter,
    source?: Critter,
    useScript?: boolean,
    animName?: string,
    damageType?: string,
    callback?: () => void
) {
    // Prevent re-triggering the death sequence on an already-dying critter.
    // critterDamage (e.g. burst fire overkill) or scripts can call this twice.
    if (obj.dead) return
    obj.dead = true
    obj.outline = null

    // Karma award for player kills. Simple placeholder: +1 per hostile kill.
    // FO2-CE awards via proto karma_vars; that lookup is not wired yet.
    if (source?.isPlayer && !obj.isPlayer) {
        const cur = source.stats.getBase('Karma')
        source.stats.setBase('Karma', Math.max(-99999999, Math.min(99999999, cur + 1)))
    }

    // CE ref: kills.cc killsAdd() — increment per-type kill counter
    if (!obj.isPlayer) {
        const kt = obj.killType ?? 0
        killCounts.set(kt, (killCounts.get(kt) ?? 0) + 1)
    }

    if (useScript === undefined || useScript === true) {
        Scripting.destroy(obj, source)
    }

    // Resolve the death animation in priority order:
    //   0. CRITTER_SPECIAL_DEATH flag (0x1000) — forces explode-to-nothing
    //   1. Explicit animName passed by caller (e.g. scripted death)
    //   2. obj.deathAnim set by a critical-hit 'death' effect
    //   3. Derived from the killing weapon's damage type
    //   4. Generic 'death' as final fallback
    // CE ref: actions.cc:209 _pick_death.
    const critterFlags = (obj as any).pro?.extra?.flags ?? 0
    const specialDeath = (critterFlags & 0x1000) !== 0
    const candidates: (string | undefined)[] = [
        specialDeath ? 'death-explode' : undefined,
        animName,
        obj.deathAnim,
        damageType ? deathAnimForDamageType(damageType) : undefined,
        'death',
    ]
    let resolvedAnim = 'death'
    for (const c of candidates) {
        if (c && obj.hasAnimation(c)) {
            resolvedAnim = c
            break
        }
    }
    // Clear the one-shot override so it doesn't bleed into a second death call
    obj.deathAnim = undefined

    const finalizeCallback = function () {
        obj.frame-- // freeze on the last frame of the death animation
        // Use 'dead' sentinel: updateAnim() returns immediately for this value,
        // keeping the corpse frozen on its last frame indefinitely.
        obj.anim = 'dead'
        if (callback) callback()

        // CE ref: critter.cc _critter_flag_check(pid, CRITTER_NO_DROP=0x40)
        // If the critter's proto sets CRITTER_NO_DROP, wipe inventory so it
        // cannot be looted — quest-critical critters must not expose items.
        if ((obj.pro?.extra?.flags ?? 0) & 0x40) {
            obj.inventory = []
        }

        // Blood pool: spawn a permanent floor decal for biological death types.
        // Explosion, Electrical and EMP deaths don't produce a blood pool.
        // Silently skipped when the FRM art is absent from the asset set.
        const noBloodTypes = ['Explosion', 'Electrical', 'EMP']
        if (!noBloodTypes.includes(damageType ?? '') && globalState.gMap) {
            const bloodArt = 'art/misc/rdatblud'
            lazyLoadImage(bloodArt, () => {
                if (!globalState.gMap || !globalState.imageInfo[bloodArt]) return
                const pool = new Obj()
                pool.type = 'misc'
                pool.art = bloodArt
                pool.position = { x: obj.position.x, y: obj.position.y }
                globalState.gMap.addObject(pool)
            })
        }

        // Player death: CE ref: critter.cc:912 — calls endgameSetupDeathEnding(REASON_DEATH)
        // then the death ending scene plays (narrator slide with voiceover).
        if (obj.isPlayer && typeof document !== 'undefined') {
            Endgame.setupDeathEnding(Endgame.DEATH_REASON_DEATH)
            Endgame.playDeathEnding().catch((e: unknown) => {
                console.error('[death] playDeathEnding error:', e)
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

    // Knockdown → death transition:
    // If the critter is mid-knockdown, let that animation finish first, then
    // transition directly to the death animation.  This avoids an ugly pop
    // where the critter snaps from falling to dying.
    if (obj.anim === 'knockdownFront' || obj.anim === 'knockdownBack') {
        obj.animCallback = () => {
            obj.staticAnimation(resolvedAnim, finalizeCallback, true)
        }
    } else {
        obj.staticAnimation(resolvedAnim, finalizeCallback, true)
    }
}

export function critterDamage(
    obj: Critter,
    damage: number,
    source: Critter,
    useScript: boolean = true,
    useAnim: boolean = true,
    damageType?: string,
    callback?: () => void
) {
    obj.stats.modifyBase('HP', -damage)
    // FO2-CE ref: combat.cc attackComputeDamage() — damage_p_proc fires after HP reduction, before death check
    if (useScript && obj._script) {
        Scripting.damage(obj, obj, source, damage)
    }
    if (obj.getStat('HP') <= 0) return critterKill(obj, source, useScript, undefined, damageType)

    // CE ref: combat.cc:4633 attackComputeDamage — knockback: damage/10, melee/unarmed/explosion only.
    // CE obj_types.h:103 CRITTER_NO_KNOCKBACK = 0x4000
    // Stonewall perk (player only): 50% negate entirely; if fails, halve distance.
    const _srcWep = source?.equippedWeapon
    const _isMeleeOrExplode = damageType === 'Explosion' ||
        _srcWep === null || (_srcWep?.weapon?.type === 'melee')
    if (_isMeleeOrExplode && source && source !== obj && !((obj.pro?.extra?.flags ?? 0) & 0x4000)) {
        let kbDiv = 10
        if (obj === (globalState.player as Obj) && (obj as Critter).hasPerk?.('Stonewall')) {
            if (getRandomInt(0, 100) < 50) kbDiv = 0 // 50% full negation
            else kbDiv = 20 // remaining 50%: halved distance
        }
        const kbDist = kbDiv > 0 ? Math.min(Math.floor(damage / kbDiv), 6) : 0
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

    // Play a hit reaction if the critter isn't already mid-animation.
    // If a knockdown/knockout crit was applied this hit, play knockdownFront and stay down;
    // otherwise pick the normal hit reaction (dodge/hitFront/hitBack).
    if (useAnim && !obj.inAnim()) {
        if (obj.isKnockedDown && obj.hasAnimation('knockdownFront')) {
            obj.isKnockedDown = false
            obj.staticAnimation('knockdownFront', () => {
                // Stay on last frame — Combat.nextTurn() plays getUpFront when skipTurns reaches 0
            })
            obj.skipTurns = 1
        } else {
            obj.isKnockedDown = false // consume flag even if no knockdown animation available
            const hitAnim =
                (obj.hasAnimation('dodge') && Math.random() < 0.3) ? 'dodge' :
                obj.hasAnimation('hitFront') ? 'hitFront' :
                obj.hasAnimation('hitBack') ? 'hitBack' : null

            if (hitAnim !== null) {
                obj.staticAnimation(hitAnim, () => {
                    obj.clearAnim()
                    if (callback) callback()
                })
            }
        }
    }
}
