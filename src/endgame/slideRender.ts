// Slide rendering primitives — split out of endgame.ts.
// See wiki/ts-split-refactor.md → "Per-file split proposals" §19.

import globalState from '../globalState.js'
import { getFileText } from '../util.js'
import { dbgWarn } from '../logger.js'
import { assetUrl } from '../modAssets.js'
import { Config } from '../config.js'
import { font3, font4 } from '../ui_font.js'

// Slide canvas dimensions (CE: ENDGAME_ENDING_WINDOW_WIDTH/HEIGHT)
const SLIDE_W = 640
const SLIDE_H = 480

// ---------- subtitle helpers ----------

// CE: endgame.cc:endgameEndingSubtitlesLoad (0x4403FC)
// File: data/text/english/cuts/<baseName>.txt
// Format: each line "N:subtitle text" — text is everything after the first ':'.
// Only with the subtitles preference (CE endgame.cc:595 gEndgameEndingSubtitlesEnabled =
// settings.preferences.subtitles; the death screen too, main.cc showDeath).
function loadSubtitleLines(baseName: string): string[] {
    if (!Config.ui.subtitles) return []
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

export function createOverlay(): HTMLDivElement {
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

export function removeOverlay(): void {
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
        img.src = assetUrl(imagePath)
    })
}

// ---------- scrolling credits ----------

// CE credits.cc creditsOpen(file, backgroundFid -1, reversed): every line ('@' a title, '#'
// a highlighted name, ';' skipped) is centred and scrolled up one pixel every 38 ms
// (CREDITS_WINDOW_SCROLLING_DELAY), a line as tall as the taller of the two fonts; the
// last one scrolls off the screen. Titles in font 103, names in 104, coloured 13673 / 18917
// — swapped for quotes.txt (reversed); '#' lines 17969. A line wider than the screen is
// skipped; any key or click stops it.
export async function showCredits(overlay: HTMLDivElement, file = 'credits.txt', reversed = false): Promise<void> {
    let raw: string
    try {
        raw = getFileText(`data/text/english/${file}`)
    } catch (_e) {
        return
    }
    await new Promise<void>((r) => font3.onLoad(() => font4.onLoad(() => r())))

    const TITLE_COLOR = reversed ? '#907824' : '#706050' // _colorTable[18917] / [13673]
    const NAME_COLOR = reversed ? '#706050' : '#907824'
    const HIGHLIGHT = '#8c8c84' // _colorTable[17969]
    const titleFont = reversed ? font4 : font3
    const nameFont = reversed ? font3 : font4
    const lineHeight = Math.max(titleFont.lineHeight, nameFont.lineHeight)

    const container = document.createElement('div')
    container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;background:#000;'
    const scroller = document.createElement('div')
    scroller.style.cssText = 'position:absolute;left:0;top:0;width:100%;will-change:transform;'
    const screenW = container.clientWidth || overlay.clientWidth || window.innerWidth
    for (const rawLine of raw.split('\n')) {
        const line = rawLine.replace(/\r$/, '')
        if (line.startsWith(';')) continue
        let font = nameFont, color = NAME_COLOR, text = line
        if (line.startsWith('@')) { font = titleFont; color = TITLE_COLOR; text = line.slice(1) }
        else if (line.startsWith('#')) { color = HIGHLIGHT; text = line.slice(1) }
        const row = document.createElement('div')
        row.style.cssText = `height:${lineHeight}px;display:flex;justify-content:center;align-items:flex-start;`
        if (text) {
            const cv = font.renderCanvas(text, color)
            if (cv.width >= screenW) continue // fontGetStringWidth(str) >= windowWidth
            row.appendChild(cv)
        }
        scroller.appendChild(row)
    }
    container.appendChild(scroller)
    overlay.appendChild(container)

    const screenH = container.clientHeight || window.innerHeight || SLIDE_H
    const totalPx = screenH + scroller.childElementCount * lineHeight
    await new Promise<void>((resolve) => {
        let y = screenH
        scroller.style.transform = `translateY(${y}px)`
        const finish = () => {
            clearInterval(timer)
            document.removeEventListener('keydown', finish, true)
            overlay.removeEventListener('mousedown', finish)
            resolve()
        }
        const timer = setInterval(() => {
            y -= 1
            scroller.style.transform = `translateY(${y}px)`
            if (screenH - y >= totalPx) finish()
        }, 38)
        document.addEventListener('keydown', finish, true)
        overlay.addEventListener('mousedown', finish)
    })

    container.remove()
}

// ---------- slide renderers ----------

// CE: endgame.cc:endgameEndingRenderStaticScene (0x440004)
// CE main.cc showDeath: with the subtitles preference, the whole text/english/cuts/<name>.txt
// (_mainDeathGrabTextFile: newlines read as spaces) word-wrapped to 560 px in one block on
// black at the bottom of DEATH.FRM, white — no timing.
export async function showDeathScreen(voiceBaseName: string, overlay: HTMLDivElement): Promise<void> {
    const [canvas, ctx] = createSlideCanvas(overlay)
    await loadImageToCanvas(ctx, 'art/intrface/death.png')
    if (Config.ui.subtitles) {
        let text = ''
        try { text = getFileText(`data/text/english/cuts/${voiceBaseName}.txt`).replace(/\r?\n/g, ' ').trim() } catch (_e) { text = '' }
        if (text) {
            const block = document.createElement('div')
            block.style.cssText = [
                'position:absolute', 'left:50%', 'bottom:8px', 'transform:translateX(-50%)', 'width:560px',
                'background:#000', 'color:#fff', 'font-size:12px', 'font-family:monospace', 'line-height:1.25',
                'padding:1px 2px', 'pointer-events:none',
            ].join(';')
            block.textContent = text
            overlay.appendChild(block)
        }
    }
    const audio = playNarratorAudio(voiceBaseName)
    await fadeIn(canvas, 500)
    // CE: until any input, the end of the speech, or 3 s without speech
    await new Promise<void>((resolve) => {
        let resolved = false
        const done = () => { if (!resolved) { resolved = true; document.removeEventListener('keydown', done); resolve() } }
        document.addEventListener('keydown', done, { once: true })
        overlay.addEventListener('click', done, { once: true })
        if (audio) audio.addEventListener('ended', done, { once: true })
        else setTimeout(done, 3000)
    })
    audio?.pause()
}

export async function showStaticSlide(
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
// CE formula (endgame.cc:337-345):
//   v8 = imageWidth - 640 (pan range in px)
//   base msPer = 16  (16 ms/px → 16 * panRange ms total at 1px/step)
//   if speechMs > 8 * panRange: msPer = (speechMs + 8 * panRange) / panRange
//   total = msPer * panRange
export async function showPanningSlide(
    imagePath: string | null,
    voiceBaseName: string,
    direction: number,
    overlay: HTMLDivElement,
): Promise<void> {
    const [canvas, ctx] = createSlideCanvas(overlay)
    const subDiv = createSubtitleDiv(overlay)

    // CE endgameEndingVoiceOverInit loads the speech now; endgameEndingVoiceOverReset starts
    // it (and the subtitles) a quarter of the way in.
    const audio = playNarratorAudio(voiceBaseName)
    if (audio) audio.pause()
    const speechMs = audio ? await waitAudioDurationMs(audio) : 0

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
            i.src = assetUrl(imagePath)
        })
    }

    // CE endgame.cc endgameEndingRenderPanningScene: one pixel every v9 ms (16, stretched
    // so the pan outlasts the speech); the palette fades in over the first quarter
    // (v32 = range / 4) and out near the end; the speech starts at pixel v32
    // (left→right) or 640 − v32 (right→left).
    const imgW = img?.naturalWidth ?? SLIDE_W
    const v8 = Math.max(0, imgW - SLIDE_W)
    const v32 = Math.trunc(v8 / 4)
    const v12 = SLIDE_W - v32
    let v9 = 16
    if (v8 > 0 && speechMs > (16 * v8) / 2) v9 = Math.trunc((speechMs + 16 * Math.trunc(v8 / 2)) / v8)
    const startX = direction === -1 ? v8 : 0
    const endX   = direction === -1 ? 0 : v8
    const voiceAt = direction === -1 ? v12 : v32
    const brightness = (x: number): number => {
        if (v32 === 0) return 1
        if (x > v32) return v12 > x ? 1 : Math.max(0, Math.min(1, (v32 - (x - v12)) / v32))
        return x / v32
    }

    const subtitleLines = loadSubtitleLines(voiceBaseName)
    let subHandles: number[] = []
    const startVoice = () => {
        if (audio) void audio.play().catch(() => {})
        subHandles = scheduleSubtitles(subtitleLines, buildSubtitleTimings(subtitleLines, speechMs || 3000), subDiv)
    }

    let interrupted = false
    const onKey = () => { interrupted = true }
    document.addEventListener('keydown', onKey, { once: true })
    overlay.addEventListener('click', () => { interrupted = true }, { once: true })

    let x = startX
    let voiceStarted = false
    if (v8 === 0) startVoice()
    await new Promise<void>(resolve => {
        let since = performance.now()
        function draw() {
            if (interrupted || x === endX) { resolve(); return }
            const now = performance.now()
            while (now - since >= v9 && x !== endX) {
                since += v9
                x += direction === -1 ? -1 : 1
                if (!voiceStarted && x === voiceAt) { voiceStarted = true; startVoice() }
            }
            ctx.fillStyle = '#000'
            ctx.fillRect(0, 0, SLIDE_W, SLIDE_H)
            if (img?.complete && img.naturalWidth > 0) {
                ctx.globalAlpha = brightness(x)
                ctx.drawImage(img, -x, 0, imgW, SLIDE_H)
                ctx.globalAlpha = 1
            }
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
