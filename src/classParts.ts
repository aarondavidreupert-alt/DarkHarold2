// Copyright 2026 DarkHarold2 contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Installs the methods of the split classes (wiki/code_quality.md Q16) on their prototypes: Script's
// opcodes, Combat's and Obj's topic files. The class modules only import their types, so they do not
// depend on these files, which import half the engine (Q14). Imported first by main.ts (and by the
// pages that load the engine without it, luaDiff.ts).
import { installMethods } from './installMethods.js'
import { Script } from './scripting.js'
import { coreOpcodes } from './scripting/opcodes/core.js'
import { metaruleOpcodes } from './scripting/opcodes/metarule.js'
import { critterOpcodes } from './scripting/opcodes/critter.js'
import { inventoryOpcodes } from './scripting/opcodes/inventory.js'
import { objectsOpcodes } from './scripting/opcodes/objects.js'
import { mapOpcodes } from './scripting/opcodes/map.js'
import { animOpcodes } from './scripting/opcodes/anim.js'
import { dialogueOpcodes } from './scripting/opcodes/dialogue.js'
import { combatOpcodes } from './scripting/opcodes/combat.js'
import { sfallOpcodes } from './scripting/opcodes/sfall.js'
import { Combat } from './combat/Combat.js'
import { combatAttackMethods } from './combat/combatAttack.js'
import { combatDisplayMethods } from './combat/combatDisplay.js'
import { combatProjectileMethods } from './combat/combatProjectiles.js'
import { combatAiTurnMethods } from './combat/combatAiTurn.js'
import { combatAiActionMethods } from './combat/combatAiActions.js'
import { Obj } from './object/Obj.js'
import { objUseMethods } from './object/objUse.js'

installMethods(
    Script.prototype,
    coreOpcodes,
    metaruleOpcodes,
    critterOpcodes,
    inventoryOpcodes,
    objectsOpcodes,
    mapOpcodes,
    animOpcodes,
    dialogueOpcodes,
    combatOpcodes,
    sfallOpcodes,
)
installMethods(
    Combat.prototype,
    combatAttackMethods,
    combatDisplayMethods,
    combatProjectileMethods,
    combatAiTurnMethods,
    combatAiActionMethods,
)
installMethods(Obj.prototype, objUseMethods)
