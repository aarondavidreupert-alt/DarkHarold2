// Quest log logic: reads GVARs and matches them against the quest definition
// table to produce a structured list of active/completed quests for display
// in the PipBoy ARCHIVES tab.

import { Scripting } from './scripting.js'
import { questDefs, questGvarSet, type QuestDef } from './questData.js'

export interface ActiveQuest {
    location: string
    description: string
    gvarIndex: number
    gvarValue: number
    isCompleted: boolean
}

// Returns all quests whose backing GVAR has reached the display threshold.
// Quests are returned in definition order (Arroyo first, Navarro last).
export function getActiveQuests(): ActiveQuest[] {
    const gvars = Scripting.getGlobalVars()
    const result: ActiveQuest[] = []

    for (const q of questDefs) {
        const val = Number(gvars[q.gvarIndex] ?? 0)
        if (val >= q.displayThreshold) {
            result.push({
                location: q.location,
                description: q.description,
                gvarIndex: q.gvarIndex,
                gvarValue: val,
                isCompleted: val >= q.completedThreshold,
            })
        }
    }

    return result
}

// Non-zero GVARs that don't belong to any quest definition. Useful for
// debugging script state that isn't surfaced in the quest log.
export function getUnknownActiveGvars(): { index: number; value: number }[] {
    const gvars = Scripting.getGlobalVars()
    const result: { index: number; value: number }[] = []

    for (const k in gvars) {
        const idx = Number(k)
        const val = Number(gvars[k])
        if (val !== 0 && !questGvarSet.has(idx)) {
            result.push({ index: idx, value: val })
        }
    }

    return result
}
