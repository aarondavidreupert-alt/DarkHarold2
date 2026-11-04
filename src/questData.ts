// Quest and holodisk tables for the Pip-Boy STATUS page.
// CE ref: pipboy.cc questInit — data/quests.txt (location, description, gvar, display
// threshold, completed threshold), sorted by location (questDescriptionCompare); the texts
// are quests.msg, the location names map.msg. pipboy.cc holodiskInit — data/holodisk.txt
// (gvar, title, text), the title and text lines in pipboy.msg.

import { getFileText, getMessage } from './util.js'

export interface QuestDef {
    location: string
    locationId: number
    descMsgId: number
    description: string
    gvarIndex: number
    displayThreshold: number
    completedThreshold: number
}

export interface HolodiskDef {
    gvar: number
    name: number // pipboy.msg id of the title
    description: number // pipboy.msg id of the first text line
}

// CE fileReadString + strtok(" \t,"): '#' lines skipped, the first N numbers of a line.
function readNumberTable(path: string, columns: number): number[][] {
    let text = ''
    try {
        text = getFileText(path)
    } catch {
        return []
    }
    const rows: number[][] = []
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (line === '' || line.startsWith('#')) continue
        const toks = line.split(/[ \t,]+/).filter((t) => t !== '')
        if (toks.length < columns) continue
        rows.push(toks.slice(0, columns).map((t) => parseInt(t, 10) || 0))
    }
    return rows
}

let quests: QuestDef[] | null = null
let holodisks: HolodiskDef[] | null = null

export function getQuestDefs(): QuestDef[] {
    if (quests) return quests
    quests = readNumberTable('data/data/quests.txt', 5)
        .map(([locationId, descMsgId, gvarIndex, displayThreshold, completedThreshold]) => ({
            location: getMessage('map', locationId) ?? `Location ${locationId}`,
            locationId,
            descMsgId,
            description: getMessage('quests', descMsgId) ?? `Quest ${descMsgId}`,
            gvarIndex,
            displayThreshold,
            completedThreshold,
        }))
        .sort((a, b) => a.locationId - b.locationId)
    return quests
}

export function getHolodiskDefs(): HolodiskDef[] {
    if (!holodisks)
        holodisks = readNumberTable('data/data/holodisk.txt', 3).map(([gvar, name, description]) => ({
            gvar,
            name,
            description,
        }))
    return holodisks
}

// Set of all GVAR indices used by quest definitions, for the debug
// "unknown active GVARs" section.
export function getQuestGvarSet(): Set<number> {
    return new Set(getQuestDefs().map((q) => q.gvarIndex))
}
