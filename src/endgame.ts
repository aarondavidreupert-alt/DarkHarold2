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

import { Scripting } from './scripting.js'
import globalState from './globalState.js'
import { getFileJSON, getFileText, getRandomInt } from './util.js'
import { dbg, dbgWarn } from './logger.js'

// CE: endgame.h EndgameEnding struct
interface EndgameEnding {
    gvar: number
    value: number
    artNum: number
    imagePath: string | null  // pre-baked by tools/convertEndgame.py
    voiceOverBaseName: string
    direction: number          // 1 = left→right, -1 = right→left
}

// CE: endgame.h EndgameDeathEnding struct
interface EndgameDeathEnding {
    gvar: number           // -1 = no check
    value: number
    worldAreaKnown: number  // -1 = no check
    worldAreaNotKnown: number
    minLevel: number
    percentage: number
    voiceOverBaseName: string
    enabled?: boolean      // runtime only, not in JSON
}

// CE art_num 327 = the wide panning background (endgame.cc:221, 316)
const PANNING_ART_NUM = 327

// Slide canvas dimensions (CE: ENDGAME_ENDING_WINDOW_WIDTH/HEIGHT)
const SLIDE_W = 640
const SLIDE_H = 480

// CE: ENDGAME_DEATH_ENDING_REASON_DEATH / _TIMEOUT (endgame.h)
export const DEATH_REASON_DEATH = 0
export const DEATH_REASON_TIMEOUT = 2

// CE: GVAR_MODOC_SHITTY_DEATH = 491 (game_vars.h:498, 0-based from GVAR_PLAYER_REPUTATION)
const GVAR_MODOC_SHITTY_DEATH = 491

let cachedDeathEndings: EndgameDeathEnding[] | null = null

// CE default filename (endgame.cc:1007 — strcpy(gEndgameDeathEndingFileName, "narrator\\nar_5"))
let selectedDeathFile = 'narrator/nar_5'

// ---------- data loading ----------

function loadDeathEndings(): EndgameDeathEnding[] {
    if (cachedDeathEndings !== null) return cachedDeathEndings
    try {
        cachedDeathEndings = getFileJSON('lut/enddeath.json') as EndgameDeathEnding[]
    } catch (_e) {
        dbgWarn('endgame', 'lut/enddeath.json not found — death endings unavailable')
        cachedDeathEndings = []
    }
    return cachedDeathEndings
}

// ---------- death ending selection ----------

// CE: endgame.cc:endgameDeathEndingValidate (0x440CF4)
// Marks entries enabled when ALL conditions hold:
//   gvar === -1 OR getGlobalVar(gvar) < value      [CE skips entry if gvar >= value]
//   worldAreaKnown === -1 OR area is known
//   worldAreaNotKnown === -1 OR area is NOT known
//   player.level >= minLevel
// Returns sum of enabled entries' percentage weights.
function validateDeathEndings(entries: EndgameDeathEnding[]): number {
    let total = 0
    for (const e of entries) {
        e.enabled = false
        if (e.gvar !== -1 && Scripting.getGlobalVar(e.gvar) >= e.value) continue
        if (e.worldAreaKnown !== -1 && !globalState.knownAreas.has(e.worldAreaKnown)) continue
        if (e.worldAreaNotKnown !== -1 && globalState.knownAreas.has(e.worldAreaNotKnown)) continue
        const lvl = globalState.player?.getStat('Level') ?? 1
        if (lvl < e.minLevel) continue
        e.enabled = true
        total += e.percentage
    }
    return total
}

// CE: endgame.cc:endgameSetupDeathEnding (0x440BD0)
// Called when the player dies or the timer expires.
export function setupDeathEnding(reason: number): void {
    const entries = loadDeathEndings()
    if (entries.length === 0) {
        dbgWarn('endgame', 'setupDeathEnding: no entries in enddeath.json')
        return
    }

    // CE: special-case GVAR_MODOC_SHITTY_DEATH → forced index 12 (endgame.cc:1136)
    if (reason === DEATH_REASON_DEATH && Scripting.getGlobalVar(GVAR_MODOC_SHITTY_DEATH) !== 0) {
        const special = entries[12]
        if (special) {
            selectedDeathFile = 'narrator/' + special.voiceOverBaseName
            dbg('endgame', 'setupDeathEnding: MODOC special ending →', selectedDeathFile)
            return
        }
    }

    const total = validateDeathEndings(entries)

    // CE: randomBetween(0, percentage) — endgame.cc:1147
    const chance = getRandomInt(0, total)
    let accum = 0
    let selectedIdx = 0
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        if (!e.enabled) continue
        accum += e.percentage
        if (accum >= chance) break
        // CE mirrors this: selectedEnding++ runs before the break check (endgame.cc:1158)
        selectedIdx++
    }

    const winner = entries[selectedIdx] ?? entries[0]
    selectedDeathFile = 'narrator/' + winner.voiceOverBaseName
    dbg('endgame', 'setupDeathEnding: picked', selectedDeathFile)
}

// CE: endgame.cc:endgameDeathEndingGetFileName (0x440D8C)
export function getDeathEndingFileName(): string {
    return selectedDeathFile
}

// ---------- subtitle helpers ----------

// CE: endgame.cc:endgameEndingSubtitlesLoad (0x4403FC)
// File: data/text/english/cuts/<baseName>.txt
// Format: each line "N:subtitle text" — text is everything after the first ':'.
function loadSubtitleLines(baseName: string): string[] {
    try {
        const raw = getFileText(`data/text/english/cuts/${baseName}.txt`)
        const lines: string[] = []
        for (const line of raw.split('\n')) {
            const sep = line.indexOf(':')
            if (sep !== -1) lines.push(line.slice(sep + 1).trimEnd())
        }
        return lines
    } catch (_e) {
        return []
    }
}

// CE: endgame.cc:endgameEndingVoiceOverInit subtitle timing (0x4402E6)
// durationPerChar = speechDurationMs / totalCharCount
// Each line's cumulative deadline: sum of (len * durationPerChar) ms
function buildSubtitleTimings(lines: string[], durationMs: number): number[] {
    const totalChars = lines.reduce((s, l) => s + l.length, 0)
    const msPerChar = totalChars > 0 ? durationMs / totalChars : 80
    const timings: number[] = []
    let accum = 0
    for (const line of lines) {
        accum += line.length * msPerChar
        timings.push(accum)
    }
    return timings
}

// ---------- audio ----------

// CE: endgame.cc:endgameEndingVoiceOverInit → speechLoad (0x4401A0)
// Load narrator audio; returns element (already started) or null if missing.
function playNarratorAudio(baseName: string): HTMLAudioElement | null {
    if (!baseName) return null
    return globalState.audioEngine.playSound('narrator/' + baseName)
}

// Resolve with duration in ms once HTMLAudioElement metadata loads, 0 on failure.
function waitAudioDurationMs(audio: HTMLAudioElement): Promise<number> {
    return new Promise(resolve => {
        if (audio.duration && !isNaN(audio.duration)) {
            resolve(audio.duration * 1000)
            return
        }
        const onMeta = () => resolve(isNaN(audio.duration) ? 0 : audio.duration * 1000)
        audio.addEventListener('loadedmetadata', onMeta, { once: true })
        audio.addEventListener('error', () => resolve(0), { once: true })
        // Safety timeout if metadata never arrives
        setTimeout(() => resolve(0), 3000)
    })
}

// ---------- overlay DOM helpers ----------

function createOverlay(): HTMLDivElement {
    const div = document.createElement('div')
    div.id = 'endgame-overlay'
    div.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
        'background:#000', 'z-index:9999',
        'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';')
    document.body.appendChild(div)
    return div
}

function removeOverlay(): void {
    document.getElementById('endgame-overlay')?.remove()
}

function createSlideCanvas(overlay: HTMLDivElement): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const canvas = document.createElement('canvas')
    canvas.width = SLIDE_W
    canvas.height = SLIDE_H
    canvas.style.cssText = 'display:block;max-width:100vw;max-height:100vh;object-fit:contain;'
    overlay.appendChild(canvas)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('endgame: could not get 2d canvas context')
    return [canvas, ctx]
}

function createSubtitleDiv(overlay: HTMLDivElement): HTMLDivElement {
    const div = document.createElement('div')
    div.style.cssText = [
        'position:absolute', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
        'color:#fff', 'font-size:16px', 'font-family:monospace',
        'text-align:center', 'text-shadow:1px 1px 3px #000',
        'max-width:90%', 'white-space:pre-line', 'pointer-events:none',
    ].join(';')
    overlay.appendChild(div)
    return div
}

// CSS-based fade-in
function fadeIn(el: HTMLElement, ms: number): Promise<void> {
    return new Promise(resolve => {
        el.style.opacity = '0'
        el.style.transition = `opacity ${ms}ms linear`
        requestAnimationFrame(() => {
            el.style.opacity = '1'
            setTimeout(resolve, ms)
        })
    })
}

// CSS-based fade-out
function fadeOut(el: HTMLElement, ms: number): Promise<void> {
    return new Promise(resolve => {
        el.style.transition = `opacity ${ms}ms linear`
        el.style.opacity = '0'
        setTimeout(resolve, ms)
    })
}

// Schedule subtitle display via setTimeout. Returns handles for cleanup.
function scheduleSubtitles(lines: string[], timings: number[], subDiv: HTMLDivElement): number[] {
    return lines.map((text, i) =>
        window.setTimeout(() => { subDiv.textContent = text }, timings[i])
    )
}

// ---------- slide renderers ----------

// Load image into canvas. Silently skips if path is null or image fails to load.
function loadImageToCanvas(ctx: CanvasRenderingContext2D, imagePath: string | null): Promise<HTMLImageElement | null> {
    return new Promise(resolve => {
        if (!imagePath) {
            ctx.fillStyle = '#000'
            ctx.fillRect(0, 0, SLIDE_W, SLIDE_H)
            resolve(null)
            return
        }
        const img = new Image()
        img.onload = () => {
            ctx.drawImage(img, 0, 0, SLIDE_W, SLIDE_H)
            resolve(img)
        }
        img.onerror = () => {
            dbgWarn('endgame', 'slide image not found:', imagePath)
            ctx.fillStyle = '#000'
            ctx.fillRect(0, 0, SLIDE_W, SLIDE_H)
            resolve(null)
        }
        img.src = imagePath
    })
}

// CE: endgame.cc:endgameEndingRenderStaticScene (0x440004)
async function showStaticSlide(
    imagePath: string | null,
    voiceBaseName: string,
    overlay: HTMLDivElement,
): Promise<void> {
    const [canvas, ctx] = createSlideCanvas(overlay)
    await loadImageToCanvas(ctx, imagePath)

    const subDiv = createSubtitleDiv(overlay)

    // CE: narrator loaded before fade-in
    const audio = playNarratorAudio(voiceBaseName)
    const speechMs = audio ? await waitAudioDurationMs(audio) : 0
    const fallbackMs = 3000  // CE: delay = 3000 if no speech and no subtitles

    const subtitleLines = loadSubtitleLines(voiceBaseName)
    const subtitleTimings = buildSubtitleTimings(subtitleLines, speechMs || fallbackMs)

    // CE: paletteFadeTo(_cmap) — fade in over ~500ms
    await fadeIn(canvas, 500)

    // CE: inputPauseForTocks(500) after fade-in
    await new Promise(r => setTimeout(r, 500))

    const subHandles = scheduleSubtitles(subtitleLines, subtitleTimings, subDiv)

    // CE: wait loop — exits on keyCode != -1, speechEnded, subtitlesEnded, or delay timeout
    await new Promise<void>(resolve => {
        let resolved = false
        const done = () => { if (!resolved) { resolved = true; resolve() } }

        const onKey = () => done()
        document.addEventListener('keydown', onKey, { once: true })
        overlay.addEventListener('click', done, { once: true })

        if (audio) {
            audio.addEventListener('ended', done, { once: true })
        } else if (subtitleLines.length > 0) {
            // End when last subtitle would have shown
            const lastTiming = subtitleTimings[subtitleTimings.length - 1]
            setTimeout(done, lastTiming + 1500)
        } else {
            setTimeout(done, fallbackMs)
        }
    })

    for (const h of subHandles) clearTimeout(h)
    subDiv.remove()

    if (audio) {
        audio.pause()
        audio.src = ''
    }

    // CE: paletteFadeTo(gPaletteBlack)
    await fadeOut(canvas, 500)
    canvas.remove()
}

// CE: endgame.cc:endgameEndingRenderPanningScene (0x43FBDC)
// TODO: CE uses a complex per-tick delay formula tied to voice-over duration
//       (endgame.cc:337-345). DH2 uses a simple linear pan over narrator duration.
async function showPanningSlide(
    imagePath: string | null,
    voiceBaseName: string,
    direction: number,
    overlay: HTMLDivElement,
): Promise<void> {
    const [canvas, ctx] = createSlideCanvas(overlay)
    const subDiv = createSubtitleDiv(overlay)

    const audio = playNarratorAudio(voiceBaseName)
    const speechMs = audio ? await waitAudioDurationMs(audio) : 5000
    const panDurationMs = Math.max(speechMs, 5000)

    // Load image (may be wider than SLIDE_W for panning)
    let img: HTMLImageElement | null = null
    if (imagePath) {
        img = await new Promise<HTMLImageElement>(resolve => {
            const i = new Image()
            i.onload = () => resolve(i)
            i.onerror = () => {
                dbgWarn('endgame', 'panning image not found:', imagePath)
                resolve(i)
            }
            i.src = imagePath
        })
    }

    const imgW = img?.naturalWidth ?? SLIDE_W
    const panRange = Math.max(0, imgW - SLIDE_W)
    const startX = direction === -1 ? panRange : 0
    const endX   = direction === -1 ? 0 : panRange

    const subtitleLines = loadSubtitleLines(voiceBaseName)
    const subtitleTimings = buildSubtitleTimings(subtitleLines, panDurationMs)
    const subHandles = scheduleSubtitles(subtitleLines, subtitleTimings, subDiv)

    let interrupted = false
    const onKey = () => { interrupted = true }
    document.addEventListener('keydown', onKey, { once: true })
    overlay.addEventListener('click', () => { interrupted = true }, { once: true })
    if (audio) audio.addEventListener('ended', () => { interrupted = true }, { once: true })

    const startTime = performance.now()

    await new Promise<void>(resolve => {
        function draw() {
            if (interrupted) { resolve(); return }
            const elapsed = performance.now() - startTime
            const t = Math.min(elapsed / panDurationMs, 1)
            const x = startX + (endX - startX) * t

            ctx.fillStyle = '#000'
            ctx.fillRect(0, 0, SLIDE_W, SLIDE_H)
            if (img?.complete && img.naturalWidth > 0) {
                ctx.drawImage(img, -x, 0, imgW, SLIDE_H)
            }

            if (t >= 1) { resolve(); return }
            requestAnimationFrame(draw)
        }
        requestAnimationFrame(draw)
    })

    document.removeEventListener('keydown', onKey)
    for (const h of subHandles) clearTimeout(h)
    subDiv.remove()

    if (audio) {
        audio.pause()
        audio.src = ''
    }

    await fadeOut(canvas, 500)
    canvas.remove()
}

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

// CE: endgame.cc:endgamePlayMovie (0x43F810)
// In DH2: no .mve playback infrastructure. Shows continue dialog directly.
// TODO: play credits.txt when credits system is implemented (CE: credits.cc:creditsOpen)
export async function playMovie(): Promise<void> {
    const wantsContinue = await showContinueDialog()
    if (!wantsContinue) {
        location.reload()
    }
}

// Play the selected death ending narrator over a black screen.
// CE equivalent: critter.cc calls endgameSetupDeathEnding then the game
// enters the death screen where endgameDeathEndingGetFileName is used to
// play the narrator voice-over. DH2 collapses this into a single call.
export async function playDeathEnding(): Promise<void> {
    const baseName = selectedDeathFile.startsWith('narrator/')
        ? selectedDeathFile.slice('narrator/'.length)
        : selectedDeathFile
    const overlay = createOverlay()
    await showStaticSlide(null, baseName, overlay)
    removeOverlay()
}
