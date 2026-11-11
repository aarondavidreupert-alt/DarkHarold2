// Action recorder — the recording format and what the recorder and the replayer share (DH2 test
// tooling, no CE equivalent; README → "Action Recorder", wiki/autocrawler.md → "Replay").
//
// A recording is the game as a save at the start (the snapshot the replay loads), the seed the
// RNG was set to, and one compact entry per player action: what was asked for (`t` and its
// arguments, from src/actionLog.ts) plus where the game stood just before it (frame, game tick,
// player tile, elevation / map when they changed, the GVARs that changed since the entry before).
// Those state fields are what the replay checks, step by step, to say where it diverges.

import { heart } from '../heart.js'
import { Obj } from '../object.js'
import * as Scripting from '../scripting.js'
import type { SaveGame } from '../saveload.js'
import { world } from '../state/world.js'
import { toTileNum } from '../tile.js'

export const RECORDING_FORMAT = 'dh2-recording'
export const RECORDING_VERSION = 1

/** One recorded action. The payload keys come from the hooks (actionLog.ts); objects are
 *  stored as labels (`o`), items as their PID (`ip`). */
export interface RecordedEntry {
    t: string
    /** milliseconds since the recording started (information; the pace is `f` and `frames`) */
    ms: number
    /** logical frames since the recording started: the action ran after this many frames */
    f: number
    /** game ticks since the recording started */
    k: number
    /** the player's tile */
    pl: number
    /** elevation, only when it changed since the entry before */
    el?: number
    /** map name, only when it changed since the entry before */
    mp?: string
    /** GVARs that changed since the entry before: index → value */
    gv?: { [index: string]: number }
    /** in combat (1) */
    cb?: 1
    /** random numbers drawn since the entry before (information: asset callbacks draw too) */
    rn?: number
    [key: string]: unknown
}

export interface Recording {
    format: typeof RECORDING_FORMAT
    version: number
    created: string
    backend: string
    /** the RNG seed; each entry reseeds with entrySeed(seed, index) just before its action */
    seed: number
    /** the game when the recording started (a save, never stored in IndexedDB until replayed) */
    start: SaveGame
    startTick: number
    /** every logical frame's time since the frame before, in 0.1 ms (encodeFrameTime): animations,
     *  the 10 Hz game tick and idle timers run on real time, so the replay runs the recorded
     *  frames at the recorded times. Two characters a frame (~210 KB an hour at 30 fps). */
    frames: string
    entries: RecordedEntry[]
    /** where the game stood when the recording stopped */
    end?: { ms: number; f: number; k: number; mp: string; el: number; pl: number; gvHash: number }
}

// ─── Object labels ──────────────────────────────────────────────────────────

// Objects are named by what they are and where they stood when the map finished loading
// (pid@tile, ~n for a second one there) — uids shift with everything created before. Objects
// that appear later get their label where they stand when they are first referenced; the
// replay resolves a label the same way, so both sides agree while the game does.
export class ObjectLabels {
    private labels = new Map<Obj, string>()
    private taken = new Set<string>()

    reset(): void {
        this.labels = new Map()
        this.taken = new Set()
        const map = world.gMap
        if (!map) {
            return
        }
        for (let level = 0; level < (map.numLevels ?? 1); level++) {
            for (const o of map.getObjects(level)) {
                this.label(o)
            }
        }
    }

    private base(o: Obj): string {
        const level = o.elevation ?? world.gMap?.currentElevation ?? 0
        return `${(o.pid ?? -1).toString(16)}@${o.position ? toTileNum(o.position) : '-'}${level ? ':' + level : ''}`
    }

    label(o: Obj): string {
        if (o === world.player) {
            return 'dude'
        }
        let l = this.labels.get(o)
        if (l === undefined) {
            const base = this.base(o)
            l = base
            for (let n = 2; this.taken.has(l); n++) {
                l = `${base}~${n}`
            }
            this.taken.add(l)
            this.labels.set(o, l)
        }
        return l
    }

    /** The object a label names on the current map (null: not there). */
    resolve(label: string): Obj | null {
        if (label === 'dude') {
            return world.player
        }
        for (const [o, l] of this.labels) {
            if (l === label && this.onMap(o)) {
                return o
            }
        }
        // not seen yet: an object whose pid@tile is the label's (labelling it now, as the
        // recorder did when it was first referenced)
        const base = label.replace(/~\d+$/, '')
        const map = world.gMap
        if (!map) {
            return null
        }
        for (let level = 0; level < (map.numLevels ?? 1); level++) {
            for (const o of map.getObjects(level)) {
                if (this.labels.has(o) || this.base(o) !== base) {
                    continue
                }
                if (this.label(o) === label) {
                    return o
                }
            }
        }
        return null
    }

    private onMap(o: Obj): boolean {
        const map = world.gMap
        if (!map) {
            return false
        }
        for (let level = 0; level < (map.numLevels ?? 1); level++) {
            if (map.getObjects(level).includes(o)) {
                return true
            }
        }
        return false
    }
}

// ─── State capture ──────────────────────────────────────────────────────────

/** Copy of the GVARs (numbers only). */
export function gvarSnapshot(): { [index: string]: number } {
    const out: { [index: string]: number } = {}
    const g = Scripting.getGlobalVars() as { [k: string]: unknown }
    for (const k of Object.keys(g)) {
        if (typeof g[k] === 'number') {
            out[k] = g[k] as number
        }
    }
    return out
}

export function gvarDelta(
    before: { [index: string]: number },
    after: { [index: string]: number },
): { [index: string]: number } | undefined {
    let out: { [index: string]: number } | undefined
    for (const k of Object.keys(after)) {
        if (before[k] !== after[k]) {
            ;(out ??= {})[k] = after[k]
        }
    }
    return out
}

export function gvarHash(g: { [index: string]: number }): number {
    let h = 2166136261 >>> 0
    for (const k of Object.keys(g).sort((a, b) => Number(a) - Number(b))) {
        const s = `${k}=${g[k]};`
        for (let i = 0; i < s.length; i++) {
            h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
        }
    }
    return h
}

export function playerTile(): number {
    const p = world.player
    return p?.position ? toTileNum(p.position) : -1
}

export function currentFrame(): number {
    return heart.frames
}

/** The RNG seed for entry `index` (CE's Park-Miller generator takes 1..2^31-2). */
export function entrySeed(seed: number, index: number): number {
    let h = (Math.imul(seed ^ 0x9e3779b9, 16777619) ^ Math.imul(index + 1, 2246822519)) >>> 0
    h = Math.imul(h ^ (h >>> 15), 2654435761) >>> 0
    return (h % 0x7ffffffe) + 1
}

// ─── Frame times ────────────────────────────────────────────────────────────

// Two base-64 characters per frame for 0..409.5 ms in 0.1 ms steps (Chrome's performance.now()
// resolution), else '~' tenths '~' (a pause, a slow frame).
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** `dt` in tenths of a millisecond (an integer: the recorder rounds the running time, so the
 *  rounding never adds up). */
export function encodeFrameTime(tenths: number): string {
    const t = Math.max(0, Math.round(tenths))
    return t < 4096 ? B64[t >> 6] + B64[t & 63] : `~${t}~`
}

/** The frame times in ms. */
export function decodeFrameTimes(text: string): number[] {
    const out: number[] = []
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '~') {
            const end = text.indexOf('~', i + 1)
            out.push(Number(text.slice(i + 1, end)) / 10)
            i = end
        } else {
            out.push(((B64.indexOf(text[i]) << 6) | B64.indexOf(text[i + 1])) / 10)
            i++
        }
    }
    return out
}

export function isRecording(v: unknown): v is Recording {
    const r = v as Partial<Recording> | null
    return !!r && r.format === RECORDING_FORMAT && Array.isArray(r.entries) && !!r.start
}
