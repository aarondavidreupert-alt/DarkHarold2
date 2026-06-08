// FO2-CE ref: src/perk.h (PERK_* enum), src/perk.cc (perk data tables)
// Perk registry: definitions, requirement checking, and application.
// Barrel — see wiki/ts-split-refactor.md → "Per-file split proposals" §11.

export { PerkDef, PERKS } from './perks/perks.data.js'
export { getValidPerks, getPerkRank, applyPerk } from './perks/perks.js'
