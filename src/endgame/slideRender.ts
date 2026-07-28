// Slide rendering primitives — split out of endgame.ts.
// See wiki/ts-split-refactor.md → "Per-file split proposals" §19.

import globalState from '../globalState.js'
import { getFileText } from '../util.js'
import { dbgWarn } from '../logger.js'

// Slide canvas dimensions (CE: ENDGAME_ENDING_WINDOW_WIDTH/HEIGHT)
const SLIDE_W = 640
const SLIDE_H = 480

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
        img.src = imagePath
    })
}

// ---------- scrolling credits ----------

// CE: credits.cc:creditsOpen (0x42E054) + creditsFileParseNextLine (0x42E53C)
// Parses data/text/english/credits.txt and scrolls it over the overlay.
// Line prefixes: ';' = skip (comment), '@' = title font/color, '#' = highlight color.
// Scroll speed: CE runs the scroll loop at ~1px per 20ms (creditsOpen:191-210).
export async function showCredits(overlay: HTMLDivElement): Promise<void> {
    let raw: string
    try {
        raw = getFileText('data/text/english/credits.txt')
    } catch (_e) {
        return
    }

    const container = document.createElement('div')
    container.style.cssText = [
        'position:absolute', 'top:0', 'left:0', 'width:100%', 'height:100%',
        'overflow:hidden', 'background:#000',
        'display:flex', 'align-items:flex-start', 'justify-content:center',
    ].join(';')

    const scroller = document.createElement('div')
    scroller.style.cssText = [
        'font-family:monospace', 'font-size:14px', 'text-align:center',
        'padding:0 40px', 'width:100%', 'box-sizing:border-box',
        'will-change:transform',
    ].join(';')

    for (const rawLine of raw.split('\n')) {
        const line = rawLine.trimEnd()
        if (line.startsWith(';')) continue

        if (line === '') {
            const sp = document.createElement('div')
            sp.style.height = '12px'
            scroller.appendChild(sp)
            continue
        }

        const el = document.createElement('div')
        if (line.startsWith('@')) {
            // CE: title font — gold color, larger
            el.textContent = line.slice(1)
            el.style.cssText = 'color:#c8a040;font-size:18px;font-weight:bold;margin:8px 0 4px;line-height:1.6;'
        } else if (line.startsWith('#')) {
            // CE: highlighted name — green tint
            el.textContent = line.slice(1)
            el.style.cssText = 'color:#70b870;line-height:1.6;'
        } else {
            el.textContent = line
            el.style.cssText = 'color:#ccc;line-height:1.6;'
        }
        scroller.appendChild(el)
    }

    container.appendChild(scroller)
    overlay.appendChild(container)

    // CE: 1px per 20ms scroll tick — total distance = screenH + contentH
    const screenH = window.innerHeight || SLIDE_H
    scroller.getBoundingClientRect()  // flush layout to get correct scrollHeight
    const contentH = scroller.scrollHeight
    const totalPx = screenH + contentH
    const durationMs = totalPx * 20

    scroller.style.transform = `translateY(${screenH}px)`
    scroller.getBoundingClientRect()  // flush before setting transition
    scroller.style.transition = `transform ${durationMs}ms linear`

    await new Promise<void>(resolve => {
        let done = false
        const finish = () => { if (!done) { done = true; resolve() } }

        requestAnimationFrame(() => {
            scroller.style.transform = `translateY(-${contentH}px)`
        })

        document.addEventListener('keydown', finish, { once: true })
        overlay.addEventListener('click', finish, { once: true })
        setTimeout(finish, durationMs)
    })

    container.remove()
}

// ---------- slide renderers ----------

// CE: endgame.cc:endgameEndingRenderStaticScene (0x440004)
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

    const audio = playNarratorAudio(voiceBaseName)
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
            i.src = imagePath
        })
    }

    const imgW = img?.naturalWidth ?? SLIDE_W
    const panRange = Math.max(0, imgW - SLIDE_W)
    const startX = direction === -1 ? panRange : 0
    const endX   = direction === -1 ? 0 : panRange

    // CE: endgame.cc:337-345 — 16ms base per pixel; stretch when speech > 8*panRange
    const BASE_MS_PER_PX = 16
    let msPer = BASE_MS_PER_PX
    if (panRange > 0 && speechMs > 0 && speechMs > BASE_MS_PER_PX * 0.5 * panRange) {
        msPer = Math.round((speechMs + BASE_MS_PER_PX * 0.5 * panRange) / panRange)
    }
    const panDurationMs = panRange > 0 ? msPer * panRange : Math.max(speechMs, 3000)

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
