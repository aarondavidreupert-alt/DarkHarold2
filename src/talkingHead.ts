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

// Talking heads, lip-sync and dialogue speech — port of fallout2-ce:
//   game_dialog.cc  _gdialogInitFromScript (music), _gdSetupFidget, gameDialogTicker,
//                   _gdPlayTransition, _talk_to_critter_reacts, gameDialogRenderTalkingHead,
//                   gameDialogStartLips / gameDialogEndLips, _head_phoneme_lookup
//   lips.cc         lipsLoad (v2 .lip format), lipsStart, lipsTicker
//   art.cc          head FID → file name (_head1/_head2), artGetFidgetCount, fps default 10
// Art comes from tools/exportImagesPar.py (heads, backgrnd); speech audio from
// tools/convertSpeech.py (audio/speech/<head>/<name>.mp3); .lip files are read from
// data/sound/speech/<head>/.

import globalState from './globalState.js'
import { getCurrentMapInfo, getLstJson } from './data.js'
import { lazyLoadImage } from './images.js'
import { dbg } from './logger.js'
import { getFileBinarySync, getRandomInt } from './util.js'

// CE art.h HeadAnimation
export const HEAD_ANIMATION_VERY_GOOD_REACTION = 0
export const FIDGET_GOOD = 1
export const HEAD_ANIMATION_GOOD_TO_NEUTRAL = 2
export const HEAD_ANIMATION_NEUTRAL_TO_GOOD = 3
export const FIDGET_NEUTRAL = 4
export const HEAD_ANIMATION_NEUTRAL_TO_BAD = 5
export const HEAD_ANIMATION_BAD_TO_NEUTRAL = 6
export const FIDGET_BAD = 7
export const HEAD_ANIMATION_VERY_BAD_REACTION = 8
const HEAD_ANIMATION_GOOD_PHONEMES = 9
const HEAD_ANIMATION_NEUTRAL_PHONEMES = 10
const HEAD_ANIMATION_BAD_PHONEMES = 11

// CE game_dialog.h GameDialogReaction
export const GAME_DIALOG_REACTION_GOOD = 49
export const GAME_DIALOG_REACTION_NEUTRAL = 50
export const GAME_DIALOG_REACTION_BAD = 51

// CE art.cc:76-79
const HEAD1 = 'gggnnnbbbgnb'
const HEAD2 = 'vfngfbnfvppp'

// CE game_dialog.cc:320 _head_phoneme_lookup[PHONEME_COUNT]
const HEAD_PHONEME_LOOKUP = [
    0, 3, 1, 1, 3, 1, 1, 1, 7, 8, 7, 3, 1, 8, 1, 7, 7, 6, 6, 2, 2,
    2, 2, 4, 4, 5, 5, 2, 2, 2, 2, 2, 6, 2, 2, 5, 8, 2, 2, 2, 2, 8,
]

const HEAD_W = 388
const HEAD_H = 200

interface HeadArt { key: string; numFrames: number; fps: number; frames: { sx: number; w: number; h: number; x: number }[]; dirX: number; dirY: number }
interface Lips { phonemes: number[]; markers: { marker: number; position: number }[]; totalBytes: number; audio: HTMLAudioElement }

let canvas: HTMLCanvasElement | null = null
let headIndex = -1
let headName = ''
let backgroundIndex = 2 // CE gGameDialogBackground default
let fidgetArt: HeadArt | null = null
let fidgetReaction = -1
let fidgetFrame = 0
let fidgetLast = 0
let fidgetDelay = 100
let canStartNewFidget = false
let tocksWaiting = 10000 // CE _tocksWaiting initial
let secondsSinceLastInput = 0
let lipsArt: HeadArt | null = null
let phoneAnim = -1
let lips: Lips | null = null
let lastPhoneme = -1
let busyTransition: Promise<void> = Promise.resolve()
let rafId = 0
let musicState: { stopped: boolean; oldVolume: number | null } | null = null
let totalHotx = 0

export function isTalkingHeadActive(): boolean {
    return headIndex !== -1
}

function headFileName(index: number): string | null {
    const entry = getLstJson('art/heads/heads', index)
    return entry && entry.frm ? String(entry.frm).toLowerCase() : null
}

function headArtKey(anim: number, fidget = 0): string {
    const type = HEAD2[anim]
    return `art/heads/${headName}${HEAD1[anim]}${type}${type === 'f' ? fidget : ''}`
}

function loadHeadArt(key: string): HeadArt | null {
    const info = globalState.imageInfo[key]
    if (!info) return null
    lazyLoadImage(key)
    const dir = info.directionOffsets?.[0] ?? { x: 0, y: 0 }
    return {
        key,
        numFrames: info.numFrames,
        fps: info.fps || 10, // CE artGetFramesPerSecond: 0 → 10
        frames: info.frameOffsets[0].map((f: any) => ({ sx: f.sx, w: f.w, h: f.h, x: f.x })),
        dirX: dir.x,
        dirY: dir.y,
    }
}

// CE art.cc artGetFidgetCount — heads.lst "name,good,neutral,bad".
function fidgetCount(reaction: number): number {
    const entry = getLstJson('art/heads/heads', headIndex)
    if (!entry) return 0
    const counts = [entry.fp, entry.pp, entry.rp].map((n: any) => Number(n) || 0)
    if (reaction === FIDGET_GOOD) return counts[0]
    if (reaction === FIDGET_NEUTRAL) return counts[1]
    if (reaction === FIDGET_BAD) return counts[2]
    return 0
}

// CE game_dialog.cc gameDialogRenderTalkingHead — background, then the head frame
// bottom-aligned in the 388x200 view, with CE's offset arithmetic (incl. the
// width*dirY quirk applied to the linear 640-pitch offset).
function render(art: HeadArt | null, frame: number): void {
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, HEAD_W, HEAD_H)
    const bgName = getLstJson('art/backgrnd/backgrnd', backgroundIndex)
    if (bgName) {
        const bgKey = 'art/backgrnd/' + String(bgName).split('.')[0].toLowerCase()
        const bg = globalState.images[bgKey]
        if (bg) ctx.drawImage(bg, 0, 0)
        else lazyLoadImage(bgKey, () => render(art, frame))
    }
    if (!art) return
    if (frame === 0) totalHotx = 0
    const f = art.frames[Math.min(frame, art.frames.length - 1)]
    if (!f) return
    totalHotx += f.x
    const a3 = art.dirX + totalHotx
    let offset = 640 * (HEAD_H - f.h) + a3 + Math.trunc((HEAD_W - f.w) / 2)
    if (offset + f.w * art.dirY > 0) offset += f.w * art.dirY
    const y = Math.floor(offset / 640)
    const x = offset - y * 640
    const img = globalState.images[art.key]
    if (img) ctx.drawImage(img, f.sx, 0, f.w, f.h, x, y, f.w, f.h)
    else lazyLoadImage(art.key, () => render(art, frame))
}

// CE game_dialog.cc:2446 _gdSetupFidget
function setupFidget(reaction: number): void {
    fidgetFrame = 0
    let anim = HEAD_ANIMATION_NEUTRAL_PHONEMES
    if (reaction === FIDGET_GOOD) anim = HEAD_ANIMATION_GOOD_PHONEMES
    else if (reaction === FIDGET_BAD) anim = HEAD_ANIMATION_BAD_PHONEMES
    if (!lipsArt || anim !== phoneAnim) {
        phoneAnim = anim
        lipsArt = loadHeadArt(headArtKey(anim))
    }

    const count = fidgetCount(reaction)
    if (count <= 0) {
        dbg('dialogue', '[Head] no fidgets for reaction ' + reaction)
        return
    }
    const chance = getRandomInt(1, 100) + Math.trunc(secondsSinceLastInput / 2)
    let fidget = count
    if (count === 1) fidget = 1
    else if (count === 2) fidget = chance < 68 ? 1 : 2
    else if (count === 3) {
        secondsSinceLastInput = 0
        fidget = chance < 52 ? 1 : chance < 77 ? 2 : 3
    }
    fidgetArt = loadHeadArt(headArtKey(reaction, fidget))
    fidgetLast = 0
    fidgetReaction = reaction
    fidgetDelay = 1000 / (fidgetArt?.fps ?? 10)
}

// CE game_dialog.cc:2585 _gdPlayTransition (after gameDialogWaitForFidgetToComplete)
function playTransition(anim: number): Promise<void> {
    const prev = busyTransition
    busyTransition = prev.then(() => new Promise<void>((resolve) => {
        const finishFidget = fidgetArt
        const steps: [HeadArt, number][] = []
        if (finishFidget) for (let f = fidgetFrame; f < finishFidget.numFrames; f++) steps.push([finishFidget, f])
        fidgetArt = null
        const art = loadHeadArt(headArtKey(anim))
        if (art) for (let f = 0; f < art.numFrames; f++) steps.push([art, f])
        const delay = 1000 / (art?.fps ?? 10)
        let i = 0
        const step = () => {
            if (i >= steps.length || !canvas) { resolve(); return }
            const [a, f] = steps[i++]
            render(a, f)
            setTimeout(step, delay)
        }
        step()
    }))
    return busyTransition
}

// CE game_dialog.cc:2888 _talk_to_critter_reacts — a1 is -1 (good) / 0 / 1 (bad).
export function talkToCritterReacts(a1: number): void {
    if (!isTalkingHeadActive()) return
    secondsSinceLastInput = 0
    const v3 = a1 + 50
    if (v3 === GAME_DIALOG_REACTION_GOOD) {
        if (fidgetReaction === FIDGET_GOOD) void playTransition(HEAD_ANIMATION_VERY_GOOD_REACTION).then(() => setupFidget(FIDGET_GOOD))
        else if (fidgetReaction === FIDGET_NEUTRAL) void playTransition(HEAD_ANIMATION_NEUTRAL_TO_GOOD).then(() => setupFidget(FIDGET_GOOD))
        else if (fidgetReaction === FIDGET_BAD) void playTransition(HEAD_ANIMATION_BAD_TO_NEUTRAL).then(() => setupFidget(FIDGET_NEUTRAL))
    } else if (v3 === GAME_DIALOG_REACTION_BAD) {
        if (fidgetReaction === FIDGET_GOOD) void playTransition(HEAD_ANIMATION_GOOD_TO_NEUTRAL).then(() => setupFidget(FIDGET_NEUTRAL))
        else if (fidgetReaction === FIDGET_NEUTRAL) void playTransition(HEAD_ANIMATION_NEUTRAL_TO_BAD).then(() => setupFidget(FIDGET_BAD))
        else if (fidgetReaction === FIDGET_BAD) void playTransition(HEAD_ANIMATION_VERY_BAD_REACTION).then(() => setupFidget(FIDGET_BAD))
    }
}

// Dialogue option reaction (GAME_DIALOG_REACTION_*) → _talk_to_critter_reacts arg
// (CE _gdProcessChoice: GOOD → -1, NEUTRAL → 0, BAD → 1).
export function reactToOption(reaction: number): void {
    endLips()
    canStartNewFidget = false
    const v1 = reaction === GAME_DIALOG_REACTION_GOOD ? -1 : reaction === GAME_DIALOG_REACTION_BAD ? 1 : 0
    talkToCritterReacts(v1)
}

// CE lips.cc lipsLoad — version-2 .lip: big-endian header, phoneme bytes, markers.
function loadLips(audioName: string): Lips | null {
    const base = audioName.split('.')[0].toLowerCase()
    let dv: DataView
    try {
        dv = getFileBinarySync(`data/sound/speech/${headName}/${base}.lip`)
    } catch {
        return null
    }
    const version = dv.getInt32(0, false)
    if (version !== 2) {
        dbg('dialogue', `[Lips] unsupported .lip version ${version} for ${base}`)
        return null
    }
    const totalBytes = dv.getInt32(16, false) // field_1C
    const phonemeCount = dv.getInt32(20, false) // field_24
    const markerCount = dv.getInt32(28, false) // field_2C
    let p = 44 // 8 int32 fields + file_name[8] + field_58[4]
    const phonemes: number[] = []
    for (let i = 0; i < phonemeCount; i++) phonemes.push(dv.getUint8(p++))
    const markers: { marker: number; position: number }[] = []
    for (let i = 0; i < markerCount; i++) {
        markers.push({ marker: dv.getInt32(p, false), position: dv.getInt32(p + 4, false) })
        p += 8
    }
    const audio = new Audio(`audio/speech/${headName}/${base}.mp3`)
    return { phonemes, markers, totalBytes, audio }
}

// CE game_dialog.cc:828 gameDialogStartLips — null name = censored line → "censor" sfx.
export function startLips(audioName: string | null): void {
    if (!isTalkingHeadActive()) return
    if (audioName === null) {
        globalState.audioEngine?.playSfxByName?.('censor')
        return
    }
    endLips()
    const l = loadLips(audioName)
    if (!l) return
    lips = l
    lastPhoneme = -1
    const ae = globalState.audioEngine as any
    // CE lipsStart: soundSetVolume(sound, speechVolume * 0.69)
    l.audio.volume = Math.max(0, Math.min(1, (ae?.speechVolume ?? 1) * (ae?.masterVolume ?? 1) * 0.69))
    l.audio.play().catch(() => { /* autoplay blocked: the head still animates */ })
    dbg('dialogue', `[Lips] start ${headName}/${audioName}`)
}

// CE game_dialog.cc:853 gameDialogEndLips
export function endLips(): void {
    if (!lips) return
    lips.audio.pause()
    lips = null
}

// CE lips.cc lipsTicker — the phoneme shown is the one of the last marker the
// playback position has passed. Position is in bytes of the decoded 22 kHz 16-bit
// stereo PCM (the .lip's total byte count matches that length).
function lipsPhoneme(l: Lips): number {
    const dur = l.audio.duration
    const bytes = isFinite(dur) && dur > 0 ? (l.audio.currentTime / dur) * l.totalBytes : l.audio.currentTime * 88200
    let idx = 0
    for (let i = 0; i < l.markers.length && i < l.phonemes.length; i++) {
        if (bytes > l.markers[i].position) idx = i
        else break
    }
    return l.phonemes[idx] ?? 0
}

// CE game_dialog.cc:2808 gameDialogTicker (head part)
function ticker(): void {
    rafId = 0
    if (!isTalkingHeadActive()) return
    const now = performance.now()

    if (lips) {
        const ended = lips.audio.ended || (lips.audio.paused && lips.audio.currentTime > 0)
        if (!ended) {
            const ph = lipsPhoneme(lips)
            if (ph !== lastPhoneme) {
                lastPhoneme = ph
                render(lipsArt, HEAD_PHONEME_LOOKUP[ph] ?? 0)
            }
        } else {
            endLips()
            render(lipsArt, 0)
            canStartNewFidget = true
            secondsSinceLastInput = 3
            fidgetFrame = 0
        }
    } else if (fidgetArt) {
        if (canStartNewFidget) {
            if (now - fidgetLast >= tocksWaiting) {
                canStartNewFidget = false
                secondsSinceLastInput += Math.trunc(tocksWaiting / 1000)
                tocksWaiting = 1000 * (getRandomInt(0, 3) + 4)
                setupFidget(fidgetReaction)
            }
        } else if (now - fidgetLast >= fidgetDelay) {
            if (fidgetArt.numFrames <= fidgetFrame) {
                render(fidgetArt, 0)
                canStartNewFidget = true
            } else {
                render(fidgetArt, fidgetFrame)
                fidgetLast = now
                fidgetFrame++
            }
        }
    }
    rafId = requestAnimationFrame(ticker)
}

function ensureCanvas(): HTMLCanvasElement | null {
    const container = document.getElementById('dialogueContainer')
    if (!container) return null
    let c = document.getElementById('dialogueTalkingHead') as HTMLCanvasElement | null
    if (!c) {
        c = document.createElement('canvas')
        c.id = 'dialogueTalkingHead'
        c.width = HEAD_W
        c.height = HEAD_H
        // CE: head view occupies (126,14)-(514,214) of the 640x480 dialogue window,
        // under the hilight1/hilight2 overlays.
        Object.assign(c.style, { position: 'absolute', left: '126px', top: '14px', width: HEAD_W + 'px', height: HEAD_H + 'px', pointerEvents: 'none' })
        container.insertBefore(c, container.firstChild)
    }
    c.style.display = 'block'
    return c
}

/**
 * CE _gdialogInitFromScript: headId -1 = no head (only the map view; music at half
 * volume). Otherwise background music stops for the conversation.
 */
export function startTalkingHead(headId: number, reaction: number, background: number): void {
    if (background !== -1) backgroundIndex = background // CE gameDialogSetBackground
    if (isTalkingHeadActive() || musicState) return // CE: _gdialog_state == 1 → already set up
    const ae = globalState.audioEngine as any
    const music: HTMLAudioElement | undefined = ae?.musicAudio
    if (headId === -1) {
        musicState = { stopped: false, oldVolume: music ? music.volume : null }
        if (music) music.volume = music.volume / 2
        return
    }
    const name = headFileName(headId)
    if (!name) return
    musicState = { stopped: true, oldVolume: null }
    ae?.stopMusic?.()
    headIndex = headId
    headName = name
    canvas = ensureCanvas()
    lipsArt = null
    phoneAnim = -1
    canStartNewFidget = false
    secondsSinceLastInput = 0
    setupFidget(reaction)
    render(fidgetArt, 0)
    if (!rafId) rafId = requestAnimationFrame(ticker)
}

// CE _gdialogExitFromScript (head + music parts)
export function stopTalkingHead(): void {
    endLips()
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
    headIndex = -1
    fidgetArt = null
    lipsArt = null
    if (canvas) canvas.style.display = 'none'
    canvas = null
    const ae = globalState.audioEngine as any
    if (musicState?.stopped) {
        // CE backgroundSoundRestart(11): resume the map's music.
        const mus = getCurrentMapInfo()?.music
        if (mus) ae?.playMusic?.(mus)
    } else if (musicState?.oldVolume != null && ae?.musicAudio) {
        ae.musicAudio.volume = musicState.oldVolume
    }
    musicState = null
}
