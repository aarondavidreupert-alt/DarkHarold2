// Save files on disk (DH2 addition, no CE equivalent): exportSave() and importSave().
// Saves live in this browser's IndexedDB (saveload.ts), so they can't be moved to another
// browser, profile or machine. These console commands write a save to a .json file and read
// one back as a new save. Registered for every page load, like exportEventLog().
//
//   exportSave()          the newest save
//   exportSave('tttt')    the newest save with that name (a number picks the save id)
//   importSave()          pick a file, store it as a new save and load it
//   importSave(false)     store it only (it then shows in the Load Game list)
//   importSave('saves/tttt.json')   read it from a URL instead of a file picker
//   exportAllSaves()      every save in one file (dh2saves_<date>.jsonl.gz: gzip, one save a line)
//   importAllSaves()      pick such a file; each save in it becomes a new save (none is loaded)

import { load, putSave, saveList, type SaveGame } from '../saveload.js'
import { hideMainMenu, isMainMenuVisible } from '../uiMainMenu.js'

// console commands are free-form globals
const devWindow = window as unknown as Record<string, unknown>

function listSaves(): Promise<SaveGame[]> {
    return new Promise((resolve) => saveList(resolve))
}

function newest(saves: SaveGame[]): SaveGame | undefined {
    return saves.reduce<SaveGame | undefined>((a, b) => (!a || b.timestamp > a.timestamp ? b : a), undefined)
}

// <name>_<date>.dh2save.json: the save's own date and time, so exports of two saves with the same
// name (or of one save that was overwritten later) never get the same file name
function fileName(save: SaveGame): string {
    const base = save.name.replace(/[^\w.-]+/g, '_') || 'save'
    const d = new Date(save.timestamp)
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
    return `${base}_${stamp}.dh2save.json`
}

async function exportSave(which?: string | number): Promise<void> {
    const saves = await listSaves()
    const pool =
        which === undefined
            ? saves
            : typeof which === 'number'
              ? saves.filter((s) => s.id === which)
              : saves.filter((s) => s.name === which)
    const save = newest(pool)
    if (!save) {
        console.log(
            `[Save] no save ${which === undefined ? 'found' : JSON.stringify(which)}; saves: ` +
                saves.map((s) => `${s.id} '${s.name}'`).join(', '),
        )
        return
    }
    const blob = new Blob([JSON.stringify(save)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName(save)
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    console.log(`[Save] exported #${save.id} '${save.name}' (${save.currentMap}) as ${a.download}`)
}

function pickFile(): Promise<string> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json,application/json'
        input.onchange = () => {
            const file = input.files?.[0]
            if (!file) {
                reject(new Error('no file chosen'))
                return
            }
            file.text().then(resolve, reject)
        }
        input.click()
    })
}

function isSave(v: unknown): v is SaveGame {
    const s = v as Partial<SaveGame> | null
    return (
        !!s && typeof s === 'object' && typeof s.name === 'string' && typeof s.currentMap === 'string' && !!s.savedMaps
    )
}

async function importSave(arg1?: boolean | string, arg2?: boolean): Promise<void> {
    const url = typeof arg1 === 'string' ? arg1 : undefined
    const loadIt = (typeof arg1 === 'boolean' ? arg1 : arg2) !== false
    let text: string
    if (url) {
        const response = await fetch(url, { cache: 'no-cache' })
        if (!response.ok) {
            console.log(`[Save] ${url}: HTTP ${response.status}`)
            return
        }
        text = await response.text()
    } else {
        text = await pickFile()
    }
    const save: unknown = JSON.parse(text)
    if (!isSave(save)) {
        console.log('[Save] not a DarkHarold2 save file')
        return
    }
    const id = await new Promise<number>((resolve) => putSave(save, resolve))
    console.log(`[Save] imported '${save.name}' (${save.currentMap}) as save #${id}`)
    if (loadIt) {
        if (isMainMenuVisible()) {
            hideMainMenu()
        }
        load(id)
    }
}

// ─── All saves at once ──────────────────────────────────────────────────────
// One line of JSON per save (a header line first) — a single JSON text of all saves (30-40 MB
// each in a long game) would be too large a string to build or parse; gzip-compressed.

const ALL_FORMAT = 'dh2-saves'

async function exportAllSaves(): Promise<void> {
    const saves = (await listSaves()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    if (saves.length === 0) {
        console.log('[Save] no saves to export')
        return
    }
    const parts: string[] = [JSON.stringify({ format: ALL_FORMAT, version: 1, count: saves.length }) + '\n']
    for (const s of saves) {
        parts.push(JSON.stringify(s) + '\n')
    }
    const plain = new Blob(parts, { type: 'application/x-ndjson' })
    const gz = await new Response(plain.stream().pipeThrough(new CompressionStream('gzip'))).blob()
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const name = `dh2saves_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.jsonl.gz`
    const url = URL.createObjectURL(gz)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    console.log(
        `[Save] exported ${saves.length} saves as ${name} (${(plain.size / 1e6).toFixed(0)} MB, ${(gz.size / 1e6).toFixed(0)} MB gzipped)`,
    )
}

function pickBlob(): Promise<File> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.gz,.jsonl,.ndjson,.json'
        input.onchange = () => {
            const file = input.files?.[0]
            if (file) {
                resolve(file)
            } else {
                reject(new Error('no file chosen'))
            }
        }
        input.click()
    })
}

async function importAllSaves(url?: string): Promise<number> {
    let blob: Blob
    if (url) {
        const response = await fetch(url, { cache: 'no-cache' })
        if (!response.ok) {
            console.log(`[Save] ${url}: HTTP ${response.status}`)
            return 0
        }
        blob = await response.blob()
    } else {
        blob = await pickBlob()
    }
    // gzip by its magic bytes (1f 8b), else plain lines
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
    let stream: ReadableStream = blob.stream()
    if (head[0] === 0x1f && head[1] === 0x8b) {
        stream = stream.pipeThrough(new DecompressionStream('gzip'))
    }
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader()
    let rest = ''
    let lineNo = 0
    let imported = 0
    const take = async (line: string): Promise<void> => {
        lineNo++
        if (!line.trim()) {
            return
        }
        const v: unknown = JSON.parse(line)
        if (lineNo === 1) {
            if ((v as { format?: string }).format !== ALL_FORMAT) {
                throw new Error('not a DarkHarold2 saves file')
            }
            return
        }
        if (!isSave(v)) {
            return
        }
        const id = await new Promise<number>((resolve) => putSave(v, resolve))
        imported++
        console.log(`[Save] imported '${v.name}' (${v.currentMap}) as save #${id}`)
    }
    for (;;) {
        const { value, done } = await reader.read()
        if (value) {
            rest += value
        }
        let nl: number
        while ((nl = rest.indexOf('\n')) >= 0) {
            const line = rest.slice(0, nl)
            rest = rest.slice(nl + 1)
            await take(line)
        }
        if (done) {
            break
        }
    }
    if (rest) {
        await take(rest)
    }
    console.log(`[Save] ${imported} saves imported`)
    return imported
}

export function registerSaveFileCommands(): void {
    devWindow.exportSave = exportSave
    devWindow.importSave = importSave
    devWindow.exportAllSaves = exportAllSaves
    devWindow.importAllSaves = importAllSaves
}
