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

// Barrel — character screen + creator.
// Split into:
//   uiCharacter/descriptions.ts  — lookup tables (SPECIAL/SKILL/DERIVED/
//                                   CONDITION/TRAIT/PERK descriptions + images)
//   uiCharacter/viewer.ts        — showCharacterScreen() (in-game read-only)
//   uiCharacter/creator.ts       — showCharacterCreator() (new-game flow)
//   uiCharacter/perkModal.ts     — showPerkModal() (level-up perk picker)

export { showCharacterScreen, closeCharacterScreen, getCharacterWindow } from './uiCharacter/viewer.js'
export { showCharacterCreator, CreatorInitialState } from './uiCharacter/creator.js'
export { STATS, SKILLS, TRAITS_BY_ID } from './uiCharacter/descriptions.js'
export { showPerkModal } from './uiCharacter/perkModal.js'
