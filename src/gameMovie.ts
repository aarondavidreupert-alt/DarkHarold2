/*
Copyright 2026 DarkHarold2 contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// Full-motion movies — port of fallout2-ce game_movie.cc gameMoviePlay() plus the
// subtitle (movie.cc movieLoadSubtitles/movieRenderSubtitles) and fade-effect
// (moviefx.cc, art/cuts/*.cfg) parts of the MVE player.
//
// The Interplay MVEs are converted by tools/convertMovies.py (export_movies stage)
// to art/cuts/<name>.webm plus art/cuts/<name>.json { fps } — the MVE timer rate,
// which is what .SVE subtitle and .CFG effect frame numbers count in.

import { UIMode } from './ui_panels.js'
import { Config } from './config.js'
import globalState from './globalState.js'
import { dbg, dbgWarn } from './logger.js'
import { getFileText, parseIni } from './util.js'

// CE game_movie.h MovieId / game_movie.cc:21 gMovieFileNames
export const MOVIE_IPLOGO = 0
export const MOVIE_INTRO = 1
export const MOVIE_ELDER = 2
export const MOVIE_VSUIT = 3
export const MOVIE_AFAILED = 4
export const MOVIE_ADESTROY = 5
export const MOVIE_CAR = 6
export const MOVIE_CARTUCCI = 7
export const MOVIE_TIMEOUT = 8
export const MOVIE_TANKER = 9
export const MOVIE_ENCLAVE = 10
export const MOVIE_DERRICK = 11
export const MOVIE_ARTIMER1 = 12
export const MOVIE_ARTIMER2 = 13
export const MOVIE_ARTIMER3 = 14
export const MOVIE_ARTIMER4 = 15
export const MOVIE_CREDITS = 16

const MOVIE_FILE_NAMES = [
    'iplogo', 'intro', 'elder', 'vsuit', 'afailed', 'adestroy', 'car', 'cartucci',
    'timeout', 'tanker', 'enclave', 'derrick', 'artimer1', 'artimer2', 'artimer3',
    'artimer4', 'credits',
]

// CE game_movie.h GameMovieFlags
export const GAME_MOVIE_FADE_IN = 0x01
export const GAME_MOVIE_FADE_OUT = 0x02
export const GAME_MOVIE_STOP_MUSIC = 0x04
export const GAME_MOVIE_PAUSE_MUSIC = 0x08

const FADE = GAME_MOVIE_FADE_IN | GAME_MOVIE_FADE_OUT | GAME_MOVIE_PAUSE_MUSIC
// CE interpreter_extra.cc:3584 opPlayGameMovie flags[] — DERRICK (11) has no fade-out.
export const SCRIPT_MOVIE_FLAGS = [
    FADE, FADE, FADE, FADE, FADE, FADE, FADE, FADE, FADE, FADE, FADE,
    GAME_MOVIE_FADE_IN | GAME_MOVIE_PAUSE_MUSIC,
    FADE, FADE, FADE, FADE, FADE,
]

const MOVIE_W = 640
const MOVIE_H = 480
const FADE_MS = 500 // paletteFadeTo duration (palette.cc fades over ~60 steps)

let playing: Promise<void> | null = null

export function gameMovieIsPlaying(): boolean {
    return playing !== null
}

// CE game_movie.cc:325 gameMovieIsSeen
export function gameMovieIsSeen(movie: number): boolean {
    return globalState.seenMovies.has(movie)
}

interface Subtitle { frame: number; text: string }
interface FadeEffect { frame: number; type: 'in' | 'out'; color: [number, number, number]; steps: number }

// CE movie.cc:559 movieLoadSubtitles — "frame:text" per line.
function loadSubtitles(name: string): Subtitle[] {
    const lang = 'english'
    try {
        const text = getFileText(`data/text/${lang}/cuts/${name}.sve`)
        const out: Subtitle[] = []
        for (const raw of text.split('\n')) {
            const line = raw.replace(/\r$/, '')
            if (line === '') break
            const i = line.indexOf(':')
            if (i === -1) continue
            out.push({ frame: parseInt(line.slice(0, i), 10) || 0, text: line.slice(i + 1) })
        }
        return out
    } catch {
        return []
    }
}

// CE moviefx.cc movieEffectsLoad — art/cuts/<name>.cfg fade effects (colors 0-63).
function loadEffects(name: string): FadeEffect[] {
    try {
        const ini = parseIni(getFileText(`data/art/cuts/${name}.cfg`))
        const frames = String(ini.info?.effect_frames ?? '').split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n))
        const out: FadeEffect[] = []
        for (const f of frames) {
            const sec = ini[String(f)]
            if (!sec) continue
            const c = String(sec.fade_color ?? '0,0,0').split(',').map((s) => parseInt(s, 10) || 0)
            out.push({
                frame: f,
                type: String(sec.fade_type).trim().toLowerCase() === 'out' ? 'out' : 'in',
                color: [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0],
                steps: parseInt(sec.fade_steps, 10) || 0,
            })
        }
        return out
    } catch {
        return []
    }
}

function loadFps(name: string): number {
    try {
        return JSON.parse(getFileText(`art/cuts/${name}.json`)).fps || 15
    } catch {
        return 15
    }
}

function makeFadeLayer(): HTMLDivElement {
    const el = document.createElement('div')
    Object.assign(el.style, {
        position: 'fixed', inset: '0', background: '#000', opacity: '0',
        zIndex: '10001', pointerEvents: 'none', transition: `opacity ${FADE_MS}ms linear`,
    })
    document.body.appendChild(el)
    return el
}

function fadeTo(layer: HTMLDivElement, opacity: number): Promise<void> {
    return new Promise((resolve) => {
        layer.style.opacity = String(opacity)
        setTimeout(resolve, FADE_MS)
    })
}

/**
 * CE game_movie.cc:144 gameMoviePlay. Resolves when the movie ends or is skipped
 * (any key / mouse click). Resolves immediately (CE returns -1) when the
 * converted movie is missing.
 */
export function gameMoviePlay(movie: number, flags: number): Promise<void> {
    if (playing) return playing.then(() => gameMoviePlay(movie, flags))
    const name = MOVIE_FILE_NAMES[movie]
    if (name === undefined) return Promise.resolve()
    dbg('script', `[Movie] playing ${name}.mve (flags 0x${flags.toString(16)})`)

    playing = new Promise<void>((resolve) => {
        const audio = globalState.audioEngine as any
        const musicEl: HTMLAudioElement | undefined = audio?.musicAudio
        const musicWasPlaying = !!musicEl && !musicEl.paused
        const prevUiMode = globalState.uiMode
        const fadeLayer = makeFadeLayer()

        const screen = document.createElement('div')
        Object.assign(screen.style, { position: 'fixed', inset: '0', background: '#000', zIndex: '10000', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'none' })
        const box = document.createElement('div')
        Object.assign(box.style, { position: 'relative', width: MOVIE_W + 'px', height: MOVIE_H + 'px', background: '#000', overflow: 'hidden' })
        const video = document.createElement('video')
        video.src = `art/cuts/${name}.webm`
        video.preload = 'auto'
        video.playsInline = true
        Object.assign(video.style, { position: 'absolute', left: '0', width: MOVIE_W + 'px', top: '80px', height: '320px' })
        const sub = document.createElement('div')
        // CE movie.cc:629 — subtitle strip centered between the movie's bottom and 480.
        Object.assign(sub.style, { position: 'absolute', left: '0', width: MOVIE_W + 'px', top: '408px', textAlign: 'center', color: '#fcfcfc', font: '12px monospace', textShadow: '1px 1px 0 #000' })
        const fx = document.createElement('div') // moviefx colour fades over the movie
        Object.assign(fx.style, { position: 'absolute', inset: '0', opacity: '0', pointerEvents: 'none' })
        box.append(video, fx, sub)
        screen.appendChild(box)

        // CE: subtitles only when the preference is on AND the .sve exists.
        const subtitles = Config.ui.subtitles ? loadSubtitles(name) : []
        const effects = loadEffects(name)
        const fps = loadFps(name)
        let subIdx = 0
        let finished = false

        const finish = async () => {
            if (finished) return
            finished = true
            video.pause()
            document.removeEventListener('keydown', onInput, true)
            screen.removeEventListener('mouseup', onInput, true)
            globalState.seenMovies.add(movie) // CE gGameMoviesSeen[movie] = 1
            // CE interpreter_extra.cc:4625 — the vault-suit movie changes the dude's look.
            if (movie === MOVIE_VSUIT) globalState.player?.updateNativeLook()
            if (flags & GAME_MOVIE_FADE_OUT) fadeLayer.style.opacity = '1'
            screen.remove()
            globalState.uiMode = prevUiMode
            if ((flags & GAME_MOVIE_PAUSE_MUSIC) && musicWasPlaying) musicEl!.play().catch(() => {})
            if (flags & GAME_MOVIE_FADE_OUT) await fadeTo(fadeLayer, 0)
            fadeLayer.remove()
            playing = null
            resolve()
        }
        let awaitingGesture = false
        const onInput = (e: Event) => {
            e.preventDefault()
            e.stopPropagation()
            if (awaitingGesture) return // this click/key only starts playback
            void finish()
        }

        const update = () => {
            if (finished) return
            const frame = Math.floor(video.currentTime * fps)
            while (subIdx < subtitles.length && frame >= subtitles[subIdx].frame) {
                sub.textContent = subtitles[subIdx].text
                subIdx++
            }
            // moviefx: fade in = from colour to clear, fade out = clear to colour, over fade_steps frames.
            let alpha = 0
            for (const ef of effects) {
                if (frame < ef.frame) continue
                const t = ef.steps > 0 ? Math.min(1, (frame - ef.frame) / ef.steps) : 1
                alpha = ef.type === 'in' ? 1 - t : t
                fx.style.background = `rgb(${ef.color.map((c) => Math.round(c * 255 / 63)).join(',')})`
            }
            fx.style.opacity = String(alpha)
        }
        // rAF for smooth fades; timeupdate as well so subtitles advance even when
        // rAF is throttled (background tab).
        const tick = () => { if (!finished) { update(); requestAnimationFrame(tick) } }
        video.addEventListener('timeupdate', update)

        video.addEventListener('ended', () => void finish())
        video.addEventListener('error', () => {
            dbgWarn('script', `[Movie] art/cuts/${name}.webm unavailable — run the export_movies pipeline stage`)
            void finish()
        })

        const start = async () => {
            if (flags & GAME_MOVIE_STOP_MUSIC) audio?.stopMusic?.()
            else if ((flags & GAME_MOVIE_PAUSE_MUSIC) && musicWasPlaying) musicEl!.pause()
            if (flags & GAME_MOVIE_FADE_IN) await fadeTo(fadeLayer, 1)
            document.body.appendChild(screen)
            fadeLayer.style.opacity = '0'
            globalState.uiMode = UIMode.movie // modal: pauses tickGame (CE isoDisable)
            document.addEventListener('keydown', onInput, true)
            screen.addEventListener('mouseup', onInput, true)
            video.volume = Math.max(0, Math.min(1, audio?.musicVolume ?? 1))
            try {
                await video.play()
            } catch {
                // Autoplay with sound needs a user gesture — wait for one click/key.
                awaitingGesture = true
                sub.textContent = '[click to play]'
                const resume = () => {
                    sub.textContent = ''
                    video.play().catch(() => void finish())
                    setTimeout(() => { awaitingGesture = false }, 0)
                }
                screen.addEventListener('mousedown', resume, { once: true })
                document.addEventListener('keydown', resume, { once: true, capture: true })
            }
            requestAnimationFrame(tick)
        }
        void start()
    })
    return playing
}
