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

// Weapon class + attack-mode/skin/damage-type constants + unarmed-move table.
// Split out of critter.ts. See wiki/ts-split-refactor.md → §13.

import { ammoGetCapacity, ammoGetQuantity } from '../weaponAmmo.js'
import globalState from '../globalState.js'
import { dbgWarn } from '../logger.js'
import type { Critter } from '../object/Critter.js'
import type { WeaponObj } from '../object/items.js'
import type { Obj } from '../object/Obj.js'

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

// FO2-CE ref: item.cc weaponGetSkillForHitMode() + _attack_skill[]
// Maps the primary attack mode (from weapon PRO attackMode field) to a base skill.
// Attack modes: 0=none, 1=punch, 2=kick, 3=swing, 4=thrust, 5=throw,
//               6=fire single, 7=fire burst, 8=flame
const attackModeToBaseSkill: { [mode: number]: string } = {
    0: 'Unarmed',
    1: 'Unarmed',
    2: 'Unarmed',
    3: 'Melee Weapons',
    4: 'Melee Weapons',
    5: 'Throwing',
    6: 'Small Guns',
    7: 'Small Guns',
    8: 'Small Guns',
}

// FO2-CE ref: item.cc — Big Gun animCodes: 8 (Big Gun), 9 (Minigun), 10 (Rocket Launcher)
const BIG_GUN_ANIM_CODES = new Set([8, 9, 10])

// FO2-CE ref: item.cc — Energy damage types: Laser, Plasma, Electrical
const ENERGY_DAMAGE_TYPES = new Set(['Laser', 'Plasma', 'Electrical'])

// Derives the correct weapon skill from the weapon's PRO data.
// Replaces the old hardcoded weaponSkillMap.
function getWeaponSkillFromPro(weapon: WeaponObj): string {
    if (!weapon || !weapon.pro || !weapon.pro.extra) return 'Unarmed'

    // Read primary attack mode from PRO
    const attackModes = weapon.pro.extra['attackMode'] ?? 0
    const primaryMode = attackModes & 0xf

    let skill = attackModeToBaseSkill[primaryMode] ?? 'Unarmed'

    // FO2-CE refinement: Small Guns can be Energy Weapons or Big Guns
    if (skill === 'Small Guns') {
        const dmgType: string | undefined = damageType[weapon.pro.extra.dmgType] as string | undefined
        if (dmgType && ENERGY_DAMAGE_TYPES.has(dmgType)) {
            skill = 'Energy Weapons'
        } else {
            const animCode = weapon.pro.extra.animCode ?? 0
            if (BIG_GUN_ANIM_CODES.has(animCode)) {
                skill = 'Big Guns'
            }
        }
    }

    return skill
}

// Legacy fallback map for weapons without proper PRO data
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

// Unarmed "weapon": no item, just the proto-shaped fields the AP/range code reads.
export interface UnarmedWeaponStub { pro: { extra: { [key: string]: any } }; pid?: undefined }

// TODO: improve handling of melee
export class Weapon {
    weapon: WeaponObj | UnarmedWeaponStub // the item, or a stub carrying unarmed AP/range
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
            // fist: CE HIT_MODE_PUNCH (1-2, 3 AP) — critters other than the player always
            // punch plainly (combat_ai.cc _ai_pick_hit_mode); the player's moves live in unarmed.ts
            this.type = 'melee'
            this.minDmg = 1
            this.maxDmg = 2
            this.name = 'punch'
            this.weaponSkillType = 'Unarmed'
            this.weapon = { pro: { extra: {} } }
            this.weapon.pro.extra.maxRange1 = 1
            this.weapon.pro.extra.maxRange2 = 1
            this.weapon.pro.extra.APCost1 = 3 // base punch AP cost
            this.weapon.pro.extra.APCost2 = 3
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

            // FO2-CE ref: item.cc weaponGetSkillForHitMode() — derive skill from PRO data
            this.weaponSkillType = getWeaponSkillFromPro(weapon)
            // Legacy fallback for weapons without proper PRO attack mode data
            if (!this.weaponSkillType || this.weaponSkillType === 'Unarmed') {
                const legacySkill = weaponSkillMap[this.name]
                if (legacySkill) this.weaponSkillType = legacySkill
            }
            if (this.weaponSkillType === undefined) dbgWarn('combat', 'unknown weapon type for ' + this.name)
            // FO2-CE ref: item.cc — melee weapons use the melee damage/crit tables, not the gun tables
            if (this.weaponSkillType === 'Melee Weapons') this.type = 'melee'

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
        // The unarmed stub isn't a weapon item, so the helpers report 0 for it.
        const item = this.weapon as Obj
        const maxAmmo = ammoGetCapacity(item)
        const canReload = maxAmmo > 0 && ammoGetQuantity(item) < maxAmmo
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

    // CE item.cc weaponGetActionPointCost for an attack by `critter`: the slot's AP cost;
    // the player's Fast Shot -1 for weapons with range > 2, Bonus HtH Attacks -1 for
    // melee/unarmed, Bonus Rate of Fire -1 for ranged; +1 when aiming; never below 1.
    getAttackAPCost(critter: Critter, slot?: number, aiming = false): number {
        const s = slot ?? (this.mode === 'burst' ? 2 : 1)
        let ap = this.getAPCost(s)
        if (critter.isPlayer) {
            const traits: string[] = (critter as any).traits ?? []
            const isItem = (this.weapon as any).pid !== undefined
            const modes = isItem ? ((this.weapon as any).pro?.extra?.attackMode ?? 0) : 0
            const mode = s === 2 ? (modes >> 4) & 0xf : modes & 0xf
            const attackType = !isItem ? 'unarmed' : (['none', 'unarmed', 'unarmed', 'melee', 'melee', 'throw', 'ranged', 'ranged', 'ranged'][mode] ?? 'none')
            if (isItem && traits.includes('Fast Shot') && this.getMaximumRange(s) > 2) ap -= 1
            if ((attackType === 'melee' || attackType === 'unarmed') && critter.hasPerk('Bonus HtH Attacks')) ap -= 1
            if (attackType === 'ranged' && critter.hasPerk('Bonus Rate of Fire')) ap -= 1
        }
        if (aiming) ap += 1
        return Math.max(1, ap)
    }

    // CE ref: item.cc:1640 weaponGetActionPointCost HIT_MODE_*_WEAPON_RELOAD branch
    getReloadAPCost(): number {
        if (this.weapon && this.weapon.pro && this.weapon.pro.extra) {
            if (this.weapon.pro.extra.perk === 65) return 1 // PERK_WEAPON_FAST_RELOAD
            if (this.weapon.pid === 390) return 0 // PROTO_ID_SOLAR_SCORCHER
        }
        return 2
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

        return null
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
            case 'run':
                return wep + 't'  // CE ref: art.cc buildFid — Xt = run-while-armed
            case 'shoot': {
                const attackSkin = this.getAttackSkin()
                return wep + (attackSkin ?? 'j')  // CE ref: art.cc — Xj = fire-single default
            }
            case 'weapon-reload':
                return wep + 'a'  // CE ref: art.cc — reload reuses idle FRM (Xa)
            case 'weapon-draw':
                return wep + 'c'  // Xc = pull out weapon, played forward
            case 'weapon-holster':
                return wep + 'd'  // Xd = put away weapon, played forward
            default:
                return null // let something else handle it
        }
    }

    canEquip(_obj: Critter): boolean {
        // CE ref: critter.cc critterEquipCurrent — equipping never gates on FRM availability;
        // getAnimation() falls back to unarmed skin 'a' when weapon FRM is absent.
        return true
    }

    getDamageType(): string {
        // Return the (string) damage type of the weapon, e.g. "Normal", "Laser", ...
        // Defaults to "Normal" if the weapon's PRO does not provide one.
        const rawDmgType = this.weapon.pro.extra.dmgType
        return rawDmgType !== undefined ? (damageType[rawDmgType] as string) : 'Normal'
    }
}
