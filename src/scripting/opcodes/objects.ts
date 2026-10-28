// Script opcodes: objects: locks, doors, protos, creation, names and types, visibility, use, light (CE op_obj_lock, op_proto_data, op_create_object_sid, ...).
// Methods of the Script class (scripting.ts), kept here by topic and installed on its prototype
// there; vm_bridge.ts and the Lua prelude call them as before (wiki/code_quality.md Q16).

import type { Script } from '../../scripting.js'
import { Config } from '../../config.js'
import { Critter, Obj, createObjectWithPID, setObjectOpen, zsort } from '../../object.js'
import * as GameTime from '../../gametime.js'
import * as Lightmap from '../../lightmap.js'
import { arrayRemove, getMessage } from '../../util.js'
import { dbgWarn } from '../../logger.js'
import { findItemHolder, unequipForRemoval } from '../../inventoryWield.js'
import { fromTileNum } from '../../tile.js'
import globalState from '../../globalState.js'
import { loadPRO } from '../../pro.js'
import { objUseItemOn } from '../../useItemOn.js'
import { objectOnScreen } from '../../renderer.js'
import { uiDrawWeapon } from '../../hudRefresh.js'
import {
    ScriptableObj,
    allCarriers,
    currentMapID,
    destroy,
    info,
    isGameObject,
    isSpatial,
    loadingGame,
    log,
    useObjOnMe,
    warn,
} from '../../scripting.js'

export const objectsOpcodes = {
    elevation(this: Script, obj: Obj) {
        // CE ref: interpreter_extra.cc:2285 opGetObjectElevation — returns obj->elevation
        if (isSpatial(obj) || isGameObject(obj)) return obj.elevation
        else {
            warn('elevation: not an object: ' + obj)
            return -1
        }
    },
    // objects
    obj_is_locked(this: Script, obj: Obj) {
        log('obj_is_locked', [obj])
        if (!isGameObject(obj)) {
            warn('obj_is_locked: not game object: ' + obj, undefined, this)
            return 1
        }
        return obj.locked ? 1 : 0
    },
    obj_lock(this: Script, obj: Obj) {
        log('obj_lock', [obj])
        if (!isGameObject(obj)) {
            warn('obj_lock: not game object: ' + obj, undefined, this)
            return
        }
        obj.locked = true
    },
    obj_unlock(this: Script, obj: Obj) {
        log('obj_unlock', [obj])
        if (!isGameObject(obj)) {
            warn('obj_unlock: not game object: ' + obj, undefined, this)
            return
        }
        obj.locked = false
    },
    // CE ref: interpreter_extra.cc:4688 opJamLock — sets jammed flag on lockable objects
    jam_lock(this: Script, obj: Obj) {
        log('jam_lock', [obj])
        if (!isGameObject(obj)) {
            warn('jam_lock: not game object: ' + obj, undefined, this)
            return
        }
        if (obj.isDoor || obj.isContainer) obj.jammed = true
    },
    obj_is_open(this: Script, obj: Obj) {
        log('obj_is_open', [obj])
        if (!isGameObject(obj)) {
            warn('obj_is_open: not game object: ' + obj, undefined, this)
            return 0
        }
        return obj.open ? 1 : 0
    },
    obj_close(this: Script, obj: Obj) {
        if (!isGameObject(obj)) {
            warn('obj_close: not game object: ' + obj)
            return
        }
        info('obj_close')
        // CE proto_instance.cc objectClose → objectOpenClose: a locked object stays as it is
        // (silently); no one animates and no loot window opens
        if (!obj.open || obj.locked) return
        obj.jammed = false // objectUnjamLock
        setObjectOpen(obj, false, false, true)
    },
    obj_open(this: Script, obj: Obj) {
        if (!isGameObject(obj)) {
            warn('obj_open: not game object: ' + obj)
            return
        }
        info('obj_open')
        // CE proto_instance.cc objectOpen → objectOpenClose (lock checked, silently)
        if (obj.open || obj.locked) return
        obj.jammed = false // objectUnjamLock
        setObjectOpen(obj, true, false, true)
    },
    proto_data(this: Script, pid: number, data_member: number): any {
        // CE ref: proto.cc:1099 protoGetDataMember (+ proto.h *_DATA_MEMBER_* enums).
        // Field mapping to tools/proto.py JSON:
        //   flags            → pro.flags (common header)
        //   extendedFlags    → items: the 32-bit word proto.py splits into
        //                      itemFlags/actionFlags/weaponFlags/attackMode bytes;
        //                      critters: extra.actionFlags; scenery/wall/misc: extra.extendedFlags
        //   sid              → extra.scriptID (scenery: extra.scriptPID)
        // CRITTER_DATA_MEMBER_DATA (9) / SCENERY_DATA_MEMBER_DATA (10) return C
        // pointers in CE and have no script-visible meaning — 0 here.
        // (Rewritten 2026-10-06 — flags/extended-flags/head-FID previously read the
        // wrong JSON fields.)
        const pidID = pid & 0xffff
        const pro = loadPRO(pid, pidID)
        if (!pro) {
            warn('proto_data: no PRO for pid=0x' + pid.toString(16))
            return 0
        }
        const objType = (pid >> 24) & 0xff
        const extra = pro.extra ?? {}
        const msgCat = ['pro_item', 'pro_crit', 'pro_scen', 'pro_wall', 'pro_tile', 'pro_misc'][objType]
        // Members 0-5 are identical for every type.
        switch (data_member) {
            case 0:
                return pid
            case 1:
                return getMessage(msgCat, pro.textID) ?? ''
            case 2:
                return getMessage(msgCat, pro.textID + 1) ?? ''
            case 3:
                return ((pro.frmType ?? objType) << 24) | (pro.frmPID ?? 0)
            case 4:
                return pro.lightDistance ?? 0
            case 5:
                return pro.lightIntensity ?? 0
            case 6:
                return pro.flags ?? 0
        }
        if (objType === 0 /* OBJ_TYPE_ITEM */) {
            switch (data_member) {
                case 7:
                    return (
                        (((extra.itemFlags ?? 0) << 24) |
                            ((extra.actionFlags ?? 0) << 16) |
                            ((extra.weaponFlags ?? 0) << 8) |
                            (extra.attackMode ?? 0)) >>>
                        0
                    )
                case 8:
                    return extra.scriptID ?? -1
                case 9:
                    return extra.subType ?? 0
                case 11:
                    return extra.materialID ?? 0
                case 12:
                    return extra.size ?? 0
                case 13:
                    return extra.weight ?? 0
                case 14:
                    return extra.cost ?? 0
                case 15:
                    return extra.invFRM ?? 0
                case 555:
                    return extra.maxRange1 ?? 0 // ITEM_DATA_MEMBER_WEAPON_RANGE
            }
        } else if (objType === 1 /* OBJ_TYPE_CRITTER */) {
            switch (data_member) {
                case 7:
                    return extra.actionFlags ?? 0
                case 8:
                    return extra.scriptID ?? -1
                case 9:
                    return 0 // CRITTER_DATA_MEMBER_DATA (pointer)
                case 10:
                    return extra.headFID ?? -1
                case 11:
                    return extra.bodyType ?? 0
            }
        } else if (objType === 2 /* OBJ_TYPE_SCENERY */) {
            switch (data_member) {
                case 7:
                    return extra.extendedFlags ?? 0
                case 8:
                    return extra.scriptPID ?? -1
                case 9:
                    return extra.subType ?? 0
                case 10:
                    return 0 // SCENERY_DATA_MEMBER_DATA (pointer)
                case 11:
                    return extra.materialID ?? 0
            }
        } else if (objType === 3 /* OBJ_TYPE_WALL */) {
            switch (data_member) {
                case 7:
                    return extra.extendedFlags ?? 0
                case 8:
                    return extra.scriptID ?? -1
                case 9:
                    return extra.material ?? 0
            }
        } else if (objType === 5 /* OBJ_TYPE_MISC */) {
            if (data_member === 7) return extra.extendedFlags ?? 0
        }
        // CE: unknown members for a valid type log "Invalid data member" and yield 0;
        // OBJ_TYPE_TILE has no members at all.
        dbgWarn('script', `proto_data: invalid data member ${data_member} for objType=${objType}`)
        return 0
    },
    create_object_sid(this: Script, pid: number, tile: number, elev: number, sid: number) {
        // Create object of pid and possibly script
        info('create_object_sid: pid=' + pid + ' tile=' + tile + ' elev=' + elev + ' sid=' + sid, undefined, this)

        // CE opCreateObject: nothing is created while a game loads
        if (loadingGame) {
            warn('create_object_sid: attempt to create in load/save-game', undefined, this)
            return null
        }
        if (elev < 0 || elev > 2) {
            warn('create_object_sid: elev out of range: elev=' + elev, undefined, this)
            return null
        }
        if (tile === -1) tile = 0 // CE opCreateObject

        const obj = createObjectWithPID(pid, sid)
        if (!obj) {
            warn("create_object_sid: couldn't create object", undefined, this)
            return null
        }
        obj.elevation = elev

        //stub("create_object_sid", arguments)

        // TODO: if tile is valid...
        // add it to the map, then set its position and fix its draw order.
        // Rendering is a plain painter's-algorithm draw in array order (no
        // depth buffer, no per-tile sort) — a raw `obj.position = ...`
        // assignment before pushing left every dynamically-created object
        // (critters, scenery, anything a map script spawns at runtime) stuck
        // at the tail of the array, drawing on top of literally everything
        // regardless of its actual position. `elev` isn't always the
        // currently-displayed elevation, so `obj.move()` (which only
        // re-splices the *current* elevation's array) can't be used
        // directly here — a full zsort() of the target elevation's array is
        // safe and correct regardless of which elevation that is.
        globalState.gMap!.addObject(obj, elev)
        obj.position = fromTileNum(tile)
        zsort(globalState.gMap!.objects![elev])
        // CE objectCreateWithFidPid → objectSetLight: a lit proto lights its tile
        if (obj.lightRadius > 0 && obj.lightIntensity > 0 && Config.engine.doFloorLighting) Lightmap.rebuildLight()

        return obj
    },
    obj_name(this: Script, obj: Obj) {
        return obj.name
    },
    // CE interpreter_extra.cc opGetItemType: itemGetType for an item, −1 otherwise; the
    // Shiv (PROTO_ID_SHIV 383) is ITEM_TYPE_MISC (5), so weapon searches miss it
    obj_item_subtype(this: Script, obj: Obj) {
        if (!isGameObject(obj)) {
            warn('obj_item_subtype: not game object: ' + obj)
            return -1
        }

        if (obj.type === 'item' && obj.pro != null) {
            if (obj.pid === 383) return 5
            // pro.py serializes as 'subType' (capital T)
            return obj.pro.extra.subType ?? obj.pro.extra.subtype ?? -1
        }
        warn('obj_item_subtype: not an item: ' + obj)
        return -1
    },
    set_obj_visibility(this: Script, obj: Obj, visibility: number) {
        if (!isGameObject(obj)) {
            warn('set_obj_visibility: not a game object: ' + obj)
            return
        }
        // CE opSetObjectVisibility: refused while a game loads
        if (loadingGame) return
        // CE ref: interpreter_extra.cc:2096 objectHide/objectShow call
        // _obj_turn_off_light/_obj_turn_on_light → triggers lightmap rebuild.
        obj.visible = !visibility
        // objectHide / objectShow set OBJECT_HIDDEN (0x01): kept in step with `visible`, so
        // the flag tests (blocking, light, line of fire) and the visible tests agree
        obj.flags = visibility ? (obj.flags ?? 0) | 0x01 : (obj.flags ?? 0) & ~0x01
        if (Config.engine.doFloorLighting) Lightmap.rebuildLight()
    },
    use_obj_on_obj(this: Script, obj: Obj, who: Obj) {
        if (!isGameObject(obj) || !isGameObject(who)) {
            warn('use_obj_on_obj: not game objects')
            return
        }
        info('use_obj_on_obj: ' + (obj.name ?? obj.pid) + ' on ' + (who.name ?? who.pid))
        // CE ref: interpreter_extra.cc:4564 opUseObjectOnObject; proto_instance.cc:1296
        // obj=item, who=target, this.self_obj=critter doing the using
        // sfall set_self: this one call runs as that object (CE opUseObjectOnObject)
        const source = (this.overriddenSelf ?? this.self_obj) as unknown as Obj
        this.overriddenSelf = null
        // A critter using it: CE _obj_use_item_on — the item's and the target's
        // use_obj_on_p_proc, then (not overridden) the engine's default use: a drug or
        // healing item takes effect and is used up (useItemOn.ts, the player's path)
        if (source && source.type === 'critter') {
            objUseItemOn(source as unknown as Critter, who, obj)
            return
        }
        // Step 1: if item has use_obj_on_p_proc, fire it with target_obj=who
        if (obj._script && obj._script.use_obj_on_p_proc !== undefined) {
            obj._script.self_obj = obj as ScriptableObj
            obj._script.source_obj = source
            obj._script.target_obj = who
            obj._script.cur_map_index = currentMapID
            obj._script._didOverride = false
            obj._script.use_obj_on_p_proc()
            if (obj._script._didOverride) return
        }
        // Step 2: fire use_obj_on_p_proc on target with source=critter, target_obj=item
        useObjOnMe(who, obj, source)
    },
    use_obj(this: Script, obj: Obj) {
        if (!isGameObject(obj)) {
            warn('use_obj: not a game object: ' + obj)
            return
        }
        info('use_obj: ' + (obj.name ?? obj.pid))
        obj.use(this.self_obj as Critter, true)
    },
    obj_pid(this: Script, obj: Obj) {
        if (!isGameObject(obj)) {
            warn('obj_pid: not game object: ' + obj, undefined, this)
            return null
        }
        return obj.pid
    },
    obj_on_screen(this: Script, obj: Obj) {
        log('obj_on_screen', [obj])
        if (!isGameObject(obj)) {
            warn('obj_on_screen: not a game object: ' + obj)
            return 0
        }
        return objectOnScreen(obj) ? 1 : 0
    },
    obj_type(this: Script, obj: Obj) {
        if (!isGameObject(obj)) {
            warn('obj_type: not game object: ' + obj)
            return null
        } else if (obj.type === 'critter')
            return 1 // critter
        else if (obj.pid === undefined) {
            warn('obj_type: no PID')
            return null
        }
        return (obj.pid >> 24) & 0xff
    },
    destroy_object(this: Script, obj: Obj) {
        // destroy object from world
        log('destroy_object', [obj])
        // CE opDestroyObject: a critter isn't destroyed while a game loads
        if (loadingGame && obj?.type === 'critter') {
            warn('destroy_object: attempt to destroy critter in load/save-game')
            return
        }
        // CE: a carried object first leaves its owner (objectGetOwner → itemRemove, the
        // dude's interface refreshed), then objectDestroy runs its destroy_p_proc.
        const holder = isGameObject(obj) ? findItemHolder(obj, allCarriers()) : null
        if (holder) {
            if (holder.type === 'critter') unequipForRemoval(holder as Critter, obj)
            arrayRemove(holder.inventory, obj)
            if (holder === globalState.player) uiDrawWeapon()
            destroy(obj)
            return
        }
        globalState.gMap!.destroyObject(obj)
    },
    set_exit_grids(this: Script, onElev: number, mapID: number, elevation: number, tileNum: number, rotation: number) {
        // CE ref: interpreter_extra.cc:2180 opSetExitGrids — iterates objectFindFirstAtElevation(onElev)
        // and updates all exit-grid objects (PIDs 0x5000010-0x5000017) on that elevation.
        for (const obj of globalState.gMap?.objects?.[onElev] ?? []) {
            const pid = obj.pid >>> 0
            if (pid >= 0x5000010 && pid <= 0x5000017 && obj.extra) {
                // FIRST/LAST_EXIT_GRID_PID
                obj.extra.exitMapID = mapID
                obj.extra.startingPosition = tileNum
                obj.extra.startingElevation = elevation
            }
        }
    },
    // CE opGetObjectBeingUsed (0x80C0) — script->target: the item used on this object
    // in use_obj_on_p_proc (DH2 keeps it in target_obj).
    obj_being_used_with(this: Script): Obj | 0 {
        return this.target_obj ?? 0
    },
    // environment
    set_light_level(this: Script, level: number) {
        log('set_light_level', [level])
        // Fallout 2 passes 0..100. A call with the "default" magic
        // value releases the override and lets the time-of-day curve
        // take back over on the next map load.
        GameTime.setLightLevelOverride(level)
    },
    obj_set_light_level(this: Script, obj: Obj, intensity: number, distance: number) {
        // CE ref: interpreter_extra.cc:3071 opSetObjectLightLevel calls objectSetLight()
        // which does a full turn-off/turn-on cycle and triggers a lightmap rebuild.
        // intensity arrives as 0–100 percent; CE converts: (intensity * 65636) / 100
        if (!isGameObject(obj)) {
            warn('obj_set_light_level: not game object: ' + obj)
            return
        }
        // CE literally (65636 is CE's own constant); objectSetLight: a light caps its
        // distance at 8, no intensity means no light at all.
        const lightIntensity = intensity !== 0 ? Math.trunc((intensity * 65636) / 100) : 0
        if (lightIntensity > 0) {
            obj.lightRadius = Math.min(distance, 8)
            obj.lightIntensity = lightIntensity
        } else {
            obj.lightRadius = 0
            obj.lightIntensity = 0
        }
        if (Config.engine.doFloorLighting) Lightmap.rebuildLight()
    },
    art_anim(this: Script, fid: number): number {
        // FO2-CE ref: art.cc artAlias() — anim field is bits 23-16 of the FID
        return (fid >>> 16) & 0xff
    },
    obj_art_fid(this: Script, obj: Obj) {
        // FO2-CE ref: art.cc obj_art_fid() — returns the object's current FID
        if (!isGameObject(obj)) {
            warn('obj_art_fid: not game object: ' + obj)
            return 0
        }
        return obj.frmPID ?? 0
    },
}
