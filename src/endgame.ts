// Endgame slideshow and death ending system.
//
// CE ref: src/endgame.cc
//   endgamePlaySlideshow          (0x43F788)
//   endgamePlayMovie              (0x43F810)
//   endgameEndingRenderStaticScene (0x440004)
//   endgameEndingRenderPanningScene (0x43FBDC)
//   endgameEndingVoiceOverInit    (0x4401A0)
//   endgameEndingRefreshSubtitles (0x4404EC)
//   endgameDeathEndingInit        (0x440984)
//   endgameSetupDeathEnding       (0x440BD0)
//   endgameDeathEndingValidate    (0x440CF4)
//   endgameDeathEndingGetFileName (0x440D8C)
//   endgameEndingHandleContinuePlaying (0x43F8C4)
//
// DH2 approach: DOM canvas overlay rendered on top of the game canvas.
// No palette pipeline — slides are pre-exported PNGs in art/intrface/.
// See wiki/endgame.md for system overview and known gaps.
//
// Split per wiki/ts-split-refactor.md §19:
//   endgame/deathEndings.ts — selection + filename helpers
//   endgame/slideRender.ts  — slide rendering primitives + overlay

import { returnToMainMenu } from './mainMenuReturn.js'
import { showConfirm } from './uiDialog.js'
import * as Scripting from './scripting.js'
import { services } from './state/services.js'
import { getFileJSON, getMessage } from './util.js'
import { dbg, dbgWarn } from './logger.js'
import {
    createOverlay,
    removeOverlay,
    showDeathScreen,
    showStaticSlide,
    showPanningSlide,
    showCredits,
} from './endgame/slideRender.js'
import { getDeathEndingFileName, setupDeathEnding, DEATH_REASON_DEATH } from './endgame/deathEndings.js'

export {
    EndgameDeathEnding,
    DEATH_REASON_DEATH,
    DEATH_REASON_TIMEOUT,
    setupDeathEnding,
    getDeathEndingFileName,
} from './endgame/deathEndings.js'

// CE: endgame.h EndgameEnding struct
interface EndgameEnding {
    gvar: number
    value: number
    artNum: number
    imagePath: string | null // pre-baked by tools/convertEndgame.py
    voiceOverBaseName: string
    direction: number // 1 = left→right, -1 = right→left
}

// CE art_num 327 = the wide panning background (endgame.cc:221, 316)
const PANNING_ART_NUM = 327

// ---------- continue dialog ----------

// CE: endgame.cc:endgameEndingHandleContinuePlaying (0x43F8C4)
// misc.msg #30 = "Continue playing?"
// Returns true if the player wants to continue, false if they want to quit.
async function showContinueDialog(): Promise<boolean> {
    // showDialogBox(misc.msg 30, DIALOG_BOX_YES_NO); NO → _game_user_wants_to_quit = 2
    return showConfirm(getMessage('misc', 30) ?? 'Continue playing?')
}

// ---------- public API ----------

// CE: endgame.cc:endgamePlaySlideshow (0x43F788)
// Iterates all entries in lut/endgame.json in order; plays each whose gvar == value.
// Called by the endgame_slideshow opcode (0x8146 → scriptsRequestEndgame).
export async function playSlideshow(): Promise<void> {
    let endings: EndgameEnding[]
    try {
        endings = getFileJSON('lut/endgame.json') as EndgameEnding[]
    } catch (_e) {
        dbgWarn('endgame', 'lut/endgame.json not found — skipping slideshow')
        await playMovie()
        return
    }

    services.audioEngine.stopMusic()

    const overlay = createOverlay()

    for (const entry of endings) {
        if (Scripting.getGlobalVar(entry.gvar) !== entry.value) continue

        if (entry.artNum === PANNING_ART_NUM) {
            await showPanningSlide(entry.imagePath, entry.voiceOverBaseName, entry.direction, overlay)
        } else {
            await showStaticSlide(entry.imagePath, entry.voiceOverBaseName, overlay)
        }
    }

    removeOverlay()

    // CE scripts.cc scriptsHandleRequests (SCRIPT_REQUEST_ENDGAME): endgamePlaySlideshow,
    // then endgamePlayMovie — akiss, the credits and the continue dialog
    await playMovie()
}

// CE: endgame.cc:234-258 endgamePlayMovie (0x43F810)
// 1. Load akiss music  2. Wait 3s  3. creditsOpen("credits.txt")  4. Continue dialog
export async function playMovie(): Promise<void> {
    // CE: soundLoad/speechPlay("akiss.acm") before 3-second delay
    const music = services.audioEngine.playSound('music/akiss')

    await new Promise((r) => setTimeout(r, 3000))

    const overlay = createOverlay()
    await showCredits(overlay)
    removeOverlay()

    if (music) {
        music.pause()
        music.src = ''
    }

    const wantsContinue = await showContinueDialog()
    if (!wantsContinue) {
        dbg('endgame', 'player chose to quit — back to the main menu')
        returnToMainMenu()
    }
}

// Play the selected death ending narrator over a black screen.
// CE equivalent: critter.cc calls endgameSetupDeathEnding then the game
// enters the death screen where endgameDeathEndingGetFileName is used to
// play the narrator voice-over. DH2 collapses this into a single call.
let deathSceneShown = false

// CE main.cc mainLoop: the dude dead (or knocked out outside combat) →
// endgameSetupDeathEnding(REASON_DEATH), showDeath, and back to the main menu.
export function dudeDeathScene(): void {
    if (deathSceneShown) return
    deathSceneShown = true
    setupDeathEnding(DEATH_REASON_DEATH)
    playDeathEnding()
        .catch((e: unknown) => dbgWarn('endgame', 'death scene error: ' + String(e)))
        .then(() => returnToMainMenu())
}

export async function playDeathEnding(): Promise<void> {
    const selected = getDeathEndingFileName()
    const baseName = selected.startsWith('narrator/') ? selected.slice('narrator/'.length) : selected
    const overlay = createOverlay()
    // CE ref: main.cc:390 showDeath — DEATH.FRM (interface art #309) with the text block
    await showDeathScreen(baseName, overlay)
    removeOverlay()
}
