/*
Copyright 2014 darkf

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

// Critter class minus the FRM animation state machine. Split out of object.ts.
// See wiki/ts-split-refactor.md §2. The animation state-machine methods
// (getAnimation, getBase, staticAnimation, playWeaponSwapAnim, clearAnim,
// updateStaticAnim, updateLoopingAnim, updateAnim) are attached to
// Critter.prototype from ./critterAnimation.ts via TS declaration merging.

import { SkillSet, StatSet } from '../char.js'
import { ActionPoints, AI } from '../combat.js'
import { Config } from '../config.js'
import { Weapon } from '../critter.js'
import { directionOfDelta, hexDistance, HEX_GRID_SIZE, Point } from '../geometry.js'
import globalState from '../globalState.js'
import { dbg, dbgWarn } from '../logger.js'
import { Scripting } from '../scripting.js'
import { getMessage } from '../util.js'
import { getAiPacket, AiPacket } from '../aiPackets.js'
import { hitSpatialTrigger, Obj, objectIsWeapon, SerializedObj, setObjectOpen } from './Obj.js'
import { WeaponObj } from './items.js'

export interface SerializedCritter extends SerializedObj {
    stats: any
    skills: any

    // TODO: Properly (de)serialize WeaponObj
    // leftHand: SerializedObj;
    // rightHand: SerializedObj;

    aiNum: number
    teamNum: number
    // ai: AI; // TODO
    hostile: boolean

    isPlayer: boolean
    dead: boolean

    anim?: string
    crippledLeftArm?: boolean
    crippledRightArm?: boolean
    crippledLeftLeg?: boolean
    crippledRightLeg?: boolean
}

export const SERIALIZED_CRITTER_PROPS = [
    'stats', 'skills', 'aiNum', 'teamNum', 'hostile', 'isPlayer', 'dead',
    'anim', 'crippledLeftArm', 'crippledRightArm', 'crippledLeftLeg', 'crippledRightLeg',
    'poisonLevel', 'radiationLevel', 'addictions', 'customAiOverrides',
]

export class Critter extends Obj {
    stats!: StatSet
    skills!: SkillSet

    leftHand?: WeaponObj // Left-hand object slot
    rightHand?: WeaponObj // Right-hand object slot

    type = 'critter'
    anim = 'idle'
    path: any = null // Holds pathfinding objects
    AP: ActionPoints | null = null

    aiNum = -1 // AI packet number
    teamNum = -1 // AI team number (TODO: implement this)
    ai: AI | null = null // AI packet
    // Per-field overrides on top of the resolved AI packet, set via the
    // companion "Custom" behavior screen (ui_companion.ts /
    // setCompanionCustomSetting). Only meaningful when aiNum currently
    // points at a disposition='custom' packet — cleared when switching to a
    // named preset (Berserk/Aggressive/Defensive/Coward). See AI.ts
    // constructor for where these get merged onto the base packet.
    customAiOverrides: Partial<AiPacket> | null = null
    hostile = false // Currently engaging an enemy?
    // Wander origin (lazily captured on first wander tick) — used to enforce
    // per-type radius caps. CE ref: ai.cc wander_type 1/2/3 short/large/unrestricted.
    wanderOrigin: { x: number; y: number } | null = null

    isPlayer = false // Is this critter the player character?
    dead = false // Is this critter dead?
    bonusAC = 0 // Temporary AC bonus from unused AP at end of turn
    perks: string[] = [] // List of acquired perks
    nextIdleAnimTime = 0 // performance.now() after which the next idle cycle begins; 0 = uninitialised
    skipTurns = 0 // Number of combat turns to skip (set by knockdown/loseNextTurn effects)
    isKnockedDown = false // Set by knockdown/knockout crit effects; consumed by critterDamage() to play the animation
    deathAnim?: string // Override death animation (set by critical 'death' effects, e.g. 'death-explode')

    // Crippled-limb flags (set by critical effects; persist for the fight)
    crippledLeftArm = false
    crippledRightArm = false
    crippledLeftLeg = false
    crippledRightLeg = false
    isBlinded = false        // Blinded: heavy hit-chance penalty, Perception effectively 1

    injuryFlags?: number     // DAM_* bitmask from critter_injure (0x01=knocked down, 0x80=dead, etc.)

    // Poison / radiation / addiction (FO2-CE ref: critter.cc, radiation.cc)
    poisonLevel: number = 0
    radiationLevel: number = 0
    addictions: string[] = []   // drug names this critter is addicted to

    // Combat status effect counters / flags
    onFireTurns = 0          // Turns of fire DoT remaining; decremented in nextTurn
    bypassArmorNextHit = false // Set by bypassArmor crit effect; zeroes DR/DT for the hit that triggered it

    static fromPID(pid: number, sid?: number): Critter {
        return Obj.fromPID_(new Critter(), pid, sid)
    }

    static fromMapObject(mobj: any, deserializing = false): Critter {
        const obj = Obj.fromMapObject_(new Critter(), mobj, deserializing)

        if (deserializing) {
            // deserialize critter: copy fields from SerializedCritter
            dbg('object', '[Deserialize] critter')
            // console.trace();

            for (const prop of SERIALIZED_CRITTER_PROPS) {
                ;(obj as any)[prop] = mobj[prop]
            }

            // Critter.init() overwrites art with the idle animation art and leaves
            // frame at 0. Restore the serialized values so dead critters keep their
            // death-animation art and last frame instead of snapping back to idle.
            obj.art = mobj.art
            obj.frame = mobj.frame ?? 0

            if (mobj.stats) {
                obj.stats = new StatSet(mobj.stats.baseStats, mobj.stats.useBonuses)
                dbgWarn('object', '[Deserialize] stat set: %o to: %o', mobj.stats, obj.stats)
            }
            if (mobj.skills) {
                obj.skills = new SkillSet(mobj.skills.baseSkills, mobj.skills.tagged, mobj.skills.skillPoints)
                dbgWarn('object', '[Deserialize] skill set: %o to: %o', mobj.skills, obj.skills)
            }

            // Re-equip weapons from the deserialized inventory.
            // init() ran before inventory was deserialized, so leftHand/rightHand
            // may point at stale raw objects. Redo the equip pass now.
            // FO2-CE ref: critter.cc critterUnequipAll / critterEquipCurrent
            obj.leftHand = undefined
            obj.rightHand = undefined
            for (const inv of obj.inventory) {
                if (inv.subtype === 'weapon') {
                    const w = inv as WeaponObj
                    if (obj.leftHand === undefined && w.weapon?.canEquip(obj)) {
                        obj.leftHand = w
                    } else if (obj.rightHand === undefined && w.weapon?.canEquip(obj)) {
                        obj.rightHand = w
                    }
                }
            }
            const makeFist = () => {
                const f = new WeaponObj(); f.type = 'item'; f.subtype = 'weapon'
                f.weapon = new Weapon(null as unknown as WeaponObj); return f
            }
            if (!obj.leftHand)  obj.leftHand  = makeFist()
            if (!obj.rightHand) obj.rightHand = makeFist()
        }

        return obj
    }

    init() {
        super.init()

        this.stats = StatSet.fromPro(this.pro)
        this.skills = SkillSet.fromPro(this.pro!.extra.skills)
        // console.log("Loaded stats/skills from PRO: HP=%d Speech=%d", this.stats.get("HP"), this.skills.get("Speech", this.stats))
        this.name = getMessage('pro_crit', this.pro!.textID) || ''

        // initialize AI packet / team number
        // FO2-CE ref: ai.cc — team_num comes from the proto field; fall back to AI packet if absent
        this.aiNum = this.pro!.extra.AI
        const protoTeam: number | undefined = this.pro!.extra.team
        if (protoTeam !== undefined && protoTeam !== null && protoTeam >= 0) {
            this.teamNum = protoTeam
        } else {
            this.teamNum = getAiPacket(this.aiNum).teamNum
        }

        // initialize weapons
        this.inventory.forEach((inv) => {
            if (inv.subtype === 'weapon') {
                const w = <WeaponObj>inv
                if (this.leftHand === undefined) {
                    if (w.weapon!.canEquip(this)) {
                        this.leftHand = w
                    }
                } else if (this.rightHand === undefined) {
                    if (w.weapon!.canEquip(this)) {
                        this.rightHand = w
                    }
                }
                //console.log("left: " + this.leftHand + " | right: " + this.rightHand)
            }
        })

        // default to punches
        if (!this.leftHand) {
            const fist = new WeaponObj()
            fist.type = 'item'
            fist.subtype = 'weapon'
            fist.weapon = new Weapon(null)
            this.leftHand = fist
        }
        if (!this.rightHand) {
            const fist = new WeaponObj()
            fist.type = 'item'
            fist.subtype = 'weapon'
            fist.weapon = new Weapon(null)
            this.rightHand = fist
        }

        // set them in their proper idle state for the weapon
        this.art = this.getAnimation('idle')
    }

    blocks(): boolean {
        return this.dead !== true && this.visible !== false
    }

    inAnim(): boolean {
        return !!(this.path || this.animCallback)
    }

    move(position: Point, curIdx?: number, signalEvents = true): boolean {
        // CE ref: animation.cc:1805 — auto-open closed unlocked doors walked through
        if (globalState.gMap) {
            for (const obj of globalState.gMap.objectsAtPosition(position)) {
                if (obj.subtype === 'door' && !obj.open && !obj.locked && !obj.jammed) {
                    setObjectOpen(obj, true, false, true)
                }
            }
        }

        if (!super.move(position, curIdx, signalEvents)) {
            return false
        }

        if (Config.engine.doSpatials !== false) {
            const hitSpatials = hitSpatialTrigger(position)
            for (let i = 0; i < hitSpatials.length; i++) {
                const spatial = hitSpatials[i]
                dbg('object', `[Object] triggered spatial ${spatial.script} (range=${spatial.range}) @ (${spatial.position.x}, ${spatial.position.y})`)
                Scripting.spatial(spatial, this)
            }
        }

        return true
    }

    canRun(): boolean {
        return this.hasAnimation('run')
    }

    getSkill(skill: string) {
        // FO2-CE ref: skill.cc skillGetValue() — player gets tagged/trait/perk/difficulty bonuses
        return this.skills.get(skill, this.stats, {
            isPlayer: this.isPlayer,
            perks: this.perks,
        })
    }

    getStat(stat: string) {
        return this.stats.get(stat)
    }

    getEquippedArmor(): Obj | null {
        // Player stores armor in a dedicated slot; NPCs check inventory
        const self = this as any
        if (self.armor !== undefined) return self.armor
        for (const item of this.inventory) {
            if (item.subtype === 'armor') return item
        }
        return null
    }

    getArmorDR(damageType: string): number {
        const armor = this.getEquippedArmor()
        if (armor?.pro?.extra?.stats) return armor.pro.extra.stats['DR ' + damageType] ?? 0
        // Secondary scan: find armor item by PRO structure (handles NPCs whose
        // armor subtype may not be set but whose PRO carries the stats block)
        for (const item of this.inventory) {
            if (item.pro?.extra?.stats?.['DR ' + damageType] !== undefined)
                return item.pro.extra.stats['DR ' + damageType]
        }
        return 0
    }

    getArmorDT(damageType: string): number {
        const armor = this.getEquippedArmor()
        if (armor?.pro?.extra?.stats) return armor.pro.extra.stats['DT ' + damageType] ?? 0
        // Secondary scan: find armor item by PRO structure
        for (const item of this.inventory) {
            if (item.pro?.extra?.stats?.['DT ' + damageType] !== undefined)
                return item.pro.extra.stats['DT ' + damageType]
        }
        return 0
    }

    getArmorAC(): number {
        const armor = this.getEquippedArmor()
        if (!armor?.pro?.extra) return 0
        return armor.pro.extra.AC ?? 0
    }

    hasPerk(perk: string): boolean {
        return this.perks.indexOf(perk) !== -1
    }

    get equippedWeapon(): WeaponObj | null {
        const self = this as any
        const activeHand: 'leftHand' | 'rightHand' = self.activeHand ?? 'leftHand'
        const weapon = self[activeHand]
        return objectIsWeapon(weapon) ? weapon : null
    }

    get killType(): number | null {
        if (this.isPlayer) {
            return 19
        } // last type
        if (!this.pro || !this.pro.extra) {
            return null
        }
        return this.pro.extra.killType
    }

    get directionalOffset(): Point {
        const info = globalState.imageInfo[this.art]
        if (info === undefined) {
            throw 'No image map info for: ' + this.art
        }
        return info.directionOffsets[this.orientation]
    }

    walkTo(target: Point, running?: boolean, callback?: () => void, maxLength?: number, path?: any): boolean {
        // pathfind and set walking to target
        if (this.position.x === target.x && this.position.y === target.y) {
            // can't walk to the same tile
            return false
        }

        if (path === undefined) {
            if (target.x < 0 || target.x >= HEX_GRID_SIZE || target.y < 0 || target.y >= HEX_GRID_SIZE) {
                dbgWarn('movement', '[Pathfinding] walkTo: invalid target tile', target.x, target.y)
                return false
            }
            path = globalState.gMap.recalcPath(this.position, target)
        }

        if (path.length === 0) {
            // no path
            //console.log("not a valid path")
            return false
        }

        if (maxLength !== undefined && path.length > maxLength) {
            console.debug(`[Pathfinding] truncating path to length ${maxLength}`)
            path = path.slice(0, maxLength + 1)
        }

        // some critters can't run
        if (running && !this.canRun()) {
            running = false
        }

        // set up animation properties
        const actualTarget = { x: path[path.length - 1][0], y: path[path.length - 1][1] }
        this.path = { path: path, index: 1, target: actualTarget, partial: 0 }
        this.anim = running ? 'run' : 'walk'
        this.art = this.getAnimation(this.anim)
        this.animCallback = callback || (() => this.clearAnim())
        this.frame = 0
        this.lastFrameTime = window.performance.now()
        this.shift = { x: 0, y: 0 }
        const dir = directionOfDelta(this.position.x, this.position.y, path[1][0], path[1][1])
        if (dir == null) {
            throw Error()
        }
        this.orientation = dir
        //console.log("start dir: %o", this.orientation)

        return true
    }

    walkInFrontOf(targetPos: Point, callback?: () => void): boolean {
        const path = globalState.gMap.recalcPath(this.position, targetPos, false)
        if (path.length === 0) {
            // invalid path
            return false
        } else if (path.length <= 2) {
            // we're already infront of or on it
            if (callback) {
                callback()
            }
            return true
        }
        path.pop() // we don't want targetPos in the path

        const target = path[path.length - 1]
        targetPos = { x: target[0], y: target[1] }

        let running = Config.engine.doAlwaysRun
        if (hexDistance(this.position, targetPos) > 5) {
            running = true
        }

        //console.log("path: %o, callback %o", path, callback)
        return this.walkTo(targetPos, running, callback, undefined, path)
    }

    serialize(): SerializedCritter {
        const obj = <SerializedCritter>super.serialize()

        for (const prop of SERIALIZED_CRITTER_PROPS) {
            ;(obj as any)[prop] = (this as any)[prop]
        }

        return obj
    }
}
