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

// Barrel — combat system split into combat/{actionPoints,damage,AI,hitChance,Combat}.ts
// See wiki/ts-split-refactor.md §4 for the split rationale.

export { ActionPoints } from './combat/actionPoints.js'
export { AI } from './combat/AI.js'
export { Combat, isCombatActive } from './combat/Combat.js'
