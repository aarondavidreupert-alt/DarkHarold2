// AutoCrawler — pure types/enums/interfaces for the test harness.
// Behaviour-bearing logic lives in the sibling sub-files.

import type { EventLogEntry } from '../logger.js'

export type DialogueStatus =
    | 'ok'
    | 'no-talk-proc'
    | 'no-adjacent-tile'
    | 'exception-on-talk'
    | 'no-dialogue'          // talk proc ran; UIMode confirmed none within polling window
    | 'stuck-no-dialogue'    // hit 5 s cap with UIMode never reaching none or dialogue
    | 'combat-triggered'
    | 'stuck-no-options'
    | 'exception-on-click'
    | 'stuck-max-clicks'
    | 'stuck-no-exit'

export type CombatStatus =
    | 'ok'
    | 'no-valid-ai'
    | 'no-adjacent-tile'
    | 'stuck-combat-active'
    | 'exception-on-start'
    | 'stuck-no-combat'
    | 'stuck-player-turn-timeout'
    | 'stuck-ai-turn-timeout'
    | 'exception-in-combat'

export type MapStatus = 'ok' | 'load-timeout' | 'exception' | 'player-missing'

export interface MapResult {
    map: string
    status: MapStatus
    durationMs: number
    error?: string
    // Populated only for non-ok results to keep ok entries compact.
    stack?: string
    eventLog?: EventLogEntry[]
}

export interface DialogueNpcResult {
    uid: number
    name: string
    tileNum: number
    status: DialogueStatus
    optionsSeen: number
    optionLabels: string[]
    replies: string[]
    durationMs: number
    error?: string
}

export interface CombatCritterResult {
    uid: number
    name: string
    tileNum: number
    status: CombatStatus
    turnsObserved: number
    aiBailout: boolean
    durationMs: number
    error?: string
    notes?: string
}

export interface CrawlerSummary {
    total: number
    ok: number
    stuck: number
    exceptions: number
    combatTriggered?: number
    noDialogue?: number
    timeout?: number
    playerMissing?: number
}

export interface CrawlerReport {
    map: string
    type: 'dialogue' | 'combat' | 'maps'
    timestamp: number
    results: DialogueNpcResult[] | CombatCritterResult[] | MapResult[]
    summary: CrawlerSummary
    // Map crawler only: non-ok results surfaced at the top of the JSON so
    // an LLM or human can jump to failures without scanning all 150+ results.
    failures?: MapResult[]
}
