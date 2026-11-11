// Action recorder (DH2 test tooling, no CE equivalent; README → "Action Recorder",
// wiki/autocrawler.md → "Replay"). Registered for every page load, like exportSave().
//
// With [dh2] record_actions=1 (the default) it runs all the time: a piece of recording starts at
// every save load (its `parent` is that save) and at NEW GAME (with a snapshot of the first map),
// and every save stores the piece up to that moment (`save.recording`). So each save knows how the
// player got there from the save loaded before, and the chain of parents goes back to NEW GAME.
//
//   recordingStatus()           what is being recorded now
//   startRecording()            a piece from a snapshot of the game now (reloaded at once), also
//                               with record_actions=0; startRecording({ seed: 7 }) chooses the seed
//   stopRecording()             end the current piece (it becomes __recording); the next load or
//                               NEW GAME starts a new one (record_actions=1)
//   exportRecording()           download __recording as .dh2rec.json.gz ({ gzip: false }: .json;
//                               { save: 'name' }: a save's piece, with its parent save packed in)
//   importRecording()           pick a file, .gz or .json (or importRecording('url'))
//   replayRecording()           replay __recording (or the one passed) and report divergences
//   replaySave('name')          replay a save's piece: load its parent save, replay, compare with it
//   replayHistory('name')       every piece back to NEW GAME (or to a parent save that is gone)
//   downloadReplayReport()      the last replay's report as JSON
//   __recording                 the current piece, else the last one stopped or imported
//
// The hooks are in src/actionLog.ts (recordAction(), called from the input paths); this module is
// the sink that turns each action into a RecordedEntry (src/autocrawler/recording.ts).

import {
    addGameLoadedListener,
    addMapReadyListener,
    addNewGameListener,
    addReplayStartListener,
    isReplaying,
    setActionSink,
    setFrameListener,
    setSaveRecordingProvider,
    type ActionEntry,
    type SaveRef,
} from '../actionLog.js'
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
import { gatherSaveData, saveList, type SaveGame } from '../saveload.js'
import { uiState } from '../state/uiState.js'
import { world } from '../state/world.js'
import { UIMode } from '../uiMode.js'
import { getPlayerWorldPos } from '../worldmap/Worldmap.js'
import { formatKB } from './gameSize.js'

// console commands are free-form globals
const devWindow = window as unknown as Record<string, unknown>

let current: Recording | null = null // the piece being recorded
let last: Recording | null = null // the last one stopped or imported
const labels = new ObjectLabels()
let frameCount = 0 // frames since the start
let startMs = 0
let lastFrameTenths = 0 // the last frame's time since the start in 0.1 ms, rounded (no drift in the sum)
let frameTimes: string[] = []
const FRAME_CHUNK = 4096
let frameChunk = ''
let lastGvars: { [index: string]: number } = {}
let lastMap = ''
let lastElevation = -1
let lastDraws = 0
// what starts the next piece: startRecording()'s snapshot (at the end of its load), NEW GAME (once
// its first map is in)
let pendingManual: { start: SaveGame; seed?: number } | null = null
let pendingNewGame = false

// entries that don't reseed the RNG: map loads (reseeded when the load ends, below), and a
// Move Items quantity / timer (asked for inside an action that already reseeded)
const NO_RESEED = new Set(['map', 'amount', 'timer'])

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
    if (!current || isReplaying()) {
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

// ─── Pieces ─────────────────────────────────────────────────────────────────

function snapshotNow(name: string): SaveGame {
    const start = JSON.parse(JSON.stringify(gatherSaveData(name))) as SaveGame
    delete start.screenshot
    delete start.id
    return start
}

/** Start a piece here and now (the game must be running: the end of a load, a NEW GAME's map). */
function beginPiece(
    origin: 'load' | 'newGame' | 'manual',
    from: { start?: SaveGame; parent?: SaveRef },
    seed?: number,
): void {
    const s = seed ?? (Date.now() % 0x7ffffffe) + 1
    current = {
        format: RECORDING_FORMAT,
        version: RECORDING_VERSION,
        created: new Date().toISOString(),
        backend: Config.scripting.backend,
        seed: s,
        origin,
        ...from,
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
    randomSeedExact(entrySeed(s, -1))
    resetLoopSchedule() // the replay restarts the loop's schedule at the same point
    lastDraws = randomDraws
    setActionSink(sink)
    setFrameListener(onFrame)
    dbg('saveload', `[Recorder] recording (${origin}) from ${lastMap}, seed ${s}`)
}

/** The current piece as it stands, with its end state (what a save stores, or stopRecording). */
export function pieceSoFar(): Recording | null {
    const rec = current
    if (!rec) {
        return null
    }
    return {
        ...rec,
        entries: rec.entries.slice(),
        frames: frameTimes.join('') + frameChunk,
        end: {
            ms: Math.round(performance.now() - startMs),
            f: frameCount,
            k: world.gameTickTime - rec.startTick,
            mp: world.gMap?.name ?? '',
            el: world.currentElevation,
            pl: playerTile(),
            gvHash: gvarHash(gvarSnapshot()),
        },
    }
}

function endPiece(): Recording | null {
    const rec = pieceSoFar()
    setActionSink(null)
    setFrameListener(null)
    current = null
    if (rec) {
        last = rec
    }
    return rec
}

/** A map finished loading: its objects get their labels, and the RNG its seed for the load. */
function onMapReady(): void {
    if (pendingNewGame && !isReplaying()) {
        // NEW GAME's first map: start once its map_enter procs ran (the load callback runs right
        // after this notification, before the next frame)
        pendingNewGame = false
        queueMicrotask(() => {
            if (Config.engine.recordActions && !current && !isReplaying()) {
                beginPiece('newGame', { start: snapshotNow('new game') })
            }
        })
        return
    }
    if (!current || isReplaying()) {
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

/** A save finished loading: a new piece starts here (its parent is that save). */
function onGameLoaded(save: SaveRef): void {
    if (isReplaying()) {
        return
    }
    if (current) {
        endPiece()
    }
    if (pendingManual) {
        const { start, seed } = pendingManual
        pendingManual = null
        beginPiece('manual', { start }, seed)
    } else if (Config.engine.recordActions) {
        beginPiece('load', { parent: { name: save.name, timestamp: save.timestamp } })
    }
}

/** Make `rec` the current __recording (an imported bug report's piece). */
export function setLastRecording(rec: Recording): void {
    last = rec
}

function onNewGame(): void {
    if (current) {
        endPiece()
    }
    pendingNewGame = Config.engine.recordActions
}

// ─── Saves ──────────────────────────────────────────────────────────────────

function listSaves(): Promise<SaveGame[]> {
    return new Promise((resolve) => saveList(resolve))
}

/** A save: the newest (no argument), the newest with that name, or that id. */
export async function findSave(which?: string | number): Promise<SaveGame | undefined> {
    const saves = await listSaves()
    const pool =
        which === undefined
            ? saves
            : typeof which === 'number'
              ? saves.filter((s) => s.id === which)
              : saves.filter((s) => s.name === which)
    return pool.reduce<SaveGame | undefined>((a, b) => (!a || b.timestamp > a.timestamp ? b : a), undefined)
}

export async function findSaveByRef(ref: SaveRef): Promise<SaveGame | undefined> {
    return (await listSaves()).find((s) => s.name === ref.name && s.timestamp === ref.timestamp)
}

/** A piece ready to replay: its own start, or its parent save as the start. */
export async function withStart(rec: Recording): Promise<Recording | null> {
    if (rec.start) {
        return rec
    }
    const parent = rec.parent ? await findSaveByRef(rec.parent) : undefined
    if (!parent) {
        console.log(
            `[Recorder] the parent save '${rec.parent?.name}' (${new Date(rec.parent?.timestamp ?? 0).toLocaleString()}) ` +
                'is not in this browser (overwritten, deleted, or on another machine: exportRecording({ save }) packs it in)',
        )
        return null
    }
    const start: SaveGame = { ...parent }
    delete start.id
    delete start.recording
    return { ...rec, start }
}

// ─── Commands ───────────────────────────────────────────────────────────────

function describe(rec: Recording): string {
    const minutes = (rec.end?.ms ?? 0) / 60000
    const from = rec.parent
        ? `save '${rec.parent.name}' (${new Date(rec.parent.timestamp).toLocaleString()})`
        : rec.origin === 'newGame'
          ? 'NEW GAME'
          : `a snapshot (${rec.start?.currentMap ?? '?'})`
    return `${rec.entries.length} entries, ${minutes.toFixed(1)} min, from ${from}, ${formatKB(JSON.stringify(rec).length)}`
}

function recordingStatus(): Recording | null {
    const rec = pieceSoFar()
    if (!rec) {
        console.log(
            `[Recorder] not recording (record_actions=${Config.engine.recordActions ? 1 : 0}; ` +
                'the next load / NEW GAME starts a piece, or startRecording())',
        )
        return null
    }
    console.log(`[Recorder] recording: ${describe(rec)}`)
    return rec
}

async function startRecording(options: { seed?: number } = {}): Promise<boolean> {
    if (!world.gMap || !world.player || globalState.isLoading || world.inCombat) {
        console.log('[Recorder] start a game first (and not in combat or while a map loads)')
        return false
    }
    if (current) {
        endPiece()
    }
    // the start is a load of the game as it is, so a replay starts from the very same load
    pendingManual = { start: snapshotNow('recording start'), seed: options.seed }
    if (!(await loadSnapshot(pendingManual.start)) || !current) {
        pendingManual = null
        console.log('[Recorder] the snapshot did not load')
        return false
    }
    console.log(`[Recorder] recording from ${lastMap} (seed ${current.seed}); stopRecording() to stop`)
    return true
}

function stopRecording(): Recording | null {
    const rec = endPiece()
    if (!rec) {
        console.log('[Recorder] not recording')
        return null
    }
    const bytes = JSON.stringify(rec).length
    const snapshot = rec.start ? JSON.stringify(rec.start).length : 0
    const minutes = (rec.end?.ms ?? 0) / 60000
    const perHour = minutes > 0 ? Math.round(((bytes - snapshot) / minutes) * 60) : 0
    console.log(
        `[Recorder] ${describe(rec)} (snapshot ${formatKB(snapshot)}, actions ~${formatKB(perHour)} per hour, ` +
            'before gzip); exportRecording() to save it',
    )
    return rec
}

/** Download a recording: gzip by default (a start snapshot is most of it and packs ~20:1),
 *  `{ gzip: false }` for plain JSON, `{ save }` a save's piece with its parent save packed in. */
async function exportRecording(
    options: { gzip?: boolean; recording?: Recording; save?: string | number } = {},
): Promise<void> {
    let rec: Recording | null = options.recording ?? null
    if (options.save !== undefined) {
        const save = await findSave(options.save)
        if (!save?.recording || !isRecording(save.recording)) {
            console.log(`[Recorder] save ${JSON.stringify(options.save)} has no recording`)
            return
        }
        rec = await withStart(save.recording)
    } else if (!rec) {
        rec = last
        if (rec?.parent && !rec.start) {
            rec = await withStart(rec)
        }
    }
    if (!rec) {
        console.log('[Recorder] nothing to export (stopRecording() first, or { save: name })')
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
    const map = rec.start?.currentMap ?? 'recording'
    a.download = `${map}_${rec.created.replace(/[:.]/g, '-')}.dh2rec.json${gzip ? '.gz' : ''}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    console.log(`[Recorder] exported ${rec.entries.length} entries (${formatKB(blob.size)}) as ${a.download}`)
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
    console.log(`[Recorder] imported ${describe(rec)}; replayRecording() to replay`)
    return rec
}

async function replayRecording(
    rec: Recording | null = last,
    options: ReplayOptions = {},
): Promise<ReplayReport | null> {
    if (!rec) {
        console.log('[Recorder] nothing to replay: importRecording() first, or replaySave()')
        return null
    }
    const ready = await withStart(rec)
    if (!ready) {
        return null
    }
    const report = await runReplay(ready, options)
    dbg('script', '[Recorder] replay report', report)
    return report
}

/** Replay the piece a save carries: load its parent save, replay, compare with the save. */
async function replaySave(which?: string | number, options: ReplayOptions = {}): Promise<ReplayReport | null> {
    const save = await findSave(which)
    if (!save) {
        console.log(`[Recorder] no save ${which === undefined ? '' : JSON.stringify(which)}`)
        return null
    }
    if (!save.recording || !isRecording(save.recording)) {
        console.log(`[Recorder] save '${save.name}' has no recording (record_actions was off, or an older save)`)
        return null
    }
    console.log(`[Recorder] replaying save '${save.name}': ${describe(save.recording)}`)
    return replayRecording(save.recording, options)
}

/** Every piece from NEW GAME (or the oldest parent still here) to this save, oldest first. */
async function replayHistory(which?: string | number, options: ReplayOptions = {}): Promise<ReplayReport[]> {
    const chain: SaveGame[] = []
    let save = await findSave(which)
    while (save?.recording && isRecording(save.recording)) {
        chain.unshift(save)
        const parent: SaveRef | undefined = save.recording.parent
        if (!parent) {
            break
        }
        const next = await findSaveByRef(parent)
        if (!next) {
            console.log(`[Recorder] the history stops at '${save.name}': its parent save '${parent.name}' is gone`)
            break
        }
        save = next
    }
    if (chain.length === 0) {
        console.log('[Recorder] no recorded history for that save')
        return []
    }
    const reports: ReplayReport[] = []
    for (const s of chain) {
        console.log(`[Recorder] history ${reports.length + 1}/${chain.length}: up to save '${s.name}'`)
        const report = await replayRecording(s.recording as unknown as Recording, options)
        if (report) {
            reports.push(report)
        }
        if (options.stopOnDivergence && report?.firstDivergence) {
            break
        }
    }
    const diverging = reports.filter((r) => r.divergences.length > 0).length
    console.log(`[Recorder] history: ${reports.length} pieces replayed, ${diverging} with divergences`)
    return reports
}

export function registerRecorderCommands(): void {
    // the recorder itself: always listening; it records while record_actions=1 or after startRecording()
    addGameLoadedListener(onGameLoaded)
    addNewGameListener(onNewGame)
    addMapReadyListener(onMapReady)
    addReplayStartListener(() => {
        if (current) {
            endPiece() // the replay replaces this game
        }
    })
    setSaveRecordingProvider(() => pieceSoFar() as unknown as Record<string, unknown> | null)

    devWindow.recordingStatus = recordingStatus
    devWindow.startRecording = startRecording
    devWindow.stopRecording = stopRecording
    devWindow.exportRecording = exportRecording
    devWindow.importRecording = importRecording
    devWindow.replayRecording = replayRecording
    devWindow.replaySave = replaySave
    devWindow.replayHistory = replayHistory
    devWindow.downloadReplayReport = () => download(getLastReplayReport(), `replay_${Date.now()}.json`)
    Object.defineProperty(window, '__recording', { get: () => pieceSoFar() ?? last, configurable: true })
}
