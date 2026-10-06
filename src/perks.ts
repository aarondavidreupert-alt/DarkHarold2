// FO2-CE ref: src/perk.h (PERK_* enum), src/perk.cc (perk data tables)
// Perk registry: definitions, requirement checking, and application.
// Barrel — see wiki/ts-split-refactor.md → "Per-file split proposals" §11.

export { PerkDef, PERKS } from './perks/perks.data.js'
export { getValidPerks, getPerkRank, applyPerk } from './perks/perks.js'

// CE perk index (perk_defs.h Perk enum, 0..118) -> display name, from perk.msg 101 + id
// (CE perk.cc perkGetName). Scripts address perks by CE index; DH2 stores perk names.
import { getMessage } from './util.js'
export function perkNameById(id: number): string | null {
    if (!(id >= 0 && id < 119)) return null
    return getMessage('perk', 101 + id)
}
