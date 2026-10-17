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

// Obj base class + top-of-file helpers + SerializedObj interface.
// Split out of object.ts per wiki/ts-split-refactor.md §2.

import { playCharSfx, playOpenSfx, sfxBuildCharName, SCENERY_SOUND_EFFECT } from '../sfxNames.js'
import { ammoFromRounds, ammoGetCapacity, ammoGetQuantity, ammoMergeInto, ammoSplitOff, initWeaponAmmo } from '../weaponAmmo.js'
import type { Proto } from '../proto_types.js'

// Object kinds as getPROTypeName() names them (plus map-object kinds that carry no proto).
export type ObjType = 'item' | 'critter' | 'scenery' | 'wall' | 'tile' | 'misc' | 'spatial'
import { ANIM_STAND, critterDamage } from '../critter.js'
import { getLstId, lookupScriptName } from '../data.js'
import { Events } from '../events.js'
import { hexDirectionTo, hexDistance, hexIsInFrontOf, hexNeighbors, Point } from '../geometry.js'
import { computeExplosionDamage, explosionRingCritters, scriptsExplodeScenery } from '../combat/explosion.js'
import globalState from '../globalState.js'
import { lazyLoadImage } from '../images.js'
import { Lightmap } from '../lightmap.js'
import { dbg, dbgWarn } from '../logger.js'
import { getPROSubTypeName, getPROTypeName, loadPRO, lookupArt, makePID } from '../pro.js'
import { Scripting } from '../scripting.js'
import { fromTileNum, toTileNum } from '../tile.js'
import { uiLoot, uiLog } from '../ui.js'
import { getMessage, getRandomInt, skillRoll, RollResult } from '../util.js'
import { uiGetTimer } from '../ui_barter/swap.js'
import { Config } from '../config.js'
import { isChargedMiscItem, useChargedMiscItem } from '../miscItem.js'
import { drawHP } from '../ui_hud.js'
import type { Critter } from './Critter.js'
// Late-bound factory hooks — set by factories.ts at module-init time.
// Direct static import would create a cycle: Obj.ts → factories.ts → items.ts
// → (extends Obj at module init) → TDZ on Obj. See wiki/ts-split-refactor.md
// §2 "Circular-dependency risks" — factories.ts is required to depend on
// Obj.ts and items.ts requires Obj.ts at module init, so the edge that has
// to be lazy is Obj.ts → factories.ts.
let _createObjectWithPID: ((pid: number, sid?: number) => Obj) | null = null
let _objFromMapObject: ((mobj: any, deserializing?: boolean) => Obj) | null = null
let _deserializeObj: ((mobj: SerializedObj) => Obj) | null = null
export function _registerObjectFactories(fns: {
    createObjectWithPID: typeof _createObjectWithPID
    objFromMapObject: typeof _objFromMapObject
    deserializeObj: typeof _deserializeObj
}): void {
    _createObjectWithPID = fns.createObjectWithPID
    _objFromMapObject = fns.objFromMapObject
    _deserializeObj = fns.deserializeObj
}
const createObjectWithPID = (pid: number, sid?: number): Obj => _createObjectWithPID!(pid, sid)
const objFromMapObject = (mobj: any, deserializing?: boolean): Obj => _objFromMapObject!(mobj, deserializing)
const deserializeObj = (mobj: SerializedObj): Obj => _deserializeObj!(mobj)

// Collection of functions for working with game objects

let _lastObjectUID = 0

export function objectIsWeapon(obj: any): boolean {
    if (obj === undefined || obj === null) {
        return false
    }
    //return obj.type === "item" && obj.pro.extra.subType === 3 // weapon subtype
    return obj.weapon !== undefined
}

function objectFindItemIndex(obj: Obj, item: Obj): number {
    for (let i = 0; i < obj.inventory.length; i++) {
        if (obj.inventory[i] === item) {
            return i
        }
    }
    return -1
}

export function cloneItem(item: Obj): Obj {
    const clone = Object.create(Object.getPrototypeOf(item))
    Object.assign(clone, item)
    if (item.inventory) {
        clone.inventory = item.inventory.map(cloneItem)
    }
    return clone
}

function objectSwapItem(a: Obj, item: Obj, b: Obj, amount: number) {
    // swap item from a -> b
    if (amount === 0) {
        return
    }

    const idx = objectFindItemIndex(a, item)
    if (idx === -1) {
        throw 'item (' + item + ') does not exist in a'
    }
    if (amount !== undefined && amount < item.amount) {
        // just deduct amount from a and give amount to b
        item.amount -= amount
        const moved = cloneItem(item)
        ammoSplitOff(item, moved) // CE itemRemove: the top ammo box goes with the moved boxes
        b.addInventoryItem(moved, amount)
    } else {
        // just swap them
        a.inventory.splice(idx, 1)
        b.addInventoryItem(item, amount || 1)
    }
}

export function objectGetDamageType(obj: any): string {
    // TODO: any (where does dmgType go? WeaponObj?)
    if (obj.dmgType !== undefined) {
        return obj.dmgType
    }
    throw 'no damage type for obj: ' + obj
}

// CE item.cc explosiveActivate / _queue_do_explosion_: dynamite (51 → armed 206) and
// plastic explosives (85 → 209); damage 30-50 / 40-80, +10 each with the player's
// Demolition Expert.
const EXPLOSIVES: { [pid: number]: { active: number; min: number; max: number } } = {
    51: { active: 206, min: 30, max: 50 },
    85: { active: 209, min: 40, max: 80 },
}

// CE proto_instance.cc _obj_use_explosive — set the timer (10-180 s), then a Traps
// roll (none with Demolition Expert): success arms it for 10 × seconds ticks, a
// failure goes off early (half the time), a critical failure at once — both with
// "Due to your inept handling..." (misc.msg 4000). The armed explosive stays where it
// is: carried, it explodes on whoever carries it.
async function useExplosive(obj: Obj, source: Critter): Promise<void> {
    if (!source.isPlayer) return
    const desc = EXPLOSIVES[obj.pid]
    if (!desc) {
        // An armed explosive (206 / 209): CE OBJECT_QUEUED → "The timer is already ticking!"
        if (obj.pid === 206 || obj.pid === 209) uiLog(getMessage('proto', 590) ?? 'The timer is already ticking!')
        return
    }
    if (Scripting.timeEventList.some((e) => e.obj === obj && (e.userdata === 'explosion' || e.userdata === 'explosionFailure'))) {
        uiLog(getMessage('proto', 590) ?? 'The timer is already ticking!') // OBJECT_QUEUED
        return
    }
    const seconds = await uiGetTimer(obj)
    if (seconds === -1) return
    uiLog(getMessage('proto', 589) ?? 'You set the timer.')

    // explosiveActivate: the armed proto
    const pro = loadPRO(desc.active, desc.active & 0xffff)
    if (pro) {
        obj.pid = desc.active
        obj.pro = pro
        obj.art = lookupArt(makePID(pro.frmType, pro.frmPID))
        const invPID = ((pro as any).extra?.invFRM ?? -1) & 0xffff
        const invName = invPID !== 0xffff ? getLstId('art/inven/inven', invPID) : null
        if (invName) obj.invArt = 'art/inven/' + invName.split('.')[0]
        obj.name = getMessage('pro_item', pro.textID) ?? obj.name
    }

    let delay = 10 * seconds
    const roll = source.hasPerk('Demolition Expert') ? RollResult.Success : skillRoll(source, 'Traps').roll
    let failure = false
    if (roll === RollResult.CriticalFailure) { delay = 0; failure = true }
    else if (roll === RollResult.Failure) { delay = Math.trunc(delay / 2); failure = true }
    dbg('object', `[Object] explosive armed: ${seconds}s, Traps ${RollResult[roll]}, fires in ${delay} ticks`)
    const fire = () => explosiveDetonate(obj, desc.min, desc.max, failure)
    if (delay === 0) fire()
    // CE queue.cc _queue_explode_exit: leaving the map sets it off at once, unanimated
    else Scripting.timeEventList.push({ obj, ticks: delay, userdata: failure ? 'explosionFailure' : 'explosion', fn: fire,
        leaveMap: () => { explosiveDetonate(obj, desc.min, desc.max, false, false); return true } })
}

// CE queue.cc explosionEventProcess / explosionFailureEventProcess → _queue_do_explosion_:
// at the owner's tile when carried.
function explosiveDetonate(obj: Obj, min: number, max: number, failure: boolean, animate = true): void {
    const gMap = globalState.gMap
    if (!gMap) return
    if (failure) uiLog(getMessage('misc', 4000) ?? 'Due to your inept handling, the explosive detonates prematurely.')
    const player = globalState.player
    if (player?.hasPerk('Demolition Expert')) { min += 10; max += 10 }
    const owner = gMap.getObjects().find((o) => o.type === 'critter' && (o as Critter).inventory.includes(obj)) as Critter | undefined
        ?? (player && player.inventory.includes(obj) ? player : undefined)
    if (owner) {
        const idx = owner.inventory.indexOf(obj)
        if (idx !== -1) owner.inventory.splice(idx, 1)
        obj.position = { ...owner.position }
        gMap.addObject(obj)
    }
    obj.explode(player ?? null, min, max, 3, animate)
}

// Set the object (door/container) open/closed; returns true if possible, false if not (e.g. locked)
export function setObjectOpen(obj: Obj, open: boolean, loot = true, signalEvent = true): boolean {
    if (!obj.isDoor && !obj.isContainer) {
        return false
    }

    // Open/closable doors/containers
    // TODO: Door/Container subclasses
    if (obj.locked) {
        // CE ref: proto_instance.cc:1712 _obj_use_door — SLDOORS<id> for locked doors;
        //         proto_instance.cc:1804 — ILCNTNR<id> + msg 487 for locked containers
        playOpenSfx(obj, SCENERY_SOUND_EFFECT.locked)
        if (obj.isContainer) uiLog('It is locked.')
        return false
    }

    obj.open = open
    // CE ref: proto_instance.cc:1764/1773 (doors) and :1842/1846 (containers) —
    // sfxBuildOpenName(obj, OPEN / CLOSED): S{O,C}DOORS<id> / I{O,C}CNTNR<id>.
    playOpenSfx(obj, open ? SCENERY_SOUND_EFFECT.open : SCENERY_SOUND_EFFECT.closed)

    if (signalEvent) {
        Events.emit('objSetOpen', { obj, open })
        Events.emit(open ? 'objOpen' : 'objClose', { obj })
    }

    // Animate open/closed
    obj.singleAnimation(!open, function () {
        obj.anim = null
        if (loot && obj.isContainer && open) {
            // loot a container
            uiLoot(obj)
        }
    })

    return true
}

// Toggle the object (door/container) open/closed; returns true if possible, false if not (e.g. locked)
export function toggleObjectOpen(obj: Obj, loot = true, signalEvent = true): boolean {
    return setObjectOpen(obj, !obj.open, loot, signalEvent)
}

function objectFindIndex(obj: Obj): number {
    return globalState.gMap.getObjects().findIndex((object) => object === obj)
}

// CE ref: proto_instance.cc:2171 objectUnjamAll — clears jammed flag on all map objects.
// Called by the midnight queue event (GTC5).
export function objectUnjamAll(): void {
    if (!globalState.gMap) return
    for (const obj of globalState.gMap.getObjects()) {
        if (obj.jammed) obj.jammed = false
    }
}

function objectZCompare(a: Obj, b: Obj): number {
    // CE ref: tile.cc tileIsInFrontOf — screen-space hex test correct for all
    // 6 hex directions. Falls back to hex-y / hex-x ordering only when both
    // tiles project to identical screen coordinates (shared tile), with walls
    // sorted underneath so they render first.
    if (a.position.x === b.position.x && a.position.y === b.position.y) {
        if (a.type === 'wall' && b.type !== 'wall') return -1
        if (b.type === 'wall' && a.type !== 'wall') return 1
        return 0
    }
    const aInFront = hexIsInFrontOf(a.position, b.position)
    const bInFront = hexIsInFrontOf(b.position, a.position)
    if (aInFront && !bInFront) return 1   // a renders later → drawn on top
    if (bInFront && !aInFront) return -1
    // Ambiguous (neither strictly in front) — fall back to a stable ordering.
    if (a.position.y !== b.position.y) return a.position.y - b.position.y
    return a.position.x - b.position.x
}

function objectZOrder(obj: Obj, index: number): void {
    const oldIdx = index !== undefined ? index : objectFindIndex(obj)
    if (oldIdx === -1) {
        dbgWarn('object', '[Object] objectZOrder: no such object')
        return
    }

    // TOOD: mutable/potentially unsafe usage of getObjects
    const objects = globalState.gMap.getObjects()

    objects.splice(oldIdx, 1) // remove the object...

    let inserted = false
    for (let i = 0; i < objects.length; i++) {
        const zc = objectZCompare(obj, objects[i])
        if (zc === -1) {
            objects.splice(i, 0, obj) // insert at new index
            inserted = true
            break
        }
    }

    if (!inserted) {
        // couldn't find a spot, just add it in
        objects.push(obj)
    }
}

export function zsort(objects: Obj[]): void {
    objects.sort(objectZCompare)
}

// Spatial trigger lookup — shared by Obj.explode and Critter.move.
export function hitSpatialTrigger(position: Point): any {
    // TODO: return type (SpatialTrigger)
    return globalState.gMap.getSpatials().filter((spatial) => hexDistance(position, spatial.position) <= spatial.range)
}

export interface SerializedObj {
    uid: number

    pid: number
    pidID: number
    type: string
    pro: any
    flags: number
    art: string
    frmPID: number
    orientation: number
    visible: boolean

    extra: any

    script: string
    _script: Scripting.SerializedScript | undefined

    name: string
    subtype: string
    invArt: string

    frame: number

    amount: number
    position: Point
    inventory: SerializedObj[]

    lightRadius: number
    lightIntensity: number

    miscOn?: boolean
    miscCharges?: number
    ammoQuantity?: number
    ammoTypePid?: number
}

export class Obj {
    uid = -1 // Unique ID given to all objects, to distinguish objects with the same PIDs

    pid: number // PID (Prototype IDentifier)
    pidID: number // ID (not type) part of the PID
    type: ObjType = null // getPROTypeName(): item/critter/scenery/wall/tile/misc
    pro: Proto = null // PRO object (shared per pid — see weaponAmmo.ts for per-object state)
    flags = 0 // Flags from PRO; may be overriden by map objects
    art: string // TODO: Path // Art path
    frmPID: number = null // Art FID
    orientation: number = null // Direction the object is facing
    visible = true // Is the object visible?
    open = false // Is the object open? (Mainly for doors)
    locked = false // Is the object locked? (Mainly for doors)
    jammed = false // Is the lock jammed? (CE DOOR_FLAG_JAMMGED / OBJ_JAMMED)

    extra: { [key: string]: any } // per-object map data (fomap.py item/scenery/misc extras)

    script: string // Script name
    _script: Scripting.Script | undefined // Live script object

    // TOOD: unify these
    name: string // = "<unnamed obj>"; // Only for some critters at the moment.
    subtype: string // Some objects, like items and scenery, have subtypes
    invArt: string // Art path used for in-inventory image

    anim: string | null = null // Current animation name ('idle', 'walk', 'attack', ...)
    animCallback: () => void | null = null // Callback when current animation is finished playing
    frame = 0 // Animation frame index
    lastFrameTime = 0 // Time since last animation frame played

    // Frame shift/offset
    // For static animations, this is just null (effectively just the frame offset as declared in the .FRM),
    // but for walk/run animations it is the sum of frame offsets between the last action frame
    // and the current frame.
    shift: Point = null

    // Carry-offset accumulated across FRM art transitions so that switching FRMs never causes a
    // visual jump. Mirrors CE's obj->x/y (object.cc) which is reset on objectSetLocation (tile
    // change during walk) and otherwise carries forward. Reset to {0,0} on walk end; updated at
    // every art switch via the exact zero-jump formula (see Critter.staticAnimation / clearAnim).
    artOffset: Point = { x: 0, y: 0 }
    // CE obj->x/y sub-tile offset while not walking (Config.engine.animOffsetModel 'ce');
    // see critterAnimation.ts ceOffsetAdd / ceStandOffset.
    ceOff: Point = { x: 0, y: 0 }

    // Outline color, if outlined
    outline: string | null = null

    amount = 1 // TODO: Where does this belong? Items and misc seem to have it, or is Money an Item?
    position: Point = { x: -1, y: -1 }
    elevation: number = 0 // CE ref: obj_types.h Object.elevation — which map level this object is on
    inventory: Obj[] = []

    // TODO: verify
    lightRadius = 0
    lightIntensity = 655

    miscOn?: boolean      // CE ref: item.cc miscItemIsOn() — true while trickle event is queued
    miscCharges?: number  // CE ref: item.cc — remaining charge count (Stealth Boy / Geiger Counter)
    ammoQuantity?: number // CE obj->data.item.weapon.ammoQuantity — rounds loaded (weapons; see weaponAmmo.ts)
    ammoTypePid?: number  // CE obj->data.item.weapon.ammoTypePid — loaded ammo type

    static fromPID(pid: number, sid?: number): Obj {
        return Obj.fromPID_(new Obj(), pid, sid)
    }

    static fromPID_<T extends Obj>(obj: T, pid: number, sid?: number): T {
        dbg('object', `[Object] fromPID: pid=${pid}, sid=${sid}`)
        const pidType = (pid >> 24) & 0xff
        const pidID = pid & 0xffff

        const pro: Proto = loadPRO(pid, pidID)
        obj.type = getPROTypeName(pidType)
        obj.pid = pid
        obj.pro = pro
        obj.flags = obj.pro.flags

        // TODO: Subclasses
        if (pidType == 0) {
            // item — PRO JSON uses camelCase 'subType' (from proto.py), not 'subtype'
            obj.subtype = getPROSubTypeName(pro.extra.subType ?? pro.extra.subtype)
            obj.name = getMessage('pro_item', pro.textID)

            const invPID = pro.extra.invFRM & 0xffff
            dbg('object', `[Object] invPID: ${invPID}, pid=${pid}`)
            if (invPID !== 0xffff) {
                obj.invArt = 'art/inven/' + getLstId('art/inven/inven', invPID).split('.')[0]
            }
        }

        if (obj.pro !== undefined) {
            obj.art = lookupArt(makePID(obj.pro.frmType, obj.pro.frmPID))
        } else {
            obj.art = 'art/items/RESERVED'
        }

        initWeaponAmmo(obj)
        obj.init()
        obj.loadScript(sid)
        return obj
    }

    static fromMapObject(mobj: any, deserializing = false): Obj {
        return Obj.fromMapObject_(new Obj(), mobj, deserializing)
    }

    static fromMapObject_<T extends Obj>(obj: T, mobj: any, deserializing = false): T {
        // Load an Obj from a map object
        //console.log("fromMapObject: %o", mobj)
        if (mobj.uid) {
            obj.uid = mobj.uid
        }
        obj.pid = mobj.pid
        obj.pidID = mobj.pidID
        obj.frmPID = mobj.frmPID
        obj.orientation = mobj.orientation
        if (obj.type === null) {
            obj.type = mobj.type
        }
        obj.art = mobj.art
        obj.position = mobj.position
        obj.lightRadius = mobj.lightRadius
        obj.lightIntensity = mobj.lightIntensity
        obj.subtype = mobj.subtype
        obj.amount = mobj.amount
        obj.inventory = mobj.inventory
        obj.script = mobj.script
        obj.extra = mobj.extra
        obj.miscOn = mobj.miscOn
        obj.miscCharges = mobj.miscCharges

        obj.pro = mobj.pro || loadPRO(obj.pid, obj.pidID)
        if (obj.subtype === 'ammo') {
            if (deserializing && mobj.ammoQuantity === undefined) {
                // saves from before the CE ammo model kept the rounds in `amount`
                ammoFromRounds(obj, obj.amount ?? 1)
            } else {
                // CE proto.cc objectDataRead: the map stores the top box's rounds
                obj.ammoQuantity = mobj.ammoQuantity ?? mobj.extra?.ammoCount
            }
        }
        if (obj.subtype === 'weapon') {
            if (deserializing && mobj.ammoQuantity === undefined && mobj.pro?.extra) {
                // Saves from before per-object ammo kept the loaded rounds/type in a
                // copy of the proto; take them from there and go back to the real proto.
                obj.ammoQuantity = mobj.pro.extra.rounds
                obj.ammoTypePid = mobj.pro.extra.ammoPID
                obj.pro = loadPRO(obj.pid, obj.pidID) ?? mobj.pro
            } else {
                obj.ammoQuantity = mobj.ammoQuantity
                obj.ammoTypePid = mobj.ammoTypePid
            }
            // CE proto.cc:585 objectDataRead — the map stores ammoQuantity/ammoTypePid.
            initWeaponAmmo(obj, mobj.extra?.ammoQuantity, mobj.extra?.ammoTypePid)
        }
        obj.flags = mobj.flags // NOTE: Tested with two objects in Mapper, map object flags seem to inherit PROs already and should thus use them

        // etc? TODO: check this!

        obj.init()

        if (deserializing) {
            obj.inventory = mobj.inventory.map((obj: SerializedObj) => deserializeObj(obj))
            obj.script = mobj.script

            if (mobj._script) {
                obj._script = Scripting.deserializeScript(mobj._script)
            }

            // TODO: Should we load the script if mobj._script does not exist?
        } else if (Config.engine.doLoadScripts) {
            obj.loadScript()
        }

        return obj
    }

    init() {
        if (this.uid === -1) {
            this.uid = _lastObjectUID++
        }

        //console.log("init: %o", this)
        if (this.inventory !== undefined) {
            // containers and critters
            this.inventory = this.inventory.map((obj) => objFromMapObject(obj))
        }
    }

    loadScript(sid = -1): void {
        let scriptName = null

        if (sid >= 0) {
            scriptName = lookupScriptName(sid)
        } else if (this.script) {
            scriptName = this.script
        } else if (this.pro?.extra) {
            // Resolve from proto. Scenery protos store the script id under
            // `scriptPID` (proto.py:65); items/critters use `scriptID`
            // (proto.py:101, 212). -1 means no script.
            const protoSid = this.pro.extra.scriptPID ?? this.pro.extra.scriptID ?? -1
            if (protoSid >= 0) {
                const lstIndex = protoSid & 0xffff
                // SID-keyed stub takes priority — works even if scripts.lst
                // resolution returns an unexpected name or throws.
                const sidStub = Scripting.loadScriptBySid(lstIndex)
                if (sidStub) {
                    dbg('object', `[Script] PRO sid=${lstIndex} → applying SID stub for pid=${this.pid}`)
                    this.script = sidStub.scriptName
                    this._script = sidStub
                    try { Scripting.initScript(this._script, this) } catch (e) {
                        dbgWarn('object', `[Script] initScript stub error for sid=${lstIndex}:`, e)
                    }
                    return
                }
                try {
                    scriptName = lookupScriptName(lstIndex)
                    dbg('object', `[Script] PRO sid=${lstIndex} → name='${scriptName}' (pid=${this.pid})`)
                } catch (e) {
                    dbgWarn('object', `[Script] PRO sid=${lstIndex} lookup failed for pid=${this.pid}:`, e)
                }
            }
        }

        if (scriptName != null) {
            if (Config.engine.doLogScriptLoads) {
                dbg('object', '[Script] loadScript: loading %s (sid=%d)', scriptName, sid)
            }
            // Guarded: many proto-derived script names point at .int files that
            // may not be present in this build. A missing file must not crash
            // the whole map load.
            let script: Scripting.Script | null = null
            try {
                script = Scripting.loadScript(scriptName)
            } catch (e) {
                dbgWarn('object', '[Script] loadScript: error loading %s (sid=%d):', scriptName, sid, e)
            }
            if (!script) {
                dbgWarn('object', '[Script] loadScript: failed for %s (sid=%d)', scriptName, sid)
            } else {
                this.script = scriptName
                this._script = script
                try {
                    Scripting.initScript(this._script, this)
                } catch (e) {
                    dbgWarn('object', '[Script] initScript error for %s:', scriptName, e)
                }
            }
        }
    }

    enterMap(): void {
        // TODO: do we updateMap?
        // TODO: is this correct?
        // TODO: map objects should be a registry, and this should be activated when objects
        // are added in. @important

        if (this._script) {
            Scripting.objectEnterMap(this, globalState.currentElevation, globalState.gMap.mapID)
        }
    }

    setAmount(amount: number): Obj {
        this.amount = amount
        return this
    }

    // Moves the object; returns `true` if successfully moved,
    // or `false` if interrupted (such as by an exit grid).
    move(position: Point, curIdx?: number, signalEvents = true): boolean {
        this.position = position

        if (signalEvents) {
            Events.emit('objMove', { obj: this, position })
        }

        // rebuild the lightmap (critters skip static rebake — dynamic light is recomputed each frame)
        if (Config.engine.doFloorLighting && this.type !== 'critter') {
            Lightmap.rebuildLight()
        }

        // give us a new z-order
        if (Config.engine.doZOrder !== false) {
            objectZOrder(this, curIdx)
        }

        return true
    }

    updateAnim(): void {
        if (!this.anim) return
        if (this.anim === 'dead') return  // corpse is frozen, never step frames

        const imageInfo = globalState.imageInfo[this.art]
        if (!imageInfo) return  // image metadata not yet loaded, skip this tick

        const time = window.performance.now()
        let fps = imageInfo.fps
        if (fps === 0) {
            fps = 10
        } // XXX: ?

        if (time - this.lastFrameTime >= 1000 / fps) {
            if (this.anim === 'reverse') {
                this.frame--
            } else {
                this.frame++
            }
            this.lastFrameTime = time

            if (this.frame === -1 || this.frame === imageInfo.numFrames) {
                // animation is done
                if (this.anim === 'reverse') {
                    this.frame++
                } else {
                    this.frame--
                }
                if (this.animCallback) {
                    this.animCallback()
                }
            }
        }
    }

    blocks(): boolean {
        // TODO: We could make use of subclass polymorphism to reduce the cases here
        // NOTE: This may be overloaded in subclasses

        if (this.type === 'misc') {
            return false
        }
        // CE object.cc _obj_blocking_at: only critters, scenery and walls block; an item
        // on the floor (dropped, thrown, ...) never does.
        if (this.type === 'item') {
            return false
        }
        if (!this.pro) {
            return true
        } // XXX: ?
        if (this.subtype === 'door') {
            return !this.open
        }
        if (this.visible === false) {
            return false
        }

        return !((this.pro.flags & 0x00000010) /* NoBlock */)
    }

    // Pathfinding-only predicate. CE pathfinder allows traversal through
    // closed-but-unlocked doors — the engine opens them mid-walk
    // (animation.cc:1805). Locked/jammed doors remain blockers. Shooting LoF
    // still uses `blocks()` so bullets do not pass through closed doors.
    inAnim(): boolean {
        return !!this.animCallback // TODO: find a better way
    }

    // Non-critter objects have no animation set — always returns false.
    // Critter overrides this with the real lookup.
    hasAnimation(_anim: string): boolean {
        return false
    }

    // Clear any animation the object has
    clearAnim(): void {
        this.frame = 0
        this.animCallback = null
        this.anim = null
        this.shift = null
    }

    singleAnimation(reversed?: boolean, callback?: () => void): void {
        if (reversed) {
            this.frame = globalState.imageInfo[this.art].numFrames - 1
        } else {
            this.frame = 0
        }
        this.lastFrameTime = 0
        this.anim = reversed ? 'reverse' : 'single'
        this.animCallback =
            callback ||
            (() => {
                this.anim = null
            })
    }

    // Are two objects approximately (not necessarily strictly) equal?
    approxEq(obj: Obj) {
        return this.pid === obj.pid
    }

    clone(): Obj {
        if (this._script) {
            dbg('object', '[Object] cloning an object with a script: %o', this)
            const _script = this._script
            this._script = null
            const obj = cloneItem(this)
            this._script = _script
            obj.loadScript()
            return obj
        }

        return cloneItem(this)
    }

    // CE item.cc itemAdd — joins a stack of the same item; an ammo stack combines its top
    // boxes (ammoMergeInto). Ammo `amount` counts boxes, as CE's quantity does.
    addInventoryItem(item: Obj, count = 1): void {
        for (let i = 0; i < this.inventory.length; i++) {
            const stack = this.inventory[i]
            if (!stack.approxEq(item)) continue
            if (item.subtype === 'ammo') ammoMergeInto(stack, count, ammoGetQuantity(item))
            else stack.amount += count
            return
        }
        // no existing item, add new inventory object
        this.inventory.push(item.clone().setAmount(count))
    }

    // CE item.cc itemGetWeight — the proto weight (0 when hidden); power armors weigh
    // half, a container adds its contents, a loaded weapon its rounds (by the box).
    getWeight(): number {
        const ex = this.pro?.extra ?? {}
        let weight = ex.weight ?? 0
        if ((((this as any).flags ?? 0) & 0x01) !== 0) weight = 0 // OBJECT_HIDDEN
        const POWER_ARMORS = [3, 232, 348, 349] // PROTO_ID_POWER_ARMOR, HARDENED, ADVANCED, ADVANCED_MK_II
        if (this.subtype === 'armor' && POWER_ARMORS.includes(this.pid)) weight = Math.trunc(weight / 2)
        else if (this.subtype === 'container') weight += this.getInventoryWeight()
        else if (this.subtype === 'weapon') {
            const rounds = (this as any).ammoQuantity ?? 0
            const ammoPid = (this as any).ammoTypePid ?? -1
            if (rounds > 0 && ammoPid !== -1) {
                const ammo = loadPRO(ammoPid, ammoPid & 0xffff)
                const perBox = Math.max(1, ammo?.extra?.quantity ?? 1)
                weight += (ammo?.extra?.weight ?? 0) * (Math.trunc((rounds - 1) / perBox) + 1)
            }
        }
        return weight
    }

    // The weight of `count` of this item (ammo: `count` boxes).
    stackWeight(count: number = this.amount ?? 1): number {
        return this.getWeight() * count
    }

    // CE item.cc itemGetCost — proto cost; a container adds its contents, a loaded weapon
    // its rounds' share of a box, an ammo box only the share of its rounds left.
    getCost(): number {
        const ex = this.pro?.extra ?? {}
        let cost = ex.cost ?? 0
        if (this.subtype === 'container') {
            for (const it of this.inventory) cost += it.stackCost()
        } else if (this.subtype === 'weapon') {
            const rounds = ammoGetQuantity(this)
            const ammoPid = (this as any).ammoTypePid ?? -1
            if (rounds > 0 && ammoPid !== -1) {
                const ammo = loadPRO(ammoPid, ammoPid & 0xffff)
                const perBox = Math.max(1, ammo?.extra?.quantity ?? 1)
                cost += Math.trunc(rounds * (ammo?.extra?.cost ?? 0) / perBox)
            }
        } else if (this.subtype === 'ammo') {
            cost = Math.trunc(cost * ammoGetQuantity(this) / ammoGetCapacity(this))
        }
        return cost
    }

    // CE item.cc objectGetCost for one inventory entry: an ammo stack is its full boxes
    // plus the partial top box.
    stackCost(count: number = this.amount ?? 1): number {
        if (this.subtype === 'ammo') return (this.pro?.extra?.cost ?? 0) * Math.max(0, count - 1) + this.getCost()
        return this.getCost() * count
    }

    // CE item.cc objectGetInventoryWeight — every carried item; a critter also counts
    // what it holds and wears outside the inventory list.
    getInventoryWeight(): number {
        let w = 0
        for (const item of this.inventory) w += item.stackWeight()
        if (this.type === 'critter') {
            const self = this as any
            for (const slot of ['leftHand', 'rightHand', 'armor']) {
                const item = self[slot]
                if (item && item.pid !== undefined && !this.inventory.includes(item) && typeof item.stackWeight === 'function') {
                    w += item.stackWeight()
                }
            }
        }
        return w
    }

    // CE ref: item.cc:253 itemAttemptAdd — critters reject anything that would exceed
    // STAT_CARRY_WEIGHT; item containers reject when containerGetTotalSize + size*qty
    // reaches proto maxSize (note CE's `>=`, item.cc:269). Other owners always pass.
    canCarry(item: Obj, count = 1): boolean {
        if (this.type === 'item' && this.subtype === 'container') {
            const maxSize = this.pro?.extra?.maxSize
            if (typeof maxSize !== 'number') return true // proto predates the container fields
            let total = 0
            for (const it of this.inventory) total += (it.pro?.extra?.size ?? 0) * (it.amount ?? 1)
            return total + (item.pro?.extra?.size ?? 0) * count < maxSize
        }
        if (this.type !== 'critter') return true
        const max = (this as unknown as Critter).getStat?.('Carry') ?? Infinity
        const addWeight = item.stackWeight(count)
        return this.getInventoryWeight() + addWeight <= max
    }

    getMessageCategory(): string {
        const categories: { [category: string]: string } = {
            item: 'pro_item',
            critter: 'pro_crit',
            scenery: 'pro_scen',
            wall: 'pro_wall',
            misc: 'pro_misc',
        }
        return categories[this.type]
    }

    getDescription(): string {
        if (!this.pro) {
            return null
        }

        return getMessage(this.getMessageCategory(), this.pro.textID + 1) || null
    }

    getName(): string {
        if (this.pro) {
            const name = getMessage(this.getMessageCategory(), this.pro.textID)
            if (name) return name
        }
        return this.name ?? 'Unknown object'
    }

    getLookText(): string {
        const desc = this.getDescription()
        return desc ?? this.getName()
    }

    get money(): number {
        // CE ref: item.cc itemGetMoney — sums all ITEM_TYPE_MONEY entries; a
        // critter or container can hold multiple money piles that all count.
        const MONEY_PID = 41
        let total = 0
        for (const item of this.inventory) {
            if (item.pid === MONEY_PID) total += item.amount ?? 0
        }
        return total
    }

    get isDoor(): boolean {
        return this.type === 'scenery' && this.pro.extra.subType === 0 // SCENERY_DOOR
    }

    get isStairs(): boolean {
        return this.type === 'scenery' && this.pro.extra.subType === 1 // SCENERY_STAIRS
    }

    get isLadder(): boolean {
        return (
            this.type === 'scenery' &&
            (this.pro.extra.subType === 3 || // SCENERY_LADDER_BOTTOM
                this.pro.extra.subType === 4)
        ) // SCENERY_LADDER_TOP
    }

    get isContainer(): boolean {
        return this.type === 'item' && this.pro.extra.subType === 1 // SUBTYPE_CONTAINER
    }

    get isExplosive(): boolean {
        // CE explosiveIsExplosive + explosiveIsActiveExplosive (armed 206 / 209)
        return this.pid === 85 /* Plastic Explosives */ || this.pid === 51 /* Dynamite */ || this.pid === 206 || this.pid === 209
    }

    get isSelectable(): boolean {
        return this.visible !== false && (this.canUse || this.type === 'critter' || this.type === 'item')
    }

    get canUse(): boolean {
        if (this._script !== undefined && this._script.use_p_proc !== undefined) {
            return true
        } else if (this.isExplosive) {
            return !(this as any).armed // already armed → only Drop is shown
        } else if (this.type === 'item' || this.type === 'scenery') {
            if (this.isDoor || this.isStairs || this.isLadder) {
                return true
            } else {
                // CE ref: proto.cc:257 _proto_action_can_use() bit 0x0800.
                // FO2 .pro files are big-endian; proto.py reads the 4 extendedFlags
                // bytes separately as itemFlags/actionFlags/weaponFlags/attackMode.
                // Bit 0x0800 lands in byte 2 (weaponFlags, bit 0x08) after the swap.
                return (this.pro.extra.weaponFlags & 0x08) != 0
            }
        }
        return false
    }

    // Returns whether or not the object was used
    use(source?: Critter, useScript?: boolean): boolean {
        if (this.canUse === false && !this.isContainer) {
            dbg('object', "[Object] can't use object")
            return false
        }

        if (useScript !== false && this._script && this._script.use_p_proc !== undefined) {
            if (source === undefined) {
                source = globalState.player
            }
            if (Scripting.use(this, source) === true) {
                dbg('object', '[Object] useObject: overridden by script')
                return true // script overrided us
            }
        } else if (this.script !== undefined && !this._script) {
            dbgWarn('object', '[Object] used object has script but is not loaded: ' + this.script)
        }

        if (this.subtype === 'drug') {
            if (source === undefined) source = globalState.player as Critter
            if (globalState.drugHandler) {
                const handled = globalState.drugHandler(this, source)
                if (handled) {
                    // CE ref: item.cc itemUse() — drug item is consumed on use.
                    const owner = source ?? globalState.player as Critter
                    if (owner) {
                        const idx = owner.inventory.indexOf(this)
                        if (idx !== -1) {
                            if (this.amount > 1) this.amount--
                            else owner.inventory.splice(idx, 1)
                        } else {
                            const ownerAny = owner as any
                            if (ownerAny.leftHand === this) ownerAny.leftHand = null
                            else if (ownerAny.rightHand === this) ownerAny.rightHand = null
                        }
                    }
                    if (source?.isPlayer) drawHP(source.getStat('HP'))
                }
                return handled
            }
        }

        // CE ref: proto_instance.cc:1245 — First Aid Kit / Doctor's Bag trigger skills.
        if (this.subtype === 'misc' && globalState.miscItemUseHandler) {
            if (source === undefined) source = globalState.player as Critter
            if (globalState.miscItemUseHandler(this, source)) return true
        }

        // CE ref: item.cc:2246-2280 _item_m_use_charged_item() — Stealth Boy / Geiger Counter toggle.
        if (isChargedMiscItem(this)) {
            if (source === undefined) source = globalState.player as Critter
            useChargedMiscItem(this, source ?? null)
            return true
        }

        if (this.isExplosive) {
            useExplosive(this, source)
            return true
        }

        // Play the interact animation on the source critter (non-blocking: the
        // interaction effect proceeds concurrently). Skipped for ladders because
        // the climb animation already handles the timing in the isLadder branch.
        if (source && !this.isLadder && source.hasAnimation('use')) {
            source.staticAnimation('use', () => source.clearAnim())
        }

        if (this.isDoor || this.isContainer) {
            toggleObjectOpen(this, true, true)
        } else if (this.isStairs) {
            const destTile = fromTileNum(this.extra.destination & 0xffff)
            const destElev = ((this.extra.destination >> 28) & 0xf) >> 1

            if (this.extra.destinationMap === -1 && this.extra.destination !== -1) {
                // same map, new destination
                dbg('object', `[Object] stairs: tile=(${destTile.x}, ${destTile.y}), elev=${destElev}`)

                globalState.player.position = destTile
                globalState.gMap.changeElevationFaded(destElev)
                // CE ref: map.cc:386 mapSetElevation fires only map_update_p_proc, not map_enter_p_proc
                globalState.gMap.updateMap()
            } else {
                dbg('object', `[Object] stairs → ${this.extra.destinationMap} @ (${destTile.x}, ${destTile.y}), elev=${destElev}`)
                globalState.gMap.loadMapByID(this.extra.destinationMap, destTile, destElev)
            }
        } else if (this.isLadder) {
            const isTop = this.pro.extra.subType === 4
            // CE ref: proto_instance.cc:1512 useLadderDown/useLadderUp — reads tile and
            // elevation from the packed destinationBuiltTile field (same format as stairs).
            const destTile = fromTileNum(this.extra.destination & 0xffff)
            const destElev = ((this.extra.destination >> 28) & 0xf) >> 1
            dbg('object', `[Object] ladder (${isTop ? 'top' : 'bottom'} → tile=${destTile.x},${destTile.y} elev=${destElev})`)

            if (this.extra.destinationMap !== -1 && this.extra.destinationMap != null) {
                globalState.gMap.loadMapByID(this.extra.destinationMap, destTile, destElev)
                return true
            }

            const actor = source ?? globalState.player
            // CE ref: actions.cc:1050 — sfxBuildCharName(critter, ANIM_CLIMB_LADDER) is
            // played as the climb starts (HMWARRAE → fallback HMXXXXAE etc.).
            playCharSfx(actor, sfxBuildCharName(actor, 4 /* ANIM_CLIMB_LADDER */))
            if (actor.hasAnimation('climb')) {
                actor.staticAnimation('climb', () => {
                    actor.clearAnim()
                    actor.position = destTile
                    globalState.gMap.changeElevationFaded(destElev)
                    // CE ref: map.cc:386 mapSetElevation fires only map_update_p_proc
                    globalState.gMap.updateMap()
                })
                return true // updateMap() handled in callback above; skip the one below
            }
            globalState.player.position = destTile
            globalState.gMap.changeElevationFaded(destElev)
            // CE ref: map.cc:386 mapSetElevation fires only map_update_p_proc
            globalState.gMap.updateMap()
        } else {
            this.singleAnimation()
        }

        globalState.gMap.updateMap()
        return true
    }

    // CE actions.cc actionExplode — the explosion sprite on the tile and the six around
    // it, the critter on the tile plus up to 6 more in the blast rings (radius 3,
    // _compute_explosion_on_extras), each taking d(min, max) − explosion DT/DR with
    // knockback; then damage_p_proc for the scripts in range (_scr_explode_scenery).
    // `_radius` is unused: CE's scripted explosions always use the rocket radius.
    // `animate` false (CE actionExplode's animate): the blast lands at once, no sprites.
    explode(source: Obj | null, minDmg: number, maxDmg: number, _radius: number = 3, animate = true): void {
        const killer = (source ?? this) as Critter // explosive itself as killer when source is null
        const center = { x: this.position.x, y: this.position.y }
        const elevation = this.elevation ?? globalState.gMap?.currentElevation ?? 0
        const blast = () => this.explosionBlast(killer, center, elevation, minDmg, maxDmg)
        if (!animate) return blast()
        const explosion = createObjectWithPID(makePID(5 /* misc */, 14 /* Explosion */), -1)
        explosion.position = { ...center }

        const adjExplosions = hexNeighbors(center).map(pos => {
            const adj = createObjectWithPID(makePID(5 /* misc */, 14 /* Explosion */), -1)
            adj.position = { x: pos.x, y: pos.y }
            return adj
        })

        lazyLoadImage(explosion.art, () => {
            if (!globalState.gMap) return
            globalState.gMap.addObject(explosion)
            for (const adj of adjExplosions) {
                globalState.gMap!.addObject(adj)
                adj.singleAnimation(false, () => { adj.anim = null; globalState.gMap?.destroyObject(adj) })
            }
            globalState.audioEngine?.playSfxByName('whn1xxx1') // CE actionExplode

            let fired = false
            explosion.singleAnimation(false, () => {
                // updateAnim keeps calling a finished animation's callback until the anim
                // is cleared; the blast happens once.
                explosion.anim = null
                if (fired) return
                fired = true
                globalState.gMap?.destroyObject(explosion)
                blast()
            })
        })
    }

    private explosionBlast(killer: Critter, center: Point, elevation: number, minDmg: number, maxDmg: number): void {
        const gMap = globalState.gMap
        if (!gMap) return

        const atTile = gMap.blockingObjectAt(toTileNum(center), elevation, 0, null)
        const main = atTile && atTile.type === 'critter' && !(atTile as Critter).dead ? atTile as Critter : null
        const victims = [...(main ? [main] : []), ...explosionRingCritters(center, elevation, main, false)]
        dbg('object', `[Object] explosion: ${minDmg}-${maxDmg}, ${victims.length} critter(s)`)
        for (const v of victims) {
            if (v.dead) continue
            const { damage, knockback } = computeExplosionDamage(minDmg, maxDmg, v, getRandomInt)
            critterDamage(v, damage, killer, true, true, 'Explosive', undefined, {
                attackerAnim: ANIM_STAND, weapon: null, knockback,
                knockbackRotation: hexDirectionTo(center, v.position),
            })
            if (v.isPlayer) drawHP(v.getStat('HP'))
        }

        scriptsExplodeScenery(this, center, elevation, (obj, target) => {
            if (!obj._script) return
            try {
                Scripting.damage(obj, target, null as any, 20) // fixed param 20
            } catch (e) {
                dbgWarn('object', `[Object] damage_p_proc error for ${obj.script}:`, e)
            }
        })

        globalState.gMap?.destroyObject(this)
    }

    pickup(source: Critter) {
        if (this._script) {
            dbg('object', '[Object] picking up %o', this)
            if (Scripting.pickup(this, source)) {
                return // script handled it
            }
        }
        // CE ref: item.cc itemAttemptAdd — refuse pickup if the player is over
        // their carry weight. Floats the standard "you can't carry any more" message.
        if (!source.canCarry(this, this.amount ?? 1)) {
            globalState.floatMessages.push({
                msg: "You can't carry any more.",
                obj: source, color: 'white', startTime: window.performance.now(),
            })
            return
        }
        const doPickup = () => {
            globalState.audioEngine.playSfxByName('ipickup1')
            source.addInventoryItem(this, this.amount)
            globalState.gMap.destroyObject(this)
            source.clearAnim()
        }
        const playPickup = () => {
            if (source.hasAnimation('pickUp')) {
                source.staticAnimation('pickUp', doPickup)
            } else {
                doPickup()
            }
        }
        // Walk to the object first, then play the pickup animation
        source.walkInFrontOf(this.position, playPickup)
    }

    drop(source: Obj) {
        // drop inventory object obj from source
        let removed = false
        for (let i = 0; i < source.inventory.length; i++) {
            if (source.inventory[i] === this) {
                removed = true
                source.inventory.splice(i, 1) // remove from source
                break
            }
        }
        if (!removed) {
            throw "dropObject: couldn't find object"
        }

        if (this._script) {
            Scripting.drop(this, source)
        }

        globalState.audioEngine.playSfxByName('iputdown')
        globalState.gMap.addObject(this) // add to objects
        const idx = globalState.gMap.getObjects().length - 1 // our new index
        this.move({ x: source.position.x, y: source.position.y }, idx)
    }

    // TODO: override this for subclasses
    serialize(): SerializedObj {
        return {
            uid: this.uid,
            pid: this.pid,
            pidID: this.pidID,
            type: this.type,
            pro: this.pro, // XXX: if pro changes in the future, this should be cloned
            flags: this.flags,
            art: this.art,
            frmPID: this.frmPID,
            orientation: this.orientation,
            visible: this.visible,
            extra: this.extra,
            script: this.script,
            _script: this._script && typeof this._script._serialize === 'function' ? this._script._serialize() : null,
            name: this.name,
            subtype: this.subtype,
            invArt: this.invArt,
            frame: this.frame,
            amount: this.amount,
            position: { x: this.position.x, y: this.position.y },
            inventory: this.inventory.map((obj) => {
                if (typeof obj.serialize !== 'function') {
                    dbgWarn('object', '[Serialize] skipping non-serializable object', obj)
                    return null
                }
                return obj.serialize()
            }).filter((obj) => obj !== null),
            lightRadius: this.lightRadius,
            lightIntensity: this.lightIntensity,
            miscOn: this.miscOn,
            miscCharges: this.miscCharges,
            ammoQuantity: this.ammoQuantity,
            ammoTypePid: this.ammoTypePid,
        }
    }
}
