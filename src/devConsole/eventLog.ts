// Combat log console commands (README → "Combat Log"): exportEventLog(tier) and
// __eventLog. Registered for every page load, not only play.html#dev.

import globalState from '../globalState.js'

export function registerEventLogCommands(): void {
    // Convenience alias so DevTools users can grab the structured event log
    // without typing globalState.eventLog every time.
    Object.defineProperty(window, '__eventLog', {
        get: () => globalState.eventLog,
        configurable: true,
    })
    // Download globalState.eventLog as a timestamped JSON file.
    // tier "summary"    — round/turn/actor/action/result/damage only
    // tier "full"       — all useful fields, formula internals omitted (default)
    // tier "diagnostic" — every field, unfiltered
    ;(window as any).exportEventLog = (tier: 'summary' | 'full' | 'diagnostic' = 'full') => {
        const SUMMARY_FIELDS = new Set(['round', 'turn', 'actor', 'action', 'result', 'damage'])
        const FULL_OMIT = new Set(['RD', 'DT', 'DR', 'CD', 'ammoX', 'ammoY', 'critMultiplier', 'critChance'])

        const filtered = globalState.eventLog.map(entry => {
            if (tier === 'diagnostic') return entry
            if (tier === 'summary') {
                const out: Record<string, any> = {}
                for (const k of SUMMARY_FIELDS) {
                    if (k in entry && (k !== 'damage' || (entry[k] as number) > 0)) {
                        out[k] = entry[k]
                    }
                }
                return out
            }
            // full
            const out: Record<string, any> = {}
            for (const k of Object.keys(entry)) {
                if (!FULL_OMIT.has(k)) out[k] = entry[k]
            }
            return out
        })

        const json = JSON.stringify(filtered, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `eventLog_${tier}_${Date.now()}.json`
        a.click()
        URL.revokeObjectURL(url)
    }
}
