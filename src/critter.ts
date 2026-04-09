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

import { Config } from './config.js'
import globalState from './globalState.js'
import { Critter, WeaponObj } from './object.js'
import { Scripting } from './scripting.js'

const weaponSkins: { [weapon: string]: string } = {
    uzi: 'i',
    rifle: 'j',
}

const weaponAnims: { [weapon: string]: { [anim: string]: string } } = {
    punch: { idle: 'aa', attack: 'aq' },
}

// TODO: (Double-sided) enum
const attackMode: { [mode: string]: string | number } = {
    none: 0,
    punch: 1,
    kick: 2,
    swing: 3,
    thrust: 4,
    throw: 5,
    'fire single': 6,
    'fire burst': 7,
    flame: 8,

    0: 'none',
    1: 'punch',
    2: 'kick',
    3: 'swing',
    4: 'thrust',
    5: 'throw',
    6: 'fire single',
    7: 'fire burst',
    8: 'flame',
}

// TODO: (Double-sided) enum
const damageType: { [type: string]: string | number } = {
    Normal: 0,
    Laser: 1,
    Fire: 2,
    Plasma: 3,
    Electrical: 4,
    EMP: 5,
    Explosive: 6,

    0: 'Normal',
    1: 'Laser',
    2: 'Fire',
    3: 'Plasma',
    4: 'Electrical',
    5: 'EMP',
    6: 'Explosive',
}

// TODO: Figure out if we can derive the correct info from the game somehow
const weaponSkillMap: { [weapon: string]: string } = {
    uzi: 'Small Guns',
    rifle: 'Small Guns',
    spear: 'Melee Weapons',
    knife: 'Melee Weapons',
    club: 'Melee Weapons',
    sledge: 'Melee Weapons',
    flamethr: 'Big Guns',
    pistol: 'Small Guns',
}

interface AttackInfo {
    mode: number
    APCost: number
    maxRange: number
}

function parseAttack(weapon: WeaponObj): { first: AttackInfo; second: AttackInfo } {
    var attackModes = weapon.pro.extra['attackMode']
    var modeOne = attackMode[attackModes & 0xf] as number
    var modeTwo = attackMode[(attackModes >> 4) & 0xf] as number
    var attackOne: AttackInfo = { mode: modeOne, APCost: 0, maxRange: 0 }
    var attackTwo: AttackInfo = { mode: modeTwo, APCost: 0, maxRange: 0 }

    if (modeOne !== attackMode.none) {
        attackOne.APCost = weapon.pro.extra.APCost1
        attackOne.maxRange = weapon.pro.extra.maxRange1
    }

    if (modeTwo !== attackMode.none) {
        attackTwo.APCost = weapon.pro.extra.APCost2
        attackTwo.maxRange = weapon.pro.extra.maxRange2
    }

    return { first: attackOne, second: attackTwo }
}

// TODO: improve handling of melee
export class Weapon {
    weapon: any // TODO: any (because of melee)
    name: string
    modes: string[]
    mode: string // current mode
    type: string
    minDmg: number
    maxDmg: number
    weaponSkillType: string

    attackOne!: { mode: number; APCost: number; maxRange: number }
    attackTwo!: { mode: number; APCost: number; maxRange: number }

    constructor(weapon: WeaponObj) {
        this.weapon = weapon
        // Default mode list; extended to include 'burst' below for burst-capable guns
        this.modes = ['single', 'called']

        if (weapon === null) {
            // default punch
            // todo: use character stats...
            // todo: fully turn this into a real weapon
            this.type = 'melee'
            this.minDmg = 1
            this.maxDmg = 2
            this.name = 'punch'
            this.weaponSkillType = 'Unarmed'
            this.weapon = {}
            this.weapon.pro = { extra: {} }
            this.weapon.pro.extra.maxRange1 = 1
            this.weapon.pro.extra.maxRange2 = 1
            this.weapon.pro.extra.APCost1 = 4
            this.weapon.pro.extra.APCost2 = 4
        } else {
            // todo: spears, etc
            this.type = 'gun'
            this.minDmg = weapon.pro.extra.minDmg
            this.maxDmg = weapon.pro.extra.maxDmg
            var s = weapon.art.split('/')
            this.name = s[s.length - 1]

            var attacks = parseAttack(weapon)
            this.attackOne = attacks.first
            this.attackTwo = attacks.second

            this.weaponSkillType = weaponSkillMap[this.name]
            if (this.weaponSkillType === undefined) console.log('unknown weapon type for ' + this.name)

            // If the secondary attack is burst fire, add 'burst' to the mode cycle.
            // attackTwo.mode is stored as a string at runtime ('fire burst'), but guard
            // against the numeric form (7) in case PRO data is read differently.
            // attackTwo.mode is a string at runtime despite the 'as number' cast in parseAttack.
            // Check both the string form and the numeric value (7) defensively.
            const secondaryMode: any = this.attackTwo?.mode
            if (secondaryMode === 'fire burst' || secondaryMode === 7) {
                this.modes = ['single', 'called', 'burst']
            }
        }

        this.mode = this.modes[0]
    }

    cycleMode(): void {
        // Dynamically append 'reload' when magazine is not full (Fallout 2 cycle order:
        // single → called/aimed → [burst] → reload → single)
        const maxAmmo: number = (this.weapon as any).pro?.extra?.maxAmmo ?? 0
        const currentRounds: number = (this.weapon as any).pro?.extra?.rounds ?? maxAmmo
        const canReload = maxAmmo > 0 && currentRounds < maxAmmo
        const effectiveModes = canReload ? [...this.modes, 'reload'] : this.modes

        const idx = effectiveModes.indexOf(this.mode)
        this.mode = effectiveModes[(idx + 1) % effectiveModes.length]
    }

    isCalled(): boolean {
        return this.mode === 'called'
    }

    isBurst(): boolean {
        return this.mode === 'burst'
    }

    getProjectilePID(): number {
        if (this.type === 'melee') return -1
        return this.weapon.pro.extra.projPID
    }

    // TODO: enum
    // When called without an argument, derives the slot from the current mode.
    getMaximumRange(attackType?: number): number {
        const slot = attackType ?? (this.mode === 'burst' ? 2 : 1)
        if (slot === 1) return this.weapon.pro.extra.maxRange1
        if (slot === 2) return this.weapon.pro.extra.maxRange2
        throw 'invalid attack type ' + slot
    }

    // When called without an argument, derives the slot from the current mode.
    getAPCost(attackSlot?: number): number {
        const slot = attackSlot ?? (this.mode === 'burst' ? 2 : 1)
        return this.weapon.pro.extra['APCost' + slot]
    }

    getSkin(): string | null {
        if (this.weapon.pro === undefined || this.weapon.pro.extra === undefined) return null
        const animCodeMap: { [animCode: number]: string } = {
            0: 'a', // None
            1: 'd', // Knife
            2: 'e', // Club
            3: 'f', // Sledgehammer
            4: 'g', // Spear
            5: 'h', // Pistol
            6: 'i', // SMG
            7: 'j', // Rifle
            8: 'k', // Big Gun
            9: 'l', // Minigun
            10: 'm',
        } // Rocket Launcher
        return animCodeMap[this.weapon.pro.extra.animCode]
    }

    getAttackSkin(): string | null {
        if (this.weapon.pro === undefined || this.weapon.pro.extra === undefined) return null
        if (this.weapon === 'punch') return 'q'

        const modeSkinMap: { [mode: string]: string } = {
            punch: 'q',
            kick: 'r',
            swing: 'g',
            thrust: 'f',
            throw: 's',
            'fire single': 'j',
            'fire burst': 'k',
            flame: 'l',
        }

        // Burst uses the secondary attack skin; everything else uses the primary.
        if (this.mode === 'burst') {
            return modeSkinMap['fire burst'] // 'k'
        }
        if (this.attackOne && this.attackOne.mode !== attackMode.none) {
            return modeSkinMap[this.attackOne.mode] ?? null
        }

        throw 'TODO'
    }

    getAnim(anim: string): string | null {
        if (weaponAnims[this.name] && weaponAnims[this.name][anim]) return weaponAnims[this.name][anim]

        var wep = this.getSkin() || 'a'
        switch (anim) {
            case 'idle':
                return wep + 'a'
            case 'walk':
                return wep + 'b'
            case 'attack':
                var attackSkin = this.getAttackSkin()
                return wep + attackSkin
            case 'fidget':
                return wep + 'a'  // idle IS the fidget/reload animation (Xa)
            case 'weapon-draw':
                return wep + 'c'  // Xc = pull out weapon, played forward
            case 'weapon-holster':
                return wep + 'd'  // Xd = put away weapon, played forward
            default:
                return null // let something else handle it
        }
    }

    // FIXME: need some other way to check this without accessing `globalState.imageInfo`
    canEquip(obj: Critter): boolean {
        return globalState.imageInfo[obj.getBase() + this.getAnim('attack')] !== undefined
    }

    getDamageType(): string {
        // Return the (string) damage type of the weapon, e.g. "Normal", "Laser", ...
        // Defaults to "Normal" if the weapon's PRO does not provide one.
        const rawDmgType = this.weapon.pro.extra.dmgType
        return rawDmgType !== undefined ? (damageType[rawDmgType] as string) : 'Normal'
    }
}

/**
 * Map a weapon damage type string to the best available death animation name.
 * Returns the most specific variant first; callers should fall back to 'death'
 * via hasAnimation() if the variant isn't exported for this critter's FRM set.
 */
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
    obj.dead = true
    obj.outline = null

    if (useScript === undefined || useScript === true) {
        Scripting.destroy(obj, source)
    }

    // Resolve the death animation in priority order:
    //   1. Explicit animName passed by caller (e.g. scripted death)
    //   2. obj.deathAnim set by a critical-hit 'death' effect
    //   3. Derived from the killing weapon's damage type
    //   4. Generic 'death' as final fallback
    const candidates: (string | undefined)[] = [
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

        // Player death: show game-over overlay after the death animation completes
        if (obj.isPlayer && typeof document !== 'undefined') {
            const overlay = document.createElement('div')
            overlay.id = 'playerDeadOverlay'
            Object.assign(overlay.style, {
                position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
                background: 'rgba(0,0,0,0.75)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', zIndex: '9999',
                cursor: 'default',
            })
            const msg = document.createElement('div')
            Object.assign(msg.style, {
                color: '#cc0000', fontSize: '48px', fontFamily: 'monospace',
                textShadow: '2px 2px 8px #000', letterSpacing: '4px',
            })
            msg.textContent = 'YOU ARE DEAD'
            overlay.appendChild(msg)
            document.body.appendChild(overlay)
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
    if (obj.getStat('HP') <= 0) return critterKill(obj, source, useScript, undefined, damageType)

    if (useScript) {
        // TODO: Call damage_p_proc
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

function critterGetRawStat(obj: Critter, stat: string) {
    return obj.stats.getBase(stat)
}

function critterSetRawStat(obj: Critter, stat: string, amount: number) {
    // obj.stats[stat] = amount
    console.warn(`TODO: Change stat ${stat} to ${amount}`)
}

function critterGetRawSkill(obj: Critter, skill: string) {
    return obj.skills.getBase(skill)
}

function critterSetRawSkill(obj: Critter, skill: string, amount: number) {
    // obj.skills[skill] = amount
    console.warn(`TODO: Change skill ${skill} to ${amount}`)
}
