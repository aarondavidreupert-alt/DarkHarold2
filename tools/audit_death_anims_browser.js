// Browser-console audit: check which violent-death animations are registered
// in the live globalState.imageInfo at runtime.
//
// Usage:
//   1. Load play.html in the browser
//   2. Open DevTools → Console
//   3. Paste this entire file and hit Enter
//   4. Output is logged + assigned to window.__deathAuditResult
//
// Complements tools/audit_death_anims.py which checks the filesystem.
// This script checks what the engine actually thinks is loadable.

(function () {
    const DEATH_SUFFIXES = [
        ['bo', 'death (normal)'],
        ['bl', 'death-explode'],
        ['be', 'death-fire'],
        ['bm', 'death-plasma'],
        ['bk', 'death-electro'],
        ['bg', 'death-laser'],
        ['bj', 'death-burst'],
    ]

    const info = (window.globalState && window.globalState.imageInfo) || null
    if (!info) {
        console.error('[death-audit] globalState.imageInfo not found — game not loaded?')
        return
    }

    // Find all critter bases by scanning for *aa keys under art/critters/
    const allKeys = Object.keys(info)
    const idlePattern = /^art\/critters\/(.+?)aa$/i
    const bases = new Set()
    for (const k of allKeys) {
        const m = idlePattern.exec(k)
        if (m) bases.add(m[1])
    }

    const sortedBases = Array.from(bases).sort()
    console.log(`[death-audit] registered imageInfo entries: ${allKeys.length}`)
    console.log(`[death-audit] critter bases found:          ${sortedBases.length}`)

    const rows = []
    let missingTotal = 0

    for (const base of sortedBases) {
        const row = { base }
        let problems = 0
        for (const [suffix, label] of DEATH_SUFFIXES) {
            const key = `art/critters/${base}${suffix}`
            const present = key in info
            row[suffix] = present ? 'OK' : 'MISS'
            if (!present) {
                problems++
                missingTotal++
            }
        }
        row._problems = problems
        rows.push(row)
    }

    // Build a printable table
    const header = ['critter base', ...DEATH_SUFFIXES.map(([s]) => s)]
    const tableData = {}
    for (const r of rows) {
        const display = {}
        for (const [s] of DEATH_SUFFIXES) display[s] = r[s]
        tableData[r.base] = display
    }

    console.log('[death-audit] per-critter death anim availability:')
    console.table(tableData)

    const problemRows = rows.filter(r => r._problems > 0)
    console.log(`[death-audit] critters with at least one missing death anim: ${problemRows.length} / ${rows.length}`)
    console.log(`[death-audit] total missing death-anim registrations:        ${missingTotal}`)

    if (problemRows.length > 0) {
        console.log('[death-audit] problem critters:')
        for (const r of problemRows) {
            const missing = DEATH_SUFFIXES.filter(([s]) => r[s] === 'MISS').map(([s, l]) => `${s} (${l})`)
            console.log(`  ${r.base}  →  missing: ${missing.join(', ')}`)
        }
    } else {
        console.log('[death-audit] no missing death-anim registrations. Black-tile bug is likely in code.')
    }

    window.__deathAuditResult = {
        totalCritters: rows.length,
        problemCritters: problemRows.length,
        missingTotal,
        rows,
    }
    console.log('[death-audit] result also stored at window.__deathAuditResult')
})()
