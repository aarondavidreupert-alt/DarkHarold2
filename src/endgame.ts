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

import { Scripting } from './scripting.js'
import globalState from './globalState.js'
import { getFileJSON } from './util.js'
import { dbg, dbgWarn } from './logger.js'
import { createOverlay, removeOverlay, showStaticSlide, showPanningSlide, showCredits } from './endgame/slideRender.js'
import { getDeathEndingFileName } from './endgame/deathEndings.js'

export { EndgameDeathEnding, DEATH_REASON_DEATH, DEATH_REASON_TIMEOUT, setupDeathEnding, getDeathEndingFileName } from './endgame/deathEndings.js'

// CE: endgame.h EndgameEnding struct
interface EndgameEnding {
    gvar: number
    value: number
    artNum: number
    imagePath: string | null  // pre-baked by tools/convertEndgame.py
    voiceOverBaseName: string
    direction: number          // 1 = left→right, -1 = right→left
}

// CE art_num 327 = the wide panning background (endgame.cc:221, 316)
const PANNING_ART_NUM = 327

// ---------- continue dialog ----------

// CE: endgame.cc:endgameEndingHandleContinuePlaying (0x43F8C4)
// misc.msg #30 = "Continue playing?"
// Returns true if the player wants to continue, false if they want to quit.
function showContinueDialog(): Promise<boolean> {
    return new Promise(resolve => {
        const dlg = document.createElement('div')
        dlg.style.cssText = [
            'position:fixed', 'top:50%', 'left:50%',
            'transform:translate(-50%,-50%)',
            'background:#1a1a1a', 'border:2px solid #777',
            'padding:28px 40px', 'z-index:10000',
            'text-align:center', 'color:#ccc',
            'font-family:monospace', 'font-size:16px',
        ].join(';')

        const msg = document.createElement('div')
        msg.textContent = 'Continue playing?'
        msg.style.marginBottom = '18px'
        dlg.appendChild(msg)

        const mkBtn = (label: string, value: boolean) => {
            const btn = document.createElement('button')
            btn.textContent = label
            btn.style.cssText = 'margin:0 8px;padding:6px 22px;background:#333;color:#ccc;border:1px solid #666;cursor:pointer;font-family:monospace;font-size:14px;'
            btn.onclick = () => { dlg.remove(); resolve(value) }
            return btn
        }

        dlg.appendChild(mkBtn('Yes', true))
        dlg.appendChild(mkBtn('No', false))
        document.body.appendChild(dlg)
    })
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
        await showContinueDialog()
        return
    }

    globalState.audioEngine.stopMusic()

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

    // CE: endgamePlaySlideshow → endgamePlayMovie → endgameEndingHandleContinuePlaying
    const wantsContinue = await showContinueDialog()
    if (!wantsContinue) {
        // CE: _game_user_wants_to_quit = 2 (main game loop exits)
        dbg('endgame', 'player chose to quit — reloading page')
        location.reload()
    }
}

// CE: endgame.cc:234-258 endgamePlayMovie (0x43F810)
// 1. Load akiss music  2. Wait 3s  3. creditsOpen("credits.txt")  4. Continue dialog
export async function playMovie(): Promise<void> {
    // CE: soundLoad/speechPlay("akiss.acm") before 3-second delay
    const music = globalState.audioEngine.playSound('music/akiss')

    await new Promise(r => setTimeout(r, 3000))

    const overlay = createOverlay()
    await showCredits(overlay)
    removeOverlay()

    if (music) {
        music.pause()
        music.src = ''
    }

    const wantsContinue = await showContinueDialog()
    if (!wantsContinue) {
        dbg('endgame', 'player chose to quit — reloading page')
        location.reload()
    }
}

// Play the selected death ending narrator over a black screen.
// CE equivalent: critter.cc calls endgameSetupDeathEnding then the game
// enters the death screen where endgameDeathEndingGetFileName is used to
// play the narrator voice-over. DH2 collapses this into a single call.
export async function playDeathEnding(): Promise<void> {
    const selected = getDeathEndingFileName()
    const baseName = selected.startsWith('narrator/')
        ? selected.slice('narrator/'.length)
        : selected
    const overlay = createOverlay()
    // CE ref: main.cc:390 — DEATH.FRM is interface art #309, blitted as the death background
    await showStaticSlide('art/intrface/death.png', baseName, overlay)
    removeOverlay()
}
