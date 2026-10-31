// Script entry points the engine calls for an object's events: talk, use, look, spatial triggers,
// destroy, damage, skill use, pickup, drop, use-on, combat (CE scripts.cc scriptExecProc callers),
// and the dialogue runtime around them. Moved out of scripting.ts, which re-exports them, so
// Scripting.talk(...) etc. keep working (wiki/code_quality.md Q16).

import { Critter, Obj } from '../object.js'
import { SKILL_NAMES } from '../skills.js'
import * as SfallHooks from '../sfallHooks.js'
import { dbg } from '../logger.js'
import { getProtoMsg } from '../util.js'
import { isTalkingHeadActive, startLips } from '../talkingHead.js'
import { toTileNum } from '../tile.js'

import { uiPort } from '../uiPort.js'
import {
    Script,
    ScriptableObj,
    currentMapID,
    getScriptName,
    info,
    loadMessageFile,
    noteMissingProc,
    scriptMessageAudio,
    scriptMessages,
    scriptingState,
    warn,
} from '../scripting.js'

export function getScriptMessage(id: number, msg: string | number) {
    if (typeof msg === 'string')
        // passed in a string message
        return msg

    // CE scripts.cc _scr_get_msg_str_speech: (0, 0) and (−1, −1) are an empty string,
    // (−2, −2) proto.msg 650
    if ((id === 0 && msg === 0) || (id === -1 && msg === -1)) return ''
    if (id === -2 && msg === -2) return getProtoMsg(650) ?? ''

    const name = getScriptName(id)
    if (name === null) {
        warn('getScriptMessage: no script with ID ' + id)
        return null
    }

    if (scriptMessages[name] === undefined) loadMessageFile(name)
    if (scriptMessages[name] === undefined) throw new Error('getScriptMessage: loadMessageFile failed?')
    if (scriptMessages[name][msg] === undefined) {
        // CE scripts.cc _scr_get_msg_str_speech: a missing message is the text "Error"
        // (vccharly asks for 134, which its .msg does not have)
        warn('getScriptMessage: no message ' + msg + ' for script ' + id + ' (' + name + ')')
        return 'Error'
    }

    return scriptMessages[name][msg]
}

// CE scripts.cc:2726 _scr_get_msg_str_speech(…, a3=1): with a talking head
// active, a reply whose message has a speech name starts the lip-synced audio.
export function speakScriptMessage(msgList: number, msgID: string | number): void {
    if (typeof msgID !== 'number' || !isTalkingHeadActive()) return
    const name = getScriptName(msgList)
    if (!name) return
    const audio = scriptMessageAudio[name.toLowerCase()]?.[msgID]
    if (audio) startLips(audio)
    else dbg('dialogue', `Missing speech name: ${msgID}`)
}

export function dialogueEnd() {
    // dialogue exited from [Done] or the UI
    dbg('dialogue', '[dialogue exit via dialogueExit]')
    dialogueExit()
}

export function dialogueExit() {
    SfallHooks.gameModeSpecial(false) // sfall: SPECIAL while the dialogue panel closes
    uiPort.uiEndDialogue()
    scriptingState.dialogueBarterMod = 0
    info('[dialogue exit]')

    const lua = scriptingState.currentDialogueObject?._script?._lua
    if (lua) {
        // the Lua backend suspended the procedure in gsay_end / gsay_message;
        // the dialogue is over, so it continues (CE: gsay_end returns). Clear
        // the dialogue first: the code after gsay_end calls end_dialogue.
        scriptingState.currentDialogueObject = null
        lua.resume()
        return
    }

    if (scriptingState.currentDialogueObject) {
        // resume what halted in gsay_end / gsay_message, like the Lua path
        // above; clear the dialogue first, the code after gsay_end calls
        // end_dialogue
        const vm = scriptingState.currentDialogueObject._script!._vm!
        scriptingState.currentDialogueObject = null
        info('[resuming from gsay_end/gsay_message]')
        vm.resume()
        return
    }

    scriptingState.currentDialogueObject = null
}

// Back from Barter / Trade / Combat Control. CE gameDialogTicker mode 1 recreates the
// window and gdUnhide shows the same reply and options again — talk_p_proc runs once
// per conversation. With no options left (the node that opened barter set none), the
// dialogue is over.
export function reenterDialogue(): void {
    if (!scriptingState.currentDialogueObject || !scriptingState.currentDialogueObject._script) {
        return
    }
    uiPort.uiStartDialogue(true, scriptingState.currentDialogueObject as Critter)
    if (scriptingState.dialogueOptionProcs.length === 0) {
        dbg('dialogue', '[dialogue exit after barter (no options)]')
        dialogueExit()
    }
}

/** Returns the number of currently pending dialogue option procs.
 *  Used by the AutoCrawler to check whether options are visible without DOM access. */
export function getDialogueOptionCount(): number {
    return scriptingState.dialogueOptionProcs.length
}

export function talk(script: Script, obj: Obj): boolean {
    script.self_obj = obj as ScriptableObj
    script.cur_map_index = currentMapID
    script._didOverride = false
    script.talk_p_proc()
    return script._didOverride
}

export function updateCritter(script: Script, obj: Critter): boolean {
    // critter heartbeat (critter_p_proc)
    if (!script.critter_p_proc) {
        noteMissingProc(script, 'critter_p_proc')
        return false
    }

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
    // CE scriptExecProc: a script without the proc just does nothing
    if (!script || !script.spatial_p_proc) return

    script.cur_map_index = currentMapID
    script.source_obj = source
    script.self_obj = spatialObj as ScriptableObj
    script.spatial_p_proc()
}

export function destroy(obj: Obj, source?: Obj) {
    if (!obj._script || !obj._script.destroy_p_proc) return null

    obj._script.self_obj = obj as ScriptableObj
    obj._script.source_obj = source || 0
    obj._script.cur_map_index = currentMapID
    obj._script._didOverride = false
    obj._script.destroy_p_proc()
    return obj._script._didOverride
}

export function damage(obj: Obj, target: Obj, source: Obj, damage: number) {
    if (!obj._script || obj._script.damage_p_proc === undefined) {
        noteMissingProc(obj._script!, 'damage_p_proc')
        return null
    }

    obj._script.self_obj = obj as ScriptableObj
    obj._script.target_obj = target
    obj._script.source_obj = source
    obj._script.cur_map_index = currentMapID
    obj._script._didOverride = false
    obj._script.fixed_param = damage // CE _damage_object: scriptSetFixedParam(sid, damage)
    obj._script.damage_p_proc()
    return obj._script._didOverride
}

export function useSkillOn(who: Critter, skillId: number, obj: Obj): boolean {
    if (!obj._script) throw Error('useSkillOn: Object has no script')
    const skillName = SKILL_NAMES[skillId] ?? `Unknown(${skillId})`
    dbg(
        'script',
        `useSkillOn: ${who.name ?? 'unknown'} uses ${skillName} (id=${skillId}) on ${obj.name ?? obj.type ?? 'unknown'}`,
    )
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

// CE proto_instance.cc _obj_drop: the owner's is_dropping_p_proc, source_obj = the
// item about to be dropped. True when the script overrides (keeps the item).
export function isDropping(owner: Obj, item: Obj): boolean {
    if (!owner._script || owner._script.is_dropping_p_proc === undefined) {
        noteMissingProc(owner._script!, 'is_dropping_p_proc')
        return false
    }
    owner._script.self_obj = owner as ScriptableObj
    owner._script.source_obj = item
    owner._script.cur_map_index = currentMapID
    owner._script._didOverride = false
    owner._script.is_dropping_p_proc()
    return owner._script._didOverride
}

export function drop(obj: Obj, source: Obj): boolean {
    if (!obj._script || obj._script.drop_p_proc === undefined) {
        noteMissingProc(obj._script!, 'drop_p_proc')
        return false
    }
    obj._script.self_obj = obj as ScriptableObj
    obj._script.source_obj = source
    obj._script.cur_map_index = currentMapID
    obj._script._didOverride = false
    obj._script.drop_p_proc()
    return obj._script._didOverride
}

// CE ref: proto_instance.cc:1293 — the item's own use_obj_on_p_proc, with
// scriptSetObjects(item->sid, critter, targetObj). True when the script overrides.
export function useObjOnItem(item: Obj, source: Obj, target: Obj): boolean {
    if (!item._script || item._script.use_obj_on_p_proc === undefined) {
        noteMissingProc(item._script!, 'use_obj_on_p_proc')
        return false
    }
    item._script.self_obj = item as ScriptableObj
    item._script.source_obj = source
    item._script.target_obj = target
    item._script.cur_map_index = currentMapID
    item._script._didOverride = false
    item._script.use_obj_on_p_proc()
    return item._script._didOverride
}

export function useObjOnMe(obj: Obj, item: Obj, source: Obj): boolean {
    if (!obj._script || obj._script.use_obj_on_p_proc === undefined) {
        noteMissingProc(obj._script!, 'use_obj_on_p_proc')
        return false
    }
    // CE ref: proto_instance.cc:1286 scriptSetObjects(targetObj->sid, critter, item)
    obj._script.self_obj = obj as ScriptableObj
    obj._script.source_obj = source
    obj._script.target_obj = item
    obj._script.cur_map_index = currentMapID
    obj._script._didOverride = false
    obj._script.use_obj_on_p_proc()
    return obj._script._didOverride
}

export function combatEvent(obj: Obj, event: 'turnBegin' | 'damage' | 'hit' | 'wantToJoin', target?: Obj): boolean {
    if (!obj._script) throw Error('combatEvent: Object has no script')

    let fixed_param: number | null = null
    switch (event) {
        case 'turnBegin':
            fixed_param = 4
            break // COMBAT_SUBTYPE_TURN
        case 'damage':
        case 'hit':
            fixed_param = 2
            break // COMBAT_SUBTYPE_HIT_SUCCEEDED (CE _apply_damage: the attacker's proc)
        case 'wantToJoin':
            fixed_param = 5
            break // CE _combatai_want_to_join
        default:
            throw new Error('combatEvent: unknown event ' + event)
    }

    if (!obj._script.combat_p_proc) return false

    info('[COMBAT EVENT ' + event + ']')

    obj._script.fixed_param = fixed_param
    if (target !== undefined) obj._script.target_obj = target
    obj._script.self_obj = obj as ScriptableObj
    obj._script.cur_map_index = currentMapID
    obj._script._didOverride = false

    // TODO: script_overrides

    // hack so that the procedure is allowed to finish before
    // we actually terminate combat
    let doTerminate: any = false // did combat_p_proc terminate combat?
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
