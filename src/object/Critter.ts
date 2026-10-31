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
import { toTileNum } from '../tile.js'
import { canUseDoor } from '../map/pathfinder.js'
import { world } from '../state/world.js'
import { assets } from '../state/assets.js'
import { dbg, dbgWarn } from '../logger.js'
import * as Scripting from '../scripting.js'
import { getMessage, getProtoMsg } from '../util.js'
import { scriptNumberOf } from '../data.js'
import { drawAP } from '../hudRefresh.js'
import { uiLog } from '../messageLog.js'
import { getAiPacket, AiPacket } from '../aiPackets.js'
import { getObjectLightIntensity } from '../combat/hitChance.js'
import { hitSpatialTrigger, Obj, ObjType, objectIsWeapon, SerializedObj, setObjectOpen } from './Obj.js'
import { WeaponObj } from './items.js'
import { fixCorpseArt } from '../critter/deathAnim.js'

// CE scripts.cc _scr_SpatialsEnabled — off while a spatial_p_proc runs
let spatialsBusy = false

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
    'stats',
    'skills',
    'aiNum',
    'teamNum',
    'hostile',
    'isPlayer',
    'dead',
    'anim',
    'crippledLeftArm',
    'crippledRightArm',
    'crippledLeftLeg',
    'crippledRightLeg',
    'poisonLevel',
    'radiationLevel',
    'radiated',
    'addictions',
    'addictedState',
    'customAiOverrides',
]

export class Critter extends Obj {
    stats!: StatSet
    skills!: SkillSet

    leftHand?: WeaponObj // Left-hand object slot
    rightHand?: WeaponObj // Right-hand object slot

    // State the combat AI, skills and the player add at run time. Declared without initialisers,
    // so the compiled class is unchanged; only the type knows them.
    whoHitMe?: Critter | null // CE critter.combat.whoHitMe (combat/whoHitMe.ts)
    aiLastTarget?: Critter | null
    aiLastItem?: Obj | null
    aiFriendlyDead?: Critter | null
    fleeing?: boolean // CE CRITTER_MANUEVER_FLEEING
    engaging?: boolean // CE CRITTER_MANUEVER_ENGAGING
    disengaging?: boolean // CE CRITTER_MANUEVER_DISENGAGING
    damageLastTurn?: number // CE critter.combat.damageLastTurn
    _aiTurn?: any
    isSneaking?: boolean // the player's Sneak (skillUse.ts)
    sneakWorking?: boolean
    gender?: string // the player's (Player sets it)
    armor?: Obj | null // the player's armour slot (Player sets it)
    activeHand?: 'leftHand' | 'rightHand' // the player's (Player sets it)
    traits?: string[] // the player's (Player sets it)

    type: ObjType = 'critter'
    anim = 'idle'
    path: any = null // Holds pathfinding objects
    AP: ActionPoints | null = null

    aiNum = -1 // AI packet number
    teamNum = -1 // AI team number (TODO: implement this)
    ai: AI | null = null // AI packet
    // Per-field overrides on top of the resolved AI packet, set via the
    // companion "Custom" behavior screen (uiCompanion.ts /
    // setCompanionCustomSetting). Only meaningful when aiNum currently
    // points at a disposition='custom' packet — cleared when switching to a
    // named preset (Berserk/Aggressive/Defensive/Coward). See AI.ts
    // constructor for where these get merged onto the base packet.
    customAiOverrides: Partial<AiPacket> | null = null
    hostile = false // Currently engaging an enemy?
    // Wander origin (lazily captured on first wander tick) — used to enforce
    // per-type radius caps. CE ref: ai.cc wander_type 1/2/3 short/large/unrestricted.
    // True while an active Stealth Boy II is in either hand slot.
    // Derived, not serialized — recomputed via miscItem.ts refreshStealthState().
    stealthActive = false

    isPlayer = false // Is this critter the player character?
    dead = false // Is this critter dead?
    perks: string[] = [] // List of acquired perks
    nextIdleAnimTime = 0 // performance.now() after which the next idle cycle begins; 0 = uninitialised
    critDeath = false // a critical with DAM_DEAD hit this critter (criticalEffects 'death'); critterDamage kills it
    knockdownAnim: 'knockdownFront' | 'knockdownBack' | null = null // fall played by the last knockdown

    // CE critter->data.critter.combat.results: the DAM_* bits (src/combat/results.ts).
    // The cripple / blind / prone accessors below read and write them.
    injuryFlags = 0

    private resultBit(bit: number): boolean {
        return (this.injuryFlags & bit) !== 0
    }
    private setResultBit(bit: number, on: boolean): void {
        this.injuryFlags = (on ? this.injuryFlags | bit : this.injuryFlags & ~bit) >>> 0
    }
    get crippledLeftLeg(): boolean {
        return this.resultBit(0x04)
    } // DAM_CRIP_LEG_LEFT
    set crippledLeftLeg(v: boolean) {
        this.setResultBit(0x04, !!v)
    }
    get crippledRightLeg(): boolean {
        return this.resultBit(0x08)
    } // DAM_CRIP_LEG_RIGHT
    set crippledRightLeg(v: boolean) {
        this.setResultBit(0x08, !!v)
    }
    get crippledLeftArm(): boolean {
        return this.resultBit(0x10)
    } // DAM_CRIP_ARM_LEFT
    set crippledLeftArm(v: boolean) {
        this.setResultBit(0x10, !!v)
    }
    get crippledRightArm(): boolean {
        return this.resultBit(0x20)
    } // DAM_CRIP_ARM_RIGHT
    set crippledRightArm(v: boolean) {
        this.setResultBit(0x20, !!v)
    }
    get isBlinded(): boolean {
        return this.resultBit(0x40)
    } // DAM_BLIND
    set isBlinded(v: boolean) {
        this.setResultBit(0x40, !!v)
    }
    // CE _critter_is_prone: DAM_KNOCKED_OUT | DAM_KNOCKED_DOWN
    get isKnockedDown(): boolean {
        return this.resultBit(0x03)
    }

    // Poison / radiation / addiction (FO2-CE ref: critter.cc, radiation.cc)
    poisonLevel: number = 0
    radiationLevel: number = 0
    // CE CRITTER_RADIATED (proto data flag): set when a dose is taken, consumed by the
    // nightly radiation check (src/radiation.ts checkRads).
    radiated: boolean = false
    addictions: string[] = [] // legacy (pre-2026-10-06 saves); addiction state now lives in the CE GVARs
    // CE DUDE_STATE_ADDICTED (critter.cc dudeEnableState) — drives the ADDICT indicator.
    addictedState: boolean = false

    // Combat status effect counters / flags

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
                const sk = mobj.skills
                const proto = sk.protoDefaults || !mobj.isPlayer
                const base =
                    proto && !sk.protoDefaults ? SkillSet.withProtoDefaults(sk.baseSkills ?? {}) : sk.baseSkills
                obj.skills = new SkillSet(base, sk.tagged, sk.skillPoints)
                obj.skills.hasTagPerk = !!sk.hasTagPerk
                obj.skills.protoDefaults = proto
                dbgWarn('object', '[Deserialize] skill set: %o to: %o', mobj.skills, obj.skills)
            }

            // Re-equip weapons from the deserialized inventory so leftHand/rightHand
            // point at the re-created inventory objects (not stale pre-deserialize refs).
            // CE ref: inventory.cc critterGetItem1/critterGetItem2 — use hand-slot
            // flags (OBJECT_IN_LEFT_HAND=0x1000000, OBJECT_IN_RIGHT_HAND=0x2000000).
            // Any item can be in a hand (a flare, a Stealth Boy), not only weapons.
            obj.leftHand = Critter.makeFist()
            obj.rightHand = Critter.makeFist()
            for (const inv of obj.inventory) {
                const w = inv as WeaponObj
                if (inv.flags & 0x1000000)
                    obj.leftHand = w // OBJECT_IN_LEFT_HAND
                else if (inv.flags & 0x2000000) obj.rightHand = w // OBJECT_IN_RIGHT_HAND
            }
        } else if (typeof mobj.extra?.hp === 'number') {
            // CE: the map file stores each critter's current HP (data.critter.hp), and
            // critterIsDead is HP <= 0 — the corpses a map starts with (Enclave soldiers in
            // the Military Base …) are critters with 0 HP and a single-frame death FID.
            const hp: number = mobj.extra.hp
            if (hp <= 0) {
                obj.stats.setBase('HP', 0)
                obj.dead = true
                obj.injuryFlags = (obj.injuryFlags | 0x80) >>> 0 // DAM_DEAD
                obj.art = fixCorpseArt(mobj.art) // the map's death frame (init() set idle); violence level
                obj.frame = 0
                obj.anim = 'dead'
            } else {
                obj.stats.setBase('HP', Math.min(hp, obj.getStat('Max HP')))
            }
        }

        return obj
    }

    // CE critter.cc critterGetName: scrname.msg 101 + the script's scripts.lst index wins over
    // the proto name when it is non-empty (the dude keeps his own name).
    protected override scriptAttached(): void {
        if (this.isPlayer || !this.script) return
        const number = scriptNumberOf(this.script) // scripts.lst index + 1
        if (number === 0) return
        const name = getMessage('scrname', 100 + number)
        if (name) this.name = name
    }

    // CE object.cc objectGetName → critterGetName
    override getName(): string {
        return this.name || super.getName()
    }

    init() {
        super.init()

        this.stats = StatSet.fromPro(this.pro)
        this.skills = SkillSet.fromPro(this.pro!.extra.skills)
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

        // CE ref: inventory.cc critterGetItem1/critterGetItem2 — equipment state
        // is encoded as flags on inventory items: OBJECT_IN_LEFT_HAND=0x1000000,
        // OBJECT_IN_RIGHT_HAND=0x2000000.  fomap.py exports these flags, so we
        // can faithfully restore which weapon each NPC had drawn on map load.
        this.leftHand = Critter.makeFist()
        this.rightHand = Critter.makeFist()
        for (const inv of this.inventory) {
            const w = inv as WeaponObj
            if (inv.flags & 0x1000000)
                this.leftHand = w // OBJECT_IN_LEFT_HAND
            else if (inv.flags & 0x2000000) this.rightHand = w // OBJECT_IN_RIGHT_HAND
        }
        // CE: a critter other than the player acts with its right-hand item
        // (critterGetItem2 — the fid's weapon code, HIT_MODE_RIGHT_WEAPON_*).
        if (!this.isPlayer && this.rightHand?.pid !== undefined) this.activeHand = 'rightHand'

        // set them in their proper idle state for the weapon
        this.art = this.getAnimation('idle')
    }

    blocks(): boolean {
        return this.dead !== true && this.visible !== false
    }

    inAnim(): boolean {
        return !!(this.path || this.animCallback)
    }

    static makeFist(): WeaponObj {
        const f = new WeaponObj()
        f.type = 'item'
        f.subtype = 'weapon'
        f.weapon = new Weapon(null as unknown as WeaponObj)
        return f
    }

    /** CE ref: critter.cc critterEquipCurrent — equip first two weapons from inventory. */
    equipFromInventory(): void {
        this.leftHand = undefined
        this.rightHand = undefined
        for (const inv of this.inventory) {
            if (inv.subtype !== 'weapon') continue
            const w = inv as WeaponObj
            if (!w.weapon?.canEquip(this)) continue
            if (this.leftHand === undefined) this.leftHand = w
            else if (this.rightHand === undefined) {
                this.rightHand = w
                break
            }
        }
        if (!this.leftHand) this.leftHand = Critter.makeFist()
        if (!this.rightHand) this.rightHand = Critter.makeFist()
    }

    // CE animation.cc _dude_run: the dude's run command ends Sneak (unless Silent Running)
    stopSneakToRun(): void {
        if (!this.isPlayer || !this.isSneaking || this.hasPerk('Silent Running')) return
        this.isSneaking = false
        this.sneakWorking = false
        Scripting.timeEventList.splice(
            0,
            Scripting.timeEventList.length,
            ...Scripting.timeEventList.filter((e) => !(e.obj === this && e.userdata === 'sneak')),
        )
    }

    move(position: Point, curIdx?: number, signalEvents = true): boolean {
        // CE ref: animation.cc _object_move — doors on the way are opened (canUseDoor)
        if (world.gMap) {
            for (const obj of world.gMap.objectsAtPosition(position)) {
                // _object_move: a blocking door the critter canUseDoor gets _obj_use_door
                if (obj.subtype === 'door' && !obj.open && !obj.jammed && canUseDoor(this, obj)) {
                    setObjectOpen(obj, true, false, true)
                }
            }
        }

        if (!super.move(position, curIdx, signalEvents)) {
            return false
        }

        // CE scripts.cc scriptsExecSpatialProc: not for hidden or flat objects or tiles below
        // 10, and not while a spatial_p_proc is already running or map_enter / map_update
        // scripts run (_scr_SpatialsEnabled).
        if (
            Config.engine.doSpatials !== false &&
            this.visible !== false &&
            ((this.flags ?? 0) & 0x08) === 0 && // OBJECT_FLAT
            toTileNum(position) >= 10 &&
            !spatialsBusy &&
            Scripting.spatialsEnabled()
        ) {
            spatialsBusy = true
            try {
                const hitSpatials = hitSpatialTrigger(position, this.elevation ?? world.gMap!.currentElevation)
                for (let i = 0; i < hitSpatials.length; i++) {
                    const spatial = hitSpatials[i]
                    dbg(
                        'object',
                        `[Object] triggered spatial ${spatial.script} (range=${spatial.range}) @ (${spatial.position.x}, ${spatial.position.y})`,
                    )
                    Scripting.spatial(spatial, this)
                }
            } finally {
                spatialsBusy = false
            }
        }

        return true
    }

    canRun(): boolean {
        return this.hasAnimation('run')
    }

    getSkill(skill: string): number {
        // FO2-CE ref: skill.cc skillGetValue() — player gets tagged/trait/perk/difficulty bonuses
        return this.skills.get(skill, this.stats, {
            isPlayer: this.isPlayer,
            perks: this.perks,
            // CE traitGetSkillModifier — the dude's traits (Gifted, Good Natured) apply always
            traits: this.isPlayer ? this.traits : undefined,
            // CE perkGetSkillModifier: Ghost reads objectGetLightIntensity(gDude).
            lightIntensity:
                skill === 'Sneak' && this.perks.includes('Ghost') && world.player
                    ? getObjectLightIntensity(world.player as Critter, true)
                    : undefined,
        })
    }

    // CE stat.cc critterGetStat — the stat plus its context modifiers: blindness −5 PER,
    // overloaded −(excess / 40 + 1) AP, and age growing with the game years.
    getStat(stat: string): number {
        const value = this.stats.get(stat)
        switch (stat) {
            case 'PER':
                return this.isBlinded ? Math.max(1, value - 5) : value // DAM_BLIND
            case 'AP': {
                // CE stat.cc:200: critterGetStat(CARRY_WEIGHT) — the traits included (Small Frame)
                const remaining = this.getStat('Carry') - this.getInventoryWeight()
                return remaining < 0 ? Math.max(1, value - (Math.trunc(-remaining / 40) + 1)) : value
            }
            case 'Age':
                return value + Math.floor((world.gameTickTime ?? 0) / 315360000) // GAME_TIME_TICKS_PER_YEAR
        }
        return value
    }

    getEquippedArmor(): Obj | null {
        // Player stores armor in a dedicated slot; NPCs wear only the inventory armor
        // flagged OBJECT_WORN (CE inventory.cc critterGetArmor) — carried armor gives nothing.
        const self = this
        if (self.armor !== undefined) return self.armor
        for (const item of this.inventory) {
            if (((item.flags ?? 0) & 0x4000000) !== 0) return item // OBJECT_WORN
        }
        return null
    }

    // CE stat.cc critterGetStat: the worn armor's DR / DT only
    getArmorDR(damageType: string): number {
        return this.getEquippedArmor()?.pro?.extra?.stats?.['DR ' + damageType] ?? 0
    }

    getArmorDT(damageType: string): number {
        return this.getEquippedArmor()?.pro?.extra?.stats?.['DT ' + damageType] ?? 0
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
        const info = assets.imageInfo![this.art]
        if (info === undefined) {
            throw new Error('No image map info for: ' + this.art)
        }
        return info.directionOffsets[this.orientation!]
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
            path = world.gMap!.recalcPath(this.position, target, undefined, this)
        }

        if (path.length === 0) {
            // no path
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
        // CE animation.cc animationRegisterRunToTile / RunToObject: an encumbered critter walks
        // (a party member, the dude included, reports it: misc.msg 8000 / 8001); so do crippled legs and the dude
        // sneaking without Silent Running (Sneak stays on — only _dude_run, the explicit run
        // command, ends it: stopSneakToRun)
        if (running && this.getInventoryWeight() > this.getStat('Carry')) {
            running = false
            if (this.isPlayer) uiLog(getMessage('misc', 8000) ?? 'You are overloaded.')
            else if (world.gParty?.isPartyMember(this)) {
                const fmt = getMessage('misc', 8001) ?? '%s is overloaded.'
                uiLog(fmt.replace('%s', this.getName()))
            }
        }
        if (running && (this.crippledLeftLeg || this.crippledRightLeg)) running = false
        if (running && this.isPlayer && this.isSneaking && !this.hasPerk('Silent Running')) running = false

        // Critters without a walk/run FRM (spore plants, floaters' stand-only art) can't
        // move: CE _object_move does nothing when artLock(sad->fid) fails (animation.cc).
        const moveArt = this.getAnimation(running ? 'run' : 'walk')
        if (!assets.imageInfo![moveArt]) {
            dbgWarn('movement', `[walkTo] ${this.name || this.pid} has no move art ${moveArt} — not moving`)
            return false
        }

        // set up animation properties
        const actualTarget = { x: path[path.length - 1][0], y: path[path.length - 1][1] }
        this.path = { path: path, index: 1, target: actualTarget, partial: 0 }
        this.anim = running ? 'run' : 'walk'
        this.art = moveArt
        this.animCallback = callback || (() => this.clearAnim())
        this.frame = 0
        this.lastFrameTime = window.performance.now()
        this.shift = { x: 0, y: 0 }
        const dir = directionOfDelta(this.position.x, this.position.y, path[1][0], path[1][1])
        if (dir == null) {
            throw Error()
        }
        this.orientation = dir
        // CE ref: animation.cc _object_move (field_20 == -2000) — the walk starts on the
        // hex centre (objectSetLocation) and then adds frame 0's FRM delta.
        if (Config.engine.walkModel !== 'dh2') {
            const d0 = assets.imageInfo![this.art]?.frameOffsets[dir]?.[0]
            if (d0) this.shift = { x: d0.x, y: d0.y }
        }

        return true
    }

    walkInFrontOf(targetPos: Point, callback?: () => void): boolean {
        const path = world.gMap!.recalcPath(this.position, targetPos, false, this)
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

        return this.walkTo(targetPos, running, callback, undefined, path)
    }

    // CE actions.cc _action_use_an_object / actionPickUp / _action_loot_container /
    // actionUseSkill: out of combat a walk up to the target, then `action`. In combat the
    // player acts only on their turn and walks only as far as the AP allow
    // (animationRegisterMoveToObject(…, combat.ap)), paying the move; then
    // _check_scenery_ap_cost takes `apCost` AP (3; proto.msg 700 when short). CE walks
    // as far as it can and then fails; DH2 refuses a walk the AP can't finish.
    // `exactHex`: walk onto that hex instead of next to the target (CE _action_climb_ladder:
    // the ladder's SE neighbour)
    walkInFrontOfToAct(targetPos: Point, action: () => void, apCost = 3, exactHex?: Point): void {
        const ap = this.AP
        const walkThere = (then: () => void): boolean => {
            if (!exactHex) return this.walkInFrontOf(targetPos, then)
            if (this.position.x === exactHex.x && this.position.y === exactHex.y) {
                then()
                return true
            }
            return this.walkTo(exactHex, Config.engine.doAlwaysRun || hexDistance(this.position, exactHex) >= 5, then)
        }
        if (!world.inCombat || !this.isPlayer || !ap) {
            walkThere(action)
            return
        }
        if (!(world.combat?.inPlayerTurn || Config.combat.allowWalkDuringAnyTurn)) return
        const redraw = () => drawAP(ap.getAvailableCombatAP(), ap.getTotalMaxAP(), ap.move)
        const act = () => {
            if (apCost > 0) {
                if (ap.getAvailableCombatAP() < apCost) {
                    uiLog(getProtoMsg(700) ?? "You don't have enough action points.")
                    return
                }
                ap.subtractCombatAP(apCost)
                redraw()
            }
            action()
        }
        const path = exactHex
            ? world.gMap!.recalcPath(this.position, exactHex, true, this)
            : world.gMap!.recalcPath(this.position, targetPos, false, this)
        if (path.length === 0 && !(exactHex && this.position.x === exactHex.x && this.position.y === exactHex.y)) return
        const steps = exactHex ? Math.max(0, path.length - 1) : Math.max(0, path.length - 2) // walkInFrontOf stops next to the target
        if (steps > ap.getAvailableMoveAP()) {
            uiLog(getProtoMsg(700) ?? "You don't have enough action points.")
            return
        }
        if (!walkThere(act)) return
        if (steps > 0) {
            ap.subtractMoveAP(steps)
            redraw()
        }
    }

    serialize(): SerializedCritter {
        const obj = <SerializedCritter>super.serialize()

        for (const prop of SERIALIZED_CRITTER_PROPS) {
            ;(obj as any)[prop] = (this as any)[prop]
        }

        return obj
    }
}
