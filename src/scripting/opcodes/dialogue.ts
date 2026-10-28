// Script opcodes: the dialogue opcodes (CE op_start_gdialog, op_gsay_*, op_giq_option, op_end_dialogue).
// Methods of the Script class (scripting.ts), kept here by topic and installed on its prototype
// there; vmBridge.ts and the Lua prelude call them as before (wiki/code_quality.md Q16).

import type { Script } from '../../scripting.js'
import { Critter, Obj } from '../../object.js'
import { FIDGET_BAD, FIDGET_GOOD, FIDGET_NEUTRAL, startTalkingHead, talkToCritterReacts } from '../../talkingHead.js'
import { UIMode } from '../../uiMode.js'
import { dbg, dbgWarn } from '../../logger.js'
import { getProtoMsg } from '../../util.js'
import { world } from '../../state/world.js'
import { uiState } from '../../state/uiState.js'
import { resetFloatMessages } from '../../floatText.js'
import { uiAddDialogueOption, uiBarterMode, uiSetDialogueReply, uiStartDialogue } from '../../ui.js'
import {
    DIALOG_OPTION_ENTRIES_CAPACITY,
    dialogueExit,
    getScriptMessage,
    inDialogueReply,
    info,
    log,
    scriptingState,
    speakScriptMessage,
    warn,
} from '../../scripting.js'

export const dialogueOpcodes = {
    gdialog_set_barter_mod(this: Script, mod: number) {
        // ref: fallout2-ce barter.cc, dialog.cc gDialogSetBarterMod
        log('gdialog_set_barter_mod', [mod])
        scriptingState.dialogueBarterMod = mod
    },
    gdialog_mod_barter(this: Script, mod: number) {
        // CE ref: game_dialog.cc:3163 gameDialogBarter — sets _dialogBarterMod then opens barter
        log('gdialog_mod_barter', [mod])
        dbg('dialogue', '--> barter mode')
        if (!this.self_obj) throw new Error('need self_obj')
        scriptingState.dialogueBarterMod = mod
        // inside an option's procedure: open it when the procedure has returned
        if (inDialogueReply) scriptingState.pendingBarter = this.self_obj as Critter
        else uiBarterMode(this.self_obj as Critter)
    },
    start_gdialog(this: Script, msgFileID: number, obj: Obj, mood: number, headNum: number, backgroundID: number) {
        log('start_gdialog', [msgFileID, obj, mood, headNum, backgroundID])
        info('DIALOGUE START', 'dialogue')
        if (!this.self_obj) throw new Error('no self_obj for start_gdialog')
        // CE opStartGameDialog: nothing in combat
        if (world.inCombat) return
        // CE ref: game_dialog.cc:1070-1075 _gdialogStart resets the review
        // log once per conversation. start_gdialog() fires on every
        // talk_p_proc run, including Scripting.reenterDialogue()'s
        // re-entry after Barter/Trade/Combat-Control — only reset on a
        // genuinely fresh Talk (uiMode isn't already dialogue yet; on a
        // reenter, reenterDialogue() already set it before calling talk()).
        if (uiState.uiMode !== UIMode.dialogue) {
            scriptingState.dialogueReviewLog = []
            scriptingState.dialogueReplyPending = false
            resetFloatMessages() // CE _gdialogInitFromScript → textObjectsReset
        }
        scriptingState.currentDialogueObject = this.self_obj as Critter
        uiStartDialogue(false, this.self_obj as Critter)
        // CE ref: interpreter_extra.cc:1892 opStartGameDialog — with a head, the
        // starting fidget comes from the speaker's reaction (LVAR 0 →
        // reactionTranslateValue: > 10 good, > -10 neutral, else bad); otherwise mood.
        if (!world.inCombat) {
            let fidget = mood
            if (headNum !== -1) {
                const lv0 = this.self_obj._script?.lvars?.[0]
                const value = typeof lv0 === 'number' ? lv0 : -1
                fidget = value > 10 ? FIDGET_GOOD : value > -10 ? FIDGET_NEUTRAL : FIDGET_BAD
            }
            startTalkingHead(headNum, fidget, backgroundID)
        }
    },
    // CE ref: interpreter_extra.cc:4937 op_dialogue_reaction (0x80E0)
    dialogue_reaction(this: Script, value: number) {
        talkToCritterReacts(value)
    },
    // CE ref: interpreter_extra.cc _op_gsay_option (0x811F) — option without an IQ test.
    gsay_option(this: Script, msgList: number, msgID: string | number, target: any, reaction: number) {
        const msg = getScriptMessage(msgList, msgID)
        if (msg === null) {
            dbgWarn('script', 'gsay_option: msg is null')
            return
        }
        if (scriptingState.dialogueOptionProcs.length >= DIALOG_OPTION_ENTRIES_CAPACITY) return // CE: 30 at most
        scriptingState.dialogueOptionProcs.push(target.bind(this))
        scriptingState.dialogueOptionTexts.push(msg)
        scriptingState.dialogueOptionReactions.push(reaction)
        uiAddDialogueOption(msg, scriptingState.dialogueOptionProcs.length - 1, reaction)
    },
    gsay_start(this: Script) {
        log('gsay_start', [])
        // CE _gdialogStart: the review entries and the options start empty
        scriptingState.dialogueReviewLog = []
        scriptingState.dialogueOptionProcs = []
        scriptingState.dialogueOptionTexts = []
        scriptingState.dialogueOptionReactions = []
        // ensure dialogue UI is open (may already be open from start_gdialog)
        if (uiState.uiMode !== UIMode.dialogue && this.self_obj) {
            uiStartDialogue(false, this.self_obj as Critter)
        }
    },
    //gSay_Option(msgList, msgID, target, reaction) { stub("gSay_Option", arguments) },
    gsay_reply(this: Script, msgList: number, msgID: string | number) {
        log('gSay_Reply', [msgList, msgID])
        const msg = getScriptMessage(msgList, msgID)
        if (msg === null) throw Error('gsay_reply: msg is null')
        info('REPLY: ' + msg, 'dialogue')
        // CE gameDialogSetMessageReply: options added before the reply are dropped
        scriptingState.dialogueOptionProcs = []
        scriptingState.dialogueOptionTexts = []
        scriptingState.dialogueOptionReactions = []
        uiSetDialogueReply(msg)
        // CE scripts.cc:2726 _scr_get_msg_str_speech(…, 1) — speak it if there's a head.
        speakScriptMessage(msgList, msgID)
        // CE ref: game_dialog.cc:1134-1146 gameDialogSetMessageReply ->
        // gameDialogAddReviewMessage.
        scriptingState.dialogueReviewLog.push({ reply: msg, option: null })
        scriptingState.dialogueReplyPending = true // CE gameDialogSetMessageReply
    },
    gsay_message(this: Script, msgList: number, msgID: string | number, reaction: number) {
        // ref: fallout2-ce dialog.cc gDialogSayMessage
        log('gsay_message', [msgList, msgID, reaction])
        const msg = getScriptMessage(msgList, msgID)
        if (msg === null) {
            warn('gsay_message: msg is null')
            return
        }
        uiSetDialogueReply(msg)
        speakScriptMessage(msgList, msgID)
        // CE ref: game_dialog.cc:1148-1160 gameDialogSetTextReply ->
        // gameDialogAddReviewText.
        scriptingState.dialogueReviewLog.push({ reply: msg, option: null })
        // CE _op_gsay_message → _gdialogSayMessage: a nested dialogue loop with one
        // [Done] option (proto.msg 650); picking it returns into this procedure with the
        // dialogue still open, and the reply is cleared (gDialogReplyMessageListId = -1),
        // so a later gsay_end returns at once. dialogueReply closes the dialogue only if
        // the procedure then sets no new options.
        const self = this
        scriptingState.dialogueReplyPending = true
        scriptingState.dialogueOptionProcs.push(() => {
            scriptingState.dialogueReplyPending = false
            if (self._lua) self._lua.resumeOne()
            else self._vm?.resume(true)
        })
        const done = getProtoMsg(650) ?? '[Done]'
        scriptingState.dialogueOptionTexts.push(done)
        uiAddDialogueOption(done, scriptingState.dialogueOptionProcs.length - 1)
        // save resume address and halt VM, mirroring the gsay_end convention
        if (this._vm) {
            this._vm.retStack.push(this._vm.script.offset)
            this._vm.halted = true
        }
    },
    gsay_end(this: Script) {
        // Halt the VM so the player can interact with dialogue options.
        // dialogueExit() resumes it (ScriptVM.resume).
        //
        // CE ref: game_dialog.cc:3662 _gdCanBarter / :4357-4388 — Barter
        // and (for party members) Combat Control are persistent buttons
        // on the dialogue window itself, not tied to any one node's
        // option list. Previously synthesized as dialogue-list options
        // here; moved to real always-present buttons wired in
        // uiStartDialogue() (uiDialogue.ts) to match CE — see
        // wiki/known_bugs.md P9.
        // CE game_dialog.cc _gdialogGo: with no reply pending (none set, or a gsay_message
        // already ran its own loop) it returns at once; a reply with no options gets the
        // implicit option (-1, -1: proto.msg 655 for INT < 4, else an empty entry) that
        // continues. Returns 1 when the caller should suspend for the dialogue (the VM
        // opcode / the Lua prelude do the suspending).
        if (!scriptingState.dialogueReplyPending) {
            info('[gsay_end: no reply pending, returns]', 'dialogue')
            return 0
        }
        if (scriptingState.dialogueOptionProcs.length === 0) {
            const text = world.player!.getStat('INT') < 4 ? (getProtoMsg(655) ?? '') : ''
            scriptingState.dialogueOptionProcs.push(() => {})
            scriptingState.dialogueOptionTexts.push(text)
            scriptingState.dialogueOptionReactions.push(50)
            uiAddDialogueOption(text, scriptingState.dialogueOptionProcs.length - 1)
        }
        info('[gsay_end: halting for dialogue]', 'dialogue')
        return 1
    },
    end_dialogue(this: Script) {
        info('[end_dialogue]', 'dialogue')
        dialogueExit()
    },
    giq_option(this: Script, iqTest: number, msgList: number, msgID: string | number, target: any, reaction: number) {
        log('giQ_Option', [iqTest, msgList, msgID, target, reaction])
        const msg = getScriptMessage(msgList, msgID)
        if (msg === null) {
            dbgWarn('script', 'giq_option: msg is null')
            return
        }
        info('DIALOGUE OPTION: ' + msg + ' [INT ' + (iqTest >= 0 ? '>=' + iqTest : '<=' + -iqTest) + ']', 'dialogue')

        // CE _op_giq_option: INT + Smooth Talker rank.
        const INT =
            world.player!.getStat('INT') + world.player!.perks.filter((p: string) => p === 'Smooth Talker').length
        if ((iqTest > 0 && INT < iqTest) || (iqTest < 0 && INT > -iqTest)) return // not enough intelligence for this option
        if (scriptingState.dialogueOptionProcs.length >= DIALOG_OPTION_ENTRIES_CAPACITY) return // CE: 30 at most

        scriptingState.dialogueOptionProcs.push(target.bind(this))
        scriptingState.dialogueOptionTexts.push(msg)
        scriptingState.dialogueOptionReactions.push(reaction)
        uiAddDialogueOption(msg, scriptingState.dialogueOptionProcs.length - 1, reaction)
    },
    dialogue_system_enter(this: Script) {
        log('dialogue_system_enter', [])
        if (!this.self_obj) {
            warn('dialogue_system_enter: no self_obj')
            return
        }
        // CE opGameDialogSystemEnter: an inactive critter (dead / knocked out)
        // or combat refuses; otherwise it only requests the dialogue (game
        // state 4), which the main loop opens after this script returns —
        // not a dialogue nested in the running one (processDialogueRequest)
        const self = this.self_obj as any
        if (self.type === 'critter' && (self.dead || ((self.injuryFlags ?? 0) & 0x01) !== 0)) return
        if (world.inCombat) return
        scriptingState.requestedDialogue = this.self_obj as Obj
    },
    // CE opGetScriptAction (0x80C7) — script->action
    script_action(this: Script) {
        return this.action ?? 0
    },
}
