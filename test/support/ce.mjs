// Helpers for tests that take their expected values from the fallout2-ce sources vendored under
// raw/fallout2-ce/src (wiki/code_quality.md Q2: expected values come from CE, never from running
// the DH2 code).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CE_SRC = fileURLToPath(new URL('../../raw/fallout2-ce/src/', import.meta.url))

/** The text of a CE source file, e.g. ceSource('skill.cc'). */
export function ceSource(name) {
    return readFileSync(CE_SRC + name, 'utf8')
}

/** C integer division (truncates toward zero). */
export function cdiv(a, b) {
    return Math.trunc(a / b)
}
