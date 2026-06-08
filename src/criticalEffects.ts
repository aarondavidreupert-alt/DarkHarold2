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

// Critical Effects system.
// Barrel — see wiki/ts-split-refactor.md → "Per-file split proposals" §22.

import { regionHitChanceDecTable as _regionHitChanceDecTable } from './criticalEffects/effects.js'
import {
    getCritical as _getCritical,
    getCriticalFail as _getCriticalFail,
    loadTable as _loadTable,
    criticalFailTable as _criticalFailTable,
    temporaryDoCritFail as _temporaryDoCritFail,
} from './criticalEffects/table.js'

export module CriticalEffects {
    export const regionHitChanceDecTable = _regionHitChanceDecTable
    export const getCritical = _getCritical
    export const getCriticalFail = _getCriticalFail
    export const loadTable = _loadTable
    export const criticalFailTable = _criticalFailTable
    export const temporaryDoCritFail = _temporaryDoCritFail
}
