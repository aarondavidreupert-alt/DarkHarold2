// Bug report bundles (DH2 addition, no CE equivalent; README → "Bug Reports"). Registered for every
// page load, like exportSave().
//
//   exportBugReport('the guard walks through the wall')
//                         one .dh2bug.json.gz with everything to look at and replay a bug: the
//                         game now (a save, with the action recording since the load before),
//                         the chain of parent saves its recording goes back through, the last
//                         console errors / warnings, the combat event log (inside the save),
//                         the settings that change behaviour, the browser
//   exportBugReport('...', { save: 'name' })   the same for a stored save instead of the game now
//   importBugReport()     pick a .dh2bug file (or importBugReport('url')): prints the note and the
//                         logs, stores the saves (as "bug: <note>" and the parents under their own
//                         names), and makes the recording __recording — replayRecording() replays
//                         it, the "bug:" save loads the moment of the report
//
// The console capture starts with the page (registerBugReportCommands), so errors from before the
// report are in it.

import { Config } from '../config.js'
import globalState from '../globalState.js'
import { gatherSaveData, putSave, saveList, type SaveGame } from '../saveload.js'
import { world } from '../state/world.js'
import { isRecording, type Recording } from '../autocrawler/recording.js'
import { formatKB } from './gameSize.js'
import { findSave, findSaveByRef, pieceSoFar, setLastRecording, withStart } from './recorder.js'

// console commands are free-form globals
const devWindow = window as unknown as Record<string, unknown>

const BUG_FORMAT = 'dh2-bugreport'
const BUG_VERSION = 1
/** how many parent saves a report packs in at most (each is ~70 KB gzipped) */
const MAX_PARENTS = 8
const LOG_LINES = 300

interface LogLine {
    t: number // ms since the page loaded
    level: 'error' | 'warn' | 'uncaught' | 'rejection'
    text: string
}

interface BugReport {
    format: typeof BUG_FORMAT
    version: number
    created: string
    note: string
    /** the game at the report (a save; its `recording` is the piece since the load before) */
    game: SaveGame
    /** the saves the recording chain goes back through, nearest first */
    parents: SaveGame[]
    /** why the chain stops: NEW GAME, a parent that is gone, or MAX_PARENTS */
    chainEnd: string
    log: LogLine[]
    settings: { [key: string]: unknown }
    browser: { userAgent: string; viewport: string; url: string }
}

// ─── Console capture ────────────────────────────────────────────────────────

const logLines: LogLine[] = []

function keep(level: LogLine['level'], parts: unknown[]): void {
    const text = parts
        .map((p) => (p instanceof Error ? `${p.message}\n${p.stack ?? ''}` : typeof p === 'string' ? p : safeJson(p)))
        .join(' ')
        .slice(0, 2000)
    logLines.push({ t: Math.round(performance.now()), level, text })
    if (logLines.length > LOG_LINES) {
        logLines.splice(0, logLines.length - LOG_LINES)
    }
}

function safeJson(v: unknown): string {
    try {
        return JSON.stringify(v)?.slice(0, 500) ?? String(v)
    } catch {
        return String(v)
    }
}

function installConsoleCapture(): void {
    const error = console.error.bind(console)
    const warn = console.warn.bind(console)
    console.error = (...args: unknown[]) => {
        keep('error', args)
        error(...args)
    }
    console.warn = (...args: unknown[]) => {
        keep('warn', args)
        warn(...args)
    }
    window.addEventListener('error', (e) => keep('uncaught', [e.error ?? e.message]))
    window.addEventListener('unhandledrejection', (e) => keep('rejection', [e.reason]))
}

// ─── Export ─────────────────────────────────────────────────────────────────

function settingsNow(): { [key: string]: unknown } {
    return {
        scriptBackend: Config.scripting.backend,
        scriptFixes: Config.scripting.scriptFixes,
        mods: Config.scripting.mods,
        recordActions: Config.engine.recordActions,
        mouseMode: Config.ui.mouseMode,
        talkMode: Config.engine.talkMode,
        interruptWalk: Config.engine.interruptWalk,
        combatSpeed: Config.combat.combatSpeed,
        playerSpeedup: Config.engine.playerSpeedup,
        doAlwaysRun: Config.engine.doAlwaysRun,
    }
}

async function exportBugReport(note = '', options: { save?: string | number; gzip?: boolean } = {}): Promise<void> {
    let game: SaveGame
    if (options.save !== undefined) {
        const save = await findSave(options.save)
        if (!save) {
            console.log(`[Bug] no save ${JSON.stringify(options.save)}`)
            return
        }
        game = { ...save }
    } else {
        if (!world.gMap || !world.player || globalState.isLoading) {
            console.log('[Bug] no game running (or a map is loading): exportBugReport(note, { save: name }) for a save')
            return
        }
        game = JSON.parse(JSON.stringify(gatherSaveData(note ? `bug: ${note.slice(0, 40)}` : 'bug report'))) as SaveGame
        const piece = pieceSoFar()
        if (piece) {
            game.recording = piece as unknown as Record<string, unknown>
        }
    }
    delete game.id
    // the parent saves, as far as they go
    const parents: SaveGame[] = []
    let chainEnd = 'no recording (record_actions=0, or a save from before it)'
    let rec = game.recording && isRecording(game.recording) ? (game.recording as unknown as Recording) : null
    while (rec) {
        if (!rec.parent) {
            chainEnd = rec.origin === 'newGame' ? 'NEW GAME' : 'a startRecording() snapshot'
            break
        }
        if (parents.length >= MAX_PARENTS) {
            chainEnd = `${MAX_PARENTS} parent saves (older ones left out)`
            break
        }
        const parent = await findSaveByRef(rec.parent)
        if (!parent) {
            chainEnd = `parent save '${rec.parent.name}' is gone (overwritten or deleted)`
            break
        }
        const copy: SaveGame = { ...parent }
        delete copy.id
        parents.push(copy)
        rec = parent.recording && isRecording(parent.recording) ? (parent.recording as unknown as Recording) : null
        if (!rec) {
            chainEnd = `save '${parent.name}' has no recording`
        }
    }
    const report: BugReport = {
        format: BUG_FORMAT,
        version: BUG_VERSION,
        created: new Date().toISOString(),
        note,
        game,
        parents,
        chainEnd,
        log: logLines.slice(),
        settings: settingsNow(),
        browser: {
            userAgent: navigator.userAgent,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            url: location.pathname + location.search + location.hash,
        },
    }
    const gzip = options.gzip !== false
    let blob = new Blob([JSON.stringify(report)], { type: 'application/json' })
    const raw = blob.size
    if (gzip) {
        blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob()
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const slug = (note.replace(/[^\w-]+/g, '_').slice(0, 30) || game.currentMap).replace(/^_+|_+$/g, '')
    a.download = `dh2bug_${slug}_${report.created.replace(/[:.]/g, '-')}.dh2bug.json${gzip ? '.gz' : ''}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    const piece = game.recording as unknown as Recording | undefined
    console.log(
        `[Bug] exported ${a.download} (${formatKB(blob.size)}, ${formatKB(raw)} unpacked): ${game.currentMap}, ` +
            `${piece ? `${piece.entries.length} recorded actions` : 'no recording'}, ${parents.length} parent saves ` +
            `(chain ends: ${chainEnd}), ${report.log.length} log lines`,
    )
}

// ─── Import ─────────────────────────────────────────────────────────────────

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

async function textOf(data: Blob): Promise<string> {
    const head = new Uint8Array(await data.slice(0, 2).arrayBuffer())
    if (head[0] !== 0x1f || head[1] !== 0x8b) {
        return data.text()
    }
    return new Response(data.stream().pipeThrough(new DecompressionStream('gzip'))).text()
}

function isBugReport(v: unknown): v is BugReport {
    const r = v as Partial<BugReport> | null
    return !!r && r.format === BUG_FORMAT && !!r.game && Array.isArray(r.parents)
}

function storeSave(save: SaveGame): Promise<number> {
    return new Promise((resolve) => putSave(save, resolve))
}

/** Read a bug report (a file picker, a URL, or the file's contents) and set it up to look at. */
async function importBugReport(from?: string | Blob): Promise<BugReport | null> {
    let data: Blob
    if (from instanceof Blob) {
        data = from
    } else if (typeof from === 'string') {
        const response = await fetch(from, { cache: 'no-cache' })
        if (!response.ok) {
            console.log(`[Bug] ${from}: HTTP ${response.status}`)
            return null
        }
        data = await response.blob()
    } else {
        data = await pickFile()
    }
    const report: unknown = JSON.parse(await textOf(data))
    if (!isBugReport(report)) {
        console.log('[Bug] not a DarkHarold2 bug report')
        return null
    }
    // the parents under their own names (the recording finds them by name and timestamp), unless
    // this browser has them already
    const saves = await new Promise<SaveGame[]>((resolve) => saveList(resolve))
    let stored = 0
    for (const parent of report.parents) {
        if (!saves.some((s) => s.name === parent.name && s.timestamp === parent.timestamp)) {
            await storeSave(parent)
            stored++
        }
    }
    const name = `bug: ${(report.note || report.game.currentMap).slice(0, 40)}`
    const id = await storeSave({ ...report.game, name })
    const piece = report.game.recording && isRecording(report.game.recording) ? report.game.recording : null
    if (piece) {
        setLastRecording(piece)
    }
    const errors = report.log.filter((l) => l.level !== 'warn')
    console.log(
        `[Bug] "${report.note}" (${report.created}, ${report.settings.scriptBackend} backend)\n` +
            `  game: ${report.game.currentMap}, stored as save #${id} '${name}'; ${stored} parent saves stored ` +
            `(${report.parents.length} in the report; chain ends: ${report.chainEnd})\n` +
            `  recording: ${piece ? `${piece.entries.length} actions — replayRecording() replays them` : 'none'}\n` +
            `  log: ${report.log.length} lines, ${errors.length} errors` +
            (errors.length
                ? '\n' +
                  errors
                      .slice(-10)
                      .map((l) => `    [${l.level} @${l.t} ms] ${l.text.split('\n')[0]}`)
                      .join('\n')
                : ''),
    )
    if (piece && !(await withStart(piece))) {
        console.log('[Bug] (the recording cannot be replayed: its parent save is not in the report)')
    }
    return report
}

export function registerBugReportCommands(): void {
    installConsoleCapture()
    devWindow.exportBugReport = exportBugReport
    devWindow.importBugReport = importBugReport
}
