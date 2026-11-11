// Save size console commands (DH2 addition, no CE equivalent; README → "Action Recorder" / "Save
// Files"). Registered for every page load, like exportSave().
//
//   gameSize()          the game as a save would store it now, by part (maps, player, the
//                       action recording, ...)
//   saveSize()          every stored save: total size and the recording's share
//   saveSize('name')    one save by part (the newest with that name; a number picks the save id)
//
// Sizes are the JSON length (what exportSave() writes; IndexedDB stores about the same). A save
// grows with every map the player changed (savedMaps) and, with [dh2] record_actions=1, with the
// actions since the load before it (~430 KB an hour, half of it the frame-time track).

import { recordingForSave } from '../actionLog.js'
import { gatherSaveData, saveList, type SaveGame } from '../saveload.js'

// console commands are free-form globals
const devWindow = window as unknown as Record<string, unknown>

/** Above this a save is worth a look (IndexedDB has room for far more; writing it takes longer). */
const LARGE_SAVE = 20 * 1024 * 1024

export function formatKB(bytes: number): string {
    return bytes >= 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
        : `${Math.max(0, Math.round(bytes / 1024))} KB`
}

function sizeOf(v: unknown): number {
    return v === undefined ? 0 : JSON.stringify(v).length
}

interface SizeReport {
    total: number
    parts: { [part: string]: number }
    maps: { [map: string]: number }
    recording?: { total: number; entries: number; frames: number; start: number; count: number; minutes: number }
    history?: { total: number; pieces: number; minutes: number; pending: number }
}

function sizeReport(save: SaveGame): SizeReport {
    const parts: { [part: string]: number } = {}
    for (const key of Object.keys(save)) {
        parts[key] = sizeOf((save as unknown as Record<string, unknown>)[key])
    }
    const maps: { [map: string]: number } = {}
    for (const name of Object.keys(save.savedMaps ?? {})) {
        maps[name] = sizeOf(save.savedMaps[name])
    }
    const report: SizeReport = { total: sizeOf(save), parts, maps }
    const rec = save.recording as
        { entries?: unknown[]; frames?: string; start?: unknown; end?: { ms?: number } } | undefined
    if (rec) {
        report.recording = {
            total: sizeOf(rec),
            entries: sizeOf(rec.entries),
            frames: sizeOf(rec.frames),
            start: sizeOf(rec.start),
            count: rec.entries?.length ?? 0,
            minutes: (rec.end?.ms ?? 0) / 60000,
        }
    }
    const hist = save.history as
        { chunks?: string[]; pending?: unknown[]; count?: number; minutes?: number } | undefined
    if (hist) {
        report.history = {
            total: sizeOf(hist),
            pieces: hist.count ?? 0,
            minutes: hist.minutes ?? 0,
            pending: hist.pending?.length ?? 0,
        }
    }
    return report
}

function printReport(title: string, r: SizeReport): void {
    const lines = [`[Size] ${title}: ${formatKB(r.total)}${r.total > LARGE_SAVE ? '  (large)' : ''}`]
    const parts = Object.entries(r.parts).sort((a, b) => b[1] - a[1])
    for (const [part, n] of parts.slice(0, 8)) {
        if (n > 0) {
            lines.push(`  ${part.padEnd(14)} ${formatKB(n).padStart(9)}`)
        }
    }
    const maps = Object.entries(r.maps).sort((a, b) => b[1] - a[1])
    if (maps.length > 0) {
        lines.push(`  maps (${maps.length}): ` + maps.map(([m, n]) => `${m} ${formatKB(n)}`).join(', '))
    }
    if (r.recording) {
        const x = r.recording
        lines.push(
            `  recording: ${x.count} actions over ${x.minutes.toFixed(1)} min — entries ${formatKB(x.entries)}, ` +
                `frame times ${formatKB(x.frames)}${x.start ? `, start snapshot ${formatKB(x.start)}` : ''}`,
        )
    }
    if (r.history) {
        const h = r.history
        lines.push(
            `  history: ${h.pieces} earlier pieces over ${h.minutes.toFixed(1)} min back to the chain's start, ` +
                `${formatKB(h.total)} (compressed${h.pending ? `; ${h.pending} not yet` : ''})`,
        )
    }
    console.log(lines.join('\n'))
}

/** The game now, as a save would store it (with the recording piece it would carry). */
function gameSize(): SizeReport | null {
    let save: SaveGame
    try {
        save = gatherSaveData('size check')
    } catch {
        console.log('[Size] no game running')
        return null
    }
    delete save.screenshot
    const recorded = recordingForSave()
    if (recorded) {
        save.recording = recorded.recording
        if (recorded.history) {
            save.history = recorded.history
        }
    }
    const r = sizeReport(save)
    printReport('the game now', r)
    return r
}

function listSaves(): Promise<SaveGame[]> {
    return new Promise((resolve) => saveList(resolve))
}

async function saveSize(which?: string | number): Promise<SizeReport | SizeReport[] | null> {
    const saves = await listSaves()
    if (which === undefined) {
        const rows = saves
            .slice()
            .sort((a, b) => b.timestamp - a.timestamp)
            .map((s) => ({ s, r: sizeReport(s) }))
        const total = rows.reduce((n, x) => n + x.r.total, 0)
        console.log(
            `[Size] ${rows.length} saves, ${formatKB(total)} in all\n` +
                rows
                    .map(
                        ({ s, r }) =>
                            `  #${String(s.id).padEnd(4)} ${s.name.slice(0, 24).padEnd(24)} ${formatKB(r.total).padStart(9)}` +
                            (r.recording ? `   recording ${formatKB(r.recording.total)}` : '') +
                            (r.history ? ` + history ${formatKB(r.history.total)} (${r.history.pieces} pieces)` : '') +
                            (r.total > LARGE_SAVE ? '  (large)' : ''),
                    )
                    .join('\n'),
        )
        return rows.map((x) => x.r)
    }
    const pool = typeof which === 'number' ? saves.filter((s) => s.id === which) : saves.filter((s) => s.name === which)
    const save = pool.reduce<SaveGame | undefined>((a, b) => (!a || b.timestamp > a.timestamp ? b : a), undefined)
    if (!save) {
        console.log(`[Size] no save ${JSON.stringify(which)}`)
        return null
    }
    const r = sizeReport(save)
    printReport(`save #${save.id} '${save.name}'`, r)
    return r
}

export function registerGameSizeCommands(): void {
    devWindow.gameSize = gameSize
    devWindow.saveSize = saveSize
}
