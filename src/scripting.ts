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

Scripting system/engine for DarkFO
*/

import { Combat, isCombatActive } from './combat.js'
import { critterDamage, critterKill } from './critter.js'
import { lookupScriptName } from './data.js'
import * as GameTime from './gametime.js'
import {
    hexDirectionTo,
    hexDistance,
    hexInDirection,
    hexNearestNeighbor,
    Point,
    tile_in_tile_rect,
} from './geometry.js'
import globalState from './globalState.js'
import { parseIntFile } from './intfile.js'
import { dbg } from './logger.js'
import { useElevator } from './main.js'
import { Critter, createObjectWithPID, Obj, objectGetDamageType } from './object.js'
import { Player } from './player.js'
import { loadPRO, makePID } from './pro.js'
import { centerCamera, objectOnScreen } from './renderer.js'
import { fromTileNum, toTileNum } from './tile.js'
import { uiAddDialogueOption, uiBarterMode, uiEndDialogue, uiLog, uiSetDialogueReply, uiStartDialogue, UIMode } from './ui.js'
import { SKILL_NAMES } from './skills.js'
import { assert, BinaryReader, getFileBinarySync, getFileJSON, getFileText, getRandomInt, randomRoll, RollResult, rollIsSuccess, rollIsCritical } from './util.js'
import { ScriptVM } from './vm.js'
import { ScriptVMBridge } from './vm_bridge.js'
import { Config } from './config.js'

export module Scripting {
    var gameObjects: Obj[] | null = null
    var mapVars: any = null
    var globalVars: any = {}
    var globalVarsLoaded = false
    var currentMapID: number | null = null
    var currentMapObject: Script | null = null
    var mapFirstRun = true
    var scriptMessages: { [scriptName: string]: { [msgID: number]: string } } = {}
    var dialogueOptionProcs: (() => void)[] = [] // Maps dialogue options to handler callbacks
    var currentDialogueObject: Obj | null = null
    export var timeEventList: TimedEvent[] = []
    let overrideStartPos: StartPos | null = null
    let fadeOverlay: HTMLDivElement | null = null

    export interface StartPos {
        position: Point
        orientation: number
        elevation: number
    }

    export interface TimedEvent {
        obj: Obj | null
        ticks: number
        userdata: any
        fn: () => void
    }

    var statMap: { [stat: number]: string } = {
        0: 'STR',
        1: 'PER',
        2: 'END',
        3: 'CHA',
        4: 'INT',
        5: 'AGI',
        6: 'LUK',
        35: 'HP',
        7: 'Max HP',
    }

    type DebugLogShowType = keyof typeof Config.scripting.debugLogShowType

    function stub(name: string, args: IArguments, type?: DebugLogShowType) {
        if (Config.scripting.debugLogShowType.stub === false || Config.scripting.debugLogShowType[type] === false)
            return
        var a = ''
        for (var i = 0; i < args.length; i++)
            if (i === args.length - 1) a += args[i]
            else a += args[i] + ', '
        console.log('STUB: ' + name + ': ' + a)
    }

    function log(name: string, args: IArguments, type?: DebugLogShowType) {
        if (Config.scripting.debugLogShowType.log === false || Config.scripting.debugLogShowType[type] === false) return
        var a = ''
        for (var i = 0; i < args.length; i++)
            if (i === args.length - 1) a += args[i]
            else a += args[i] + ', '
        console.log('log: ' + name + ': ' + a)
    }

    function warn(msg: string, type?: DebugLogShowType, script?: Script) {
        if (type !== undefined && Config.scripting.debugLogShowType[type] === false) return
        if (script) console.log(`WARNING [${(script as any)._vm.intfile.name}]: ${msg}`)
        else console.log(`WARNING: ${msg}`)
    }

    export function info(msg: string, type?: DebugLogShowType, script?: Script) {
        if (type !== undefined && Config.scripting.debugLogShowType[type] === false) return
        if (script) console.log(`INFO [${(script as any)._vm.intfile.name}]: ${msg}`)
        else console.log(`INFO: ${msg}`)
    }

    // http://stackoverflow.com/a/23304189/1958152
    function seed(s: number) {
        Math.random = () => {
            s = Math.sin(s) * 10000
            return s - Math.floor(s)
        }
    }

    export function getGlobalVar(gvar: number): any {
        return globalVars[gvar] !== undefined ? globalVars[gvar] : 0
    }

    export function getGlobalVars(): any {
        return globalVars
    }

    export function setGlobalVars(vars: { [k: string]: number }): void {
        globalVars = Object.assign({}, vars)
    }

    export function loadGlobalVars(): void {
        if (globalVarsLoaded) return
        try {
            const data = getFileJSON('data/gvars.json')
            for (const key of Object.keys(data)) {
                const idx = Number(key)
                if (globalVars[idx] === undefined) {
                    globalVars[idx] = data[key]
                }
            }
            globalVarsLoaded = true
            info('loadGlobalVars: loaded ' + Object.keys(data).length + ' global vars from gvars.json')
        } catch (e: any) {
            globalVarsLoaded = true
            console.log('loadGlobalVars: gvars.json not found, using defaults (' + e.message + ')')
        }
    }

    export function loadMapVars(mapName: string): void {
        const scriptName = mapName.toLowerCase()
        try {
            const data = getFileJSON('data/maps/' + scriptName + '.mvars.json')
            if (mapVars[scriptName] === undefined) mapVars[scriptName] = {}
            for (const key of Object.keys(data)) {
                const idx = Number(key)
                if (mapVars[scriptName][idx] === undefined) {
                    mapVars[scriptName][idx] = data[key]
                }
            }
            info('loadMapVars: loaded ' + Object.keys(data).length + ' map vars for ' + scriptName)
        } catch (e: any) {
            // No mvars file for this map is normal - many maps have no MVARs
        }
    }

    function isGameObject(obj: any) {
        // TODO: just use isinstance Obj?
        if (obj === undefined || obj === null) return false
        if (obj.isPlayer === true) return true
        if (
            obj.type === 'item' ||
            obj.type === 'critter' ||
            obj.type === 'scenery' ||
            obj.type === 'wall' ||
            obj.type === 'tile' ||
            obj.type === 'misc'
        )
            return true

        //warn("is NOT GO: " + obj.toString())
        dbg('script', 'is NOT GO: %o', obj)
        return false
    }

    function isSpatial(obj: any): boolean {
        if (!obj) return false
        return obj.isSpatial === true
    }

    // Sentinel userdata value for engine-managed poison tick events
    const UD_POISON = '__eng_poison__'

    // FO2-CE ref: stat.cc poisonEventCallback()
    // Fires every POISON_TICK_INTERVAL ticks; deals 1 HP, decrements poison level, re-queues if > 0.
    function poisonTick(critter: Critter): void {
        if (critter.dead || critter.poisonLevel <= 0) return
        critter.stats.modifyBase('HP', -1)
        critter.poisonLevel = Math.max(0, critter.poisonLevel - 1)
        if (critter.isPlayer) {
            const msg = critter.poisonLevel >= 15 ? 'You feel extremely ill from the poison.' :
                        critter.poisonLevel >= 8  ? 'You feel sick from the poison.' :
                                                    'You feel a little sick.'
            uiLog(msg)
        }
        info(`poisonTick: ${critter.name} HP−1, poison→${critter.poisonLevel}`)
        if (critter.getStat('HP') <= 0) critterKill(critter)
        if (!critter.dead && critter.poisonLevel > 0) schedulePoisonTick(critter)
    }

    function schedulePoisonTick(critter: Critter): void {
        if (timeEventList.some(e => e.obj === critter && e.userdata === UD_POISON)) return
        timeEventList.push({ obj: critter, ticks: GameTime.POISON_TICK_INTERVAL, userdata: UD_POISON, fn: () => poisonTick(critter) })
    }

    // FO2-CE ref: stat.cc radiationEventCallback(), proto_types.h RadiationLevel enum
    // Radiation thresholds: 0-99 none, 100-199 Minor (−1 END), 200-399 Advanced (−2 END −1 AGI),
    //   400-599 Critical (−4 END −2 AGI −2 STR), 600+ Lethal (death).
    // Undoes the previously applied penalties before applying the new ones so changes are idempotent.
    function applyRadiationPenalties(critter: Critter): void {
        // Undo previous radiation penalties
        critter.stats.modifyBase('END', critter._radPenalties.END)
        critter.stats.modifyBase('AGI', critter._radPenalties.AGI)
        critter.stats.modifyBase('STR', critter._radPenalties.STR)

        const level = critter.radiationLevel
        if (level >= 600) {
            if (!critter.dead) {
                if (critter.isPlayer) uiLog('Your body can no longer withstand the radiation. You are dead.')
                critterKill(critter)
            }
            critter._radPenalties = { END: 0, AGI: 0, STR: 0 }
            return
        }

        let endPen = 0, agiPen = 0, strPen = 0
        if (level >= 400)      { endPen = 4; agiPen = 2; strPen = 2 }
        else if (level >= 200) { endPen = 2; agiPen = 1 }
        else if (level >= 100) { endPen = 1 }

        critter.stats.modifyBase('END', -endPen)
        critter.stats.modifyBase('AGI', -agiPen)
        critter.stats.modifyBase('STR', -strPen)
        critter._radPenalties = { END: endPen, AGI: agiPen, STR: strPen }

        if (critter.isPlayer && (endPen || agiPen || strPen)) {
            const msg = level >= 400 ? 'You are suffering from critical radiation poisoning!' :
                        level >= 200 ? 'You feel the effects of advanced radiation poisoning.' :
                                       'You feel slightly nauseous from radiation exposure.'
            uiLog(msg)
        }
        info(`radiation penalties: ${critter.name} level=${level} END-${endPen} AGI-${agiPen} STR-${strPen}`)
    }

    function getScriptName(id: number): string {
        // return getLstId("scripts/scripts", id - 1).split(".")[0].toLowerCase()
        return lookupScriptName(id)
    }

    function getScriptMessage(id: number, msg: string | number) {
        if (typeof msg === 'string')
            // passed in a string message
            return msg

        var name = getScriptName(id)
        if (name === null) {
            warn('getScriptMessage: no script with ID ' + id)
            return null
        }

        if (scriptMessages[name] === undefined) loadMessageFile(name)
        if (scriptMessages[name] === undefined) throw 'getScriptMessage: loadMessageFile failed?'
        if (scriptMessages[name][msg] === undefined)
            throw 'getScriptMessage: no message ' + msg + ' for script ' + id + ' (' + name + ')'

        return scriptMessages[name][msg]
    }

    export function dialogueReply(id: number): void {
        var f = dialogueOptionProcs[id]
        dialogueOptionProcs = []
        f()
        // by this point we may have already exited dialogue or switched to barter
        if (globalState.uiMode === UIMode.barter) {
            // script switched to barter mode — don't close dialogue
            return
        }
        if (currentDialogueObject !== null && dialogueOptionProcs.length === 0) {
            // after running the option procedure we have no options...
            // so close the dialogue
            dbg('dialogue', '[dialogue exit via dialogueReply (no replies)]')
            dialogueExit()
        }
    }

    export function dialogueEnd() {
        // dialogue exited from [Done] or the UI
        dbg('dialogue', '[dialogue exit via dialogueExit]')
        dialogueExit()
    }

    function dialogueExit() {
        uiEndDialogue()
        info('[dialogue exit]')

        if (currentDialogueObject) {
            // resume from when we halted in gsay_end
            var vm = currentDialogueObject._script!._vm!
            vm.pc = vm.popAddr()
            info(`[resuming from gsay_end (pc=0x${vm.pc.toString(16)})]`)
            vm.run()
        }

        currentDialogueObject = null
    }

    export function reenterDialogue(): void {
        if (!currentDialogueObject || !currentDialogueObject._script) {
            return
        }
        globalState.uiMode = UIMode.dialogue
        dialogueOptionProcs = []
        talk(currentDialogueObject._script, currentDialogueObject)
    }

    function canSee(obj: Obj, target: Obj): boolean {
        const dir = Math.abs(obj.orientation - hexDirectionTo(obj.position, target.position))
        return [0, 1, 5].indexOf(dir) !== -1
    }

    // TODO: Thoroughly test these functions (dealing with critter LOS)
    function isWithinPerception(obj: Critter, target: Critter): boolean {
        const dist = hexDistance(obj.position, target.position)
        const perception = obj.getStat('PER')
        const sneakSkill = target.getSkill('Sneak')
        let reqDist

        // TODO: Implement all of the conditionals here

        if (canSee(obj, target)) {
            reqDist = perception * 5

            if (false /* some target flags & 2 */)
                // @ts-ignore: Unreachable code error (this isn't implemented yet)
                reqDist /= 2

            if (target === globalState.player) {
                if (false /* is_pc_sneak_working */) {
                    // @ts-ignore: Unreachable code error (this isn't implemented yet)
                    reqDist /= 4

                    if (sneakSkill > 120) reqDist--
                } else if (false /* is_sneaking */)
                    // @ts-ignore: Unreachable code error (this isn't implemented yet)
                    reqDist = (reqDist * 2) / 3
            }

            if (dist <= reqDist) return true
        }

        reqDist = globalState.inCombat ? perception * 2 : perception

        if (target === globalState.player) {
            if (false /* is_pc_sneak_working */) {
                // @ts-ignore: Unreachable code error (this isn't implemented yet)
                reqDist /= 4

                if (sneakSkill > 120) reqDist--
            } else if (false /* is_sneaking */)
                // @ts-ignore: Unreachable code error (this isn't implemented yet)
                reqDist = (reqDist * 2) / 3
        }

        return dist <= reqDist
    }

    function objCanSeeObj(obj: Critter, target: Obj): boolean {
        // Is target within obj's perception, or is it a non-critter object (without perception)?
        if (target.type !== 'critter' || isWithinPerception(obj, target as Critter)) {
            // Then, is anything blocking obj from drawing a straight line to target?
            const hit = globalState.gMap.hexLinecast(obj.position, target.position)
            return !hit
        }
        return false
    }

    export interface SerializedScript {
        name: string
        lvars: { [lvar: number]: any }
    }

    interface ScriptableObj {
        _script: Script
    }

    export class Script {
        // Stuff we hacked in
        _didOverride = false // Did the procedure call override the default action?

        scriptName!: string
        lvars!: { [lvar: number]: any }
        _vm?: ScriptVM
        _mapScript?: Script

        // Special built-in variables
        self_obj!: { _script: Script }
        self_tile!: number
        cur_map_index!: number | null
        fixed_param!: number
        source_obj!: Obj | 0
        target_obj!: Obj
        action_being_used!: number
        game_time_hour!: number

        combat_is_initialized!: 0 | 1
        game_time!: number

        // Script procedure prototypes
        start!: () => void

        map_enter_p_proc!: () => void
        map_update_p_proc!: () => void

        timed_event_p_proc!: () => void

        critter_p_proc!: () => void
        spatial_p_proc!: () => void

        use_p_proc!: () => void
        talk_p_proc!: () => void
        pickup_p_proc!: () => void

        combat_p_proc!: () => void
        damage_p_proc!: () => void
        destroy_p_proc!: () => void

        use_skill_on_p_proc!: () => void

        // Actual scripting engine API implementations

        set_global_var(gvar: number, value: any) {
            globalVars[gvar] = value
            info('set_global_var: ' + gvar + ' = ' + value, 'gvars')
            log('set_global_var', arguments, 'gvars')
        }
        set_local_var(lvar: number, value: any) {
            this.lvars[lvar] = value
            info('set_local_var: ' + lvar + ' = ' + value + ' [' + this.scriptName + ']', 'lvars')
            log('set_local_var', arguments, 'lvars')
        }
        local_var(lvar: number) {
            log('local_var', arguments, 'lvars')
            if (this.lvars[lvar] === undefined) {
                warn('local_var: setting default value (0) for LVAR ' + lvar, 'lvars')
                this.lvars[lvar] = 0
            }
            return this.lvars[lvar]
        }
        map_var(mvar: number) {
            if (this._mapScript === undefined) {
                warn('map_var: no map script')
                return
            }
            var scriptName = this._mapScript.scriptName
            if (scriptName === undefined) {
                warn('map_var: map script has no name')
                return
            } else if (mapVars[scriptName] === undefined) mapVars[scriptName] = {}
            else if (mapVars[scriptName][mvar] === undefined) {
                warn('map_var: setting default value (0) for MVAR ' + mvar, 'mvars')
                mapVars[scriptName][mvar] = 0
            }
            return mapVars[scriptName][mvar]
        }
        set_map_var(mvar: number, value: any) {
            if (!this._mapScript) throw Error('set_map_var: no map script')
            var scriptName = this._mapScript.scriptName
            if (scriptName === undefined) {
                warn('map_var: map script has no name')
                return
            }
            info('set_map_var: ' + mvar + ' = ' + value, 'mvars')
            if (mapVars[scriptName] === undefined) mapVars[scriptName] = {}
            mapVars[scriptName][mvar] = value
        }
        global_var(gvar: number) {
            if (globalVars[gvar] === undefined) {
                warn('global_var: unknown gvar ' + gvar + ', using default (0)', 'gvars')
                globalVars[gvar] = 0
            }
            return globalVars[gvar]
        }
        random(min: number, max: number) {
            log('random', arguments)
            return getRandomInt(min, max)
        }
        debug_msg(msg: string) {
            log('debug_msg', arguments)
            info('DEBUG MSG: [' + this.scriptName + ']: ' + msg, 'debugMessage')
        }
        display_msg(msg: string) {
            log('display_msg', arguments)
            info('DISPLAY MSG: ' + msg, 'displayMessage')
            uiLog(msg)
        }
        message_str(msgList: number, msgNum: number) {
            return getScriptMessage(msgList, msgNum)
        }
        metarule(id: number, target: number): any {
            switch (id) {
                case 14:
                    return mapFirstRun // map_first_run
                case 15: // elevator
                    if (target !== -1) throw 'elevator given explicit type'
                    useElevator()
                    break
                case 17: // is area known?
                    return globalState.knownAreas.has(target) ? 1 : 0
                case 18:
                    return 0 // is the critter under the influence of drugs? (TODO)
                case 22:
                    return 0 // is_game_loading
                case 46: { // METARULE_CURRENT_TOWN
                    const mapName = globalState.gMap?.name
                    if (mapName && globalState.mapAreas) {
                        for (const key of Object.keys(globalState.mapAreas)) {
                            const area = globalState.mapAreas[key]
                            if (area.entrances.some(e => e.mapName === mapName))
                                return area.id
                        }
                    }
                    return 0
                }
                case 48:
                    return 2 // METARULE_VIOLENCE_FILTER (2 = VLNCLVL_NORMAL)
                case 49: // METARULE_W_DAMAGE_TYPE
                    // FO2-CE ref: combat_defs.h DMG_* constants
                    switch (objectGetDamageType(target)) {
                        case 'normal':     return 0
                        case 'laser':      return 1
                        case 'fire':       return 2
                        case 'plasma':     return 3
                        case 'electrical': return 4
                        case 'emp':        return 5
                        case 'explosion':  return 6
                        default:           return 0 // safe fallback instead of throw
                    }
                default:
                    stub('metarule', arguments)
                    break
            }
        }
        metarule3(id: number, obj: any, userdata: any, radius: number): any {
            if (id === 100) {
                // METARULE3_CLR_FIXED_TIMED_EVENTS
                for (var i = 0; i < timeEventList.length; i++) {
                    if (timeEventList[i].obj === obj && timeEventList[i].userdata === userdata) {
                        // todo: game object equals
                        info('removing timed event (userdata ' + userdata + ')', 'timer')
                        timeEventList.splice(i, 1)
                        return
                    }
                }
            } else if (id === 106) {
                // METARULE3_TILE_GET_NEXT_CRITTER
                // As far as I know, with lastCritter == 0, it just grabs the critter that is not the player at the tile. TODO: Test this!
                // TODO: use elevation
                var tile = obj,
                    elevation = userdata,
                    lastCritter = radius
                var objs = globalState.gMap.objectsAtPosition(fromTileNum(tile))
                log('metarule3 106 (tile_get_next_critter)', arguments)
                for (var i = 0; i < objs.length; i++) {
                    if (objs[i].type === 'critter' && !(<Critter>objs[i]).isPlayer) return objs[i]
                }
                return 0 // no critter found at that position (TODO: test)
            }

            stub('metarule3', arguments)
        }
        script_overrides() {
            log('script_overrides', arguments)
            info('[SCRIPT OVERRIDES]')
            this._didOverride = true
        }

        // player
        give_exp_points(xp: number) {
            if (!globalState.player) return
            globalState.player.addExperience(xp)
            uiLog(`You gain ${xp} experience points.`)
        }

        // critters
        get_critter_stat(obj: Critter, stat: number) {
            if (stat === 34) {
                // STAT_gender
                if (obj.isPlayer) return (<Player>obj).gender === 'female' ? 1 : 0
                return 0 // Default to male
            }
            var namedStat = statMap[stat]
            if (namedStat !== undefined) return obj.getStat(namedStat)
            stub('get_critter_stat', arguments)
            return 5
        }
        has_trait(traitType: number, obj: Obj, trait: number) {
            if (!isGameObject(obj)) {
                warn('has_trait: not game object: ' + obj, undefined, this)
                return 0
            }

            if (traitType === 1) {
                // TRAIT_OBJECT
                switch (trait) {
                    case 5:
                        return (<Critter>obj).aiNum ?? 0 // OBJECT_AI_PACKET
                    case 6:
                        return (<Critter>obj).teamNum ?? 0 // OBJECT_TEAM_NUM
                    case 10:
                        return obj.orientation // OBJECT_CUR_ROT
                    case 666: // OBJECT_VISIBILITY
                        return obj.visible === false ? 0 : 1 // 1 = visible, 0 = invisible
                    case 669:
                        break // OBJECT_CUR_WEIGHT (TODO)
                }
            }

            stub('has_trait', arguments)
            return 0
        }
        critter_add_trait(obj: Obj, traitType: number, trait: number, amount: number) {
            stub('critter_add_trait', arguments)

            if (!isGameObject(obj)) {
                warn('critter_add_trait: not game object: ' + obj, undefined, this)
                return
            }

            if (obj.type !== 'critter') {
                warn('critter_add_trait: not a critter: ' + obj, undefined, this)
                return
            }

            if (traitType === 1) {
                // TRAIT_OBJECT
                switch (trait) {
                    case 5: // OBJECT_AI_PACKET
                        // Set critter's AI packet number
                        info('Setting critter AI packet to ' + amount, undefined, this)
                        ;(<Critter>obj).aiNum = amount
                        break
                    case 6: // OBJECT_TEAM_NUM
                        // Set critter's team number
                        info('Setting critter team to ' + amount, undefined, this)
                        ;(<Critter>obj).teamNum = amount
                        break
                    case 10:
                        break // OBJECT_CUR_ROT (TODO)
                    case 666:
                        break // OBJECT_VISIBILITY (TODO)
                    case 669:
                        break // OBJECT_CUR_WEIGHT (TODO)
                }
            }
        }
        item_caps_total(obj: Obj) {
            if (!isGameObject(obj)) throw 'item_caps_total: not game object'
            return obj.money
        }
        item_caps_adjust(obj: Obj, amount: number) {
            if (!isGameObject(obj)) {
                warn('item_caps_adjust: not game object: ' + obj)
                return
            }
            const MONEY_PID = 41
            for (let i = 0; i < obj.inventory.length; i++) {
                if (obj.inventory[i].pid === MONEY_PID) {
                    obj.inventory[i].amount = Math.max(0, obj.inventory[i].amount + amount)
                    info('item_caps_adjust: ' + obj.name + ' caps ' + (amount >= 0 ? '+' : '') + amount)
                    return
                }
            }
            if (amount > 0) {
                const money = createObjectWithPID(MONEY_PID)
                this.add_mult_objs_to_inven(obj, money, amount)
                info('item_caps_adjust: ' + obj.name + ' caps +' + amount + ' (new)')
            }
        }
        move_obj_inven_to_obj(obj: Obj, other: Obj) {
            if (obj === null || other === null) {
                warn('move_obj_inven_to_obj: null pointer passed in')
                return
            }

            if (!isGameObject(obj) || !isGameObject(other)) {
                warn('move_obj_inven_to_obj: not game object')
                return
            }

            info('move_obj_inven_to_obj: ' + obj.inventory.length + ' to ' + other.inventory.length, 'inventory')
            other.inventory = obj.inventory
            obj.inventory = []
        }
        obj_is_carrying_obj_pid(obj: Obj, pid: number) {
            // Number of inventory items with matching PID
            log('obj_is_carrying_obj_pid', arguments)
            if (!isGameObject(obj)) {
                warn('obj_is_carrying_obj_pid: not a game object')
                return 0
            } else if (obj.inventory === undefined) {
                warn('obj_is_carrying_obj_pid: object has no inventory!')
                return 0
            }

            //info("obj_is_carrying_obj_pid: " + pid, "inventory")
            var count = 0
            for (var i = 0; i < obj.inventory.length; i++) {
                if (obj.inventory[i].pid === pid) count++
            }
            return count
        }
        add_mult_objs_to_inven(obj: Obj, item: Obj, count: number) {
            // Add count copies of item to obj's inventory
            if (!isGameObject(obj)) {
                warn('add_mult_objs_to_inven: not a game object')
                return
            } else if (!isGameObject(item)) {
                warn('add_mult_objs_to_inven: item not a game object: ' + item)
                return
            } else if (obj.inventory === undefined) {
                warn('add_mult_objs_to_inven: object has no inventory!')
                return
            }

            //info("add_mult_objs_to_inven: " + count + " counts of " + item.toString(), "inventory")
            dbg('inventory', 'add_mult_objs_to_inven: %d counts of %o to %o', count, item, obj)
            obj.addInventoryItem(item, count)
        }
        rm_mult_objs_from_inven(obj: Obj, item: Obj, count: number) {
            if (!isGameObject(obj)) {
                warn('rm_mult_objs_from_inven: not a game object')
                return
            } else if (!isGameObject(item)) {
                warn('rm_mult_objs_from_inven: item not a game object: ' + item)
                return
            } else if (obj.inventory === undefined) {
                warn('rm_mult_objs_from_inven: object has no inventory!')
                return
            }
            dbg('inventory', 'rm_mult_objs_from_inven: %d counts of %o from %o', count, item, obj)
            for (let i = 0; i < obj.inventory.length; i++) {
                if (obj.inventory[i].approxEq(item)) {
                    obj.inventory[i].amount -= count
                    if (obj.inventory[i].amount <= 0) obj.inventory.splice(i, 1)
                    return
                }
            }
            warn('rm_mult_objs_from_inven: item not found in inventory')
        }
        add_obj_to_inven(obj: Obj, item: Obj) {
            this.add_mult_objs_to_inven(obj, item, 1)
        }
        rm_obj_from_inven(obj: Obj, item: Obj) {
            this.rm_mult_objs_from_inven(obj, item, 1)
        }
        obj_carrying_pid_obj(obj: Obj, pid: number) {
            log('obj_carrying_pid_obj', arguments)
            if (!isGameObject(obj)) {
                warn('obj_carrying_pid_obj: not a game object: ' + obj)
                return 0
            }

            for (var i = 0; i < obj.inventory.length; i++) {
                if (obj.inventory[i].pid === pid) return obj.inventory[i]
            }
            return 0
        }
        elevation(obj: Obj) {
            if (isSpatial(obj) || isGameObject(obj)) return globalState.currentElevation
            else {
                warn('elevation: not an object: ' + obj)
                return -1
            }
        }
        obj_can_see_obj(a: Critter, b: Critter) {
            log('obj_can_see_obj', arguments)
            if (!isGameObject(a) || !isGameObject(b)) {
                warn(`obj_can_see_obj: not game object: a=${a} b=${b}`, undefined, this)
                return 0
            }
            return +objCanSeeObj(a, b)
        }
        obj_can_hear_obj(a: Obj, b: Obj) {
            /*stub("obj_can_hear_obj", arguments);*/ return 0
        }
        critter_mod_skill(obj: Obj, skill: number, amount: number) {
            if (!isGameObject(obj) || obj.type !== 'critter') {
                warn('critter_mod_skill: not a critter: ' + obj)
                return 0
            }
            const skillName = SKILL_NAMES[skill]
            if (!skillName) {
                warn('critter_mod_skill: unknown skill id ' + skill)
                return 0
            }
            const critter = obj as Critter
            try {
                const current = critter.skills.getBase(skillName)
                critter.skills.setBase(skillName, current + amount)
                info('critter_mod_skill: ' + obj.name + ' ' + skillName + (amount >= 0 ? '+' : '') + amount)
            } catch (e) {
                warn('critter_mod_skill: error: ' + e)
            }
            return 0
        }
        using_skill(obj: Obj, skill: number) {
            stub('using_skill', arguments)
            return 0
        }
        has_skill(obj: Obj, skill: number) {
            // FO2-CE ref: skill.cc skillGetValue() — returns the critter's effective skill value
            const skillName = SKILL_NAMES[skill] ?? `Unknown(${skill})`
            const critter = obj as Critter
            const value = (typeof critter.getSkill === 'function') ? critter.getSkill(skillName) : 0
            dbg('script', `has_skill(${skillName}, id=${skill}) → ${value}`)
            return value
        }
        roll_vs_skill(obj: Obj, skill: number, bonus: number) {
            // FO2-CE ref: skill.cc roll_vs_skill() — performs a skill roll for script checks
            // skill is a numeric ID (0-17), maps to SKILL_NAMES
            const skillName = SKILL_NAMES[skill] ?? `Unknown(${skill})`
            const critter = obj as Critter
            const skillValue = (typeof critter.getSkill === 'function') ? critter.getSkill(skillName) : 0
            const critChance = (typeof critter.getStat === 'function') ? critter.getStat('Critical Chance') : 0
            const { roll, delta } = randomRoll(skillValue + bonus, critChance)
            dbg(
                'script',
                `roll_vs_skill: ${skillName} (id=${skill}) — `
                + `base=${skillValue}, bonus=${bonus}, total=${skillValue + bonus}, `
                + `critChance=${critChance}, roll=${RollResult[roll]}(${roll}), delta=${delta}`
            )
            return roll
        }
        do_check(obj: Obj, check: number, modifier: number) {
            stub('do_check', arguments)
            return 1
        }
        is_success(roll: number) {
            // FO2-CE ref: random.h — Success=2, CriticalSuccess=3
            const result = rollIsSuccess(roll as RollResult) ? 1 : 0
            dbg('script', `is_success(${RollResult[roll] ?? roll}) → ${result}`)
            return result
        }
        is_critical(roll: number) {
            // FO2-CE ref: random.h — CriticalFailure=0, CriticalSuccess=3
            const result = rollIsCritical(roll as RollResult) ? 1 : 0
            dbg('script', `is_critical(${RollResult[roll] ?? roll}) → ${result}`)
            return result
        }
        critter_inven_obj(obj: Critter, where: number) {
            if (!isGameObject(obj)) throw 'critter_inven_obj: not game object'
            if (where === 0) return (obj as Critter).getEquippedArmor() ?? null // INVEN_TYPE_WORN
            else if (where === 1) return obj.rightHand // INVEN_TYPE_RIGHT_HAND
            else if (where === 2) return obj.leftHand // INVEN_TYPE_LEFT_HAND
            else if (where === -2) {
                warn('INVEN_TYPE_INV_COUNT', 'inventory', this)
                return 0 /*throw "INVEN_TYPE_INV_COUNT"*/
            }
            warn('critter_inven_obj: unknown where=' + where)
            return null
        }
        inven_cmds(obj: Critter, invenCmd: number, itemIndex: number): Obj | null {
            stub('inven_cmds', arguments, 'inventory')
            assert(invenCmd === 13 /* INVEN_CMD_INDEX_PTR */, 'Invalid invenCmd')
            return null
        }
        critter_attempt_placement(obj: Obj, tileNum: number, elevation: number) {
            stub('critter_attempt_placement', arguments)
            // TODO: it should find a place around tileNum if it's occupied
            return this.move_to(obj, tileNum, elevation)
        }
        critter_state(obj: Critter) {
            /*stub("critter_state", arguments);*/
            if (!isGameObject(obj)) {
                warn('critter_state: not game object: ' + obj)
                return 0
            }

            var state = 0
            if (obj.dead === true) state |= 1
            // TODO: if obj is prone, state |= 2

            return state
        }
        kill_critter(obj: Critter, deathFrame: number) {
            log('kill_critter', arguments)
            critterKill(obj)
        }
        get_poison(obj: Obj) {
            // FO2-CE ref: stat.cc stat_get_base(obj, STAT_poison_level)
            return (obj as Critter).poisonLevel ?? 0
        }
        get_pc_stat(pcstat: number) {
            // FO2-CE ref: stat.cc pcGetStat() — PCSTAT constants from stat_defs.h
            switch (pcstat) {
                case 0: // PCSTAT_unspent_skill_points
                    return globalState.player?.skills?.skillPoints ?? 0
                case 1: // PCSTAT_level
                    return globalState.player?.getStat('Level') ?? 1
                case 2: // PCSTAT_experience
                    return globalState.player?.getStat('Experience') ?? 0
                case 3: // PCSTAT_reputation
                    return globalState.player?.stats.getBase('Reputation') ?? 0
                case 4: // PCSTAT_karma
                    return globalState.player?.stats.getBase('Karma') ?? 0
                case 5: // PCSTAT_max_pc_stat (sentinel, always 5)
                    return 5
                default:
                    throw `get_pc_stat: unhandled ${pcstat}`
            }
        }
        set_pc_stat(pcstat: number, value: number) {
            // FO2-CE ref: stat.cc pcSetStat()
            const p = globalState.player
            if (!p) return -1
            switch (pcstat) {
                case 3: // PCSTAT_reputation
                    p.stats.setBase('Reputation', Math.max(-20, Math.min(20, value)))
                    return 0
                case 4: // PCSTAT_karma
                    p.stats.setBase('Karma', Math.max(-99999999, Math.min(99999999, value)))
                    return 0
                default:
                    stub('set_pc_stat', arguments)
                    return -1
            }
        }
        mod_pc_stat(pcstat: number, delta: number) {
            // FO2-CE ref: scripts.cc opModifyPcStat() — additive on top of current base
            const p = globalState.player
            if (!p) return -1
            switch (pcstat) {
                case 3: { // PCSTAT_reputation
                    const cur = p.stats.getBase('Reputation')
                    p.stats.setBase('Reputation', Math.max(-20, Math.min(20, cur + delta)))
                    return 0
                }
                case 4: { // PCSTAT_karma
                    const cur = p.stats.getBase('Karma')
                    p.stats.setBase('Karma', Math.max(-99999999, Math.min(99999999, cur + delta)))
                    return 0
                }
                default:
                    stub('mod_pc_stat', arguments)
                    return -1
            }
        }
        critter_injure(obj: Obj, how: number) {
            if (!isGameObject(obj)) {
                warn('critter_injure: not game object: ' + obj)
                return
            }
            ;(obj as Critter).injuryFlags = ((obj as Critter).injuryFlags ?? 0) | how
            if (how & 0x80) critterKill(obj as Critter)
            info('critter_injure: ' + obj.name + ' flags=0x' + how.toString(16))
        }
        critter_is_fleeing(obj: Obj) {
            if (!isGameObject(obj)) return 0
            return (obj as any).fleeing ? 1 : 0
        }
        wield_obj_critter(obj: Obj, item: Obj) {
            if (!isGameObject(obj) || obj.type !== 'critter') {
                warn('wield_obj_critter: not a critter: ' + obj)
                return
            }
            if (!isGameObject(item)) {
                warn('wield_obj_critter: item not a game object: ' + item)
                return
            }
            info('wield_obj_critter: ' + obj.name + ' wields ' + (item.name ?? item.pid))
            ;(obj as Critter).rightHand = item as any
        }
        critter_dmg(obj: Critter, damage: number, damageType: string) {
            if (!isGameObject(obj)) {
                warn('critter_dmg: not game object: ' + obj)
                return
            }
            critterDamage(obj, damage, this.self_obj as Critter, true, true, damageType)
        }
        critter_heal(obj: Obj, amount: number) {
            if (!isGameObject(obj)) {
                warn('critter_heal: not game object: ' + obj)
                return
            }
            const hp = (obj as Critter).getStat('HP')
            const maxHp = (obj as Critter).getStat('Max HP')
            const healed = Math.min(amount, maxHp - hp)
            ;(obj as Critter).stats.modifyBase('HP', healed)
            info('critter_heal: ' + obj.name + ' healed ' + healed + ' HP')
        }
        poison(obj: Obj, amount: number) {
            // FO2-CE ref: stat.cc critterAdjustPoison()
            if (!isGameObject(obj)) return
            const critter = obj as Critter
            critter.poisonLevel = Math.max(0, (critter.poisonLevel ?? 0) + amount)
            info(`poison: ${critter.name} → level ${critter.poisonLevel}`)
            if (critter.poisonLevel > 0) schedulePoisonTick(critter)
        }
        radiation_dec(obj: Obj, amount: number) {
            // FO2-CE ref: stat.cc critterAdjustRadiation() — negative delta decreases level
            if (!isGameObject(obj)) return
            const critter = obj as Critter
            critter.radiationLevel = Math.max(0, (critter.radiationLevel ?? 0) - amount)
            info(`radiation_dec: ${critter.name} → level ${critter.radiationLevel}`)
            applyRadiationPenalties(critter)
        }

        // combat
        attack_complex(
            obj: Obj,
            calledShot: number,
            numAttacks: number,
            bonus: number,
            minDmg: number,
            maxDmg: number,
            attackerResults: number,
            targetResults: number
        ) {
            info('[enter combat via attack_complex]')
            //stub("attack_complex", arguments)
            // since this isn't actually used beyond its basic form, we're not going to bother
            // implementing all of it

            // begin combat, turn starting with us
            if (Config.engine.doCombat) {
                if (isCombatActive() || globalState.combat) return // already in combat — ignore re-entry from script
                const initiator = this.self_obj as Critter
                // Mark the initiating critter hostile before combat starts so the LOS
                // scan in nextTurn() counts it as active and doesn't skip its turn.
                if (initiator && !initiator.isPlayer) initiator.hostile = true
                Combat.start(initiator)
            }
        }
        terminate_combat() {
            info('[terminate_combat]')
            if (globalState.combat) globalState.combat.forceEnd()
        }
        critter_set_flee_state(obj: Obj, isFleeing: number) {
            if (!isGameObject(obj)) {
                warn('critter_set_flee_state: not game object: ' + obj)
                return
            }
            info('critter_set_flee_state: ' + obj.name + ' fleeing=' + isFleeing)
            ;(obj as any).fleeing = !!isFleeing
        }

        // objects
        obj_is_locked(obj: Obj) {
            log('obj_is_locked', arguments)
            if (!isGameObject(obj)) {
                warn('obj_is_locked: not game object: ' + obj, undefined, this)
                return 1
            }
            return obj.locked ? 1 : 0
        }
        obj_lock(obj: Obj) {
            log('obj_lock', arguments)
            if (!isGameObject(obj)) {
                warn('obj_lock: not game object: ' + obj, undefined, this)
                return
            }
            obj.locked = true
        }
        obj_unlock(obj: Obj) {
            log('obj_unlock', arguments)
            if (!isGameObject(obj)) {
                warn('obj_unlock: not game object: ' + obj, undefined, this)
                return
            }
            obj.locked = false
        }
        obj_is_open(obj: Obj) {
            log('obj_is_open', arguments)
            if (!isGameObject(obj)) {
                warn('obj_is_open: not game object: ' + obj, undefined, this)
                return 0
            }
            return obj.open ? 1 : 0
        }
        obj_close(obj: Obj) {
            if (!isGameObject(obj)) {
                warn('obj_close: not game object: ' + obj)
                return
            }
            info('obj_close')
            if (!obj.open) return
            obj.use(this.self_obj as Critter, false)
            //stub("obj_close", arguments)
        }
        obj_open(obj: Obj) {
            if (!isGameObject(obj)) {
                warn('obj_open: not game object: ' + obj)
                return
            }
            info('obj_open')
            if (obj.open) return
            obj.use(this.self_obj as Critter, false)
            //stub("obj_open", arguments)
        }
        proto_data(pid: number, data_member: number): any {
            // FO2-CE ref: intrinsics.cc proto_data_pointer() — maps data_member IDs to PRO fields
            const pidID = pid & 0xffff
            const pro = loadPRO(pid, pidID)
            if (!pro) {
                warn('proto_data: no PRO for pid=0x' + pid.toString(16))
                return 0
            }
            const objType = (pid >> 24) & 0xff
            const extra = pro.extra ?? {}
            if (objType === 0 /* OBJ_TYPE_ITEM */) {
                // item.h DATA_MEMBER constants (fallout2-ce)
                switch (data_member) {
                    case 0: return extra.subType ?? 0       // ITEM_TYPE
                    case 1: return extra.materialID ?? 0    // ITEM_MATERIAL
                    case 2: return extra.size ?? 0          // ITEM_SIZE
                    case 3: return extra.weight ?? 0        // ITEM_WEIGHT
                    case 4: return extra.cost ?? 0          // ITEM_COST
                    case 5: return extra.invFRM ?? 0        // ITEM_INV_FID
                    case 6: return extra.itemFlags ?? 0     // ITEM_FLAGS
                    case 7: return extra.attackMode ?? 0    // ITEM_FIREMODE
                    // Weapon/Ammo/Armor subtype-specific fields start at 8
                    case 8:  return extra.animCode ?? extra.caliber ?? extra.AC ?? 0
                    case 9:  return extra.minDmg ?? extra.quantity ?? 0
                    case 10: return extra.maxDmg ?? extra['AC modifier'] ?? 0
                    case 11: return extra.dmgType ?? extra['DR modifier'] ?? 0
                    case 12: return extra.maxRange1 ?? extra.damMult ?? 0
                    case 13: return extra.maxRange2 ?? extra.damDiv ?? 0
                    case 14: return extra.projPID ?? 0
                    case 15: return extra.minST ?? 0
                    case 16: return extra.APCost1 ?? 0
                    case 17: return extra.APCost2 ?? 0
                    case 18: return extra.critFail ?? 0
                    case 19: return extra.perk ?? 0
                    case 20: return extra.rounds ?? 0
                    case 21: return extra.caliber ?? 0
                    case 22: return extra.ammoPID ?? 0
                    case 23: return extra.maxAmmo ?? 0
                    default:
                        warn('proto_data: unknown item data_member=' + data_member + ' pid=0x' + pid.toString(16))
                        return 0
                }
            } else if (objType === 1 /* OBJ_TYPE_CRITTER */) {
                // Critter proto fields — limited support; add more as scripts require them
                switch (data_member) {
                    case 0: return pro.pid ?? 0     // CRITTER_KILL_TYPE (proto pid id)
                    default:
                        warn('proto_data: critter data_member=' + data_member + ' not implemented')
                        return 0
                }
            }
            warn('proto_data: unsupported objType=' + objType + ' data_member=' + data_member)
            return 0
        }
        create_object_sid(pid: number, tile: number, elev: number, sid: number) {
            // Create object of pid and possibly script
            info('create_object_sid: pid=' + pid + ' tile=' + tile + ' elev=' + elev + ' sid=' + sid, undefined, this)

            if (elev < 0 || elev > 2) throw 'create_object_sid: elev out of range: elev=' + elev

            var obj = createObjectWithPID(pid, sid)
            if (!obj) {
                warn("create_object_sid: couldn't create object", undefined, this)
                return null
            }
            obj.position = fromTileNum(tile)

            //stub("create_object_sid", arguments)

            // TODO: if tile is valid...
            /*if(elevation !== currentElevation) {
                warn("create_object_sid: want to create object on another elevation (current=" + currentElevation + ", elev=" + elevation + ")")
                return
            }*/

            // add it to the map
            globalState.gMap.addObject(obj, elev)

            return obj
        }
        obj_name(obj: Obj) {
            return obj.name
        }
        obj_item_subtype(obj: Obj) {
            if (!isGameObject(obj)) {
                warn('obj_item_subtype: not game object: ' + obj)
                return null
            }

            if (obj.type === 'item' && obj.pro != null) return obj.pro.extra.subtype
            stub('obj_item_subtype', arguments)
            return null
        }
        anim_busy(obj: Obj) {
            log('anim_busy', arguments)
            if (!isGameObject(obj)) {
                warn('anim_busy: not game object: ' + obj)
                return false
            }
            return obj.inAnim()
        }
        obj_art_fid(obj: Obj) {
            stub('obj_art_fid', arguments)
            return 0
        }
        art_anim(fid: number): number {
            stub('art_anim', arguments)
            return 0
        }
        set_obj_visibility(obj: Obj, visibility: number) {
            if (!isGameObject(obj)) {
                warn('set_obj_visibility: not a game object: ' + obj)
                return
            }

            obj.visible = !visibility
        }
        use_obj_on_obj(obj: Obj, who: Obj) {
            if (!isGameObject(obj) || !isGameObject(who)) {
                warn('use_obj_on_obj: not game objects')
                return
            }
            info('use_obj_on_obj: ' + (obj.name ?? obj.pid) + ' on ' + (who.name ?? who.pid))
            obj.use(who as Critter, true)
        }
        use_obj(obj: Obj) {
            if (!isGameObject(obj)) {
                warn('use_obj: not a game object: ' + obj)
                return
            }
            info('use_obj: ' + (obj.name ?? obj.pid))
            obj.use(this.self_obj as Critter, true)
        }
        anim(obj: Obj, anim: number, param: number) {
            if (!isGameObject(obj)) {
                warn('anim: not a game object: ' + obj)
                return
            }
            if (anim === 1000)
                // set rotation
                obj.orientation = param
            else if (anim === 1010)
                // set frame
                obj.frame = param
            else {
                stub('anim', arguments)
                warn('anim: unknown anim request: ' + anim)
            }
        }

        // environment
        set_light_level(level: number) {
            log('set_light_level', arguments)
            // Fallout 2 passes 0..100. A call with the "default" magic
            // value releases the override and lets the time-of-day curve
            // take back over on the next map load.
            GameTime.setLightLevelOverride(level)
        }
        obj_set_light_level(obj: Obj, intensity: number, distance: number) {
            if (!isGameObject(obj)) {
                warn('obj_set_light_level: not game object: ' + obj)
                return
            }
            obj.lightRadius = distance
            obj.lightIntensity = intensity
        }
        override_map_start(x: number, y: number, elevation: number, rotation: number) {
            log('override_map_start', arguments)
            info(`override_map_start: ${x}, ${y} / elevation ${elevation}`)
            overrideStartPos = { position: { x, y }, orientation: rotation, elevation }
        }
        obj_pid(obj: Obj) {
            if (!isGameObject(obj)) {
                warn('obj_pid: not game object: ' + obj, undefined, this)
                return null
            }
            return obj.pid
        }
        obj_on_screen(obj: Obj) {
            log('obj_on_screen', arguments)
            if (!isGameObject(obj)) {
                warn('obj_on_screen: not a game object: ' + obj)
                return 0
            }
            return objectOnScreen(obj) ? 1 : 0
        }
        obj_type(obj: Obj) {
            if (!isGameObject(obj)) {
                warn('obj_type: not game object: ' + obj)
                return null
            } else if (obj.type === 'critter') return 1 // critter
            else if (obj.pid === undefined) {
                warn('obj_type: no PID')
                return null
            }
            return (obj.pid >> 24) & 0xff
        }
        destroy_object(obj: Obj) {
            // destroy object from world
            log('destroy_object', arguments)
            globalState.gMap.destroyObject(obj)
        }
        set_exit_grids(onElev: number, mapID: number, elevation: number, tileNum: number, rotation: number) {
            stub('set_exit_grids', arguments)
            for (var i = 0; i < gameObjects!.length; i++) {
                var obj = gameObjects![i]
                if (obj.type === 'misc' && obj.extra && obj.extra.exitMapID !== undefined) {
                    obj.extra.exitMapID = mapID
                    obj.extra.startingPosition = tileNum
                    obj.extra.startingElevation = elevation
                }
            }
        }

        // tiles
        tile_distance_objs(a: Obj, b: Obj) {
            if (!isSpatial(a) && !isSpatial(b) && (!isGameObject(a) || !isGameObject(b))) {
                warn('tile_distance_objs: ' + a + ' or ' + b + ' are not game objects')
                return null
            }
            return hexDistance(a.position, b.position)
        }
        tile_distance(a: number, b: number) {
            if (a === -1 || b === -1) return 9999
            return hexDistance(fromTileNum(a), fromTileNum(b))
        }
        tile_num(obj: Obj) {
            if (!isSpatial(obj) && !isGameObject(obj)) {
                warn('tile_num: not a game object: ' + obj, undefined, this)
                return null
            }
            return toTileNum(obj.position)
        }
        tile_contains_pid_obj(tile: number, elevation: number, pid: number): any {
            stub('tile_contains_pid_obj', arguments, 'tiles')
            var pos = fromTileNum(tile)
            var objects = globalState.gMap.getObjects(elevation)
            for (var i = 0; i < objects.length; i++) {
                if (objects[i].position.x === pos.x && objects[i].position.y === pos.y && objects[i].pid === pid) {
                    return objects[i]
                }
            }
            return 0 // it's not there
        }
        tile_is_visible(tile: number) {
            stub('tile_is_visible', arguments, 'tiles')
            return 1
        }
        tile_num_in_direction(tile: number, direction: number, distance: number) {
            if (distance === 0) {
                //warn("tile_num_in_direction: distance=" + distance)
                return -1
            }
            let newTile = hexInDirection(fromTileNum(tile), direction)
            for (
                var i = 0;
                i < distance - 1;
                i++ // repeat for each further distance
            )
                newTile = hexInDirection(newTile, direction)
            return toTileNum(newTile)
        }
        tile_in_tile_rect(ul: number, ur: number, ll: number, lr: number, t: number) {
            //stub("tile_in_tile_rect", arguments, "tiles")
            const _ul = fromTileNum(ul),
                _ur = fromTileNum(ur)
            const _ll = fromTileNum(ll),
                _lr = fromTileNum(lr)
            const _t = fromTileNum(t)
            return tile_in_tile_rect(_t, _ur, _lr, _ll, _ul) ? 1 : 0
        }
        tile_contains_obj_pid(tile: number, elevation: number, pid: number) {
            if (elevation !== globalState.currentElevation) {
                warn('tile_contains_obj_pid: not same elevation')
                return 0
            }
            var objs = globalState.gMap.objectsAtPosition(fromTileNum(tile))
            for (var i = 0; i < objs.length; i++) {
                if (objs[i].pid === pid) return 1
            }
            return 0
        }
        rotation_to_tile(srcTile: number, destTile: number) {
            var src = fromTileNum(srcTile),
                dest = fromTileNum(destTile)
            var hex = hexNearestNeighbor(src, dest)
            if (hex !== null) return hex.direction
            warn('rotation_to_tile: invalid hex: ' + srcTile + ' / ' + destTile)
            return -1 // TODO/XXX: what does this return if invalid?
        }
        move_to(obj: Obj, tileNum: number, elevation: number) {
            if (!isGameObject(obj)) {
                warn('move_to: not a game object: ' + obj)
                return
            }
            if (elevation !== globalState.currentElevation) {
                info('move_to: moving to elevation ' + elevation)

                if (obj instanceof Critter && obj.isPlayer) globalState.gMap.changeElevation(elevation, true)
                else {
                    globalState.gMap.removeObject(obj)
                    globalState.gMap.addObject(obj, elevation)
                }
            }
            obj.position = fromTileNum(tileNum)

            if (obj instanceof Critter && obj.isPlayer) centerCamera(obj.position)
        }

        // combat
        node998() {
            // enter combat
            dbg('script', '[enter combat]')
        }

        // dialogue
        node999() {
            // exit dialogue
            info('DIALOGUE EXIT (Node999)')
            dialogueExit()
        }
        gdialog_set_barter_mod(mod: number) {
            stub('gdialog_set_barter_mod', arguments)
        }
        gdialog_mod_barter(mod: number) {
            // switch to barter mode
            log('gdialog_mod_barter', arguments)
            dbg('dialogue', '--> barter mode')
            if (!this.self_obj) throw 'need self_obj'
            uiBarterMode(this.self_obj as Critter)
        }
        start_gdialog(msgFileID: number, obj: Obj, mood: number, headNum: number, backgroundID: number) {
            log('start_gdialog', arguments)
            info('DIALOGUE START', 'dialogue')
            if (!this.self_obj) throw 'no self_obj for start_gdialog'
            currentDialogueObject = this.self_obj as Critter
            uiStartDialogue(false, this.self_obj as Critter)
            //stub("start_gdialog", arguments)
        }
        gsay_start() {
            stub('gSay_Start', arguments)
        }
        //gSay_Option(msgList, msgID, target, reaction) { stub("gSay_Option", arguments) },
        gsay_reply(msgList: number, msgID: string | number) {
            log('gSay_Reply', arguments)
            var msg = getScriptMessage(msgList, msgID)
            if (msg === null) throw Error('gsay_reply: msg is null')
            info('REPLY: ' + msg, 'dialogue')
            uiSetDialogueReply(msg)
        }
        gsay_message(msgList: number, msgID: string | number, reaction: number) {
            // TODO: update this for ui
            log('gsay_message', arguments)
            /*
            // message with [Done] option
            var msg = msgID
            if(typeof msgID !== "string")
                msg = getScriptMessage(msgList, msgID)
            */

            // TODO: XXX: This has bitrotted, #dialogue no longer exists. [Done] needs testing.
            // $("#dialogue").append("&nbsp;&nbsp;\"" + msg + "\"<br><a href=\"javascript:dialogueEnd()\">[Done]</a><br>")
            // appendHTML($id("dialogue"), `&nbsp;&nbsp;"${msg}"<br><a href="javascript:dialogueEnd()">[Done]</a><br>`);
        }
        gsay_end() {
            // Halt the VM so the player can interact with dialogue options.
            // dialogueExit() resumes via vm.pc = vm.popAddr(); vm.run().
            info('[gsay_end: halting VM for dialogue]', 'dialogue')
            if (this._vm) this._vm.halted = true
        }
        end_dialogue() {
            info('[end_dialogue]', 'dialogue')
            dialogueExit()
        }
        giq_option(iqTest: number, msgList: number, msgID: string | number, target: any, reaction: number) {
            log('giQ_Option', arguments)
            var msg = getScriptMessage(msgList, msgID)
            if (msg === null) {
                console.warn('giq_option: msg is null')
                return
            }
            info(
                'DIALOGUE OPTION: ' + msg + ' [INT ' + (iqTest >= 0 ? '>=' + iqTest : '<=' + -iqTest) + ']',
                'dialogue'
            )

            const INT = globalState.player.getStat('INT')
            if ((iqTest > 0 && INT < iqTest) || (iqTest < 0 && INT > -iqTest)) return // not enough intelligence for this option

            dialogueOptionProcs.push(target.bind(this))
            uiAddDialogueOption(msg, dialogueOptionProcs.length - 1)
        }
        dialogue_system_enter() {
            log('dialogue_system_enter', arguments)
            if (!this.self_obj) {
                warn('dialogue_system_enter: no self_obj')
                return
            }
            talk(this.self_obj._script, this.self_obj as Obj)
        }
        float_msg(obj: Obj, msg: string, type: number) {
            log('float_msg', arguments)
            //info("FLOAT MSG: " + msg, "floatMessage")
            if (!isGameObject(obj)) {
                warn('float_msg: not game object: ' + obj)
                return
            }
            var colorMap: { [color: number]: string } = {
                // todo: take the exact values from some palette. also, yellow is ugly.
                0: 'white', //0: "yellow",
                1: 'black',
                2: 'red',
                3: 'green',
                4: 'blue',
                5: 'purple',
                6: 'white',
                7: 'red',
                8: 'white', //8: "yellow",
                9: 'white',
                10: 'dark gray',
                11: 'dark gray',
                12: 'light gray',
            }
            var color = colorMap[type]
            if (type === -2 /* FLOAT_MSG_WARNING */ || type === -1 /* FLOAT_MSG_SEQUENTIAL */) color = colorMap[9]
            globalState.floatMessages.push({
                msg: msg,
                obj: this.self_obj as Obj,
                startTime: window.performance.now(),
                color: color,
            })
        }

        // animation
        reg_anim_func(_1: any, _2: any) {
            stub('reg_anim_func', arguments, 'animation')
        }
        reg_anim_animate(obj: Obj, anim: number, delay: number) {
            if (!isGameObject(obj)) {
                warn('reg_anim_animate: not a game object')
                return
            }
            // Queue a single animation cycle; full playback timing via delay not yet implemented
            obj.singleAnimation(true, () => obj.clearAnim())
        }
        reg_anim_animate_forever(obj: Obj, anim: number) {
            log('reg_anim_animate_forever', arguments, 'animation')
            if (!isGameObject(obj)) {
                warn('reg_anim_animate_forever: not a game object')
                return
            }
            //console.log("ANIM FOREVER: " + obj.art + " / " + anim)
            if (anim !== 0) warn('reg_anim_animate_forever: anim = ' + anim)
            function animate() {
                obj.singleAnimation(false, animate)
            }
            animate()
        }
        animate_move_obj_to_tile(obj: Critter, tileNum: any, isRun: number) {
            log('animate_move_obj_to_tile', arguments, 'movement')
            if (!isGameObject(obj)) {
                warn('animate_move_obj_to_tile: not a game object', 'movement', this)
                return
            }
            // XXX: is this correct? FCMALPNK passes a procedure name
            // but is it a call (wouldn't make sense for NOption) or
            // a procedure reference that this should call?
            if (typeof tileNum === 'function') tileNum = tileNum.call(this)
            if (isNaN(tileNum)) {
                warn('animate_move_obj_to_tile: invalid tile num', 'movement', this)
                return
            }

            var tile = fromTileNum(tileNum)
            if (tile.x < 0 || tile.x >= 200 || tile.y < 0 || tile.y >= 200) {
                warn(
                    'animate_move_obj_to_tile: invalid tile: ' + tile.x + ', ' + tile.y + ' (' + tileNum + ')',
                    'movement',
                    this
                )
                return
            }
            if (!obj.walkTo(tile, !!isRun)) {
                warn('animate_move_obj_to_tile: no path', 'movement', this)
                return
            }
        }
        reg_anim_obj_move_to_tile(obj: Obj, tileNum: number, delay: number) {
            if (!isGameObject(obj)) {
                warn('reg_anim_obj_move_to_tile: not a game object', 'movement', this)
                return
            }
            if (isNaN(tileNum)) {
                warn('reg_anim_obj_move_to_tile: invalid tile num', 'movement', this)
                return
            }
            const tile = fromTileNum(tileNum)
            const critter = obj as Critter
            if (typeof critter.walkTo === 'function') {
                if (!critter.walkTo(tile, false))
                    warn('reg_anim_obj_move_to_tile: no path to tile ' + tileNum, 'movement', this)
            } else {
                obj.position = tile
            }
        }

        animate_stand_obj(obj: Critter) {
            if (!isGameObject(obj)) return
            if (typeof obj.clearAnim === 'function') obj.clearAnim()
        }

        explosion(tile: number, elevation: number, damage: number) {
            log('explosion', arguments)

            // TODO: objectExplode should defer to an auxillary tile explode function, which we should use
            // Make dummy object so we can explode at the tile
            var explosives = createObjectWithPID(makePID(0 /* items */, 85 /* Plastic Explosives */), -1)
            explosives.position = fromTileNum(tile)
            globalState.gMap.addObject(explosives)
            explosives.explode(explosives, 0, 100) // TODO: min/max dmg?
            globalState.gMap.removeObject(explosives)
        }

        gfade_out(time: number) {
            log('gfade_out', arguments)
            if (!fadeOverlay) {
                fadeOverlay = document.createElement('div')
                Object.assign(fadeOverlay.style, {
                    position: 'fixed', top: '0', left: '0',
                    width: '100%', height: '100%',
                    background: 'black', opacity: '0',
                    pointerEvents: 'none', zIndex: '8000',
                    transition: `opacity ${time}ms linear`,
                })
                document.body.appendChild(fadeOverlay)
            }
            // Force reflow so the transition fires from 0
            void fadeOverlay.offsetWidth
            fadeOverlay.style.opacity = '1'
        }
        gfade_in(time: number) {
            log('gfade_in', arguments)
            if (!fadeOverlay) return
            fadeOverlay.style.transition = `opacity ${time}ms linear`
            fadeOverlay.style.opacity = '0'
            fadeOverlay.addEventListener('transitionend', () => {
                if (fadeOverlay) {
                    fadeOverlay.remove()
                    fadeOverlay = null
                }
            }, { once: true })
        }

        // timing
        add_timer_event(obj: Obj, ticks: number, userdata: any) {
            log('add_timer_event', arguments)
            if (!obj || !obj._script) {
                warn('add_timer_event: not a scriptable object: ' + obj)
                return
            }
            info('timer event added in ' + ticks + ' ticks (userdata ' + userdata + ')', 'timer')
            // trigger timedEvent in `ticks` game ticks
            timeEventList.push({
                ticks: ticks,
                obj: obj,
                userdata: userdata,
                fn: function () {
                    timedEvent(obj._script!, userdata)
                }.bind(this),
            })
        }
        rm_timer_event(obj: Obj) {
            log('rm_timer_event', arguments)
            info('rm_timer_event: ' + obj + ', ' + obj.pid)
            for (var i = 0; i < timeEventList.length; i++) {
                const timedEvent = timeEventList[i]
                if (timedEvent.obj && timedEvent.obj.pid === obj.pid) {
                    // TODO: better object equality
                    info('removing timed event for obj')
                    timeEventList.splice(i--, 1)
                    break
                }
            }
        }
        game_ticks(seconds: number) {
            return seconds * 10
        }
        game_time_advance(ticks: number) {
            log('game_time_advance', arguments)
            info('advancing time ' + ticks + ' ticks ' + '(' + ticks / 10 + ' seconds)')
            GameTime.advanceTicks(ticks)
        }

        // game
        load_map(map: number | string, startLocation: number) {
            log('load_map', arguments)
            info('load_map: ' + map)
            if (typeof map === 'string') globalState.gMap.loadMap(map.split('.')[0].toLowerCase())
            else globalState.gMap.loadMapByID(map)
        }
        play_gmovie(movieID: number) {
            // FO2 .mve movies are not converted/supported yet.
            // Log and skip gracefully so scripts don't hang.
            info('play_gmovie: movie ' + movieID + ' (not implemented — skipping)')
            uiLog('[Movie ' + movieID + ' skipped]')
        }
        mark_area_known(areaType: number, areaID: number, state: number) {
            // areaType: 0 = AREATYPE_KNOWN, 1 = AREATYPE_ENTRANCE_KNOWN
            // state: 1 = mark known, 0 = mark unknown
            log('mark_area_known', arguments)
            if (state === 1) globalState.knownAreas.add(areaID)
            else globalState.knownAreas.delete(areaID)
            info('mark_area_known: area ' + areaID + ' → ' + (state ? 'known' : 'unknown'))
        }
        wm_area_set_pos(area: number, x: number, y: number) {
            stub('wm_area_set_pos', arguments)
        }
        game_ui_disable() {
            stub('game_ui_disable', arguments)
        }
        game_ui_enable() {
            stub('game_ui_enable', arguments)
        }

        // sound
        play_sfx(sfx: string) {
            if (!globalState.audioEngine) return
            globalState.audioEngine.playSfx(sfx.toLowerCase())
        }

        // party
        party_member_obj(pid: number) {
            log('party_member_obj', arguments, 'party')
            return globalState.gParty.getPartyMemberByPID(pid) || 0
        }
        party_add(obj: Critter) {
            log('party_add', arguments)
            globalState.gParty.addPartyMember(obj)
        }
        party_remove(obj: Critter) {
            log('party_remove', arguments)
            globalState.gParty.removePartyMember(obj)
        }

        _serialize(): SerializedScript {
            return { name: this.scriptName, lvars: Object.assign({}, this.lvars) }
        }
    }

    export function deserializeScript(obj: SerializedScript): Script {
        var script = loadScript(obj.name)
        script.lvars = obj.lvars
        // TODO: do some kind of logic like enterMap/updateMap
        return script
    }

    function loadMessageFile(name: string) {
        name = name.toLowerCase()
        info('loading message file: ' + name, 'load')
        var msg = getFileText('data/text/english/dialog/' + name + '.msg')
        if (scriptMessages[name] === undefined) scriptMessages[name] = {}

        // parse message file
        var lines = msg.split(/\r|\n/)

        // preprocess and merge lines
        for (var i = 0; i < lines.length; i++) {
            // comments/blanks
            if (lines[i][0] === '#' || lines[i].trim() === '') {
                lines.splice(i--, 1)
                continue
            }

            // probably a continuation -- merge it with the last line
            if (lines[i][0] !== '{') {
                lines[i - 1] += lines[i]
                lines.splice(i--, 1)
                continue
            }
        }

        for (var i = 0; i < lines.length; i++) {
            // e.g. {100}{}{You have entered a dark cave in the side of a mountain.}
            var m = lines[i].match(/\{(\d+)\}\{.*\}\{(.*)\}/)
            if (m === null) throw 'message parsing: not a valid line: ' + lines[i]
            // HACK: replace unicode replacement character with an apostrophe (because the Web sucks at character encodings)
            scriptMessages[name][parseInt(m[1])] = m[2].replace(/\ufffd/g, "'")
        }
    }

    export function setMapScript(script: Script) {
        currentMapObject = script
    }

    // --- Stub script registry ---
    // When a .int file is absent, JS-defined stubs let the engine preserve
    // expected spatial/destroy behaviour. Keyed by lowercase script name and,
    // independently, by proto SID number (avoids depending on scripts.lst
    // resolution to find the canonical name).
    const _stubRegistry = new Map<string, Partial<Script>>()
    const _stubBySid = new Map<number, Partial<Script>>()

    export function registerStub(name: string, procs: Partial<Script>): void {
        _stubRegistry.set(name.toLowerCase(), procs)
    }

    export function registerStubBySid(sid: number, name: string, procs: Partial<Script>): void {
        _stubBySid.set(sid, procs)
        _stubRegistry.set(name.toLowerCase(), procs)
    }

    function _buildStub(name: string, procs: Partial<Script>): Script {
        const stub = Object.create(Script.prototype) as Script
        stub.scriptName = name
        stub.lvars = {}
        stub._mapScript = currentMapObject ?? stub
        Object.assign(stub, procs)
        return stub
    }

    export function loadScriptBySid(sid: number): Script | null {
        const procs = _stubBySid.get(sid)
        if (!procs) return null
        info('loading stub script for sid=' + sid, 'load')
        return _buildStub(`stub:sid${sid}`, procs)
    }

    export function loadScript(name: string): Script {
        const key = name.toLowerCase()

        // Return a stub if one is registered and the .int file is absent.
        // The stub is an instance of Script so it has all the engine API methods.
        const stubProcs = _stubRegistry.get(key)
        if (stubProcs) {
            info('loading stub script ' + key, 'load')
            return _buildStub(key, stubProcs)
        }

        info('loading script ' + name, 'load')

        var path = 'data/scripts/' + name.toLowerCase() + '.int'
        var data: DataView = getFileBinarySync(path)
        var reader = new BinaryReader(data)
        //console.log("[%s] loaded %d bytes", name, reader.length)
        var intfile = parseIntFile(reader, name.toLowerCase())

        //console.log("%s int file: %o", name, intfile)

        if (!currentMapObject)
            dbg('load', 'note: using current script (%s) as map script for this object', intfile.name)

        reader.seek(0)
        var vm = new ScriptVMBridge.GameScriptVM(reader, intfile)
        vm.scriptObj.scriptName = name
        vm.scriptObj.lvars = {}
        vm.scriptObj._mapScript = currentMapObject || vm.scriptObj // map scripts are their own map scripts
        vm.scriptObj._vm = vm
        vm.run()

        // return the scriptObj, which is a clone of ScriptProto
        // which will be patched by the GameScriptVM to allow
        // transparent procedure calls
        return vm.scriptObj
    }

    export function initScript(script: Script, obj: Obj) {
        script.self_obj = obj as ScriptableObj
        script.cur_map_index = currentMapID!
        if (script.start !== undefined) script.start()
    }

    export function timedEvent(script: Script, userdata: any): boolean {
        info('timedEvent: ' + script.scriptName + ': ' + userdata, 'timer')
        if (script.timed_event_p_proc === undefined) {
            warn(
                `timedEvent called on script without a timed_event_p_proc! script: ${script.scriptName} userdata: ${userdata}`
            )
            return false
        }

        script.fixed_param = userdata
        script._didOverride = false
        script.timed_event_p_proc()
        return script._didOverride
    }

    export function use(obj: Obj, source: Obj): boolean | null {
        if (!obj._script || obj._script.use_p_proc === undefined) return null

        obj._script.source_obj = source
        obj._script.self_obj = obj as ScriptableObj
        obj._script._didOverride = false
        obj._script.use_p_proc()
        return obj._script._didOverride
    }

    export function talk(script: Script, obj: Obj): boolean {
        script.self_obj = obj as ScriptableObj
        script.game_time = Math.max(1, globalState.gameTickTime)
        script.cur_map_index = currentMapID
        script._didOverride = false
        script.talk_p_proc()
        return script._didOverride
    }

    export function updateCritter(script: Script, obj: Critter): boolean {
        // critter heartbeat (critter_p_proc)
        if (!script.critter_p_proc) return false // TODO: Should we override or not if it doesn't exist? Probably not.

        script.game_time = globalState.gameTickTime
        script.cur_map_index = currentMapID
        script._didOverride = false
        script.self_obj = obj as ScriptableObj
        script.self_tile = toTileNum(obj.position)
        script.critter_p_proc()
        return script._didOverride
    }

    export function spatial(spatialObj: Obj, source: Obj) {
        // TODO: Spatial type
        const script = spatialObj._script
        if (!script) throw Error('spatial without a script being triggered')
        if (!script.spatial_p_proc) throw Error('spatial script without a spatial_p_proc triggered')

        script.game_time = globalState.gameTickTime
        script.cur_map_index = currentMapID
        script.source_obj = source
        script.self_obj = spatialObj as ScriptableObj
        script.spatial_p_proc()
    }

    export function destroy(obj: Obj, source?: Obj) {
        if (!obj._script || !obj._script.destroy_p_proc) return null

        obj._script.self_obj = obj as ScriptableObj
        obj._script.source_obj = source || 0
        obj._script.game_time = Math.max(1, globalState.gameTickTime)
        obj._script.cur_map_index = currentMapID
        obj._script._didOverride = false
        obj._script.destroy_p_proc()
        return obj._script._didOverride
    }

    export function damage(obj: Obj, target: Obj, source: Obj, damage: number) {
        if (!obj._script || obj._script.damage_p_proc === undefined) return null

        obj._script.self_obj = obj as ScriptableObj
        obj._script.target_obj = target
        obj._script.source_obj = source
        obj._script.game_time = Math.max(1, globalState.gameTickTime)
        obj._script.cur_map_index = currentMapID
        obj._script._didOverride = false
        obj._script.damage_p_proc()
        return obj._script._didOverride
    }

    export function useSkillOn(who: Critter, skillId: number, obj: Obj): boolean {
        if (!obj._script) throw Error('useSkillOn: Object has no script')
        const skillName = SKILL_NAMES[skillId] ?? `Unknown(${skillId})`
        dbg('script', `useSkillOn: ${who.name ?? 'unknown'} uses ${skillName} (id=${skillId}) on ${obj.name ?? obj.type ?? 'unknown'}`)
        obj._script.self_obj = obj as ScriptableObj
        obj._script.source_obj = who
        obj._script.cur_map_index = currentMapID
        obj._script._didOverride = false
        obj._script.action_being_used = skillId
        if (!obj._script.use_skill_on_p_proc) return false
        obj._script.use_skill_on_p_proc()
        dbg('script', `useSkillOn result: _didOverride=${obj._script._didOverride}`)
        return obj._script._didOverride
    }

    export function pickup(obj: Obj, source: Critter): boolean {
        if (!obj._script) throw Error('pickup: Object has no script')
        obj._script.self_obj = obj as ScriptableObj
        obj._script.source_obj = source
        obj._script.cur_map_index = currentMapID
        obj._script._didOverride = false
        obj._script.pickup_p_proc()
        return obj._script._didOverride
    }

    export function combatEvent(obj: Obj, event: 'turnBegin' | 'damage'): boolean {
        if (!obj._script) throw Error('combatEvent: Object has no script')

        let fixed_param: number | null = null
        switch (event) {
            case 'turnBegin':
                fixed_param = 4
                break // COMBAT_SUBTYPE_TURN
            case 'damage':
                fixed_param = 2
                break // COMBAT_SUBTYPE_DAMAGE_TAKE
            default:
                throw 'combatEvent: unknown event ' + event
        }

        if (!obj._script.combat_p_proc) return false

        info('[COMBAT EVENT ' + event + ']')

        obj._script.combat_is_initialized = 1
        obj._script.fixed_param = fixed_param
        obj._script.self_obj = obj as ScriptableObj
        obj._script.game_time = Math.max(1, globalState.gameTickTime)
        obj._script.cur_map_index = currentMapID
        obj._script._didOverride = false

        // TODO: script_overrides

        // hack so that the procedure is allowed to finish before
        // we actually terminate combat
        var doTerminate: any = false // did combat_p_proc terminate combat?
        obj._script.terminate_combat = function () {
            doTerminate = true
        }
        obj._script.combat_p_proc()

        if (doTerminate) {
            dbg('script', 'terminate_combat invoked from combat_p_proc')
            Script.prototype.terminate_combat.call(obj._script) // call original
        }

        return doTerminate
    }

    export function updateMap(mapScript: Script, objects: Obj[], elevation: number) {
        gameObjects = objects
        mapFirstRun = false

        if (mapScript) {
            mapScript.combat_is_initialized = globalState.inCombat ? 1 : 0
            if (mapScript.map_update_p_proc !== undefined) {
                mapScript.self_obj = { _script: mapScript }
                mapScript.map_update_p_proc()
            }
        }

        var updated = 0
        for (var i = 0; i < gameObjects.length; i++) {
            var script = gameObjects[i]._script
            if (script !== undefined && script.map_update_p_proc !== undefined) {
                script.combat_is_initialized = globalState.inCombat ? 1 : 0
                script.self_obj = gameObjects[i] as ScriptableObj
                script.game_time = Math.max(1, globalState.gameTickTime)
                // Fallout 2 style HHMM: "8:24 AM" => 824, "3:00 PM" => 1500
                script.game_time_hour = GameTime.getHourMilitary()
                script.cur_map_index = currentMapID
                script.map_update_p_proc()
                updated++
            }
        }

        // info("updated " + updated + " objects")
    }

    export function enterMap(
        mapScript: Script,
        objects: Obj[],
        elevation: number,
        mapID: number,
        isFirstRun: boolean
    ): StartPos | null {
        gameObjects = objects
        currentMapID = mapID
        mapFirstRun = isFirstRun

        // Fallout 2 resets ambient light to max on every map load; any
        // script darkness is reapplied by the new map's map_enter_p_proc.
        GameTime.clearLightLevelOverride()

        if (mapScript && mapScript.map_enter_p_proc !== undefined) {
            info('calling map enter')
            mapScript.self_obj = { _script: mapScript }
            mapScript.map_enter_p_proc()
        }

        if (overrideStartPos) {
            const r = overrideStartPos
            overrideStartPos = null
            return r
        }

        // XXX: caller should do this for all objects, which is better?
        /*for(var i = 0; i < gameObjects.length; i++) {
            objectEnterMap(gameObjects[i], elevation, mapID)			
        }*/

        return null
    }

    export function objectEnterMap(obj: Obj, elevation: number, mapID: number) {
        var script = obj._script
        if (script !== undefined && script.map_enter_p_proc !== undefined) {
            script.combat_is_initialized = 0
            script.self_obj = obj as ScriptableObj
            script.game_time = Math.max(1, globalState.gameTickTime)
            script.game_time_hour = GameTime.getHourMilitary()
            script.cur_map_index = currentMapID
            script.map_enter_p_proc()
        }
    }

    export function reset(mapName: string, mapID?: number) {
        timeEventList.length = 0 // clear timed events
        dialogueOptionProcs.length = 0
        gameObjects = null
        currentMapObject = null
        currentMapID = mapID !== undefined ? mapID : null
        mapVars = {}
        loadMapVars(mapName)
    }

    export function init(mapName: string, mapID?: number) {
        seed(123)
        loadGlobalVars()
        reset(mapName, mapID)
    }

    export function give_exp_points(xp: number) {
        if (!globalState.player) return
        globalState.player.addExperience(xp)
    }

    // --- Built-in stubs for scripts whose .int files are not shipped ---

    // ACTemDor: Temple of Trials wall/floor scenery script (proto SID 203).
    // spatial_p_proc fires when an explosion blast hits the object's tile,
    // and the vanilla implementation calls obj_destroy(self_obj) to remove
    // the wall tile and open the passage. Registered by both name and SID
    // so it works even when scripts.lst is missing or resolves to a name
    // other than 'ACTemDor.int'.
    registerStubBySid(203, 'actemdor', {
        spatial_p_proc(this: Script) {
            const self = this.self_obj as unknown as Obj
            if (!self) return
            dbg('script', `actemdor stub: destroying ${self.type} pid=${self.pid}`)
            globalState.gMap?.destroyObject(self)
        },
    })

    // AIBkDor: cave door script on acavedr2 (pid=33555364) in the Temple of
    // Trials. Vanilla spatial_p_proc removes the intact door and places the
    // destroyed rubble variant (acavedr3, pid=33555365) at the same tile with
    // NoBlock flags so pathfinding allows movement through it.
    // AIBkDor.int does not export spatial_p_proc, so we stub it here.
    registerStub('aibkdor', {
        spatial_p_proc(this: Script) {
            const self = this.self_obj as unknown as Obj
            if (!self) return
            const pos = { ...self.position }
            dbg('script', `AIBkDor stub: removing acavedr2 pid=${self.pid} @ (${pos.x},${pos.y})`)
            globalState.gMap?.destroyObject(self)

            // Spawn acavedr3 (destroyed rubble) at the same tile.
            // pid 33555365 = (2 << 24) | 933 = scenery, pidID 933.
            // flags 0xA0008010 = 2684387344, includes NoBlock (bit 4).
            const rubble = createObjectWithPID(33555365, -1)
            if (rubble && globalState.gMap) {
                rubble.position = pos
                rubble.flags = 2684387344
                if (rubble.pro) rubble.pro.flags = 2684387344
                globalState.gMap.addObject(rubble)
                globalState.gMap.updateMap()
            }
        },
    })
}

if (typeof window !== 'undefined') {
    ;(window as any).Scripting = Scripting
}
