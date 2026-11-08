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

function fileName(save: SaveGame): string {
    const base = save.name.replace(/[^\w.-]+/g, '_') || 'save'
    return `${base}.dh2save.json`
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

export function registerSaveFileCommands(): void {
    devWindow.exportSave = exportSave
    devWindow.importSave = importSave
}
