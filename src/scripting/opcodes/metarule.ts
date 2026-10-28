// Script opcodes: metarule / metarule3 and the sfall explosions metarule (CE interpreter_extra.cc op_metarule, op_metarule3).
// Methods of the Script class (scripting.ts), kept here by topic and installed on its prototype
// there; vmBridge.ts and the Lua prelude call them as before (wiki/code_quality.md Q16).

import type { Script } from '../../scripting.js'
import { CHEM_USE_MAP, getAiPacket } from '../../aiPackets.js'
import { Config } from '../../config.js'
import { Critter, Obj, explosiveGetDamage, objectGetDamageType } from '../../object.js'
import { SKILL_NAMES } from '../../skills.js'
import * as SfallArrays from '../../sfallArrays.js'
import * as Worldmap from '../../worldmap.js'
import { areaContainingMap, lookupMapName } from '../../data.js'
import { centerCamera } from '../../renderer.js'
import { dbg, dbgWarn } from '../../logger.js'
import { drawAC } from '../../hudRefresh.js'
import { fromTileNum } from '../../tile.js'
import { getMessage } from '../../util.js'
import { world } from '../../state/world.js'
import { itemDropAll, killCounts } from '../../critter.js'
import { loadPRO, lookupArt, makePID } from '../../pro.js'
import { returnToMainMenu } from '../../mainMenuReturn.js'
import { uiDrawWeapon } from '../../hudRefresh.js'
import { uiLog } from '../../messageLog.js'
import { uiWorldMap } from '../../ui.js'
import {
    info,
    isGameObject,
    loadingGame,
    log,
    mapFirstRun,
    requestElevator,
    timeEventList,
    warn,
} from '../../scripting.js'

export const metaruleOpcodes = {
    metarule(this: Script, id: number, target: number): any {
        switch (id) {
            case 13: {
                // CE ref: interpreter_extra.cc:3208 METARULE_SIGNAL_END_GAME
                // Sets _game_user_wants_to_quit = 2 → triggers endgame sequence
                dbg('script', 'metarule(13): signal end game')
                // CE: _game_user_wants_to_quit = 2 — the game loop ends and returns to the main
                // menu once the script has finished (as after the end slides, endgame.ts)
                setTimeout(() => returnToMainMenu(), 0)
                return 0
            }
            case 14:
                return mapFirstRun // map_first_run
            case 15: // METARULE_ELEVATOR → scripts.cc scriptsRequestElevator(self, type)
                requestElevator(this.self_obj as Obj, target)
                return 0
            case 16:
                // CE ref: interpreter_extra.cc:3219 METARULE_PARTY_COUNT → party_member.cc
                // _getPartyMemberCount: the dude plus every member that is a live, visible critter.
                return (
                    1 +
                    (world.gParty?.party ?? []).filter((m) => m.type === 'critter' && !m.dead && m.visible !== false)
                        .length
                )
            case 17: // METARULE_AREA_KNOWN — CE wmAreaVisitedState
                return Worldmap.areaVisitedState(target)
            case 18: {
                // CE METARULE_WHO_ON_DRUGS → queueHasEvent(param, EVENT_TYPE_DRUG): any drug
                // event of the critter passed in (delayed effects are drug events too)
                if (!isGameObject(target)) return 0
                const hasDrug = timeEventList.some(
                    (e: any) =>
                        e.obj === target &&
                        typeof e.userdata === 'string' &&
                        (e.userdata as string).startsWith('drug:'),
                )
                return hasDrug ? 1 : 0
            }
            case 19: {
                // CE ref: interpreter_extra.cc:3228 METARULE_MAP_KNOWN → worldmap.cc wmMapIsKnown:
                // the first entrance to that map (maps.txt index) decides — its state == 1
                const mapName = typeof target === 'number' && target >= 0 ? lookupMapName(target) : null
                if (!mapName || !world.mapAreas) return 0
                for (const key of Object.keys(world.mapAreas)) {
                    const e = world.mapAreas[key].entrances.find(
                        (x: any) => (x.mapName ?? '').toLowerCase() === mapName.toLowerCase(),
                    )
                    if (e) return e.state ? 1 : 0
                }
                return 0
            }
            case 22:
                return loadingGame ? 1 : 0 // METARULE_IS_LOADGAME → _isLoadingGame
            case 42: {
                // CE ref: interpreter_extra.cc:3246 METARULE_DROP_ALL_INVEN —
                // itemDropAll: everything (hands and armor too) onto the critter's
                // tile, no scripts run; the dude's interface items refresh.
                const dropTarget = target as any
                if (!isGameObject(dropTarget) || dropTarget.type !== 'critter' || !world.gMap) return 0
                itemDropAll(dropTarget as Critter)
                if ((dropTarget as Critter).isPlayer) {
                    uiDrawWeapon()
                    drawAC(dropTarget.getStat('AC'))
                }
                return 0
            }
            case 43: {
                // CE ref: interpreter_extra.cc:3256 METARULE_INVEN_UNWIELD_WHO —
                // moves the active-hand weapon back to inventory (unwield)
                const unObj = target as any
                if (!isGameObject(unObj)) return 0
                const isPlayer = unObj === world.player
                const handKey: 'leftHand' | 'rightHand' = isPlayer
                    ? ((unObj.activeHand as 'leftHand' | 'rightHand') ?? 'rightHand')
                    : 'rightHand'
                const heldItem = unObj[handKey] as Obj | null | undefined
                if (heldItem) {
                    unObj[handKey] = null
                    unObj.inventory.push(heldItem)
                }
                return 0
            }
            case 40: {
                // CE ref: interpreter_extra.cc:3243 METARULE_SKILL_CHECK_TAG
                const skillName = SKILL_NAMES[target as number]
                if (!skillName || !world.player) return 0
                return world.player.skills.isTagged(skillName) ? 1 : 0
            }
            case 44: {
                // CE ref: interpreter_extra.cc:3280 METARULE_GET_WORLDMAP_XPOS
                const wpos = Worldmap.getPlayerWorldPos()
                return wpos ? wpos.x : 0
            }
            case 45: {
                // CE ref: interpreter_extra.cc:3283 METARULE_GET_WORLDMAP_YPOS
                const wpos = Worldmap.getPlayerWorldPos()
                return wpos ? wpos.y : 0
            }
            case 46: // METARULE_CURRENT_TOWN — CE wmGetPartyCurArea (-1 in the wastes)
                return Worldmap.getCurrentAreaId()
            case 47:
                // CE ref: interpreter_extra.cc:3291 METARULE_LANGUAGE_FILTER — profanity filter state
                return Config.ui.languageFilter ? 1 : 0
            case 48:
                // CE ref: interpreter_extra.cc:3310 METARULE_VIOLENCE_FILTER
                // Returns current violence level: 0=None,1=Minimal,2=Normal,3=Maximum
                return Config.combat.violenceLevel
            case 49: // METARULE_W_DAMAGE_TYPE
                // FO2-CE ref: combat_defs.h DMG_* constants
                switch (objectGetDamageType(target)) {
                    case 'normal':
                        return 0
                    case 'laser':
                        return 1
                    case 'fire':
                        return 2
                    case 'plasma':
                        return 3
                    case 'electrical':
                        return 4
                    case 'emp':
                        return 5
                    case 'explosion':
                        return 6
                    default:
                        return 0 // safe fallback instead of throw
                }
            case 50: {
                // CE ref: interpreter_extra.cc:3316 METARULE_CRITTER_BARTERS
                // CRITTER_BARTER = 0x02 (obj_types.h:93)
                if (!isGameObject(target)) return 0
                const pro = (target as any).pro
                return ((pro?.extra?.flags ?? 0) & 0x02) !== 0 ? 1 : 0
            }
            case 51: {
                // CE ref: interpreter_extra.cc:3328 METARULE_CRITTER_KILL_TYPE
                if (!isGameObject(target)) return 0
                return (target as any).killType ?? 0
            }
            case 30:
                // CE ref: interpreter_extra.cc:3235 METARULE_CAR_CURRENT_TOWN →
                // worldmap.cc:6037 wmCarCurrentArea — returns wmGenData.currentCarAreaId.
                return Worldmap.getCarAreaId()
            case 31: {
                // CE ref: interpreter_extra.cc:3238 METARULE_GIVE_CAR_TO_PARTY →
                // worldmap.cc:6043 wmCarGiveToParty — refuses an empty tank (worldmap
                // msg 1502), else puts the party in the car and goes to the worldmap
                // (mapSetTransition map -2), resetting the CAR_OUT_OF_GAS area. The
                // fuel and GVAR_PLAYER_GOT_CAR are the calling script's business.
                if (Worldmap.getCarFuel() <= 0) {
                    uiLog(getMessage('worldmap', 1502) ?? 'The car is out of power.')
                    return -1
                }
                Worldmap.setIsInCar(true)
                Worldmap.updateCarUI()
                const outOfGas = world.mapAreas?.[21] // CITY_CAR_OUT_OF_GAS
                if (outOfGas) {
                    Worldmap.setAreaVisible(21, false)
                    outOfGas.visitedState = 0
                }
                uiWorldMap()
                return 0
            }
            case 32: {
                // CE ref: interpreter_extra.cc:3241 METARULE_GIVE_CAR_GAS →
                // worldmap.cc:5984 wmCarFillGas(amount).
                const gasAmount = typeof target === 'number' ? target : 0
                return Worldmap.addCarFuel(gasAmount)
            }
            case 52: {
                // CE ref: interpreter_extra.cc:3331 METARULE_SET_CAR_CARRY_AMOUNT — writes
                // maxSize on the shared PROTO_ID_CAR_TRUNK (455) proto.
                const trunkPro = loadPRO(455, 455)
                if (!trunkPro) return 0
                trunkPro.extra.maxSize = typeof target === 'number' ? target : 0
                return 1
            }
            case 53: {
                // CE ref: interpreter_extra.cc:3340 METARULE_GET_CAR_CARRY_AMOUNT.
                const trunkPro = loadPRO(455, 455)
                return trunkPro?.extra?.maxSize ?? 0
            }
            default:
                dbgWarn('script', `metarule: unhandled id ${id}`)
                return 0 // CE opMetarule: result stays 0
        }
    },
    metarule3(this: Script, id: number, obj: any, userdata: any, radius: number): any {
        switch (id) {
            case 100: {
                // METARULE3_CLR_FIXED_TIMED_EVENTS → _queue_clear_type(EVENT_TYPE_SCRIPT,
                // _scrQueueRemoveFixed): every script timer of that object with that fixed param
                for (let i = timeEventList.length - 1; i >= 0; i--) {
                    const e = timeEventList[i]
                    if (e.obj === obj && e.userdata === userdata && (e.script || typeof e.userdata === 'number')) {
                        info('removing timed event (userdata ' + userdata + ')', 'timer')
                        timeEventList.splice(i, 1)
                    }
                }
                return 0
            }
            case 101:
                // METARULE3_MARK_SUBTILE — CE ref: worldmap.cc:5076 wmSubTileMarkRadiusVisited(x, y, radius)
                Worldmap.markSubTileRadiusVisited(obj as number, userdata as number, radius as number)
                return 0
            case 102:
                // METARULE3_SET_WM_MUSIC — CE ref: interpreter_extra.cc:1968-2060:
                // the switch has no case for this ID despite the enum name; result stays 0.
                // Not a DH2 gap — this matches CE exactly.
                return 0
            case 103:
                // CE ref: interpreter_extra.cc:1989 METARULE3_GET_KILL_COUNT
                // Returns how many critters of killType `obj` have been killed.
                return killCounts.get(obj as number) ?? 0
            case 104: {
                // CE ref: worldmap.cc:2940 wmMapMarkMapEntranceState(mapIdx, elevation, state);
                // the result stays 0 (interpreter_extra.cc opMetarule3)
                const entrMapName = typeof obj === 'number' && obj >= 0 ? lookupMapName(obj) : null
                // CE: the result of wmMapMarkMapEntranceState, 0 or -1
                if (
                    entrMapName &&
                    Worldmap.markMapEntranceState(entrMapName, userdata as number, (radius as number) !== 0)
                )
                    return 0
                return -1
            }
            case 105:
                // METARULE3_WM_SUBTILE_STATE — CE ref: worldmap.cc:5125 wmSubTileGetVisitedState:
                // 0 unknown, 1 known, 2 visited (Vault City's vcstark tests > 1)
                return Worldmap.subTileVisitedState(obj as number, userdata as number)
            case 106: {
                // METARULE3_TILE_GET_NEXT_CRITTER: the critter after `previous` among the objects
                // at (tile, elevation) — the dude included; the first one when previous is 0
                const p = fromTileNum(obj as number)
                const previous = radius as any
                log('metarule3 106 (tile_get_next_critter)', [id, obj, userdata, radius])
                let found = !previous
                for (const o of world.gMap!.getObjects(userdata as number)) {
                    if (o.position?.x !== p.x || o.position?.y !== p.y) continue
                    if (o.type === 'critter' && found) return o
                    if (o === previous) found = true
                }
                return 0
            }
            case 107: {
                // METARULE3_ART_SET_BASE_FID_NUM — CE ref: interpreter_extra.cc:2029
                // Rebuilds the object's FID with a new frmId, keeping type/animType/rotation.
                // DH2 stores `art` as a path; resolve via lookupArt(makePID(frmType, frmId)).
                if (!isGameObject(obj) || !obj.pro) {
                    warn('metarule3 107: not a game object or no proto')
                    return 0
                }
                const newArt = lookupArt(makePID(obj.pro.frmType, userdata as number))
                if (newArt) obj.art = newArt
                return 0
            }
            case 108: {
                // CE ref: interpreter_extra.cc:2045 METARULE3_TILE_SET_CENTER
                // Centers the game camera on the given tile number.
                centerCamera(fromTileNum(obj as number))
                return 0
            }
            case 109: {
                // METARULE3_109 (chem use preference) — CE ref: combat_ai.cc:804
                // aiGetChemUse() → ai->chem_use. Reads live AI packet and returns CE's numeric index.
                if (!isGameObject(obj)) return 0
                const critter = obj as Critter
                const packet = critter.ai?.packet ?? getAiPacket(critter.aiNum)
                const idx = CHEM_USE_MAP.indexOf(packet.chemUse)
                return idx === -1 ? 0 : idx
            }
            case 110:
                // CE ref: worldmap.cc wmCarIsOutOfGas — carFuel <= 0, in the car or not
                return Worldmap.getCarFuel() <= 0 ? 1 : 0
            case 111: {
                // METARULE3_111 (_map_target_load_area) — CE ref: map.cc:1202.
                // Returns the worldmap area index containing the current map, or -1.
                const mapName = lookupMapName(world.gMap!.mapID)
                const area = mapName ? areaContainingMap(mapName) : null
                return area ? area.id : -1
            }
            default:
                dbgWarn('script', `metarule3: unhandled id ${id}`)
                return 0 // CE opMetarule3: result stays 0
        }
    },
    // CE op_explosions_metarule (0x8261). The UPU uses only 6, EXPL_GET_EXPLOSION_DAMAGE:
    // a temporary array [min, max] of an explosive's damage (item.cc explosiveGetDamage);
    // the others change the next explosion and are not supported (a warning, 0).
    explosions_metarule(this: Script, metarule: number, param1: number, _param2: number) {
        if (metarule === 6) {
            const d = explosiveGetDamage(param1, true)
            const id = SfallArrays.createTempArray(2, 0)
            SfallArrays.setArray(id, 0, d?.min ?? 0, false)
            SfallArrays.setArray(id, 1, d?.max ?? 0, false)
            return id
        }
        warn('explosions_metarule: metarule ' + metarule + ' is not supported')
        return 0
    },
}
