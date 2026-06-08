/*
Copyright 2014 darkf, Stratege
Copyright 2015 darkf

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// Barrel — critter module. Split per wiki/ts-split-refactor.md §13 into:
//   critter/Weapon.ts    — Weapon class + attack-mode/skin/damage-type
//                          constants + UnarmedMove table.
//   critter/lifecycle.ts — critterKill, critterDamage,
//                          deathAnimForDamageType, killCounts.
//
// Dead helpers (critterGetRawStat/critterSetRawSkill quartet) were dropped
// during the split — they were only referenced internally with TODO warnings.

export { Weapon, UnarmedMove, UNARMED_MOVES, getAvailableUnarmedMoves } from './critter/Weapon.js'
export { critterKill, critterDamage, deathAnimForDamageType, killCounts } from './critter/lifecycle.js'
