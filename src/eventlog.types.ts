// Shared types for the structured event log.
// Kept in a separate file so neither logger.ts nor globalState.ts
// needs to import from the other just to share these interfaces.

export interface EventLogEntry {
    /** Combat round number (full cycle through combatants); 0 outside combat. */
    round: number
    /** Sequential turn counter inside the active Combat instance. */
    turn: number
    /** Who acted (display name, "you" for the player), or null for engine events. */
    actor: string | null
    /** Short action key — e.g. 'attack-roll', 'damage', 'ai-decision', 'turn-begin'. */
    action: string
    /** Target of the action, if applicable. */
    target?: string | null
    /** Outcome summary — 'hit', 'miss', 'crit', 'dead', 'flee', etc. */
    result?: string
    /** Free-form message for human consumption. */
    message?: string
    /** Wall-clock time the entry was recorded. */
    timestamp: number
    /** Numerics and other context (damage, hitChance, roll, AP, distance...). */
    [k: string]: any
}

export type EventLogInput = Omit<EventLogEntry, 'round' | 'turn' | 'timestamp'> &
    Partial<Pick<EventLogEntry, 'round' | 'turn' | 'timestamp'>>
