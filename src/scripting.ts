import * as Events from './events.js'
import { activeAssetMods, assetLayer, assetUrl } from './modAssets.js'
import * as GlobalScripts from './sfallGlobalScripts.js'
import { isPartyMemberPid } from './party.js'
import { filterBadwords } from './badwords.js'
import { GAME_DIALOG_REACTION_NEUTRAL, reactToOption } from './talkingHead.js'
import { randomSeedPrerandom } from './random.js'
import { critterKill } from './critter.js'
import { getElevator, lookupScriptName, mapIndexOf, parseMsgFile } from './data.js'
import { prefetchMap } from './map/prefetch.js'
import * as GameTime from './gametime.js'
import { Point } from './geometry.js'
import globalState from './globalState.js'
import { parseIntFile } from './intfile.js'
import { dbg, dbgWarn } from './logger.js'
import { uiElevator } from './uiElevator.js'
import { Critter, createObjectWithPID, Obj } from './object.js'
import { uiBarterMode } from './ui.js'
import { uiLog } from './messageLog.js'
import { UIMode } from './uiMode.js'
import { updateIndicatorBar } from './hudRefresh.js'
import { BinaryReader, getFileBinarySync, getFileJSON, getFileText, getMessage } from './util.js'
import { ScriptVM } from './vm.js'
import { attachLuaScript, isLuaReady, LuaScriptHandle } from './lua/luaRuntime.js'
import * as Worldmap from './worldmap.js'
import * as ScriptVMBridge from './vmBridge.js'
import { setChildProgramLoader, vmClearPrograms, vmDoEvents } from './vm.js'
import { Config } from './config.js'
import { isWithinPerception } from './perception.js'
import * as ScriptingModule from './scripting.js' // itself: window.Scripting below
import { installMethods } from './installMethods.js'
import { coreOpcodes } from './scripting/opcodes/core.js'
import { metaruleOpcodes } from './scripting/opcodes/metarule.js'
import { critterOpcodes } from './scripting/opcodes/critter.js'
import { inventoryOpcodes } from './scripting/opcodes/inventory.js'
import { objectsOpcodes } from './scripting/opcodes/objects.js'
import { mapOpcodes } from './scripting/opcodes/map.js'
import { animOpcodes } from './scripting/opcodes/anim.js'
import { dialogueOpcodes } from './scripting/opcodes/dialogue.js'
import { combatOpcodes } from './scripting/opcodes/combat.js'
import { sfallOpcodes } from './scripting/opcodes/sfall.js'
import { dialogueExit, talk } from './scripting/events.js'
export {
    getScriptMessage,
    speakScriptMessage,
    dialogueEnd,
    dialogueExit,
    reenterDialogue,
    getDialogueOptionCount,
    talk,
    updateCritter,
    spatial,
    destroy,
    damage,
    useSkillOn,
    pickup,
    isDropping,
    drop,
    useObjOnItem,
    useObjOnMe,
    combatEvent,
} from './scripting/events.js'

// Module state the Script methods share (an object, so the methods kept in src/scripting/*.ts can
// assign it too; wiki/code_quality.md Q16).
export const scriptingState = {
    animBatch: null as AnimEntry[] | null,
    overrideStartPos: null as StartPos | null,
    nextSfallListId: 0xcccccc,
    sfallMessageWindowOpen: false,
    // Per-dialogue barter modifier set by gdialog_set_barter_mod.
    // Reset to 0 on dialogue exit. Applied as a percentage markup in uiBarter.ts.
    // ref: fallout2-ce barter.cc, dialog.cc gDialogSetBarterMod
    dialogueBarterMod: 0,
    // CE game_dialog.cc gameDialogBarter only sets _dialogue_switch_mode = 2; the dialogue
    // loop opens the barter screen once the option's procedure has returned (with the
    // reply and options it set up). The merchant waiting for that, while an option runs.
    pendingBarter: null as Critter | null,
    dialogueReviewLog: [] as DialogueReviewEntry[],
    // CE gDialogReplyMessageListId != -1: a reply the dialogue loop has to show (set by
    // gsay_reply / gsay_message, cleared when a gsay_message's loop ends)
    dialogueReplyPending: false,
    currentDialogueObject: null as Obj | null,
    dialogueOptionProcs: [] as (() => void)[], // Maps dialogue options to handler callbacks
    dialogueOptionTexts: [] as string[], // parallel to dialogueOptionProcs — display text, for the review log
    dialogueOptionReactions: [] as number[], // parallel — GAME_DIALOG_REACTION_* (head reaction on pick)
    // dialogue_system_enter's request (CE gGameDialogSpeaker + game state 4)
    requestedDialogue: null as Obj | null,
    floatMsgLastColor: 0, // CE _last_color (opFloatMessage COLOR_SEQUENCE)
    fadeOverlay: null as HTMLDivElement | null,
    // load_map's transition (CE mapSetTransition): a map name or index
    pendingMapTransition: null as string | number | null,
}

let gameObjects: Obj[] | null = null
export let mapVars: any = null
export let globalVars: any = {}
let globalVarsLoaded = false
export let currentMapID: number | null = null
let currentMapObject: Script | null = null
export let mapFirstRun = true
// CE loadsave.cc _loadingGame / _isLoadingGame — set while a saved game's map runs
// its start / map_enter / map_update procs (GameMap.runLoadGameProcs).
export let loadingGame = false
export function isLoadingGame(): boolean {
    return loadingGame
}
export function setLoadingGame(v: boolean): void {
    loadingGame = v
}
export let scriptMessages: { [scriptName: string]: { [msgID: number]: string } } = {}
// the map script's map_enter_p_proc is running (override_map_start hands its position
// to the map loader then)
export let inMapEnter = false
// CE _scr_spatials_disable / _scr_spatials_enable: no spatial_p_proc while map_enter /
// map_update scripts run or scenery explodes
let spatialsOff = 0
export function spatialsEnabled(): boolean {
    return spatialsOff === 0
}
export function withSpatialsOff<T>(fn: () => T): T {
    spatialsOff++
    try {
        return fn()
    } finally {
        spatialsOff--
    }
}
export let inDialogueReply = false
export let scriptMessageAudio: { [msgFile: string]: { [msgID: number]: string } } = {} // {id}{audio}{text} middle field
/** CE game_dialog.cc _gdialogActive: a dialogue (or its barter / control screens) is up. */
export function dialogueActive(): boolean {
    return scriptingState.currentDialogueObject !== null
}

// Conversation review log. CE ref: game_dialog.cc gDialogReviewEntries —
// every NPC line (gsay_reply/gsay_message) paired with whichever option
// text the player picked in response (set once the player actually
// chooses, game_dialog.cc:2040-2044 _gdProcessChoice), shown via the
// Review button (game_dialog.cc:1512 gameDialogReviewButtonOnMouseUp).
export interface DialogueReviewEntry {
    reply: string
    option: string | null
}

export function getDialogueReviewLog(): readonly DialogueReviewEntry[] {
    return scriptingState.dialogueReviewLog
}
export let timeEventList: TimedEvent[] = []

const PROTO_ID_MONEY = 41

// CE perk.cc perkGetRankData: whose perk ranks a critter has — the dude's own, a
// party.txt member's own, else (CE's fallback for any other critter) the dude's.
export function perkRankOwner(c: Critter): Critter {
    if (c.isPlayer || isPartyMemberPid(c.pid)) return c
    return globalState.player as Critter
}

// CE item.cc itemGetTotalCaps — money in the inventory and, recursively, in containers.
export function itemGetTotalCaps(obj: Obj): number {
    let amount = 0
    for (const item of obj.inventory ?? []) {
        if (item.pid === PROTO_ID_MONEY) amount += item.amount ?? 1
        else if (item.subtype === 'container') amount += itemGetTotalCaps(item)
    }
    return amount
}

// CE item.cc itemCapsAdjust — take from (or add to) the money stacks first, then the
// containers; with no money at all a positive amount becomes a new stack.
export function itemCapsAdjust(obj: Obj, amount: number): number {
    const caps = itemGetTotalCaps(obj)
    if (amount < 0 && caps < -amount) return -1
    if (amount <= 0 || caps !== 0) {
        const inv = obj.inventory
        for (let i = 0; i < inv.length && amount !== 0; i++) {
            const item = inv[i]
            if (item.pid !== PROTO_ID_MONEY) continue
            if (amount <= 0 && -amount >= (item.amount ?? 1)) {
                amount += item.amount ?? 1
                inv.splice(i, 1)
                i = -1
            } else {
                item.amount = (item.amount ?? 1) + amount
                amount = 0
            }
        }
        for (let i = 0; i < inv.length && amount !== 0; i++) {
            const item = inv[i]
            if (item.subtype !== 'container') continue
            const inside = itemGetTotalCaps(item)
            if (amount <= 0 || inside <= 0) {
                if (amount < 0) {
                    if (inside < -amount) {
                        if (itemCapsAdjust(item, inside) === 0) amount += inside
                    } else if (itemCapsAdjust(item, amount) === 0) amount = 0
                }
            } else if (itemCapsAdjust(item, amount) === 0) {
                amount = 0
            }
        }
        return 0
    }
    obj.addInventoryItem(createObjectWithPID(PROTO_ID_MONEY), amount)
    return 0
}
// CE ref: game_vars.h GVAR_TOWN_REP_* — maps each town-reputation GVAR index
// (verified against CE source; indices are NOT contiguous) to its display name.
// character_editor.cc gTownReputationEntries[TOWN_REPUTATION_COUNT=19].
export const TOWN_REP_GVARS: { [gvar: number]: string } = {
    47: 'Arroyo',
    48: 'Klamath',
    49: 'The Den',
    50: 'Vault City',
    51: 'Gecko',
    52: 'Modoc',
    53: 'Sierra Base',
    54: 'Broken Hills',
    55: 'New Reno',
    56: 'Redding',
    57: 'NCR',
    59: 'Vault 13',
    61: 'San Francisco',
    63: 'Abbey',
    64: 'EPA',
    65: 'Primitive Tribe',
    66: 'Raiders',
    294: 'Vault 15',
    308: 'Ghost Farm',
}

export function getDialogueBarterMod(): number {
    return scriptingState.dialogueBarterMod
}

// CE animation.cc animationRegisterAnimate: the object's fid for `anim` (buildFid) —
// a critter plays that animation (its weapon code kept), other objects their single
// FRM.
export function playAnimId(obj: Obj, anim: number, reversed: boolean, then: () => void): void {
    if (obj.type === 'critter') (obj as Critter).staticAnimation('anim:' + anim, then, true, reversed)
    else obj.singleAnimation(reversed, then)
}

// Animation batch (reg_anim_begin / reg_anim_end queue)
// ref: fallout2-ce animation.cc animationRegAnimFunc / animationRegAnimAnimate
export interface AnimStep {
    kind: 'animate'
    obj: Obj
    anim: number
    delay: number
    reversed?: boolean
}
interface AnimFunc {
    kind: 'func'
    fn: (() => void) | null
    delay?: number
}
// animationRegisterMoveTo{Tile,Object} / RunTo…: walk (or run) there; the next step
// waits until it arrives (or can't get there).
export interface AnimMove {
    kind: 'move'
    obj: Obj
    to: Point | Obj
    run: boolean
    delay: number
}
// animationRegisterAnimateForever (ANIM_KIND_ANIMATE_FOREVER): loops until cleared
export interface AnimForever {
    kind: 'forever'
    obj: Obj
    anim: number
}
export type AnimEntry = AnimStep | AnimFunc | AnimMove | AnimForever
// CE game_dialog.cc DIALOG_OPTION_ENTRIES_CAPACITY
export const DIALOG_OPTION_ENTRIES_CAPACITY = 30

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
    // CE queue.cc gEventTypeDescriptions — what _queue_leaving_map does with the event:
    // 'keep' (poison, radiation), or a clear proc that returns true when the event goes
    // (false keeps it). Unset: the event is dropped (script timers and the rest).
    leaveMap?: 'keep' | (() => boolean)
    script?: boolean // CE EVENT_TYPE_SCRIPT (add_timer_event)
}

// CE queue.cc _queue_leaving_map (map.cc _map_save_in_game): every event type marked
// for it is cleared, through its clear proc where it has one.
export function queueLeavingMap(): void {
    for (const e of timeEventList.slice()) {
        if (e.leaveMap === 'keep') continue
        if (e.leaveMap && !e.leaveMap()) continue
        const i = timeEventList.indexOf(e)
        if (i !== -1) timeEventList.splice(i, 1)
    }
}

export interface SerializedTimedEvent {
    objUid?: number | null // CE queueSave writes the owner's object id; saves before 2026-10-25 only have the PID
    objPid: number | null
    ticks: number
    userdata: any
}

// CE critter.cc critterAdjustHitPoints: capped at Max HP; at 0 or less the critter dies
export function critterAdjustHitPoints(c: Critter, delta: number): void {
    c.stats.modifyBase('HP', delta)
    const max = c.getStat('Max HP')
    const hp = c.getStat('HP')
    if (hp > max) c.stats.modifyBase('HP', max - hp)
    else if (hp <= 0 && !c.dead) critterKill(c)
}

// The dude's trait part of a SPECIAL base (DH2 keeps Gifted, Bruiser and Small Frame in
// the base; CE traitGetStatModifier)
export function traitSpecialPart(c: Critter, stat: number): number {
    if (!c.isPlayer) return 0
    const t: string[] = (c as any).traits ?? []
    let n = t.includes('Gifted') ? 1 : 0
    if (stat === 0 && t.includes('Bruiser')) n += 2
    if (stat === 5 && t.includes('Small Frame')) n += 1
    return n
}

export function setGameUiDisabled(disabled: boolean): void {
    globalState.gameUIDisabled = disabled
    const $bar = document.getElementById('bar')
    if ($bar) $bar.style.pointerEvents = disabled ? 'none' : ''
}

export let statMap: { [stat: number]: string } = {
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
    if (Config.scripting.debugLogShowType.stub === false || Config.scripting.debugLogShowType[type!] === false) return
    let a = ''
    for (let i = 0; i < args.length; i++)
        if (i === args.length - 1) a += args[i]
        else a += args[i] + ', '
    console.log('STUB: ' + name + ': ' + a)
}

export function log(name: string, args: unknown[], type?: DebugLogShowType) {
    if (Config.scripting.debugLogShowType.log === false || Config.scripting.debugLogShowType[type!] === false) return
    let a = ''
    for (let i = 0; i < args.length; i++)
        if (i === args.length - 1) a += args[i]
        else a += args[i] + ', '
    console.log('log: ' + name + ': ' + a)
}

export function warn(msg: string, type?: DebugLogShowType, script?: Script) {
    if (type !== undefined && Config.scripting.debugLogShowType[type] === false) return
    if (script) console.log(`WARNING [${script.scriptName}]: ${msg}`)
    else console.log(`WARNING: ${msg}`)
}

export function info(msg: string, type?: DebugLogShowType, script?: Script) {
    if (type !== undefined && Config.scripting.debugLogShowType[type] === false) return
    if (script) console.log(`INFO [${script.scriptName}]: ${msg}`)
    else console.log(`INFO: ${msg}`)
}

// CE ref: critter.cc:327 critterAdjustPoison — player only. Positive amounts are
// reduced by poison resistance; a positive result (re)schedules the decay event at
// 10*(505-5*poison) ticks; messages misc.msg 3000/3002/3003.
export function adjustPoison(critter: Critter, amount: number): void {
    if (critter !== globalState.player) return
    if (amount > 0) {
        amount -= Math.trunc((amount * (critter.getStat('DR Poison') ?? 0)) / 100)
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
                e.userdata = 'poison-cancelled'
                e.fn = () => {}
                e.ticks = 1
            }
        }
        timeEventList.push({
            obj: critter,
            ticks: 10 * (505 - 5 * newPoison),
            userdata: 'poison',
            fn: () => poisonDecayEvent(critter),
            leaveMap: 'keep',
        })
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
    if (hp <= 0 && !critter.dead) critterKill(critter, undefined, false) // CE critterAdjustHitPoints → critterKill: no destroy_p_proc
    // CE returns 1 at 5 HP or less: queueProcessEvents stops (a rest ends)
    if (hp <= 5) Events.emit('queueBail')
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

// CE ref: game.cc gameReset → gameLoadGlobalVars (vault13.gam defaults), _scr_reset /
// scriptsReset (queue, MVARs of every map) — a new game or a load starts clean.
export function resetGameState(): void {
    vmClearPrograms() // a new game / load: no program's exports or call_at / call_when survive
    globalVars = {}
    globalVarsLoaded = false
    loadGlobalVars()
    mapVars = null
    timeEventList.length = 0
}

export function getMapVars(): any {
    return mapVars
}

export function setMapVars(vars: any): void {
    mapVars = vars ?? {}
}

// CE ref: scripts.cc scriptsSaveProcedureNames — timed events persisted with map save
export function getTimedEventsSerialized(): SerializedTimedEvent[] {
    return timeEventList.map((e) => ({
        objUid: e.obj?.uid ?? null,
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

// data/maps/<map>.mvars.json per map (null = none), fetched once per session.
const mapVarsFileCache: { [map: string]: { [idx: string]: number } | null } = {}

export function loadMapVars(mapName: string): void {
    const scriptName = mapName.toLowerCase()
    try {
        if (!(scriptName in mapVarsFileCache)) {
            try {
                mapVarsFileCache[scriptName] = getFileJSON('data/maps/' + scriptName + '.mvars.json')
            } catch (e) {
                mapVarsFileCache[scriptName] = null
            }
        }
        const data = mapVarsFileCache[scriptName]
        if (data === null) return
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

export function isGameObject(obj: any) {
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

// DAMAGE_TYPE_* order (proto_types.h), as Weapon.ts names them
export const DAMAGE_TYPE_NAMES = ['Normal', 'Laser', 'Fire', 'Plasma', 'Electrical', 'EMP', 'Explosive']

// CE scripts.cc scriptsRequestElevator(self, type): the elevator stub (0x200050D) in the
// 10×10 tiles around the script's object (its type and level win), else the explicit
// type; -1 refuses. The elevator opens after the script (a request).
export function requestElevator(self: Obj | null, explicitType: number): void {
    if (!self?.position) return
    let type = explicitType
    const elevation = (self as any).elevation ?? globalState.gMap!.currentElevation
    const objects: Obj[] = globalState.gMap!.getObjects(elevation)
    search: for (let dy = -5; dy < 5; dy++) {
        for (let dx = -5; dx < 5; dx++) {
            const x = self.position.x + dx,
                y = self.position.y + dy
            const stub = objects.find((o) => o.pid === 0x200050d && o.position?.x === x && o.position?.y === y)
            if (stub) {
                type = (stub as any).extra?.type ?? type
                break search
            }
        }
    }
    if (type === -1 || type === undefined) return
    setTimeout(() => {
        const elevator = getElevator(type)
        if (elevator) uiElevator(elevator)
        else warn('metarule(15): no elevator type ' + type)
    }, 0)
}

// Every object that can carry items: the map's objects on all elevations and the dude.
export function allCarriers(): Obj[] {
    const levels: Obj[][] = globalState.gMap?.objects ?? []
    const all = levels.flat()
    const dude = globalState.player
    if (dude && !all.includes(dude)) all.push(dude)
    return all
}

export function isSpatial(obj: any): boolean {
    if (!obj) return false
    return obj.isSpatial === true
}

export function getScriptName(id: number): string {
    // return getLstId("scripts/scripts", id - 1).split(".")[0].toLowerCase()
    return lookupScriptName(id)
}

export function dialogueReply(id: number): void {
    const f = scriptingState.dialogueOptionProcs[id]
    // CE ref: game_dialog.cc:2040-2044 _gdProcessChoice — records the
    // chosen option's text onto the most recent review entry, before
    // running its callback (which may clear/replace state).
    const pickedText = scriptingState.dialogueOptionTexts[id]
    // CE game_dialog.cc _gdProcessChoice → _talk_to_critter_reacts(option reaction).
    reactToOption(scriptingState.dialogueOptionReactions[id] ?? GAME_DIALOG_REACTION_NEUTRAL)
    scriptingState.dialogueOptionReactions = []
    if (scriptingState.dialogueReviewLog.length > 0 && pickedText !== undefined) {
        scriptingState.dialogueReviewLog[scriptingState.dialogueReviewLog.length - 1].option = pickedText
    }
    scriptingState.dialogueOptionProcs = []
    scriptingState.dialogueOptionTexts = []
    scriptingState.dialogueOptionReactions = []
    inDialogueReply = true
    try {
        f()
    } finally {
        inDialogueReply = false
    }
    if (scriptingState.pendingBarter) {
        const merchant = scriptingState.pendingBarter
        scriptingState.pendingBarter = null
        uiBarterMode(merchant)
        return
    }
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
    if (scriptingState.currentDialogueObject !== null && scriptingState.dialogueOptionProcs.length === 0) {
        // after running the option procedure we have no options...
        // so close the dialogue
        dbg('dialogue', '[dialogue exit via dialogueReply (no replies)]')
        dialogueExit()
    }
}

/** Seed Math.random for deterministic crawler runs. */
export function setSeed(n: number): void {
    seed(n)
}

// CE opObjectCanSeeObject: same elevation, both on the map, within perception (any
// target), and the target is the first obstacle of _make_straight_path(a, a, b)
export function objCanSeeObj(obj: Critter, target: Obj): boolean {
    if (obj.elevation !== target.elevation || !obj.position || !target.position) return false
    if (!isWithinPerception(obj, target as Critter)) return false
    return globalState.gMap!.straightPathBlockingObject(obj, target.position, 0) === target
}

export interface SerializedScript {
    name: string
    lvars: { [lvar: number]: any }
}

export interface ScriptableObj {
    _script: Script
}

// CE game_sound.cc:92 _snd_lookup_scenery_action
export const SND_SCENERY_ACTION = 'OCLNU'
// CE art.cc _art_get_code for sound names (weapon code, anim code)
export function artGetCodeForSfx(animation: number, weaponType: number): [string, string] | null {
    const chr = (b: string, o: number) => String.fromCharCode(b.charCodeAt(0) + o)
    if (weaponType < 0 || weaponType >= 11) return null
    if (animation >= 38 && animation <= 47)
        return weaponType === 0 ? null : [chr('d', weaponType - 1), chr('c', animation - 38)]
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

// sfall get_object_data on combat_data (CE combat_defs.h Attack at sfall's 32-bit offsets)
export const ATTACK_FIELDS_BY_OFFSET: { [offset: number]: string } = {
    0: 'attacker',
    8: 'weapon',
    16: 'attackerDamage',
    20: 'attackerFlags',
    24: 'ammoQuantity',
    28: 'criticalMessageId',
    32: 'defender',
    44: 'defenderDamage',
    48: 'defenderFlags',
    52: 'defenderKnockback',
    56: 'oops',
}

// sfall: CE hit locations → DH2 region names (combat_defs.h HIT_LOCATION_*)
export const SFALL_HIT_LOCATIONS = ['head', 'leftArm', 'rightArm', 'torso', 'rightLeg', 'leftLeg', 'eyes', 'groin']
// CE message.cc STANDARD_MESSAGE_LIST_* / PROTO_MESSAGE_LIST_* file names
export const SFALL_STANDARD_MESSAGE_FILES = [
    'combat',
    'combatai',
    'scrname',
    'misc',
    'custom',
    'inventry',
    'item',
    'lsgame',
    'map',
    'options',
    'perk',
    'pipboy',
    'quests',
    'proto',
    'script',
    'skill',
    'skilldex',
    'stat',
    'trait',
    'worldmap',
]
export const SFALL_PROTO_MESSAGE_FILES = ['pro_item', 'pro_crit', 'pro_scen', 'pro_wall', 'pro_tile', 'pro_misc']
// CE sfall_lists.cc: the open object lists
export const sfallLists = new Map<number, { objects: any[]; next: number }>()

// the class + interface merge is intended: the interface carries the opcode methods installed below
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Script {
    // Stuff we hacked in
    _didOverride = false // Did the procedure call override the default action?

    scriptName!: string
    lvars!: { [lvar: number]: any }
    _vm?: ScriptVM
    _lua?: LuaScriptHandle // set when the Lua backend runs this script (src/lua/)
    _pendingEntry?: () => void // startup code not run yet (setDeferObjectStart)
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
    push_p_proc!: () => void
    pickup_p_proc!: () => void
    drop_p_proc!: () => void
    is_dropping_p_proc!: () => void

    combat_p_proc!: () => void
    damage_p_proc!: () => void
    destroy_p_proc!: () => void

    use_skill_on_p_proc!: () => void
    // CE op_set_self (0x8206): the next use_obj_on_obj / pickup_obj runs as obj
    // (interpreter_extra.cc opUseObjectOnObject / opPickup consume overriddenSelf)
    overriddenSelf: Obj | null = null

    _serialize(): SerializedScript {
        return { name: this.scriptName, lvars: Object.assign({}, this.lvars) }
    }
}

export function deserializeScript(obj: SerializedScript): Script {
    const script = loadScript(obj.name)
    script.lvars = obj.lvars
    // TODO: do some kind of logic like enterMap/updateMap
    return script
}

export function loadMessageFile(name: string) {
    name = name.toLowerCase()
    info('loading message file: ' + name, 'load')
    const msg = getFileText('data/text/english/dialog/' + name + '.msg')
    if (scriptMessages[name] === undefined) scriptMessages[name] = {}

    for (const e of parseMsgFile(msg, name)) {
        scriptMessages[name][e.num] = e.text
        // CE message.cc: the middle field is the speech file for talking heads.
        if (e.audio.trim() !== '') {
            if (scriptMessageAudio[name] === undefined) scriptMessageAudio[name] = {}
            scriptMessageAudio[name][e.num] = e.audio.trim()
        }
    }
    filterBadwords(scriptMessages[name]) // CE scripts.cc:2703 messageListFilterBadwords
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

/** CE sfall_gl_scr_exec_start_proc after a save is loaded (loadsave.cc) */
export function startSfallGlobalScripts(): void {
    GlobalScripts.startGlobalScripts((name) => loadScript(name))
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

    if (Config.scripting.backend === 'lua') {
        const luaScript = loadLuaScript(name)
        if (luaScript) return luaScript
    }
    return loadIntScript(name)
}

// The .int on the script VM (vm.ts) — also a child program's (callstart / spawn / fork / exec)
function loadIntScript(name: string): Script {
    const path = 'data/scripts/' + name.toLowerCase() + '.int'
    const data: DataView = getFileBinarySync(path)
    const reader = new BinaryReader(data)
    const intfile = parseIntFile(reader, name.toLowerCase())

    if (!currentMapObject) dbg('load', 'note: using current script (%s) as map script for this object', intfile.name)

    reader.seek(0)
    const vm = new ScriptVMBridge.GameScriptVM(reader, intfile)
    vm.scriptObj.scriptName = name
    vm.scriptObj.lvars = {}
    vm.scriptObj._mapScript = currentMapObject || vm.scriptObj // map scripts are their own map scripts
    vm.scriptObj._vm = vm
    // CE scriptExecProc runs the startup code when the program loads, on its first proc —
    // for a map's objects that is scriptsExecStartProc (startMapScripts)
    if (deferObjectStart) vm.scriptObj._pendingEntry = () => vm.run()
    else vm.run()

    // return the scriptObj, which is a clone of ScriptProto
    // which will be patched by the GameScriptVM to allow
    // transparent procedure calls
    return vm.scriptObj
}

// Lua backend (src/lua/): data/scripts/<name>.lua from tools/int2lua.py, or a
// mod's mods/<mod>/scripts/<name>.lua (Config.scripting.mods, the last listed
// mod that has the script wins). Null when there is no .lua file or it does
// not load, so the .int runs instead. data/scripts/ paths go through the mod
// asset overlay (modAssets.ts): a mod whose .int did not decompile has no .lua,
// and the .lua of a lower layer (the vanilla script) must not run in its place.
function loadLuaScript(name: string): Script | null {
    if (!isLuaReady()) return null
    const key = name.toLowerCase()
    // hand-written Lua mods (no manifest) first; a pipeline-built mod folder's scripts
    // come through the asset overlay as data/scripts/<name>.lua, unless that layer has
    // only the .int
    const assetMods = activeAssetMods()
    const paths = Config.scripting.mods
        .filter((m) => !assetMods.includes(m))
        .reverse()
        .map((m) => `mods/${m}/scripts/${key}.lua`)
    if (assetLayer(`data/scripts/${key}.int`) <= assetLayer(`data/scripts/${key}.lua`))
        paths.push('data/scripts/' + key + '.lua')
    else dbg('lua', `${key}: the mod's ${key}.int has no .lua`)
    let source: string | null = null
    for (const path of paths) {
        try {
            source = getFileText(path)
        } catch (e) {
            continue
        }
        if (path.startsWith('mods/')) dbg('lua', `${key}: using ${path}`)
        break
    }
    if (source === null) {
        dbg('lua', `no ${key}.lua, using ${key}.int`)
        return null
    }
    const script = new Script()
    script.scriptName = name
    script.lvars = {}
    script._mapScript = currentMapObject || script // map scripts are their own map scripts
    try {
        attachLuaScript(script, key, source, deferObjectStart)
    } catch (e) {
        dbgWarn('lua', `${key}.lua failed to load (${e}), using ${key}.int`)
        return null
    }
    return script
}

// CE map.cc mapLoad → scriptsExecStartProc: after the map script's map_enter_p_proc and
// the party's placement, `start` runs for every script on the map, list by list — the map
// script, the spatials, items (and scenery), critters. Scripts loaded meanwhile (the map's,
// its objects', those its map_enter_p_proc creates) wait for it (setDeferObjectStart); their
// startup code runs when their first proc does, as CE loads a program on its first proc.
let deferObjectStart = false
export function setDeferObjectStart(on: boolean): void {
    deferObjectStart = on
}
export function startMapScripts(mapScript: Script | null, spatials: Obj[], objects: Obj[]): void {
    deferObjectStart = false
    if (mapScript) initScript(mapScript, { _script: mapScript } as any)
    for (const spatial of spatials) if (spatial._script) initScript(spatial._script, spatial)
    const scripted = objects.filter((o) => o._script)
    for (const o of scripted) if (o.type !== 'critter' && o._script) initScript(o._script, o)
    for (const o of scripted) if (o.type === 'critter' && o._script) initScript(o._script, o)
}

// CE scripts.cc scriptsSetDudeScript (object.cc objectsInit / new game): the dude runs
// obj_dude.int (scripts.lst index 0) — GECK experience, the GECK drop block, the mutation
// messages, its timers (add_timer_event(dude_obj, …)). A loaded game's LVARs go in
// before its start proc runs.
let pendingDudeLvars: { [lvar: number]: any } | null = null
export function setPendingDudeLvars(lvars: { [lvar: number]: any } | null): void {
    pendingDudeLvars = lvars
    if (globalState.player) globalState.player._script = undefined
}
export function ensureDudeScript(): void {
    const player = globalState.player
    if (!player || player._script) return
    let script: Script | null = null
    try {
        script = loadScript('obj_dude')
    } catch (e) {
        warn('obj_dude: ' + e)
    }
    if (!script) return
    if (pendingDudeLvars) script.lvars = pendingDudeLvars
    pendingDudeLvars = null
    player.script = 'obj_dude'
    player._script = script
    initScript(script, player)
}

export function initScript(script: Script, obj: Obj) {
    script.self_obj = obj as ScriptableObj
    script.cur_map_index = currentMapID!
    if (deferObjectStart) return // startMapScripts runs it
    const entry = script._pendingEntry
    if (entry) {
        script._pendingEntry = undefined
        entry()
    }
    if (script.start !== undefined) script.start()
}

// CE scripts.cc scriptExecProc: a procedure the script doesn't have (procs[proc] == 0) runs
// its procedure #1 instead (SCR-11). DH2 runs nothing; the console says so, once per script
// and procedure, when CE's #1 would do something — not the sslc door helper
// checkPartyMembersNearDoor that is #1 in most scripts.
const missingProcWarned = new Set<string>()
const procedureOneNames: { [script: string]: Promise<string | null> } = {}
// (the Lua backend reads the .int's procedure table in the background, once per script)
function procedureOneName(script: Script): Promise<string | null> {
    const key = (script.scriptName ?? '').toLowerCase()
    if (!(key in procedureOneNames)) {
        procedureOneNames[key] = script._vm
            ? Promise.resolve(script._vm.intfile.proceduresTable?.[1]?.name ?? null)
            : fetch(assetUrl('data/scripts/' + key + '.int'))
                  .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
                  .then(
                      (buf) =>
                          parseIntFile(new BinaryReader(new DataView(buf)), key).proceduresTable?.[1]?.name ?? null,
                  )
                  .catch((): null => null) // a stub, or no .int
    }
    return procedureOneNames[key]
}
export function noteMissingProc(script: Script | undefined, proc: string): void {
    if (!script?.scriptName) return
    const key = script.scriptName + ':' + proc
    if (missingProcWarned.has(key)) return
    missingProcWarned.add(key)
    void procedureOneName(script).then((one) => {
        if (!one || one.toLowerCase() === 'checkpartymembersneardoor' || one.toLowerCase() === proc) return
        console.warn(
            `[script] ${script.scriptName} has no ${proc}: CE (scripts.cc scriptExecProc) would run ` +
                `its procedure #1, ${one}, here instead; DH2 runs nothing (SCR-11, wiki/ce_audit/script_engine.md)`,
        )
    })
}

export function timedEvent(script: Script, userdata: any): boolean {
    info('timedEvent: ' + script.scriptName + ': ' + userdata, 'timer')
    if (script.timed_event_p_proc === undefined) {
        noteMissingProc(script, 'timed_event_p_proc')
        warn(
            `timedEvent called on script without a timed_event_p_proc! script: ${script.scriptName} userdata: ${userdata}`,
        )
        return false
    }

    script.fixed_param = userdata
    script._didOverride = false
    script.timed_event_p_proc()
    return script._didOverride
}

// CE proto_instance.cc _obj_look_at_func / _obj_examine_func — SCRIPT_PROC_LOOK_AT /
// SCRIPT_PROC_DESCRIPTION with source = the viewer; true if the script overrode the
// engine's text (script_overrides).
function runViewProc(obj: Obj, source: Obj, proc: 'look_at_p_proc' | 'description_p_proc'): boolean {
    const script: any = obj._script
    if (!script || script[proc] === undefined) {
        noteMissingProc(script, proc)
        return false
    }
    script.source_obj = source
    script.self_obj = obj as ScriptableObj
    script.cur_map_index = currentMapID
    script._didOverride = false
    script[proc]()
    return script._didOverride
}
export function lookAt(obj: Obj, source: Obj): boolean {
    return runViewProc(obj, source, 'look_at_p_proc')
}
export function description(obj: Obj, source: Obj): boolean {
    return runViewProc(obj, source, 'description_p_proc')
}

export function use(obj: Obj, source: Obj): boolean | null {
    if (!obj._script || obj._script.use_p_proc === undefined) {
        noteMissingProc(obj._script!, 'use_p_proc')
        return null
    }

    obj._script.source_obj = source
    obj._script.self_obj = obj as ScriptableObj
    obj._script._didOverride = false
    obj._script.use_p_proc()
    return obj._script._didOverride
}

// CE actions.cc actionPush: the target's push_p_proc with the pusher as source;
// true when the script overrode the engine's push.
export function push(obj: Obj, source: Obj): boolean {
    const script = obj._script
    if (!script || !script.push_p_proc) return false
    script.self_obj = obj as ScriptableObj
    script.source_obj = source
    script.cur_map_index = currentMapID
    script._didOverride = false
    script.push_p_proc()
    return script._didOverride
}

// the new map's files, fetched while the transition waits (map/prefetch.ts); null = none pending
let transitionPrefetchDone: boolean | null = null
export function startTransitionPrefetch(mapName: string | null): void {
    if (!mapName) {
        return
    }
    transitionPrefetchDone = false
    void prefetchMap(mapName).finally(() => {
        transitionPrefetchDone = true
    })
}

/** Change to the map a script's load_map asked for, once no dialogue runs and
 *  no map is loading (CE game loop → mapHandleTransition). True if it did.
 *  `waitForPrefetch`: also wait until the new map's files are fetched (the game loop does;
 *  the story crawler does not, its traces must not depend on download timing). */
export function processMapTransition(waitForPrefetch = false): boolean {
    if (scriptingState.pendingMapTransition === null || globalState.uiMode !== UIMode.none || globalState.isLoading)
        return false
    if (waitForPrefetch && transitionPrefetchDone === false) {
        return false
    }
    transitionPrefetchDone = null
    const map = scriptingState.pendingMapTransition
    scriptingState.pendingMapTransition = null
    if (typeof map === 'string') {
        globalState.gMap!.loadMap(map)
        Events.emit('mapTransition', mapIndexOf(map))
    } else {
        globalState.gMap!.loadMapByID(map)
        Events.emit('mapTransition', map)
    }
    return true
}

/** Open the dialogue a script requested with dialogue_system_enter, once no
 *  dialogue or combat is running. Called by the game tick (and the story
 *  crawler, which ticks by hand). True if one was opened. */
// CE scripts.cc gScriptsRequests / scriptsHandleRequests: what a script asks for — a
// fight, the world map, an explosion, the endgame — happens from the game loop after the
// script returned (with the dialogue over), in CE's order; the dialogue request between.
type ScriptRequestKind = 'combat' | 'worldMap' | 'explosion' | 'endgame'
const scriptRequests = new Map<ScriptRequestKind, () => void>()
export function requestScript(kind: ScriptRequestKind, run: () => void): void {
    scriptRequests.set(kind, run) // CE keeps one of each (the last request's data)
}
function runScriptRequest(kind: ScriptRequestKind): void {
    const run = scriptRequests.get(kind)
    if (!run) return
    scriptRequests.delete(kind)
    try {
        run()
    } catch (e) {
        warn(`script request ${kind}: ${e}`)
    }
}
// CE _updatePrograms → _doEvents: call_at / call_when procedures of the .int programs
export function doProgramEvents(): void {
    vmDoEvents()
}
setChildProgramLoader((name) => {
    try {
        return loadIntScript(name)._vm ?? null
    } catch (e) {
        return null
    }
})

export function processScriptRequests(): void {
    if (scriptRequests.size === 0 || globalState.uiMode !== UIMode.none) return
    if (scriptRequests.has('combat') && !globalState.inCombat) runScriptRequest('combat')
    else scriptRequests.delete('combat') // in combat attack_setup / attack_complex only engage
    runScriptRequest('worldMap')
    runScriptRequest('explosion')
}
export function processEndgameRequest(): void {
    if (globalState.uiMode !== UIMode.none) return
    runScriptRequest('endgame')
}
// gameReset / map change: pending requests go
export function clearScriptRequests(): void {
    scriptRequests.clear()
}

export function processDialogueRequest(): boolean {
    if (!scriptingState.requestedDialogue || globalState.uiMode !== UIMode.none || globalState.inCombat) return false
    const obj = scriptingState.requestedDialogue
    scriptingState.requestedDialogue = null
    if (!obj._script || (obj as any).dead) return false
    talk(obj._script, obj)
    return true
}

export function updateMap(mapScript: Script, objects: Obj[], elevation: number) {
    withSpatialsOff(() => updateMapScripts(mapScript, objects))
}

function updateMapScripts(mapScript: Script, objects: Obj[]) {
    gameObjects = objects
    mapFirstRun = false

    if (mapScript) {
        if (mapScript.map_update_p_proc !== undefined) {
            mapScript.self_obj = { _script: mapScript }
            mapScript.map_update_p_proc()
        }
    }

    for (let i = 0; i < gameObjects.length; i++) {
        const script = gameObjects[i]._script
        if (script !== undefined && script!.map_update_p_proc === undefined)
            noteMissingProc(script!, 'map_update_p_proc')
        if (script !== undefined && script!.map_update_p_proc !== undefined) {
            script!.self_obj = gameObjects[i] as ScriptableObj
            // Fallout 2 style HHMM: "8:24 AM" => 824, "3:00 PM" => 1500
            script!.game_time_hour = GameTime.getHourMilitary()
            script!.cur_map_index = currentMapID
            script!.map_update_p_proc()
        }
    }
    GlobalScripts.globalScriptsMapProc('map_update_p_proc') // CE scriptsExecMapUpdateScripts
}

export function enterMap(
    mapScript: Script,
    objects: Obj[],
    elevation: number,
    mapID: number,
    isFirstRun: boolean,
): StartPos | null {
    return withSpatialsOff(() => enterMapScripts(mapScript, objects, mapID, isFirstRun))
}

function enterMapScripts(mapScript: Script, objects: Obj[], mapID: number, isFirstRun: boolean): StartPos | null {
    gameObjects = objects
    currentMapID = mapID
    mapFirstRun = isFirstRun
    ensureDudeScript()

    // Fallout 2 resets ambient light to max on every map load; any
    // script darkness is reapplied by the new map's map_enter_p_proc.
    GameTime.clearLightLevelOverride()

    if (mapScript && mapScript.map_enter_p_proc !== undefined) {
        info('calling map enter')
        mapScript.self_obj = { _script: mapScript }
        // CE map.cc mapLoad: scriptSetFixedParam(gMapSid, (gMapHeader.flags & 1) == 0) — 1 on
        // the first visit (the map not saved yet)
        mapScript.fixed_param = isFirstRun ? 1 : 0
        inMapEnter = true
        try {
            mapScript.map_enter_p_proc()
        } finally {
            inMapEnter = false
        }
    }
    GlobalScripts.globalScriptsMapProc('map_enter_p_proc') // CE scriptsExecMapUpdateScripts
    // a new game: its global scripts start once its map is loaded (CE main.cc)
    GlobalScripts.startGlobalScriptsIfRequested((name) => loadScript(name))

    if (scriptingState.overrideStartPos) {
        const r = scriptingState.overrideStartPos
        scriptingState.overrideStartPos = null
        return r
    }

    // XXX: caller should do this for all objects, which is better?
    return null
}

// Runs a no-argument proc on an object's script with the per-call context
// objectEnterMap sets up (used for map_exit_p_proc).
export function objectRunProc(obj: Obj, proc: 'map_exit_p_proc'): void {
    const script: any = obj._script
    if (script === undefined || script[proc] === undefined) {
        noteMissingProc(script, proc)
        return
    }
    script.self_obj = obj as ScriptableObj
    script.game_time_hour = GameTime.getHourMilitary()
    script.cur_map_index = currentMapID
    script[proc]()
}

export function objectEnterMap(obj: Obj, elevation: number, mapID: number) {
    const script = obj._script
    if (script !== undefined && script!.map_enter_p_proc !== undefined) {
        script!.self_obj = obj as ScriptableObj
        // CE scripts.cc scriptsExecMapUpdateScripts(MAP_ENTER): fixed_param = first visit
        script!.fixed_param = mapFirstRun ? 1 : 0
        script!.game_time_hour = GameTime.getHourMilitary()
        script!.cur_map_index = currentMapID
        script!.map_enter_p_proc()
    } else noteMissingProc(script!, 'map_enter_p_proc')
}

export function reset(mapName: string, mapID?: number) {
    // CE: the old map's programs are freed, and with them their exported procedures and
    // pending call_at / call_when; the dude's and the global scripts stay
    const dudeScript = globalState.player?._script
    vmClearPrograms((vm: any) => vm.scriptObj === dudeScript || GlobalScripts.globalScriptIsLoaded(vm.scriptObj))
    // The event queue is not emptied here: leaving the old map already cleared what CE
    // clears (queueLeavingMap, _queue_leaving_map); poison, radiation and the party's
    // drug events carry over. A new game / load empties it (resetGameState).
    scriptingState.dialogueOptionProcs.length = 0
    scriptingState.dialogueOptionTexts.length = 0
    scriptingState.dialogueReviewLog.length = 0
    gameObjects = null
    currentMapObject = null
    currentMapID = mapID !== undefined ? mapID : null
    // MVARs belong to their map and persist with it (CE saves them with the map);
    // only a map never seen before gets its defaults (loadMapVars fills missing ones).
    if (mapVars === null) mapVars = {}
    loadMapVars(mapName)
}

export function init(mapName: string, mapID?: number) {
    Worldmap.setWorldmapGlobalVarHooks((g: number) => globalVars[g] ?? 0, setGlobalVar) // car GVARs
    // No randomInit here: CE seeds the RNG once per launch (game.cc gameInitWithOptions →
    // random.cc randomInit; DH2: random.ts on module load), not on every map load.
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

if (typeof window !== 'undefined') {
    // the module's own namespace object, for DevTools and the test pages (was the TS namespace)
    window.Scripting = ScriptingModule
}

// Script's methods kept in other files by topic (wiki/code_quality.md Q16): installed on the prototype
// here, typed through the interface merge below. Import those files only through this module: it
// must be loaded first, so that their objects exist when it installs them.
type ScriptMethods = typeof coreOpcodes &
    typeof metaruleOpcodes &
    typeof critterOpcodes &
    typeof inventoryOpcodes &
    typeof objectsOpcodes &
    typeof mapOpcodes &
    typeof animOpcodes &
    typeof dialogueOpcodes &
    typeof combatOpcodes &
    typeof sfallOpcodes
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
export interface Script extends ScriptMethods {}
installMethods(
    Script.prototype,
    coreOpcodes,
    metaruleOpcodes,
    critterOpcodes,
    inventoryOpcodes,
    objectsOpcodes,
    mapOpcodes,
    animOpcodes,
    dialogueOpcodes,
    combatOpcodes,
    sfallOpcodes,
)
