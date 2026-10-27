/*
Copyright 2014 darkf

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

// Random Encounter system. Barrel — see wiki/ts-split-refactor.md →
// "Per-file split proposals" §20.

import { Node as _Node, parseConds as _parseConds, evalConds as _evalConds } from './encounters/conditionLang.js'

// The encounter condition language of worldmap.txt ("If(...) And If(...)"); the
// encounters themselves are worldmap/encounterData.ts + worldmap/encounters.ts.
export type Node = _Node
export const parseConds = _parseConds
export const evalConds = _evalConds
