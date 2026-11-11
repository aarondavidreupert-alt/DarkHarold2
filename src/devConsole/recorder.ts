// Action recorder console commands (DH2 test tooling, no CE equivalent; README → "Action
// Recorder", wiki/autocrawler.md → "Replay"). Registered for every page load, like exportSave().
//
//   startRecording()            restart from a snapshot of the game (a save, reloaded at once) and
//                               record every player action from there
//   startRecording({ seed: 7 }) the same with a chosen RNG seed
//   stopRecording()             stop; prints the entry count and the size
//   exportRecording()           download the last recording as .dh2rec.json.gz ({ gzip: false }: .json)
//   importRecording()           pick a file, .gz or .json (or importRecording('url')); it becomes __recording
//   replayRecording()           replay __recording (or the one passed) and report divergences
//   downloadReplayReport()      download the last replay's report
//   __recording                 the current / last recording
//
// The hooks are in src/actionLog.ts (recordAction(), called from the input paths); this module is
// the sink that turns each action into a RecordedEntry (src/autocrawler/recording.ts).

import { setActionSink, setFrameListener, setMapReadyListener, type ActionEntry } from '../actionLog.js'
import { getLastReplayReport, loadSnapshot, runReplay, type ReplayOptions, type ReplayReport } from '../autocrawler.js'
import {
    encodeFrameTime,
    entrySeed,
    gvarDelta,
    gvarHash,
    gvarSnapshot,
    isRecording,
    ObjectLabels,
    playerTile,
    RECORDING_FORMAT,
    RECORDING_VERSION,
    type RecordedEntry,
    type Recording,
} from '../autocrawler/recording.js'
import { Config } from '../config.js'
import { resetLoopSchedule } from '../gameTick.js'
import globalState from '../globalState.js'
import { dbg } from '../logger.js'
import { Obj } from '../object.js'
import { randomDraws, randomSeedExact } from '../random.js'
import { gatherSaveData } from '../saveload.js'
import { uiState } from '../state/uiState.js'
import { world } from '../state/world.js'
import { UIMode } from '../uiMode.js'
import { getPlayerWorldPos } from '../worldmap/Worldmap.js'

// console commands are free-form globals
const devWindow = window as unknown as Record<string, unknown>

let current: Recording | null = null // being recorded
let last: Recording | null = null // the last one recorded or imported
const labels = new ObjectLabels()
let frameCount = 0 // frames since the start
let startMs = 0
let lastFrameTenths = 0 // the last frame's time since the start in 0.1 ms, rounded (no drift in the sum)
let frameTimes: string[] = []
const FRAME_CHUNK = 4096
let frameChunk = ''

function onFrame(): void {
    const now = Math.round((performance.now() - startMs) * 10)
    frameChunk += encodeFrameTime(now - lastFrameTenths)
    lastFrameTenths = now
    frameCount++
    if (frameChunk.length >= FRAME_CHUNK) {
        frameTimes.push(frameChunk)
        frameChunk = ''
    }
}
let lastGvars: { [index: string]: number } = {}
let lastMap = ''
let lastElevation = -1
let lastDraws = 0

// entries that don't reseed the RNG: map loads (reseeded when the load ends, below), and a
// Move Items quantity (asked for inside an action that already reseeded)
const NO_RESEED = new Set(['map', 'amount', 'timer'])

function makeEntry(t: string): RecordedEntry {
    const rec = current!
    const entry: RecordedEntry = {
        t,
        ms: Math.round(performance.now() - startMs),
        f: frameCount,
        k: world.gameTickTime - rec.startTick,
        pl: playerTile(),
    }
    const map = world.gMap?.name ?? ''
    if (map !== lastMap) {
        entry.mp = lastMap = map
    }
    const elevation = world.currentElevation
    if (elevation !== lastElevation) {
        entry.el = lastElevation = elevation
    }
    const gvars = gvarSnapshot()
    const delta = gvarDelta(lastGvars, gvars)
    if (delta) {
        entry.gv = delta
    }
    lastGvars = gvars
    if (world.inCombat) {
        entry.cb = 1
    }
    const draws = randomDraws - lastDraws
    if (draws) {
        entry.rn = draws
    }
    // on the world map: where the party is (the replay waits for it, travel runs on real time)
    if (uiState.uiMode === UIMode.worldMap) {
        const pos = getPlayerWorldPos()
        if (pos) {
            entry.wx = Math.round(pos.x)
            entry.wy = Math.round(pos.y)
        }
    }
    return entry
}

function push(entry: RecordedEntry): RecordedEntry {
    const rec = current!
    rec.entries.push(entry)
    if (!NO_RESEED.has(entry.t)) {
        randomSeedExact(entrySeed(rec.seed, rec.entries.length - 1))
    }
    lastDraws = randomDraws
    return entry
}

/** The sink behind recordAction(): objects become labels, items their PID. */
function sink(action: ActionEntry): ActionEntry | null {
    if (!current) {
        return null
    }
    const entry = makeEntry(action.t)
    for (const key of Object.keys(action)) {
        const v = action[key]
        if (key === 't' || v === undefined) {
            continue
        }
        if (key === 'o') {
            entry.o = v instanceof Obj ? labels.label(v) : null
        } else if (key === 'item') {
            entry.ip = v instanceof Obj ? v.pid : null
        } else {
            entry[key] = v
        }
    }
    return push(entry)
}

/** A map finished loading: its objects get their labels, and the RNG its seed for the load. */
function onMapReady(): void {
    if (!current) {
        return
    }
    labels.reset()
    const entry = makeEntry('map')
    entry.mp = lastMap = world.gMap?.name ?? ''
    entry.el = lastElevation = world.currentElevation
    push(entry)
    randomSeedExact(entrySeed(current.seed, current.entries.length - 1))
    lastDraws = randomDraws
}

async function startRecording(options: { seed?: number } = {}): Promise<boolean> {
    if (current) {
        console.log('[Recorder] already recording; stopRecording() first')
        return false
    }
    if (!world.gMap || !world.player || globalState.isLoading || world.inCombat) {
        console.log('[Recorder] start a game first (and not in combat or while a map loads)')
        return false
    }
    // the start is a load of the game as it is, so a replay starts from the very same load
    const start = JSON.parse(JSON.stringify(gatherSaveData('recording start')))
    delete start.screenshot
    delete start.id
    if (!(await loadSnapshot(start))) {
        console.log('[Recorder] the snapshot did not load')
        return false
    }
    const seed = options.seed ?? (Date.now() % 0x7ffffffe) + 1
    current = {
        format: RECORDING_FORMAT,
        version: RECORDING_VERSION,
        created: new Date().toISOString(),
        backend: Config.scripting.backend,
        seed,
        start,
        startTick: world.gameTickTime,
        frames: '',
        entries: [],
    }
    frameCount = 0
    frameTimes = []
    frameChunk = ''
    startMs = performance.now()
    lastFrameTenths = 0
    labels.reset()
    lastGvars = gvarSnapshot()
    lastMap = world.gMap?.name ?? ''
    lastElevation = world.currentElevation
    randomSeedExact(entrySeed(seed, -1))
    resetLoopSchedule() // the replay restarts the loop's schedule at the same point
    lastDraws = randomDraws
    setActionSink(sink)
    setMapReadyListener(onMapReady)
    setFrameListener(onFrame)
    console.log(`[Recorder] recording from ${lastMap} (seed ${seed}); stopRecording() to stop`)
    return true
}

function sizeOf(rec: Recording): { bytes: number; snapshot: number } {
    const bytes = JSON.stringify(rec).length
    return { bytes, snapshot: JSON.stringify(rec.start).length }
}

function stopRecording(): Recording | null {
    const rec = current
    if (!rec) {
        console.log('[Recorder] not recording')
        return null
    }
    setActionSink(null)
    setMapReadyListener(null)
    setFrameListener(null)
    rec.frames = frameTimes.join('') + frameChunk
    rec.end = {
        ms: Math.round(performance.now() - startMs),
        f: frameCount,
        k: world.gameTickTime - rec.startTick,
        mp: world.gMap?.name ?? '',
        el: world.currentElevation,
        pl: playerTile(),
        gvHash: gvarHash(gvarSnapshot()),
    }
    current = null
    last = rec
    const { bytes, snapshot } = sizeOf(rec)
    const minutes = rec.end.ms / 60000
    const perHour = minutes > 0 ? Math.round(((bytes - snapshot) / minutes) * 60) : 0
    console.log(
        `[Recorder] ${rec.entries.length} entries, ${minutes.toFixed(1)} min, ${(bytes / 1024).toFixed(0)} KB ` +
            `(snapshot ${(snapshot / 1024).toFixed(0)} KB, actions ~${(perHour / 1024).toFixed(0)} KB per hour); exportRecording() to save it`,
    )
    return rec
}

/** Download the recording: gzip by default (the start snapshot is most of it and packs ~20:1),
 *  `{ gzip: false }` for plain JSON. */
async function exportRecording(options: { gzip?: boolean; recording?: Recording } = {}): Promise<void> {
    if (current && !options.recording) {
        console.log('[Recorder] stopRecording() first')
        return
    }
    const rec = options.recording ?? last
    if (!rec) {
        console.log('[Recorder] nothing recorded')
        return
    }
    const gzip = options.gzip !== false
    let blob = new Blob([JSON.stringify(rec)], { type: 'application/json' })
    if (gzip) {
        blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob()
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${rec.start.currentMap}_${rec.created.replace(/[:.]/g, '-')}.dh2rec.json${gzip ? '.gz' : ''}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    console.log(
        `[Recorder] exported ${rec.entries.length} entries (${(blob.size / 1024).toFixed(0)} KB) as ${a.download}`,
    )
}

/** A recording file's text: gzip (by its magic bytes) or plain JSON. */
async function recordingText(data: Blob): Promise<string> {
    const head = new Uint8Array(await data.slice(0, 2).arrayBuffer())
    if (head[0] !== 0x1f || head[1] !== 0x8b) {
        return data.text()
    }
    return new Response(data.stream().pipeThrough(new DecompressionStream('gzip'))).text()
}

function download(data: unknown, name: string): void {
    if (!data) {
        console.log('[Recorder] nothing to download')
        return
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function pickFile(): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json,.gz,application/json,application/gzip'
        input.onchange = () => {
            const file = input.files?.[0]
            if (!file) {
                reject(new Error('no file chosen'))
            } else {
                resolve(file)
            }
        }
        input.click()
    })
}

async function importRecording(url?: string): Promise<Recording | null> {
    let data: Blob
    if (url) {
        const response = await fetch(url, { cache: 'no-cache' })
        if (!response.ok) {
            console.log(`[Recorder] ${url}: HTTP ${response.status}`)
            return null
        }
        data = await response.blob()
    } else {
        data = await pickFile()
    }
    const rec: unknown = JSON.parse(await recordingText(data))
    if (!isRecording(rec)) {
        console.log('[Recorder] not a DarkHarold2 recording')
        return null
    }
    last = rec
    console.log(
        `[Recorder] imported ${rec.entries.length} entries from ${rec.start.currentMap}; replayRecording() to replay`,
    )
    return rec
}

async function replayRecording(
    rec: Recording | null = last,
    options: ReplayOptions = {},
): Promise<ReplayReport | null> {
    if (current) {
        console.log('[Recorder] stopRecording() first')
        return null
    }
    if (!rec) {
        console.log('[Recorder] nothing to replay: importRecording() first')
        return null
    }
    const report = await runReplay(rec, options)
    dbg('script', '[Recorder] replay report', report)
    return report
}

export function registerRecorderCommands(): void {
    devWindow.startRecording = startRecording
    devWindow.stopRecording = stopRecording
    devWindow.exportRecording = exportRecording
    devWindow.importRecording = importRecording
    devWindow.replayRecording = replayRecording
    devWindow.downloadReplayReport = () => download(getLastReplayReport(), `replay_${Date.now()}.json`)
    Object.defineProperty(window, '__recording', { get: () => current ?? last, configurable: true })
}
