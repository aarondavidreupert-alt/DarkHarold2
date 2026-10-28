// Script opcodes: variables (GVAR / LVAR / MVAR), messages, float text, timers and game time (CE interpreter_extra.cc op_set_global_var, op_display_msg, op_add_timer_event, ...).
// Methods of the Script class (scripting.ts), kept here by topic and installed on its prototype
// there; vm_bridge.ts and the Lua prelude call them as before (wiki/code_quality.md Q16).

import type { Script } from '../../scripting.js'
import { Config } from '../../config.js'
import { FLOAT_MSG_COLOR, addFloatMessage } from '../../floatText.js'
import * as GameTime from '../../gametime.js'
import { Obj } from '../../object.js'
import { dbg } from '../../logger.js'
import { getRandomInt } from '../../util.js'
import globalState from '../../globalState.js'
import { uiLog } from '../../messageLog.js'
import {
    TOWN_REP_GVARS,
    dialogueExit,
    getScriptMessage,
    globalVars,
    info,
    isGameObject,
    log,
    mapVars,
    scriptingState,
    timeEventList,
    timedEvent,
    warn,
} from '../../scripting.js'

export const coreOpcodes = {
    // Actual scripting engine API implementations

    set_global_var(this: Script, gvar: number, value: any) {
        globalVars[gvar] = value
        info('set_global_var: ' + gvar + ' = ' + value, 'gvars')
        log('set_global_var', [gvar, value], 'gvars')
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
    },
    set_local_var(this: Script, lvar: number, value: any) {
        // CE scriptSetLocalVar: a map script has no LVARs in scripts.lst — nothing is stored
        if (globalState.gMap?.mapScript === this) {
            warn('set_local_var: map scripts have no local vars')
            return
        }
        this.lvars[lvar] = value
        info('set_local_var: ' + lvar + ' = ' + value + ' [' + this.scriptName + ']', 'lvars')
        log('set_local_var', [lvar, value], 'lvars')
    },
    local_var(this: Script, lvar: number) {
        log('local_var', [lvar], 'lvars')
        // CE scriptGetLocalVar: every LVAR exists from the start as 0 and a read
        // never writes (an unset one is 0 here, not stored); a map script's read is −1
        if (globalState.gMap?.mapScript === this) {
            warn('local_var: map scripts have no local vars')
            return -1
        }
        return this.lvars[lvar] ?? 0
    },
    map_var(this: Script, mvar: number) {
        if (this._mapScript === undefined) {
            warn('map_var: no map script')
            return
        }
        const scriptName = this._mapScript.scriptName
        if (scriptName === undefined) {
            warn('map_var: map script has no name')
            return
        }
        // CE mapGetGlobalVar: an MVAR the map never set is 0; a read never writes
        return mapVars[scriptName]?.[mvar] ?? 0
    },
    set_map_var(this: Script, mvar: number, value: any) {
        if (!this._mapScript) throw Error('set_map_var: no map script')
        const scriptName = this._mapScript.scriptName
        if (scriptName === undefined) {
            warn('map_var: map script has no name')
            return
        }
        info('set_map_var: ' + mvar + ' = ' + value, 'mvars')
        if (mapVars[scriptName] === undefined) mapVars[scriptName] = {}
        mapVars[scriptName][mvar] = value
    },
    global_var(this: Script, gvar: number) {
        if (globalVars[gvar] === undefined) {
            warn('global_var: unknown gvar ' + gvar + ', using default (0)', 'gvars')
            globalVars[gvar] = 0
        }
        return globalVars[gvar]
    },
    random(this: Script, min: number, max: number) {
        log('random', [min, max])
        return getRandomInt(min, max)
    },
    debug_msg(this: Script, msg: string) {
        log('debug_msg', [msg])
        info('DEBUG MSG: [' + this.scriptName + ']: ' + msg, 'debugMessage')
    },
    display_msg(this: Script, msg: string) {
        log('display_msg', [msg])
        info('DISPLAY MSG: ' + msg, 'displayMessage')
        uiLog(msg)
    },
    message_str(this: Script, msgList: number, msgNum: number) {
        return getScriptMessage(msgList, msgNum)
    },
    script_overrides(this: Script) {
        log('script_overrides', [])
        info('[SCRIPT OVERRIDES]')
        this._didOverride = true
    },
    // player
    give_exp_points(this: Script, xp: number) {
        // CE opGiveExpPoints → pcAddExperience: no message — the scripts display their
        // own "You gain %d experience points." (the extra uiLog doubled it)
        if (!globalState.player) return
        globalState.player.addExperience(xp)
    },
    // combat
    node998(this: Script) {
        // enter combat
        dbg('script', '[enter combat]')
    },
    // dialogue
    node999(this: Script) {
        // exit dialogue
        info('DIALOGUE EXIT (Node999)')
        dialogueExit()
    },
    // ── Opcodes that were never bridged (found 2026-10-06 by diffing CE's
    //    interpreterRegisterOpcode table against vm.ts/vm_bridge.ts). An unbridged
    //    opcode makes vm.step() return false, silently ending the procedure.

    // CE interpreter_extra.cc opScrReturn (0x80A2) — value handed back to the engine.
    scr_return(this: Script, value: number) {
        this.returnValue = value
    },
    float_msg(this: Script, obj: Obj, msg: string, type: number) {
        log('float_msg', [obj, msg, type])
        //info("FLOAT MSG: " + msg, "floatMessage")
        if (!isGameObject(obj)) {
            warn('float_msg: not game object: ' + obj)
            return
        }
        // CE opFloatMessage: COLOR_SEQUENCE (-1) cycles BLACK..LIGHT_GREY; WARNING
        // (-2) is red in font 103; every type has a black outline.
        if (type === -1) {
            scriptingState.floatMsgLastColor =
                scriptingState.floatMsgLastColor + 1 >= 13 ? 1 : scriptingState.floatMsgLastColor + 1
            type = scriptingState.floatMsgLastColor
        }
        addFloatMessage({
            msg: msg,
            obj: obj, // CE opFloatMessage: over the object passed in (was this.self_obj)
            startTime: window.performance.now(),
            color: FLOAT_MSG_COLOR[type] ?? FLOAT_MSG_COLOR[0],
            font: type === -2 ? 103 : 101,
        })
    },
    game_ticks(this: Script, seconds: number) {
        return seconds * 10
    },
    days_since_visited(this: Script) {
        // CE ref: interpreter_extra.cc:3734 opGetDaysSinceLastVisit
        // Returns floor((currentTick - lastVisitTime) / TICKS_PER_DAY), or -1 if never visited.
        const lastVisit = globalState.gMap?.lastVisitTime ?? 0
        if (lastVisit === 0) return -1
        return Math.floor((GameTime.getTime() - lastVisit) / GameTime.TICKS_PER_DAY)
    },
    game_time_advance(this: Script, ticks: number) {
        log('game_time_advance', [ticks])
        info('advancing time ' + ticks + ' ticks (' + ticks / 10 + ' seconds)')
        // CE ref: interpreter_extra.cc:2761 opGameTimeAdvance — advance, then
        // queueProcessEvents(); GameTime's time-jump hook (gameTick.ts) runs every
        // crossed midnight and fires the expired timed events in due order.
        GameTime.advanceTicks(ticks)
    },
    // timing
    add_timer_event(this: Script, obj: Obj, ticks: number, userdata: any) {
        log('add_timer_event', [obj, ticks, userdata])
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
            script: true,
            fn: function () {
                timedEvent(obj._script!, userdata)
            }.bind(this),
        })
    },
    // CE interpreter_extra.cc opRemoveTimerEvent → queue.cc queueRemoveEvents(object):
    // every queued event this object owns goes, whatever its type.
    rm_timer_event(this: Script, obj: Obj) {
        log('rm_timer_event', [obj])
        if (!obj) {
            warn('rm_timer_event: pobj is NULL')
            return
        }
        for (let i = timeEventList.length - 1; i >= 0; i--) {
            if (timeEventList[i].obj === obj) timeEventList.splice(i, 1)
        }
    },
    // Not an opcode: the decompiled Lua asks this before a script fix
    // (tools/int2lua.py SCRIPT_FIXES): 1 = use the fix, 0 = the original behaviour.
    // DH2 addition, fallout2.cfg [dh2] script_fixes.
    dh2_script_fixes(this: Script) {
        return Config.scripting.scriptFixes ? 1 : 0
    },
}
