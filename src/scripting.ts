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

import { FIDGET_BAD, FIDGET_GOOD, FIDGET_NEUTRAL, GAME_DIALOG_REACTION_NEUTRAL, reactToOption, startLips, startTalkingHead, talkToCritterReacts, isTalkingHeadActive } from './talkingHead.js'
import { gameMoviePlay, SCRIPT_MOVIE_FLAGS } from './gameMovie.js'
import { randomInit, randomSeedPrerandom } from './random.js'
import { critterAdjustRadiation } from './radiation.js'
import { Combat, isCombatActive } from './combat.js'
import { critterDamage, critterKill, killCounts } from './critter.js'
import { areaContainingMap, getLstJson, lookupMapName, lookupScriptName, setMapMusicOverride } from './data.js'
import { CHEM_USE_MAP, getAiPacket } from './aiPackets.js'
import * as GameTime from './gametime.js'
import {
    hexDirectionTo,
    hexDistance,
    hexInDirection,
    hexNearestNeighbor,
    Point,
    tile_in_tile_rect,
} from './geometry.js'
import { Lightmap } from './lightmap.js'
import globalState from './globalState.js'
import { parseIntFile } from './intfile.js'
import { dbg, dbgWarn } from './logger.js'
import { useElevator } from './main.js'
import { Critter, createObjectWithPID, Obj, objectGetDamageType, zsort } from './object.js'
import { applyPerk, CE_PERKS, getPerkRank, perkApplyEffect, perkNameById, PERKS } from './perks.js'
import { Player } from './player.js'
import { loadPRO, lookupArt, makePID } from './pro.js'
import * as Endgame from './endgame.js'
import { centerCamera, objectOnScreen } from './renderer.js'
import { fromTileNum, toTileNum } from './tile.js'
import { uiAddDialogueOption, uiBarterMode, uiDrawWeapon, uiEndDialogue, uiLog, uiSetDialogueReply, uiStartDialogue, uiWorldMap, UIMode } from './ui.js'
import { updateIndicatorBar } from './ui_hud.js'
import { SKILL_NAMES } from './skills.js'
import { arrayRemove, assert, BinaryReader, getFileBinarySync, getFileJSON, getFileText, getMessage, getRandomInt, randomRoll, RollResult, rollIsSuccess, rollIsCritical } from './util.js'
import { ScriptVM } from './vm.js'
import { Worldmap } from './worldmap.js'
import { ScriptVMBridge } from './vm_bridge.js'
import { processMidnightForDay } from './gameTick.js'
import { Config } from './config.js'
import { refreshStealthState } from './miscItem.js'

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
    var dialogueOptionTexts: string[] = [] // parallel to dialogueOptionProcs — display text, for the review log
    var dialogueOptionReactions: number[] = [] // parallel — GAME_DIALOG_REACTION_* (head reaction on pick)
    var scriptMessageAudio: { [msgFile: string]: { [msgID: number]: string } } = {} // {id}{audio}{text} middle field
    var currentDialogueObject: Obj | null = null

    // Conversation review log. CE ref: game_dialog.cc gDialogReviewEntries —
    // every NPC line (gsay_reply/gsay_message) paired with whichever option
    // text the player picked in response (set once the player actually
    // chooses, game_dialog.cc:2040-2044 _gdProcessChoice), shown via the
    // Review button (game_dialog.cc:1512 gameDialogReviewButtonOnMouseUp).
    export interface DialogueReviewEntry {
        reply: string
        option: string | null
    }
    var dialogueReviewLog: DialogueReviewEntry[] = []

    export function getDialogueReviewLog(): readonly DialogueReviewEntry[] {
        return dialogueReviewLog
    }
    export var timeEventList: TimedEvent[] = []
    // CE ref: game_vars.h GVAR_TOWN_REP_* — maps each town-reputation GVAR index
    // (verified against CE source; indices are NOT contiguous) to its display name.
    // character_editor.cc gTownReputationEntries[TOWN_REPUTATION_COUNT=19].
    export const TOWN_REP_GVARS: { [gvar: number]: string } = {
        47: 'Arroyo', 48: 'Klamath', 49: 'The Den', 50: 'Vault City',
        51: 'Gecko', 52: 'Modoc', 53: 'Sierra Base', 54: 'Broken Hills',
        55: 'New Reno', 56: 'Redding', 57: 'NCR', 59: 'Vault 13',
        61: 'San Francisco', 63: 'Abbey', 64: 'EPA', 65: 'Primitive Tribe',
        66: 'Raiders', 294: 'Vault 15', 308: 'Ghost Farm',
    }
    let overrideStartPos: StartPos | null = null
    let fadeOverlay: HTMLDivElement | null = null

    // Per-dialogue barter modifier set by gdialog_set_barter_mod.
    // Reset to 0 on dialogue exit. Applied as a percentage markup in ui_barter.ts.
    // ref: fallout2-ce barter.cc, dialog.cc gDialogSetBarterMod
    let dialogueBarterMod = 0

    export function getDialogueBarterMod(): number { return dialogueBarterMod }

    // Animation batch (reg_anim_begin / reg_anim_end queue)
    // ref: fallout2-ce animation.cc animationRegAnimFunc / animationRegAnimAnimate
    interface AnimStep { kind: 'animate'; obj: Obj; anim: number; delay: number; reversed?: boolean }
    interface AnimFunc  { kind: 'func';    fn: (() => void) | null }
    type AnimEntry = AnimStep | AnimFunc
    let animBatch: AnimEntry[] | null = null

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

    export interface SerializedTimedEvent {
        objPid: number | null
        ticks: number
        userdata: any
    }

    var statMap: { [stat: number]: string } = {
        0: 'STR',
        1: 'PER',
        2: 'END',
        3: 'CHA',
        4: 'INT',
        5: 'AGI',
        6: 'LUK',
        7: 'Max HP',
        9: 'AC',
        // CE stat_defs.h: 11=STAT_MELEE_DAMAGE, 12=STAT_CARRY_WEIGHT, 14=STAT_HEALING_RATE
        11: 'Melee',
        12: 'Carry',
        14: 'Healing Rate',
        15: 'Critical Chance',
        16: 'Better Criticals',
        35: 'HP',
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

    // CE ref: critter.cc:327 critterAdjustPoison — player only. Positive amounts are
    // reduced by poison resistance; a positive result (re)schedules the decay event at
    // 10*(505-5*poison) ticks; messages misc.msg 3000/3002/3003.
    export function adjustPoison(critter: Critter, amount: number): void {
        if (critter !== globalState.player) return
        if (amount > 0) {
            amount -= Math.trunc(amount * (critter.getStat('DR Poison') ?? 0) / 100)
        } else if ((critter.poisonLevel ?? 0) <= 0) {
            return
        }
        const newPoison = (critter.poisonLevel ?? 0) + amount
        let msgId: number
        if (newPoison > 0) {
            critter.poisonLevel = newPoison
            // CE: _queue_clear_type(EVENT_TYPE_POISON) — neutralised in place because this
            // also runs from inside the gameTick timed-event loop (via poisonDecayEvent).
            for (const e of timeEventList) {
                if (e.obj === critter && e.userdata === 'poison' && e.ticks > 0) {
                    e.userdata = 'poison-cancelled'; e.fn = () => {}; e.ticks = 1
                }
            }
            timeEventList.push({ obj: critter, ticks: 10 * (505 - 5 * newPoison), userdata: 'poison', fn: () => poisonDecayEvent(critter) })
            msgId = amount < 0 ? 3002 : 3000 // "You feel a little better." / "You have been poisoned!"
        } else {
            critter.poisonLevel = 0
            msgId = 3003 // "You feel better."
        }
        const msg = getMessage('misc', msgId)
        if (msg) uiLog(msg)
        updateIndicatorBar()
    }

    // CE ref: critter.cc:378 poisonEventProcess — -2 poison (reschedules), -1 HP, msg 3001.
    export function poisonDecayEvent(critter: Critter): void {
        if (!critter || critter.dead || critter !== globalState.player) return
        adjustPoison(critter, -2)
        const hp = critter.getStat('HP') - 1
        critter.stats.setBase('HP', Math.min(hp, critter.getStat('Max HP')))
        const msg = getMessage('misc', 3001) // "You take damage from poison."
        if (msg) uiLog(msg)
        if (hp <= 0 && !critter.dead) critterKill(critter, undefined, true)
    }

    export function setGlobalVar(gvar: number, value: number): void {
        globalVars[gvar] = value
    }

    // CE random.cc — seeding goes to the ported Park-Miller generator (src/random.ts);
    // Math.random is no longer overridden.
    function seed(s: number) {
        randomSeedPrerandom(Math.abs(Math.trunc(s)) % 0x7fffffff)
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

    export function getMapVars(): any {
        return mapVars
    }

    export function setMapVars(vars: any): void {
        mapVars = vars ?? {}
    }

    // CE ref: scripts.cc scriptsSaveProcedureNames — timed events persisted with map save
    export function getTimedEventsSerialized(): SerializedTimedEvent[] {
        return timeEventList.map(e => ({
            objPid: e.obj?.pid ?? null,
            ticks: e.ticks,
            userdata: e.userdata,
        }))
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
            dbg('load', 'loadGlobalVars: gvars.json not found, using defaults (' + e.message + ')')
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

    // CE scripts.cc:2726 _scr_get_msg_str_speech(…, a3=1): with a talking head
    // active, a reply whose message has a speech name starts the lip-synced audio.
    function speakScriptMessage(msgList: number, msgID: string | number): void {
        if (typeof msgID !== 'number' || !isTalkingHeadActive()) return
        const name = getScriptName(msgList)
        if (!name) return
        const audio = scriptMessageAudio[name.toLowerCase()]?.[msgID]
        if (audio) startLips(audio)
        else dbg('dialogue', `Missing speech name: ${msgID}`)
    }

    export function dialogueReply(id: number): void {
        var f = dialogueOptionProcs[id]
        // CE ref: game_dialog.cc:2040-2044 _gdProcessChoice — records the
        // chosen option's text onto the most recent review entry, before
        // running its callback (which may clear/replace state).
        const pickedText = dialogueOptionTexts[id]
        // CE game_dialog.cc _gdProcessChoice → _talk_to_critter_reacts(option reaction).
        reactToOption(dialogueOptionReactions[id] ?? GAME_DIALOG_REACTION_NEUTRAL)
        dialogueOptionReactions = []
        if (dialogueReviewLog.length > 0 && pickedText !== undefined) {
            dialogueReviewLog[dialogueReviewLog.length - 1].option = pickedText
        }
        dialogueOptionProcs = []
        dialogueOptionTexts = []
        dialogueOptionReactions = []
        f()
        // by this point the option's callback may have switched to an
        // entirely different screen (barter, companion control/customize) —
        // the "no more options, close dialogue" logic below only applies if
        // we're still actually showing the dialogue UI. Checking only for
        // UIMode.barter (pre-2026-06-22) missed companionControl, causing
        // dialogueExit() to fire immediately after opening Combat Control —
        // hiding the dialogue UI instantly and nulling currentDialogueObject
        // out from under it.
        if (globalState.uiMode !== UIMode.dialogue) {
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
        dialogueBarterMod = 0
        info('[dialogue exit]')

        if (currentDialogueObject) {
            // resume from when we halted in gsay_end or gsay_message
            var vm = currentDialogueObject._script!._vm!
            vm.pc = vm.popAddr()
            info(`[resuming from gsay_end/gsay_message (pc=0x${vm.pc.toString(16)})]`)
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
        dialogueOptionTexts = []
        dialogueOptionReactions = []
        talk(currentDialogueObject._script, currentDialogueObject)
    }

    /** Returns the number of currently pending dialogue option procs.
     *  Used by the AutoCrawler to check whether options are visible without DOM access. */
    export function getDialogueOptionCount(): number {
        return dialogueOptionProcs.length
    }


    /** Seed Math.random for deterministic crawler runs. */
    export function setSeed(n: number): void {
        seed(n)
    }

    function canSee(obj: Obj, target: Obj): boolean {
        const dir = Math.abs(obj.orientation - hexDirectionTo(obj.position, target.position))
        return [0, 1, 5].indexOf(dir) !== -1
    }

    function isWithinPerception(obj: Critter, target: Obj): boolean {
        const dist = hexDistance(obj.position, target.position)
        const perception = obj.getStat('PER')
        const sneakSkill = target.type === 'critter' ? (target as Critter).getSkill('Sneak') : 0
        // CE ref: combat_ai.cc:3514-3522 isWithinPerception — sneak detection tiers:
        //   dudeIsSneaking (isSneaking && sneakWorking) → ÷4 (strong path)
        //   dudeHasState(SNEAKING) (isSneaking only, roll failing) → ×2/3 (weak path)
        const playerTarget = target === globalState.player
        const isSneaking = playerTarget && (globalState.player as any).isSneaking === true
        const sneakWorking = isSneaking && (globalState.player as any).sneakWorking === true
        let reqDist

        if (canSee(obj, target)) {
            reqDist = perception * 5

            // CE ref: combat_ai.cc:3510 — OBJECT_TRANS_GLASS (Stealth Boy II) halves visual range.
            if ((target as any).stealthActive) reqDist = Math.floor(reqDist / 2)

            if (sneakWorking) {
                // CE: dudeIsSneaking() → true → ÷4
                reqDist = Math.floor(reqDist / 4)
                if (sneakSkill > 120) reqDist--
            } else if (isSneaking) {
                // CE: dudeHasState(SNEAKING) only → ×2/3 (no Sneak>120 bonus on this path)
                reqDist = Math.floor((reqDist * 2) / 3)
            }

            if (dist <= reqDist) return true
        }

        // Hearing range — CE combat_ai.cc:3527: no OBJECT_TRANS_GLASS halving here.
        reqDist = globalState.inCombat ? perception * 2 : perception

        if (sneakWorking) {
            reqDist = Math.floor(reqDist / 4)
            if (sneakSkill > 120) reqDist--
        } else if (isSneaking) {
            reqDist = Math.floor((reqDist * 2) / 3)
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


    // CE game_sound.cc:92 _snd_lookup_scenery_action
    const SND_SCENERY_ACTION = 'OCLNU'
    // CE art.cc _art_get_code for sound names (weapon code, anim code)
    function artGetCodeForSfx(animation: number, weaponType: number): [string, string] | null {
        const chr = (b: string, o: number) => String.fromCharCode(b.charCodeAt(0) + o)
        if (weaponType < 0 || weaponType >= 11) return null
        if (animation >= 38 && animation <= 47) return weaponType === 0 ? null : [chr('d', weaponType - 1), chr('c', animation - 38)]
        if (animation === 36) return ['c', 'h']
        if (animation === 37) return ['c', 'j']
        if (animation === 64) return ['n', 'a']
        if (animation >= 48) return ['r', chr('a', animation - 48)]
        if (animation >= 20) return ['b', chr('a', animation - 20)]
        if (animation === 18) return weaponType === 1 ? ['d', 'm'] : weaponType === 4 ? ['g', 'm'] : ['a', 's']
        if (animation === 13) return weaponType <= 0 ? ['a', 'n'] : [chr('d', weaponType - 1), 'e']
        if (animation <= 1 && weaponType > 0) return [chr('d', weaponType - 1), chr('a', animation)]
        return ['a', chr('a', animation)]
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
        returnValue = 0 // CE Script.returnValue (scr_return)
        howMuch = 0 // CE Script.howMuch
        action = 0 // CE Script.action
        target_obj!: Obj
        action_being_used!: number
        game_time_hour!: number

        combat_is_initialized!: 0 | 1
        game_time!: number

        // Script procedure prototypes
        start!: () => void

        map_enter_p_proc!: () => void
        map_exit_p_proc!: () => void
        map_update_p_proc!: () => void

        timed_event_p_proc!: () => void

        critter_p_proc!: () => void
        spatial_p_proc!: () => void

        use_p_proc!: () => void
        use_obj_on_p_proc!: () => void
        talk_p_proc!: () => void
        pickup_p_proc!: () => void
        drop_p_proc!: () => void

        combat_p_proc!: () => void
        damage_p_proc!: () => void
        destroy_p_proc!: () => void

        use_skill_on_p_proc!: () => void

        // Actual scripting engine API implementations

        set_global_var(gvar: number, value: any) {
            globalVars[gvar] = value
            info('set_global_var: ' + gvar + ' = ' + value, 'gvars')
            log('set_global_var', arguments, 'gvars')
            // CE ref: game.cc:995 gameSetGlobalVar — GVAR 0 is the main karma score
            // Sync to player stat so the character-sheet title display stays current.
            if (gvar === 0 && globalState.player) {
                globalState.player.stats.setBase('Karma', typeof value === 'number' ? value : parseInt(value))
            }
            // CE ref: scripts.cc:487 gameSetGlobalVar(GVAR_TOWN_REP_ARROYO, ...) —
            // town reps are plain GVARs; sync to player stat so viewer.ts reputation
            // panel reflects script writes instead of only ever reading an unset default.
            const townRepName = TOWN_REP_GVARS[gvar]
            if (townRepName !== undefined && globalState.player) {
                globalState.player.stats.setBase('Rep_' + townRepName, typeof value === 'number' ? value : parseInt(value))
            }
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
                case 13: {
                    // CE ref: interpreter_extra.cc:3208 METARULE_SIGNAL_END_GAME
                    // Sets _game_user_wants_to_quit = 2 → triggers endgame sequence
                    dbg('script', 'metarule(13): signal end game')
                    // DH2 defers full end-game to Endgame.triggerEnd; fire whatever we have
                    ;(Endgame as any).triggerEnd?.()
                    return 0
                }
                case 14:
                    return mapFirstRun // map_first_run
                case 15: // elevator
                    if (target !== -1) throw 'elevator given explicit type'
                    useElevator()
                    break
                case 16:
                    // CE ref: interpreter_extra.cc:3219 METARULE_PARTY_COUNT
                    return globalState.gParty?.party.length ?? 0
                case 17: // is area known?
                    return globalState.knownAreas.has(target) ? 1 : 0
                case 18: {
                    // FO2-CE ref: proto.cc drugEffect — is critter under influence of drugs?
                    const checkObj = (this as any).self ?? null
                    if (checkObj) {
                        const hasDrug = timeEventList.some(
                            (e: any) => e.obj === checkObj &&
                            typeof e.userdata === 'string' &&
                            (e.userdata as string).startsWith('drug:') &&
                            !(e.userdata as string).startsWith('drug:delayed:')
                        )
                        return hasDrug ? 1 : 0
                    }
                    return 0
                }
                case 19: {
                    // CE ref: interpreter_extra.cc:3228 METARULE_MAP_KNOWN
                    // wmMapIsKnown() — in CE maps have their own known-state; in DH2 we
                    // approximate using knownAreas: a map is known if its area has been visited
                    if (!globalState.mapAreas) return 0
                    for (const key of Object.keys(globalState.mapAreas)) {
                        const area = globalState.mapAreas[key]
                        if (area.entrances.some((e: any) => e.mapName === target || (e.mapLookupName ?? '') === target))
                            return globalState.knownAreas.has(area.id) ? 1 : 0
                    }
                    return 0
                }
                case 22:
                    return 0 // is_game_loading
                case 42: {
                    // CE ref: interpreter_extra.cc:3246 METARULE_DROP_ALL_INVEN —
                    // drops all inventory items to the ground at critter's tile
                    const dropTarget = target as any
                    if (!isGameObject(dropTarget) || !globalState.gMap) return 0
                    const items = [...dropTarget.inventory] as Obj[]
                    for (const item of items) item.drop(dropTarget)
                    return 0
                }
                case 43: {
                    // CE ref: interpreter_extra.cc:3256 METARULE_INVEN_UNWIELD_WHO —
                    // moves the active-hand weapon back to inventory (unwield)
                    const unObj = target as any
                    if (!isGameObject(unObj)) return 0
                    const isPlayer = unObj === globalState.player
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
                    if (!skillName || !globalState.player) return 0
                    return globalState.player.skills.isTagged(skillName) ? 1 : 0
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
                        case 'normal':     return 0
                        case 'laser':      return 1
                        case 'fire':       return 2
                        case 'plasma':     return 3
                        case 'electrical': return 4
                        case 'emp':        return 5
                        case 'explosion':  return 6
                        default:           return 0 // safe fallback instead of throw
                    }
                case 50: {
                    // CE ref: interpreter_extra.cc:3316 METARULE_CRITTER_BARTERS
                    // CRITTER_BARTER = 0x02 (obj_types.h:93)
                    if (!isGameObject(target as any)) return 0
                    const pro = (target as any).pro
                    return ((pro?.extra?.flags ?? 0) & 0x02) !== 0 ? 1 : 0
                }
                case 51: {
                    // CE ref: interpreter_extra.cc:3328 METARULE_CRITTER_KILL_TYPE
                    if (!isGameObject(target as any)) return 0
                    return (target as any).killType ?? 0
                }
                case 30:
                    // CE ref: interpreter_extra.cc:3235 METARULE_CAR_CURRENT_TOWN →
                    // worldmap.cc:6037 wmCarCurrentArea — returns wmGenData.currentCarAreaId.
                    return Worldmap.getCarAreaId()
                case 31: {
                    // CE ref: interpreter_extra.cc:3238 METARULE_GIVE_CAR_TO_PARTY →
                    // worldmap.cc:6043 wmCarGiveToParty — set isInCar=true, fill tank,
                    // also sets GVAR_PLAYER_GOT_CAR=1 (game_vars.h:25, index 18).
                    // CE ref: wmCarGiveToParty calls mapSetTransition({map:-2}) → wmWorldMap().
                    Worldmap.setIsInCar(true)
                    Worldmap.fillCarFuel()
                    Worldmap.updateCarUI()
                    globalVars[18] = 1   // GVAR_PLAYER_GOT_CAR (game_vars.h:25)
                    uiWorldMap()
                    return 1
                }
                case 32: {
                    // CE ref: interpreter_extra.cc:3241 METARULE_GIVE_CAR_GAS →
                    // worldmap.cc:5984 wmCarFillGas(amount).
                    const gasAmount = typeof target === 'number' ? target : 0
                    Worldmap.addCarFuel(gasAmount)
                    return 1
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
                    break
            }
        }
        metarule3(id: number, obj: any, userdata: any, radius: number): any {
            switch (id) {
            case 100: {
                // METARULE3_CLR_FIXED_TIMED_EVENTS
                for (var i = 0; i < timeEventList.length; i++) {
                    if (timeEventList[i].obj === obj && timeEventList[i].userdata === userdata) {
                        info('removing timed event (userdata ' + userdata + ')', 'timer')
                        timeEventList.splice(i, 1)
                        return
                    }
                }
                return
            }
            case 101:
                // METARULE3_MARK_SUBTILE — CE ref: worldmap.cc:5076 wmSubTileMarkRadiusVisited.
                // Worldmap fog-of-war subtile grid — not implemented in DH2. Safe no-op: CE
                // uses this only for exploration tracking; missing it leaves the map fully visible.
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
                // CE ref: worldmap.cc:2940 wmMapMarkMapEntranceState(mapIdx, elevation, state)
                // Sets entrance->state for the entrance matching mapIdx+elevation.
                const entrMapName = lookupMapName(obj as number)
                if (entrMapName && globalState.mapAreas) {
                    const elevIdx = userdata as number
                    const newState = (radius as number) !== 0
                    for (const areaKey of Object.keys(globalState.mapAreas)) {
                        for (const entr of (globalState.mapAreas[areaKey] as any).entrances) {
                            if (entr.mapName && entr.mapName.toLowerCase() === entrMapName.toLowerCase()
                                    && entr.elevation === elevIdx) {
                                entr.state = newState
                            }
                        }
                    }
                }
                return 0
            }
            case 105:
                // METARULE3_WM_SUBTILE_STATE — CE ref: worldmap.cc:5125 wmSubTileGetVisitedState.
                // Same missing subsystem as 101.
                // METARULE3_WM_SUBTILE_STATE — CE ref: worldmap.cc:5125 wmSubTileGetVisitedState.
                // Subtile fog-of-war query — not implemented in DH2. Return 1 (visited) so
                // scripts that gate on visited state proceed rather than stall.
                return 1
            case 106: {
                // METARULE3_TILE_GET_NEXT_CRITTER
                // TODO: use elevation
                var tile = obj,
                    elevation = userdata,
                    lastCritter = radius
                var objs = globalState.gMap.objectsAtPosition(fromTileNum(tile))
                log('metarule3 106 (tile_get_next_critter)', arguments)
                for (var i = 0; i < objs.length; i++) {
                    if (objs[i].type === 'critter' && !(<Critter>objs[i]).isPlayer) return objs[i]
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
                // CE ref: worldmap.cc:5984 wmCarIsOutOfGas — returns 1 if car fuel is 0.
                return (Worldmap.getIsInCar() && Worldmap.getCarFuel() === 0) ? 1 : 0
            case 111: {
                // METARULE3_111 (_map_target_load_area) — CE ref: map.cc:1202.
                // Returns the worldmap area index containing the current map, or -1.
                const mapName = lookupMapName(globalState.gMap.mapID)
                const area = mapName ? areaContainingMap(mapName) : null
                return area ? area.id : -1
            }
            default:
                dbgWarn('script', `metarule3: unhandled id ${id}`)
            }
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
                // STAT_GENDER
                if (obj.isPlayer) return (<Player>obj).gender === 'female' ? 1 : 0
                return 0
            }
            if (stat === 8) {
                // STAT_MAXIMUM_ACTION_POINTS — CE ref: stat.cc critterGetStat, formula: 5 + AGI/2
                return 5 + Math.floor(obj.getStat('AGI') / 2)
            }
            if (stat === 10) {
                // STAT_UNARMED_DAMAGE — CE ref: stat.cc critterStatBaseGetter (default 0 bonus)
                // DH2 tracks unarmed damage per-move in UNARMED_MOVES; no separate bonus stat.
                return 0
            }
            if (stat === 13) {
                // STAT_SEQUENCE — CE ref: stat.cc:572 baseStats[STAT_SEQUENCE] = 2 * perception
                return obj.getStat('Sequence')
            }
            // STAT_DAMAGE_THRESHOLD (17-23) and STAT_DAMAGE_RESISTANCE (24-30)
            // CE ref: stat.cc critterGetStat — returns critter base stat + equipped armour contribution
            const DT_DR_TYPES = ['Normal', 'Laser', 'Fire', 'Plasma', 'Electrical', 'EMP', 'Explosive']
            if (stat >= 17 && stat <= 23) {
                const dmgType = DT_DR_TYPES[stat - 17]
                return obj.getStat('DT ' + dmgType) + obj.getArmorDT(dmgType)
            }
            if (stat >= 24 && stat <= 30) {
                const dmgType = DT_DR_TYPES[stat - 24]
                return obj.getStat('DR ' + dmgType) + obj.getArmorDR(dmgType)
            }
            if (stat === 31) return obj.getStat('DR Radiation') // STAT_RADIATION_RESISTANCE
            if (stat === 32) return obj.getStat('DR Poison')    // STAT_POISON_RESISTANCE
            if (stat === 33) {
                // STAT_AGE — CE ref: stat.cc:244 critterGetStat — base age (default 25)
                // + gameTime / GAME_TIME_TICKS_PER_YEAR. DH2 has no per-critter base,
                // so use the default of 25 (gStatDescriptions[STAT_AGE].defaultValue).
                return 25 + Math.floor(globalState.gameTickTime / GameTime.TICKS_PER_YEAR)
            }
            if (stat === 36) return obj.poisonLevel ?? 0    // STAT_CURRENT_POISON_LEVEL
            if (stat === 37) return obj.radiationLevel ?? 0 // STAT_CURRENT_RADIATION_LEVEL
            var namedStat = statMap[stat]
            if (namedStat !== undefined) return obj.getStat(namedStat)
            dbgWarn('script', `get_critter_stat: unknown stat ${stat}`)
            return 0
        }
        set_critter_stat(obj: Obj, stat: number, value: number) {
            // CE ref: interpreter_extra.cc:1313 opSetCritterStat — player only, additive
            // Adds `value` to base+trait-modified stat and stores as new base.
            if (!isGameObject(obj) || obj.type !== 'critter') {
                warn('set_critter_stat: not a critter')
                return -1
            }
            if (!(obj as Critter).isPlayer) {
                warn('set_critter_stat: can only modify obj_dude')
                return -1
            }
            // CE stat.cc:439 critterSetBaseStat: derived stats (STAT_MAXIMUM_HIT_POINTS 7 ..
            // STAT_POISON_RESISTANCE 32) can't be set; current HP / poison / radiation (35-37)
            // route through their adjust functions with the delta.
            if (stat > 6 && stat <= 32) return 0
            if (stat === 35) { (obj as Critter).stats.modifyBase('HP', value); return 0 }
            if (stat === 36) { this.poison(obj, value); return 0 }
            if (stat === 37) { critterAdjustRadiation(obj as Critter, value); return 0 }
            const statName = statMap[stat]
            if (!statName) {
                warn('set_critter_stat: unknown stat ' + stat)
                return -1
            }
            const current = (obj as Critter).getStat(statName)
            ;(obj as Critter).stats.setBase(statName, current + value)
            return 0
        }
        has_trait(traitType: number, obj: Obj, trait: number) {
            if (!isGameObject(obj)) {
                warn('has_trait: not game object: ' + obj, undefined, this)
                return 0
            }

            if (traitType === 0) {
                // CRITTER_TRAIT_PERK — CE ref: interpreter_extra.cc:2570 opHasTrait
                // perkGetRank returns number of times perk acquired (0 = not present).
                // `trait` is the CE perk id (perk_defs.h), not an index into DH2's
                // selectable PERKS list (the two diverge from id 33 on).
                const name = perkNameById(trait)
                if (!name) return 0
                const critter = obj as Critter
                if (!critter.isPlayer) return 0 // DH2 perk system is player-only
                return getPerkRank(globalState.player as any, name)
            }

            if (traitType === 1) {
                // CRITTER_TRAIT_OBJECT — CE ref: interpreter_extra.cc:2570 opHasTrait
                switch (trait) {
                    case 5:
                        return (<Critter>obj).aiNum ?? 0 // OBJECT_AI_PACKET
                    case 6:
                        return (<Critter>obj).teamNum ?? 0 // OBJECT_TEAM_NUM
                    case 10:
                        return obj.orientation // OBJECT_CUR_ROT
                    case 34: // OBJECT_SEX — CE ref: critter.cc critterGetSex
                        if ((<Critter>obj).isPlayer) return (<Player>obj).gender === 'female' ? 1 : 0
                        return 0
                    case 666: // OBJECT_VISIBILITY
                        return obj.visible === false ? 0 : 1 // 1 = visible, 0 = invisible
                    case 667: // OBJECT_CUR_POISON — CE ref: critter.cc critterGetPoison
                        return (<Critter>obj).poisonLevel ?? 0
                    case 668: // OBJECT_CUR_RADIATION — CE ref: critter.cc critterGetRadiation
                        return (<Critter>obj).radiationLevel ?? 0
                    case 669: {
                        // CE ref: interpreter_extra.cc:2595 CRITTER_TRAIT_OBJECT_GET_INVENTORY_WEIGHT
                        let totalWeight = 0
                        for (const item of obj.inventory) {
                            totalWeight += (item.pro?.extra?.weight ?? 0) * (item.amount ?? 1)
                        }
                        return totalWeight
                    }
                    default:
                        dbgWarn('script', `has_trait: unhandled OBJECT trait ${trait}`)
                        return -1
                }
            }

            if (traitType === 2) {
                // CRITTER_TRAIT_TRAIT — CE ref: interpreter_extra.cc:2600 opHasTrait
                const TRAIT_NAMES: string[] = [
                    'Fast Metabolism', 'Bruiser', 'Small Frame', 'One Hander',
                    'Finesse', 'Kamikaze', 'Heavy Handed', 'Fast Shot',
                    'Bloody Mess', 'Jinxed', 'Good Natured', 'Chem Reliant',
                    'Chem Resistant', 'Sex Appeal', 'Skilled', 'Gifted',
                ]
                const traitName = TRAIT_NAMES[trait]
                if (!traitName) return 0
                return globalState.player?.traits?.includes(traitName) ? 1 : 0
            }

            dbgWarn('script', `has_trait: unknown traitType ${traitType}`)
            return 0
        }
        critter_add_trait(obj: Obj, traitType: number, trait: number, amount: number) {
            if (!isGameObject(obj)) {
                warn('critter_add_trait: not game object: ' + obj, undefined, this)
                return
            }

            if (obj.type !== 'critter') {
                warn('critter_add_trait: not a critter: ' + obj, undefined, this)
                return
            }

            if (traitType === 1) {
                // CRITTER_TRAIT_OBJECT — CE ref: interpreter_extra.cc:2869 opCritterAddTrait
                // Unknown OBJECT traits are silently ignored in CE (default: break).
                switch (trait) {
                    case 5: // OBJECT_AI_PACKET
                        ;(<Critter>obj).aiNum = amount
                        return
                    case 6: // OBJECT_TEAM_NUM
                        ;(<Critter>obj).teamNum = amount
                        return
                    case 10: // OBJECT_CUR_ROT
                        obj.orientation = Math.max(0, Math.min(5, amount))
                        return
                    case 666: // OBJECT_VISIBILITY — 0=invisible, 1=visible
                        obj.visible = amount !== 0
                        return
                    case 669: // OBJECT_CUR_WEIGHT — read-only (computed), no-op
                        return
                    default:
                        dbgWarn('script', `critter_add_trait: unhandled OBJECT trait ${trait} (amount=${amount}) — ignored`)
                        return
                }
            } else if (traitType === 0) {
                // CRITTER_TRAIT_PERK — CE ref: interpreter_extra.cc:2869 opCritterAddTrait
                // amount > 0 → perkAddForce (no requirement check); amount <= 0 → perkRemove
                // CE applies to any critter, but DH2's perk system is player-only.
                const player = (<Critter>obj).isPlayer ? (<Player>obj) : null
                if (!player) {
                    dbg('script', 'critter_add_trait: PERK on non-player critter ignored (trait=%d)', trait)
                    return
                }
                // CE perk.cc perkAddForce / perkRemove, by CE perk id. Covers the
                // special/quest perks (ids 70-118) that aren't in DH2's selectable list.
                const name = perkNameById(trait)
                const ce = CE_PERKS[trait]
                if (!name || !ce) {
                    warn(`critter_add_trait: unknown perk id ${trait}`)
                    return
                }
                if (amount > 0) {
                    const rank = getPerkRank(player, name)
                    if (ce.maxRank !== -1 && rank >= ce.maxRank) return
                    player.perks.push(name)
                    perkApplyEffect(player, trait, 1)
                } else {
                    const idx = player.perks.indexOf(name)
                    if (idx >= 0) {
                        player.perks.splice(idx, 1)
                        perkApplyEffect(player, trait, -1)
                    }
                }
                return
            }

            dbgWarn('script', `critter_add_trait: unhandled traitType ${traitType}`)
        }
        item_caps_total(obj: Obj) {
            // CE ref: item.cc item_caps_total — iterates ITEM_TYPE_MONEY inventory
            // and sums quantities live, so it cannot drift from `obj.money`.
            if (!isGameObject(obj)) throw 'item_caps_total: not game object'
            const MONEY_PID = 41
            let total = 0
            for (const item of obj.inventory) {
                if (item.pid === MONEY_PID) total += item.amount ?? 1
            }
            return total
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
            // CE ref: item.cc itemAdd() — add per item to merge stacks correctly, not direct reference
            for (const item of obj.inventory) {
                other.addInventoryItem(item, item.amount ?? 1)
            }
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
            // CE ref: interpreter_extra.cc:2285 opGetObjectElevation — returns obj->elevation
            if (isSpatial(obj) || isGameObject(obj)) return obj.elevation
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
            // CE ref: interpreter_extra.cc:2620 opObjectCanHearObject (sfall-fixed form CE
            // ships): same elevation, both on valid tiles, and isWithinPerception(a, b).
            if (!isGameObject(a) || !isGameObject(b)) return 0
            if (a.type !== 'critter') return 0
            if (a.elevation !== b.elevation) return 0
            if (!a.position || !b.position) return 0
            return isWithinPerception(a as Critter, b) ? 1 : 0
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
            // FO2-CE ref: interpreter_extra.cc opUsingSkill — only SKILL_SNEAK(8) on gDude returns meaningful data
            if (skill === 8 /* SKILL_SNEAK */ && (obj as any).isPlayer) {
                return (obj as Player).isSneaking ? 1 : 0
            }
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
            // FO2-CE ref: interpreter_extra.cc opDoCheck + stat.cc statRoll
            // Only SPECIAL stats (0=STR…6=LUK) are valid; CE treats others as script errors.
            if (check < 0 || check > 6) {
                dbg('script', `do_check: stat index ${check} out of range (0–6); returning failure`)
                return RollResult.Failure
            }
            const critter = obj as Critter
            const statName = statMap[check]!
            const value = (typeof critter.getStat === 'function') ? critter.getStat(statName) : 0
            const chance = getRandomInt(1, 10)
            const roll = chance <= value + modifier ? RollResult.Success : RollResult.Failure
            dbg('script', `do_check: stat=${statName} base=${value} mod=${modifier} roll=${chance} → ${RollResult[roll]}`)
            return roll
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
                // INVEN_TYPE_INV_COUNT — CE ref: inventory.cc critter_inven_obj() returns inventory.length
                return (obj as Critter).inventory.length
            }
            warn('critter_inven_obj: unknown where=' + where)
            return null
        }
        inven_cmds(obj: Critter, invenCmd: number, itemIndex: number): Obj | null {
            // CE ref: interpreter_extra.cc:3088 _op_inven_cmds
            // Only cmd=13 exists in CE: _inven_index_ptr(obj, index) → inventory[index]
            if (invenCmd !== 13) {
                dbgWarn('script', `inven_cmds: unhandled cmd ${invenCmd}`)
                return null
            }
            if (!isGameObject(obj as any) || !obj.inventory) return null
            if (itemIndex < 0 || itemIndex >= obj.inventory.length) return null
            return obj.inventory[itemIndex]
        }
        critter_attempt_placement(obj: Obj, tileNum: number, elevation: number) {
            // FO2-CE ref: critter.cc critterAttemptPlacement() — tries target tile, then all 6 neighbors
            let targetTile = tileNum
            if (globalState.gMap) {
                const targetPos = fromTileNum(tileNum)
                const objects = globalState.gMap.getObjects(elevation)
                if (!objects) return this.move_to(obj, tileNum, elevation)
                const occupied = (p: Point) => objects.some(o => o !== obj && o.position.x === p.x && o.position.y === p.y)
                if (occupied(targetPos)) {
                    for (let dir = 0; dir < 6; dir++) {
                        const neighborPos = hexInDirection(targetPos, dir)
                        if (!occupied(neighborPos)) {
                            targetTile = toTileNum(neighborPos)
                            break
                        }
                    }
                }
            }
            return this.move_to(obj, targetTile, elevation)
        }
        critter_state(obj: Critter) {
            // CE ref: interpreter_extra.cc:2730 opGetCritterState
            // CRITTER_STATE_DEAD=1, CRITTER_STATE_PRONE=2, CRITTER_STATE_NORMAL=0
            // Plus cripple flags: leg_left=0x10, leg_right=0x20, arm_left=0x40, arm_right=0x80
            if (!isGameObject(obj)) {
                warn('critter_state: not game object: ' + obj)
                return 0
            }

            const c = obj as any
            if (obj.dead === true || obj.getStat('HP') <= 0)
                return 1 // CRITTER_STATE_DEAD

            let state = c.isKnockedDown ? 2 : 0 // PRONE : NORMAL
            if (c.crippledLeftLeg)  state |= 0x10 // DAM_CRIP_LEG_LEFT
            if (c.crippledRightLeg) state |= 0x20 // DAM_CRIP_LEG_RIGHT
            if (c.crippledLeftArm)  state |= 0x40 // DAM_CRIP_ARM_LEFT
            if (c.crippledRightArm) state |= 0x80 // DAM_CRIP_ARM_RIGHT
            return state
        }
        kill_critter(obj: Critter, deathFrame: number) {
            log('kill_critter', arguments)
            critterKill(obj)
        }
        get_poison(obj: Obj) {
            // FO2-CE ref: critter.cc critterGetPoison
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
                case 0: // PCSTAT_unspent_skill_points
                    p.skills.skillPoints = Math.max(0, value)
                    return 0
                case 1: // PCSTAT_level — direct set, no side effects
                    p.stats.setBase('Level', Math.max(1, Math.min(99, value)))
                    return 0
                case 2: // PCSTAT_experience — direct set
                    p.stats.setBase('Experience', Math.max(0, value))
                    return 0
                case 3: // PCSTAT_reputation
                    p.stats.setBase('Reputation', Math.max(-20, Math.min(20, value)))
                    return 0
                case 4: // PCSTAT_karma
                    p.stats.setBase('Karma', Math.max(-99999999, Math.min(99999999, value)))
                    return 0
                case 5: // PCSTAT_max_pc_stat — sentinel count; CE pcSetStat returns -1
                    return -1
                default:
                    dbgWarn('script', `set_pc_stat: unknown pcstat ${pcstat}`)
                    return -1
            }
        }
        mod_pc_stat(pcstat: number, delta: number) {
            // FO2-CE ref: scripts.cc opModifyPcStat()
            const p = globalState.player
            if (!p) return -1
            switch (pcstat) {
                case 0: // PCSTAT_unspent_skill_points
                    p.skills.skillPoints = Math.max(0, p.skills.skillPoints + delta)
                    return 0
                case 1: { // PCSTAT_level
                    const cur = p.stats.getBase('Level')
                    p.stats.setBase('Level', Math.max(1, Math.min(99, cur + delta)))
                    return 0
                }
                case 2: // PCSTAT_experience — addExperience triggers level-up loop
                    p.addExperience(delta)
                    return 0
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
                case 5: // PCSTAT_max_pc_stat — sentinel; CE mod returns -1
                    return -1
                default:
                    dbgWarn('script', `mod_pc_stat: unknown pcstat ${pcstat}`)
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
            // CE ref: item.cc:353 itemAdd() stealthBoyTurnOn — sync stealthActive after wield.
            refreshStealthState(obj as Critter)
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
            // CE ref: interpreter_extra.cc opPoison → critter.cc:327 critterAdjustPoison.
            if (!isGameObject(obj) || obj.type !== 'critter') return
            adjustPoison(obj as Critter, amount)
        }
        radiation_inc(obj: Obj, amount: number) {
            // CE ref: interpreter_extra.cc:2777 opRadiationIncrease → critter.cc:412
            // critterAdjustRadiation (player only; resistance, geiger, CRITTER_RADIATED).
            if (!isGameObject(obj) || obj.type !== 'critter') return
            critterAdjustRadiation(obj as Critter, amount)
        }
        radiation_dec(obj: Obj, amount: number) {
            // CE ref: interpreter_extra.cc:2792 opRadiationDecrease.
            if (!isGameObject(obj) || obj.type !== 'critter') return
            const radiation = (obj as Critter).radiationLevel ?? 0
            critterAdjustRadiation(obj as Critter, radiation >= 0 ? -amount : 0)
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
                // CE opAttackComplex: attacker = self, defender = target.
                if (initiator && isGameObject(obj)) (initiator as any).whoHitMe = obj
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
        // CE ref: interpreter_extra.cc:4688 opJamLock — sets jammed flag on lockable objects
        jam_lock(obj: Obj) {
            log('jam_lock', arguments)
            if (!isGameObject(obj)) {
                warn('jam_lock: not game object: ' + obj, undefined, this)
                return
            }
            if (obj.isDoor || obj.isContainer) obj.jammed = true
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
                case 0: return pid
                case 1: return getMessage(msgCat, pro.textID) ?? ''
                case 2: return getMessage(msgCat, pro.textID + 1) ?? ''
                case 3: return ((pro.frmType ?? objType) << 24) | (pro.frmPID ?? 0)
                case 4: return pro.lightDistance ?? pro.lightRadius ?? 0
                case 5: return pro.lightIntensity ?? 0
                case 6: return pro.flags ?? 0
            }
            if (objType === 0 /* OBJ_TYPE_ITEM */) {
                switch (data_member) {
                    case 7: return (((extra.itemFlags ?? 0) << 24) | ((extra.actionFlags ?? 0) << 16)
                        | ((extra.weaponFlags ?? 0) << 8) | (extra.attackMode ?? 0)) >>> 0
                    case 8: return extra.scriptID ?? -1
                    case 9: return extra.subType ?? 0
                    case 11: return extra.materialID ?? 0
                    case 12: return extra.size ?? 0
                    case 13: return extra.weight ?? 0
                    case 14: return extra.cost ?? 0
                    case 15: return extra.invFRM ?? 0
                    case 555: return extra.maxRange1 ?? 0 // ITEM_DATA_MEMBER_WEAPON_RANGE
                }
            } else if (objType === 1 /* OBJ_TYPE_CRITTER */) {
                switch (data_member) {
                    case 7: return extra.actionFlags ?? 0
                    case 8: return extra.scriptID ?? -1
                    case 9: return 0 // CRITTER_DATA_MEMBER_DATA (pointer)
                    case 10: return extra.headFID ?? -1
                    case 11: return extra.bodyType ?? 0
                }
            } else if (objType === 2 /* OBJ_TYPE_SCENERY */) {
                switch (data_member) {
                    case 7: return extra.extendedFlags ?? 0
                    case 8: return extra.scriptPID ?? -1
                    case 9: return extra.subType ?? 0
                    case 10: return 0 // SCENERY_DATA_MEMBER_DATA (pointer)
                    case 11: return extra.materialID ?? 0
                }
            } else if (objType === 3 /* OBJ_TYPE_WALL */) {
                switch (data_member) {
                    case 7: return extra.extendedFlags ?? 0
                    case 8: return extra.scriptID ?? -1
                    case 9: return extra.material ?? 0
                }
            } else if (objType === 5 /* OBJ_TYPE_MISC */) {
                if (data_member === 7) return extra.extendedFlags ?? 0
            }
            // CE: unknown members for a valid type log "Invalid data member" and yield 0;
            // OBJ_TYPE_TILE has no members at all.
            dbgWarn('script', `proto_data: invalid data member ${data_member} for objType=${objType}`)
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
            obj.elevation = elev

            //stub("create_object_sid", arguments)

            // TODO: if tile is valid...
            /*if(elevation !== currentElevation) {
                warn("create_object_sid: want to create object on another elevation (current=" + currentElevation + ", elev=" + elevation + ")")
                return
            }*/

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
            globalState.gMap.addObject(obj, elev)
            obj.position = fromTileNum(tile)
            zsort(globalState.gMap.objects[elev])

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

            if (obj.type === 'item' && obj.pro != null) {
                // pro.py serializes as 'subType' (capital T)
                return obj.pro.extra.subType ?? obj.pro.extra.subtype ?? null
            }
            warn('obj_item_subtype: not an item: ' + obj)
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
            // FO2-CE ref: art.cc obj_art_fid() — returns the object's current FID
            if (!isGameObject(obj)) {
                warn('obj_art_fid: not game object: ' + obj)
                return 0
            }
            return obj.frmPID ?? 0
        }
        art_anim(fid: number): number {
            // FO2-CE ref: art.cc artAlias() — anim field is bits 23-16 of the FID
            return (fid >>> 16) & 0xFF
        }
        set_obj_visibility(obj: Obj, visibility: number) {
            if (!isGameObject(obj)) {
                warn('set_obj_visibility: not a game object: ' + obj)
                return
            }
            // CE ref: interpreter_extra.cc:2096 objectHide/objectShow call
            // _obj_turn_off_light/_obj_turn_on_light → triggers lightmap rebuild.
            obj.visible = !visibility
            if (Config.engine.doFloorLighting) Lightmap.rebuildLight()
        }
        use_obj_on_obj(obj: Obj, who: Obj) {
            if (!isGameObject(obj) || !isGameObject(who)) {
                warn('use_obj_on_obj: not game objects')
                return
            }
            info('use_obj_on_obj: ' + (obj.name ?? obj.pid) + ' on ' + (who.name ?? who.pid))
            // CE ref: interpreter_extra.cc:4564 opUseObjectOnObject; proto_instance.cc:1296
            // obj=item, who=target, this.self_obj=critter doing the using
            const source = this.self_obj as unknown as Obj
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
            Scripting.useObjOnMe(who, obj, source)
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
            if (anim === 1000) {
                // OBJECT_SET_ROTATION — CE ref: interpreter_extra.cc:3421 opAnim
                if (param >= 0 && param < 6) obj.orientation = param
            } else if (anim === 1010) {
                // OBJECT_SET_FRAME — CE ref: interpreter_extra.cc:3427 opAnim
                obj.frame = param
            } else if (anim >= 0 && anim < 65) {
                // Animation type ID — wrap in a one-shot reg_anim batch
                // CE ref: interpreter_extra.cc:3382 opAnim (anim < ANIM_COUNT branch)
                // param == 0 → forward; param != 0 → reversed (animationRegisterAnimateReversed).
                const saved = animBatch
                animBatch = []
                animBatch.push({ kind: 'animate', obj, anim, delay: 0, reversed: param !== 0 })
                this.reg_anim_end()
                animBatch = saved
            } else {
                dbgWarn('script', `anim: unhandled anim value ${anim}`)
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
            // CE ref: interpreter_extra.cc:3071 opSetObjectLightLevel calls objectSetLight()
            // which does a full turn-off/turn-on cycle and triggers a lightmap rebuild.
            // intensity arrives as 0–100 percent; CE converts: (intensity * 65636) / 100
            if (!isGameObject(obj)) {
                warn('obj_set_light_level: not game object: ' + obj)
                return
            }
            obj.lightRadius = distance
            obj.lightIntensity = Math.round(intensity * 65536 / 100)
            if (Config.engine.doFloorLighting) Lightmap.rebuildLight()
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
            // CE ref: interpreter_extra.cc:2180 opSetExitGrids — iterates objectFindFirstAtElevation(onElev)
            // and updates all exit-grid objects (PIDs 0x5000010-0x5000017) on that elevation.
            for (var i = 0; i < gameObjects!.length; i++) {
                var obj = gameObjects![i]
                if (obj.elevation !== onElev) continue
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
            // FO2-CE ref: scripts.cc — checks tile light intensity > 0
            if (tile < 0 || tile >= Lightmap.tile_intensity.length) return 0
            return Lightmap.tile_intensity[tile] > 0 ? 1 : 0
        }
        // CE ref: sfall_opcodes.cc:951 op_obj_blocking_at — first blocking object at
        // (tile, elevation) for block type 0=BLOCK/1=SHOOT/2=AI/3=SIGHT/4=SCROLL
        // (see GameMap.blockingObjectAt); SHOOT drops OBJECT_SHOOT_THRU obstacles.
        obj_blocking_at(tile: number, elevation: number, blockingType: number): Obj | null {
            if (!globalState.gMap) return null
            const o = globalState.gMap.blockingObjectAt(tile, elevation, blockingType, null)
            if (o && blockingType === 1 && ((((o as any).flags ?? 0) >>> 0) & 0x80000000) !== 0) return null
            return o
        }
        // CE ref: sfall_opcodes.cc:937 op_make_straight_path — screen-space straight line
        // from obj's tile to dest, returning the first obstacle (animation.cc
        // _make_straight_path_func; see GameMap.straightPathBlockingObject).
        make_straight_path(obj: Obj, destTile: number, blockingType: number): Obj | null {
            if (!isGameObject(obj) || !globalState.gMap) return null
            return globalState.gMap.straightPathBlockingObject(obj, fromTileNum(destTile), blockingType)
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

                if (obj instanceof Critter && obj.isPlayer) globalState.gMap.changeElevationFaded(elevation, true)
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
            // ref: fallout2-ce barter.cc, dialog.cc gDialogSetBarterMod
            log('gdialog_set_barter_mod', arguments)
            dialogueBarterMod = mod
        }
        gdialog_mod_barter(mod: number) {
            // CE ref: game_dialog.cc:3163 gameDialogBarter — sets _dialogBarterMod then opens barter
            log('gdialog_mod_barter', arguments)
            dbg('dialogue', '--> barter mode')
            if (!this.self_obj) throw 'need self_obj'
            dialogueBarterMod = mod
            uiBarterMode(this.self_obj as Critter)
        }
        start_gdialog(msgFileID: number, obj: Obj, mood: number, headNum: number, backgroundID: number) {
            log('start_gdialog', arguments)
            info('DIALOGUE START', 'dialogue')
            if (!this.self_obj) throw 'no self_obj for start_gdialog'
            // CE ref: game_dialog.cc:1070-1075 _gdialogStart resets the review
            // log once per conversation. start_gdialog() fires on every
            // talk_p_proc run, including Scripting.reenterDialogue()'s
            // re-entry after Barter/Trade/Combat-Control — only reset on a
            // genuinely fresh Talk (uiMode isn't already dialogue yet; on a
            // reenter, reenterDialogue() already set it before calling talk()).
            if (globalState.uiMode !== UIMode.dialogue) {
                dialogueReviewLog = []
            }
            currentDialogueObject = this.self_obj as Critter
            uiStartDialogue(false, this.self_obj as Critter)
            // CE ref: interpreter_extra.cc:1892 opStartGameDialog — with a head, the
            // starting fidget comes from the speaker's reaction (LVAR 0 →
            // reactionTranslateValue: > 10 good, > -10 neutral, else bad); otherwise mood.
            if (!globalState.inCombat) {
                let fidget = mood
                if (headNum !== -1) {
                    const lv0 = (this.self_obj as any)._script?.lvars?.[0]
                    const value = typeof lv0 === 'number' ? lv0 : -1
                    fidget = value > 10 ? FIDGET_GOOD : value > -10 ? FIDGET_NEUTRAL : FIDGET_BAD
                }
                startTalkingHead(headNum, fidget, backgroundID)
            }
        }

        // ── Opcodes that were never bridged (found 2026-10-06 by diffing CE's
        //    interpreterRegisterOpcode table against vm.ts/vm_bridge.ts). An unbridged
        //    opcode makes vm.step() return false, silently ending the procedure.

        // CE interpreter_extra.cc opScrReturn (0x80A2) — value handed back to the engine.
        scr_return(value: number) {
            this.returnValue = value
        }
        // CE opSfxBuildOpenName (0x80A5) — game_sound.cc sfxBuildOpenName
        sfx_build_open_name(obj: Obj, action: number): string | null {
            if (!isGameObject(obj)) return null
            const act = SND_SCENERY_ACTION[action] ?? 'O'
            if (obj.type === 'scenery') {
                const id = obj.pro?.extra?.soundID
                return `S${act}DOORS${typeof id === 'number' ? String.fromCharCode(id) : 'A'}`.toUpperCase()
            }
            const id = obj.pro?.extra?.soundID
            return `I${act}CNTNR${typeof id === 'number' ? String.fromCharCode(id) : 'A'}`.toUpperCase()
        }
        // CE opSkillContest (0x80AD) — "not implemented" in CE too; returns 0.
        skill_contest(_a: number, _b: number, _c: number) {
            dbgWarn('script', 'skill_contest: not implemented in CE either (returns 0)')
            return 0
        }
        // CE opHowMuch (0x80B1) — script->howMuch
        how_much(_data: number) {
            return this.howMuch ?? 0
        }
        // CE opReactionInfluence (0x80B3) — reaction.cc _reaction_influence_ returns 0.
        reaction_influence(_a: number, _b: number, _c: number) {
            return 0
        }
        // CE opGetObjectBeingUsed (0x80C0) — script->target: the item used on this object
        // in use_obj_on_p_proc (DH2 keeps it in target_obj).
        obj_being_used_with(): Obj | 0 {
            return this.target_obj ?? 0
        }
        // CE opGetScriptAction (0x80C7) — script->action
        script_action() {
            return this.action ?? 0
        }
        // CE opAnimateStandReverse (0x80CD) — ANIM_STAND reversed, outside combat only.
        animate_stand_reverse_obj(obj: Obj) {
            const target = isGameObject(obj) ? obj : (this.self_obj as Obj)
            if (!target || globalState.inCombat || target.type !== 'critter') return
            ;(target as Critter).staticAnimation('idle', () => (target as Critter).clearAnim(), true, true)
        }
        // CE opMakeDayTime (0x80D1) — an empty function in CE.
        make_daytime() {}
        // CE opPickup (0x80D6) — actionPickUp(script->target, obj)
        pickup_obj(obj: Obj) {
            if (!isGameObject(obj)) return
            const who = (this.target_obj ?? this.self_obj) as Critter
            if (!who || who.type !== 'critter') return
            obj.pickup?.(who)
        }
        // CE opDrop (0x80D7) — _obj_drop(script->target, obj)
        drop_obj(obj: Obj) {
            if (!isGameObject(obj)) return
            const who = (this.target_obj ?? this.self_obj) as Critter
            if (!who) return
            obj.drop?.(who)
        }
        // CE opGetGameDifficulty (0x812A) — settings.preferences.game_difficulty (0/1/2)
        game_difficulty() {
            const d = Config.combat.gameDifficultyModifier
            return d === 75 ? 0 : d === 125 ? 2 : 1
        }
        // CE opGetRunningBurningGuy (0x812B)
        running_burning_guy() {
            return Config.combat.runningBurningGuy === false ? 0 : 1
        }
        // CE _op_inven_unwield (0x812C) — self puts its weapon away (dude: current hand).
        inven_unwield() {
            const self = this.self_obj as Critter
            if (!self || self.type !== 'critter') return
            const hand: 'leftHand' | 'rightHand' = self.isPlayer
                ? ((self as any).activeHand ?? 'leftHand')
                : 'rightHand'
            const item = (self as any)[hand]
            if (!item) return
            ;(self as any)[hand] = undefined
            self.inventory.push(item)
            if (self.isPlayer) uiDrawWeapon()
        }
        // CE opGameUiIsDisabled (0x8135)
        game_ui_is_disabled() {
            return globalState.gameUIDisabled ? 1 : 0
        }
        // CE _op_anim_action_frame (0x813A) — artGetActionFrame of obj's FRM for `anim`.
        anim_action_frame(obj: Obj, anim: number) {
            if (!isGameObject(obj) || !obj.pro) return 0
            try {
                const fid = ((obj.pro.frmType ?? 1) << 24) | ((anim & 0xff) << 16) | (obj.pro.frmPID & 0xfff)
                const info = globalState.imageInfo[lookupArt(fid)]
                const af = info?.actionFrame
                return Array.isArray(af) ? (af[obj.orientation ?? 0] ?? af[0] ?? 0) : (af ?? 0)
            } catch {
                return 0
            }
        }
        // CE opRegAnimPlaySfx (0x813B) — sound step inside the current reg_anim sequence.
        reg_anim_play_sfx(obj: Obj, sfx: string, delay: number) {
            if (!isGameObject(obj) || typeof sfx !== 'string') return
            const play = () => globalState.audioEngine?.playSfxByName?.(sfx.toLowerCase())
            if (animBatch !== null) animBatch.push({ kind: 'func', obj, fn: () => setTimeout(play, Math.max(0, delay) * 100) } as any)
            else setTimeout(play, Math.max(0, delay) * 100)
        }
        // CE opSfxBuildCharName (0x813D) — game_sound.cc sfxBuildCharName
        sfx_build_char_name(obj: Obj, anim: number, extra: number): string | null {
            if (!isGameObject(obj) || !obj.pro) return null
            const base = getLstJson('art/critters/critters', obj.pro.frmPID & 0xfff)?.frm
            if (!base) return null
            const weapon = anim === 38 /* ANIM_TAKE_OUT */ ? extra : (((obj as any).frmPID ?? obj.pro.frmPID) & 0xf000) >> 12
            const code = artGetCodeForSfx(anim, weapon)
            if (!code) return null
            let [w, a] = code
            if (anim === 21 || anim === 20) { // ANIM_FALL_FRONT / ANIM_FALL_BACK
                if (extra === 2) w = 'Y'      // CHARACTER_SOUND_EFFECT_PASS_OUT
                else if (extra === 3) w = 'Z' // CHARACTER_SOUND_EFFECT_DIE
            } else if ((anim === 16 || anim === 17) && extra === 4) { // punch/kick + CONTACT
                w = 'Z'
            }
            return `${base}${w}${a}`.toUpperCase()
        }
        // CE opSfxBuildAmbientName (0x813E)
        sfx_build_ambient_name(name: string) {
            return `A${String(name).padStart(6).slice(0, 6)}1`.toUpperCase()
        }
        // CE opSfxBuildInterfaceName (0x813F) / opSfxBuildItemName (0x8140) — both use
        // gameSoundBuildInterfaceName in CE.
        sfx_build_interface_name(name: string) {
            return `N${String(name).padStart(6).slice(0, 6)}1`.toUpperCase()
        }
        sfx_build_item_name(name: string) {
            return `N${String(name).padStart(6).slice(0, 6)}1`.toUpperCase()
        }
        // CE opSfxBuildWeaponName (0x8141) — game_sound.cc sfxBuildWeaponName
        sfx_build_weapon_name(effectType: number, weapon: Obj, hitMode: number, target: Obj) {
            const typeCode = 'RAOFH'[effectType] ?? 'A'
            const sid = weapon?.pro?.extra?.soundID
            const weaponCode = typeof sid === 'number' ? String.fromCharCode(sid) : 'A'
            const variant = (effectType !== 0 && effectType !== 2 && hitMode !== 0 && hitMode !== 2 && hitMode !== 4) ? 2 : 1
            const dmg = weapon?.pro?.extra?.dmgType
            let material = 'X'
            if (typeCode === 'H' && isGameObject(target) && dmg !== 3 /* plasma */ && dmg !== 5 /* EMP */ && dmg !== 6 /* explosion */) {
                const m = target.type === 'wall' ? target.pro?.extra?.material : (target.type === 'item' || target.type === 'scenery') ? target.pro?.extra?.materialID : -1
                material = (m === 0 || m === 1 || m === 2) ? 'M' : m === 3 ? 'W' : (m === 4 || m === 5 || m === 6) ? 'S' : 'F'
            }
            return `W${typeCode}${weaponCode}${variant}${material}XX1`.toUpperCase()
        }
        // CE opSfxBuildSceneryName (0x8142)
        sfx_build_scenery_name(name: string, action: number, actionType: number) {
            const typeCode = actionType === 1 /* SOUND_EFFECT_ACTION_TYPE_PASSIVE */ ? 'P' : 'A'
            return `S${typeCode}${SND_SCENERY_ACTION[action] ?? 'O'}${String(name).padStart(4).slice(0, 4)}1`.toUpperCase()
        }
        // CE opAttackSetup (0x8143) — attacker engages defender (starts combat if needed).
        attack_setup(attacker: Obj, defender: Obj) {
            if (!isGameObject(attacker) || !isGameObject(defender)) return
            const a = attacker as Critter, d = defender as Critter
            if (a.dead || a.visible === false) return
            if (d.dead || d.visible === false) return
            if ((d as any).isFleeing) return // CRITTER_MANUEVER_FLEEING
            ;(a as any).whoHitMe = d
            if (!a.isPlayer) a.hostile = true
            if (!globalState.inCombat && Config.engine.doCombat) Combat.start(a.isPlayer ? undefined : a)
        }
        // CE opDestroyMultipleObjects (0x8144) — remove `quantity` of an item from its
        // owner (returns how many), or destroy the object outright when it has no owner.
        destroy_mult_objs(obj: Obj, quantity: number) {
            if (!isGameObject(obj)) return 0
            const owner = globalState.gMap.getObjects().find((o) => o.inventory?.includes(obj))
                ?? (globalState.player?.inventory?.includes(obj) ? globalState.player : undefined)
            if (owner) {
                const have = obj.amount ?? 1
                const n = Math.min(have, quantity)
                if (n >= have) arrayRemove(owner.inventory, obj)
                else obj.amount = have - n
                if (owner === globalState.player) uiDrawWeapon()
                return n
            }
            globalState.gMap.destroyObject(obj)
            return 0
        }
        // CE opGetCombatDifficulty (0x814F) — settings.preferences.combat_difficulty (0/1/2)
        combat_difficulty() {
            const d = Config.combat.difficultyModifier
            return d === 75 ? 0 : d === 125 ? 2 : 1
        }
        // CE opCritterStopAttacking (0x8155) — CRITTER_MANEUVER_DISENGAGING, forget target.
        critter_stop_attacking(obj: Obj) {
            if (!isGameObject(obj)) return
            const c = obj as Critter
            ;(c as any).disengaging = true
            ;(c as any).whoHitMe = null
            c.hostile = false
        }
        // CE opSetMapMusic (0x80E2) — worldmap.cc wmSetMapMusic: override maps.txt music.
        set_map_music(mapIndex: number, music: string) {
            setMapMusicOverride(mapIndex, String(music))
        }
        // CE opWorldmap (0x8108) — scriptsRequestWorldMap
        world_map() {
            uiWorldMap()
        }
        // CE opRegAnimObjectRunToTile (0x8114) — as move_to_tile, running.
        reg_anim_obj_run_to_tile(obj: Obj, tileNum: number, delay: number) {
            if (globalState.inCombat) return
            this.reg_anim_obj_move_to_tile(obj, tileNum, delay)
        }
        // CE opKillCritterType (0x80EE) — kill (or with deathFrame 0, destroy) every live,
        // visible critter of `pid` on the map. deathFrame 1 cycles CE's ftList.
        kill_critter_type(pid: number, deathFrame: number) {
            const FT_LIST = ['death-burst', 'death-explode', 'death-fire', 'death', 'death', 'death', 'death-burst', 'death', 'death-explode', 'death', 'death']
            let ft = 0
            let count = 0
            for (const obj of globalState.gMap.getObjects().slice()) {
                if (obj.type !== 'critter' || obj.pid !== pid || (obj as Critter).dead || obj.visible === false) continue
                if (++count > 200) { warn('kill_critter_type: infinite loop destroying critters!'); return }
                const c = obj as Critter
                if (deathFrame === 0) {
                    globalState.gMap.destroyObject(c)
                } else {
                    // CE _combat_delete_critter: critterKill below drops it from combat via its dead flag.
                    const anim = deathFrame === 1 ? FT_LIST[ft] : undefined
                    ft = (ft + 1) % FT_LIST.length
                    critterKill(c, undefined, true, anim)
                }
            }
        }
        // CE opCritterRemoveTrait (0x8103) — TRAIT_PERK only: remove every rank.
        critter_rm_trait(obj: Obj, kind: number, param: number, _value: number) {
            if (!isGameObject(obj) || obj.type !== 'critter') return -1
            if (kind !== 0) {
                warn('critter_rm_trait: trait out of range')
                return -1
            }
            const name = perkNameById(param)
            const perks: string[] = (obj as any).perks ?? []
            if (name) for (let i = perks.length - 1; i >= 0; i--) {
                if (perks[i] !== name) continue
                perks.splice(i, 1)
                perkApplyEffect(obj as Critter, param, -1) // CE perkRemove → perkRemoveEffect
            }
            return -1
        }
        // CE ref: interpreter_extra.cc:4937 op_dialogue_reaction (0x80E0)
        dialogue_reaction(value: number) {
            talkToCritterReacts(value)
        }
        // CE ref: interpreter_extra.cc _op_gsay_option (0x811F) — option without an IQ test.
        gsay_option(msgList: number, msgID: string | number, target: any, reaction: number) {
            const msg = getScriptMessage(msgList, msgID)
            if (msg === null) {
                dbgWarn('script', 'gsay_option: msg is null')
                return
            }
            dialogueOptionProcs.push(target.bind(this))
            dialogueOptionTexts.push(msg)
            dialogueOptionReactions.push(reaction)
            uiAddDialogueOption(msg, dialogueOptionProcs.length - 1)
        }
        gsay_start() {
            log('gsay_start', arguments)
            dialogueOptionProcs = []
            dialogueOptionTexts = []
        dialogueOptionReactions = []
            // ensure dialogue UI is open (may already be open from start_gdialog)
            if (globalState.uiMode !== UIMode.dialogue && this.self_obj) {
                uiStartDialogue(false, this.self_obj as Critter)
            }
        }
        //gSay_Option(msgList, msgID, target, reaction) { stub("gSay_Option", arguments) },
        gsay_reply(msgList: number, msgID: string | number) {
            log('gSay_Reply', arguments)
            var msg = getScriptMessage(msgList, msgID)
            if (msg === null) throw Error('gsay_reply: msg is null')
            info('REPLY: ' + msg, 'dialogue')
            uiSetDialogueReply(msg)
            // CE scripts.cc:2726 _scr_get_msg_str_speech(…, 1) — speak it if there's a head.
            speakScriptMessage(msgList, msgID)
            // CE ref: game_dialog.cc:1134-1146 gameDialogSetMessageReply ->
            // gameDialogAddReviewMessage.
            dialogueReviewLog.push({ reply: msg, option: null })
        }
        gsay_message(msgList: number, msgID: string | number, reaction: number) {
            // ref: fallout2-ce dialog.cc gDialogSayMessage
            log('gsay_message', arguments)
            const msg = getScriptMessage(msgList, msgID)
            if (msg === null) {
                warn('gsay_message: msg is null')
                return
            }
            uiSetDialogueReply(msg)
            speakScriptMessage(msgList, msgID)
            // CE ref: game_dialog.cc:1148-1160 gameDialogSetTextReply ->
            // gameDialogAddReviewText.
            dialogueReviewLog.push({ reply: msg, option: null })
            // single synthesised [Done] option; dialogueReply will call dialogueExit
            // because dialogueOptionProcs will be empty after the no-op proc fires
            dialogueOptionProcs.push(() => { /* no-op: dialogueReply checks length after */ })
            dialogueOptionTexts.push('[Done]')
            uiAddDialogueOption('[Done]', dialogueOptionProcs.length - 1)
            // save resume address and halt VM, mirroring the gsay_end convention
            if (this._vm) {
                this._vm.retStack.push(this._vm.script.offset)
                this._vm.halted = true
            }
        }
        gsay_end() {
            // Halt the VM so the player can interact with dialogue options.
            // dialogueExit() resumes via vm.pc = vm.popAddr(); vm.run().
            //
            // CE ref: game_dialog.cc:3662 _gdCanBarter / :4357-4388 — Barter
            // and (for party members) Combat Control are persistent buttons
            // on the dialogue window itself, not tied to any one node's
            // option list. Previously synthesized as dialogue-list options
            // here; moved to real always-present buttons wired in
            // uiStartDialogue() (ui_dialogue.ts) to match CE — see
            // wiki/known_bugs.md P9.
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
                dbgWarn('script', 'giq_option: msg is null')
                return
            }
            info(
                'DIALOGUE OPTION: ' + msg + ' [INT ' + (iqTest >= 0 ? '>=' + iqTest : '<=' + -iqTest) + ']',
                'dialogue'
            )

            // CE _op_giq_option: INT + Smooth Talker rank.
            const INT = globalState.player.getStat('INT') + globalState.player.perks.filter((p: string) => p === 'Smooth Talker').length
            if ((iqTest > 0 && INT < iqTest) || (iqTest < 0 && INT > -iqTest)) return // not enough intelligence for this option

            dialogueOptionProcs.push(target.bind(this))
            dialogueOptionTexts.push(msg)
            dialogueOptionReactions.push(reaction)
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
                obj: obj, // CE opFloatMessage: over the object passed in (was this.self_obj)
                startTime: window.performance.now(),
                color: color,
            })
        }

        // animation — ref: fallout2-ce animation.cc animationRegAnimFunc/animationRegAnimAnimate/animationBegin/End
        reg_anim_begin(_flags: number) {
            animBatch = []
        }

        reg_anim_clear() {
            animBatch = null
        }

        reg_anim_func(obj: Obj, fn: (() => void) | null) {
            if (animBatch === null) {
                warn('reg_anim_func: called outside reg_anim_begin', 'animation')
                return
            }
            animBatch.push({ kind: 'func', fn })
        }

        reg_anim_animate(obj: Obj, anim: number, delay: number) {
            if (!isGameObject(obj)) {
                warn('reg_anim_animate: not a game object', 'animation')
                return
            }
            if (animBatch === null) {
                // CE ref: animation.cc:1374 — honour delay even outside a batch
                const play = () => { if (anim !== 0) obj.singleAnimation(false, () => obj.clearAnim()) }
                if (delay > 0) setTimeout(play, delay * 100)
                else play()
                return
            }
            animBatch.push({ kind: 'animate', obj, anim, delay })
        }

        reg_anim_end() {
            if (animBatch === null) {
                warn('reg_anim_end: no active batch', 'animation')
                return
            }
            const batch = animBatch
            animBatch = null

            // CE ref: animation.cc::animationRegAnimFunc — callbacks are fired in
            // registration order, interleaved between animate steps (not batched at end).
            function doStep(i: number) {
                // Fire all consecutive func entries at this position before the next animate
                while (i < batch.length && batch[i].kind === 'func') {
                    const fn = (batch[i] as AnimFunc).fn
                    if (fn !== null) fn()
                    i++
                }
                if (i >= batch.length) return

                const step = batch[i] as AnimStep
                const obj = step.obj
                const next = () => { obj.clearAnim(); doStep(i + 1) }
                // anim=0 is ANIM_STAND — snap to idle rather than playing a cycle
                if (step.anim === 0) {
                    if (step.delay > 0) setTimeout(next, step.delay * 100)
                    else next()
                } else {
                    const play = () => obj.singleAnimation(step.reversed === true, next)
                    if (step.delay > 0) setTimeout(play, step.delay * 100)
                    else play()
                }
            }
            doStep(0)
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
            if (tile.x < 0 || tile.x >= 200 || tile.y < 0 || tile.y >= 200) {
                warn(
                    'reg_anim_obj_move_to_tile: invalid tile: ' + tile.x + ', ' + tile.y + ' (' + tileNum + ')',
                    'movement',
                    this
                )
                return
            }
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
            // CE ref: actions.cc:1582 actionExplode — tile, elevation, minDamage, maxDamage
            // Script opcode passes a single damage value; treat as fixed damage (min=max).
            const explosives = createObjectWithPID(makePID(0 /* items */, 85 /* Plastic Explosives */), -1)
            explosives.position = fromTileNum(tile)
            globalState.gMap.addObject(explosives)
            explosives.explode(explosives, damage, damage)
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
        days_since_visited() {
            // CE ref: interpreter_extra.cc:3734 opGetDaysSinceLastVisit
            // Returns floor((currentTick - lastVisitTime) / TICKS_PER_DAY), or -1 if never visited.
            const lastVisit = globalState.gMap?.lastVisitTime ?? 0
            if (lastVisit === 0) return -1
            return Math.floor((GameTime.getTime() - lastVisit) / GameTime.TICKS_PER_DAY)
        }
        game_time_advance(ticks: number) {
            log('game_time_advance', arguments)
            info('advancing time ' + ticks + ' ticks (' + ticks / 10 + ' seconds)')
            // CE ref: interpreter_extra.cc:2761 opGameTimeAdvance — advance, then
            // queueProcessEvents(); GameTime's time-jump hook (gameTick.ts) runs every
            // crossed midnight and fires the expired timed events in due order.
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
            // CE: interpreter_extra.cc:3581 opPlayGameMovie — per-movie flags table,
            // map updates and dialogue disabled while it plays (DH2: the movie sets a
            // modal uiMode, which pauses tickGame). CE blocks the script until the movie
            // ends; DH2's VM can't block, so the script continues behind the modal overlay.
            info('play_gmovie: movie ' + movieID)
            void gameMoviePlay(movieID, SCRIPT_MOVIE_FLAGS[movieID] ?? 0)
        }
        endgame_slideshow() {
            // CE: interpreter_extra.cc:opEndgameSlideshow (0x8146)
            // CE defers via scriptsRequestEndgame() flag; DH2 fires async directly.
            info('endgame_slideshow: starting')
            Endgame.playSlideshow().catch((e: unknown) => {
                info('endgame_slideshow error: ' + String(e))
            })
        }
        endgame_movie() {
            // CE: interpreter_extra.cc:opEndgameMovie (0x8148)
            info('endgame_movie: starting')
            Endgame.playMovie().catch((e: unknown) => {
                info('endgame_movie error: ' + String(e))
            })
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
            // CE ref: worldmap.cc wmAreaSetPos() — updates world-map marker position
            if (!globalState.mapAreas) { warn('wm_area_set_pos: mapAreas not loaded'); return }
            const areaKey = String(area)
            if (!globalState.mapAreas[areaKey]) { warn('wm_area_set_pos: unknown area ' + area); return }
            globalState.mapAreas[areaKey].worldPosition = { x, y }
            Worldmap.updateAreaMarkerPos(areaKey, x, y)
        }
        game_ui_disable() {
            // CE ref: interface.cc gameUiDisable() — blocks in-world player input
            // AND hides the bottom HUD bar (interface windows are torn down).
            globalState.gameUIDisabled = true
            const $bar = document.getElementById('bar')
            if ($bar) $bar.style.visibility = 'hidden'
        }
        game_ui_enable() {
            globalState.gameUIDisabled = false
            const $bar = document.getElementById('bar')
            if ($bar) $bar.style.visibility = 'visible'
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
            // CE ref: interpreter_extra.cc:3956 — silently no-ops when obj isn't a
            // party member (dismissal dialogue hook).
            log('party_remove', arguments)
            globalState.gParty.dismissPartyMember(obj)
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
            // CE message.cc: the middle field is the speech file for talking heads.
            const audio = lines[i].match(/^\{\d+\}\{([^}]*)\}/)
            if (audio && audio[1].trim() !== '') {
                if (scriptMessageAudio[name] === undefined) scriptMessageAudio[name] = {}
                scriptMessageAudio[name][parseInt(m[1])] = audio[1].trim()
            }
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

    export function drop(obj: Obj, source: Obj): boolean {
        if (!obj._script || obj._script.drop_p_proc === undefined) return false
        obj._script.self_obj = obj as ScriptableObj
        obj._script.source_obj = source
        obj._script.cur_map_index = currentMapID
        obj._script._didOverride = false
        obj._script.drop_p_proc()
        return obj._script._didOverride
    }

    export function useObjOnMe(obj: Obj, item: Obj, source: Obj): boolean {
        if (!obj._script || obj._script.use_obj_on_p_proc === undefined) return false
        // CE ref: proto_instance.cc:1286 scriptSetObjects(targetObj->sid, critter, item)
        obj._script.self_obj = obj as ScriptableObj
        obj._script.source_obj = source
        obj._script.target_obj = item
        obj._script.cur_map_index = currentMapID
        obj._script._didOverride = false
        obj._script.use_obj_on_p_proc()
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
        dialogueOptionTexts.length = 0
        dialogueReviewLog.length = 0
        gameObjects = null
        currentMapObject = null
        currentMapID = mapID !== undefined ? mapID : null
        mapVars = {}
        loadMapVars(mapName)
    }

    export function init(mapName: string, mapID?: number) {
        // CE ref: random.cc:31 randomInit() — seeds from compat_timeGetTime() for different rolls each launch
        randomInit(Date.now())
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
