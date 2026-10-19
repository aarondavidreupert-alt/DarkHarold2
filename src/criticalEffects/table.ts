/*
Copyright 2014-2015 darkf, Stratege

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

// The critical hit tables are CE's own (criticalEffects/ceTables.ts, generated from
// fallout2-ce combat.cc gCriticalHitTables / gPlayerCriticalHitTable). The old
// lut/criticalTables.json decode mislabelled DAM_BYPASS as "lose next turn" and
// dropped DAM_LOSE_TURN, so it is no longer read.

export { CRITICAL_HIT_TABLES, PLAYER_CRITICAL_HIT_TABLE } from './ceTables.js'

// Kept for init.ts: the tables are compiled in, nothing to load.
export function loadTable(): void {}
