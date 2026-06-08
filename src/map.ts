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

// Barrel — `GameMap` class. Split per wiki/ts-split-refactor.md §9 into:
//   map/GameMap.ts   — class core: object lists, elevation switch, party
//                      placement, removal queue, tile helpers, serialize
//   map/mapLoader.ts — loadMap / loadNewMap / loadMapByID (mixed onto
//                      GameMap.prototype) + JSON fetch / dirty-cache /
//                      doEnterNewMap callout
//
// Importing this barrel pulls in mapLoader.ts for its prototype-augmentation
// side effects, so callers that go through it see the full GameMap surface.

import './map/mapLoader.js'

export { GameMap, SerializedMap, SerializedSpatial } from './map/GameMap.js'
