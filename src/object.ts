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

// Barrel — object module. Split per wiki/ts-split-refactor.md §2 into:
//   object/Obj.ts              — Obj base class, SerializedObj interface,
//                                top-of-file helpers (cloneItem, zsort,
//                                objectIsWeapon, objectUnjamAll, etc.).
//   object/items.ts            — Item / WeaponObj / Scenery / Door subclasses.
//   object/factories.ts        — createObjectWithPID / objFromMapObject /
//                                deserializeObj PID-dispatch factory functions.
//   object/Critter.ts          — Critter class minus the FRM animation state
//                                machine; combat/skill/armor accessors,
//                                walkTo/walkInFrontOf/move, serialize.
//   object/critterAnimation.ts — FRM animation state machine attached to
//                                Critter.prototype via TS declaration merging
//                                (getAnimation, staticAnimation, updateAnim,
//                                clearAnim, playWeaponSwapAnim, etc.).

export { Obj, SerializedObj, objectIsWeapon, cloneItem, objectGetDamageType, objectUnjamAll, zsort, hitSpatialTrigger, setObjectOpen, toggleObjectOpen } from './object/Obj.js'
export { Item, WeaponObj, Scenery, Door } from './object/items.js'
export { createObjectWithPID, objFromMapObject, deserializeObj } from './object/factories.js'
export { Critter, SerializedCritter, SERIALIZED_CRITTER_PROPS } from './object/Critter.js'

// Import for side effects — attaches animation state machine to Critter.prototype.
import './object/critterAnimation.js'
