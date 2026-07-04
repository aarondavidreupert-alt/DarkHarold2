// Copyright 2014-2022 darkf
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

// Proto (.pro) type definitions — field-for-field mirror of
// tools/proto.py::readPRO()/readItem()/readCritter()/readScenery()/
// readWall()/readTile()/readMisc(). CE ref: raw/fallout2-ce/src/proto.cc
// protoRead(), proto_types.h structs. Verified against the Python extractor
// during the PS2/PS3/PS4 (2026-07-04) and Q-any (2026-07-04) audit passes —
// see wiki/proto_system.md.

export const PROTO_TYPE_ITEM = 0
export const PROTO_TYPE_CRITTER = 1
export const PROTO_TYPE_SCENERY = 2
export const PROTO_TYPE_WALL = 3
export const PROTO_TYPE_TILE = 4
export const PROTO_TYPE_MISC = 5

export const ITEM_SUBTYPE_ARMOR = 0
export const ITEM_SUBTYPE_CONTAINER = 1
export const ITEM_SUBTYPE_DRUG = 2
export const ITEM_SUBTYPE_WEAPON = 3
export const ITEM_SUBTYPE_AMMO = 4
export const ITEM_SUBTYPE_MISC = 5
export const ITEM_SUBTYPE_KEY = 6

export const SCENERY_SUBTYPE_DOOR = 0
export const SCENERY_SUBTYPE_STAIRS = 1
export const SCENERY_SUBTYPE_ELEVATOR = 2
export const SCENERY_SUBTYPE_LADDER_BOTTOM = 3
export const SCENERY_SUBTYPE_LADDER_TOP = 4
export const SCENERY_SUBTYPE_GENERIC = 5

// --- Item extra --------------------------------------------------------

export interface DrugEffect {
    duration: number
    amount0: number
    amount1: number
    amount2: number
}

// Fields common to every item subtype (tools/proto.py readItem(), read
// before the subType branch).
export interface ItemProtoExtraBase {
    itemFlags: number
    actionFlags: number
    weaponFlags: number
    attackMode: number
    scriptID: number
    subType: number
    materialID: number
    size: number
    weight: number
    cost: number
    invFRM: number
    soundID: number
}

export interface WeaponProtoExtra extends ItemProtoExtraBase {
    subType: 3 // ITEM_SUBTYPE_WEAPON
    animCode: number
    minDmg: number
    maxDmg: number
    dmgType: number
    maxRange1: number
    maxRange2: number
    projPID: number
    minST: number
    APCost1: number
    APCost2: number
    critFail: number
    perk: number
    rounds: number
    caliber: number
    ammoPID: number
    maxAmmo: number
}

export interface AmmoProtoExtra extends ItemProtoExtraBase {
    subType: 4 // ITEM_SUBTYPE_AMMO
    caliber: number
    quantity: number // CE: ammo capacity per box — see wiki/economy.md L3
    'AC modifier': number
    'DR modifier': number
    damMult: number
    damDiv: number
}

// CE ref: proto_types.h ArmorProtoData DR/DT arrays — keyed here by the same
// "DR X"/"DT X" strings CritterStatsBlock uses (tools/proto.py readItem()
// SUBTYPE_ARMOR, matching readCritterStats()'s DT/DR block byte-for-byte).
export interface ArmorStats {
    'DR Normal': number
    'DR Laser': number
    'DR Fire': number
    'DR Plasma': number
    'DR Electrical': number
    'DR EMP': number
    'DR Explosive': number
    'DT Normal': number
    'DT Laser': number
    'DT Fire': number
    'DT Plasma': number
    'DT Electrical': number
    'DT EMP': number
    'DT Explosive': number
}

export interface ArmorProtoExtra extends ItemProtoExtraBase {
    subType: 0 // ITEM_SUBTYPE_ARMOR
    AC: number
    stats: ArmorStats
    perk: number
    maleFID: number
    femaleFID: number
}

export interface DrugProtoExtra extends ItemProtoExtraBase {
    subType: 2 // ITEM_SUBTYPE_DRUG
    stat0: number
    stat1: number
    stat2: number
    amount0: number
    amount1: number
    amount2: number
    firstDelayed: DrugEffect
    secondDelayed: DrugEffect
    addictionRate: number
    addictionEffect: number
    addictionOnset: number
}

// Container / Key / Misc-subtype items: tools/proto.py readItem() has no
// branch for these subtypes ("unhandled item subtype") — only the base
// fields above are populated.
export interface OtherItemProtoExtra extends ItemProtoExtraBase {
    subType: 1 | 5 | 6 // CONTAINER | MISC | KEY
}

export type ItemProtoExtra =
    | WeaponProtoExtra
    | AmmoProtoExtra
    | ArmorProtoExtra
    | DrugProtoExtra
    | OtherItemProtoExtra

// --- Critter extra -------------------------------------------------------

// CE ref: proto_types.h CritterProtoData baseStats/bonusStats — 17 base
// stats + 16 DT/DR stats, keyed by name (tools/proto.py readCritterStats()).
export interface CritterStatsBlock {
    STR: number
    PER: number
    END: number
    CHR: number
    INT: number
    AGI: number
    LUK: number
    HP: number
    AP: number
    AC: number
    Unarmed: number
    Melee: number
    Carry: number
    Sequence: number
    'Healing Rate': number
    'Critical Chance': number
    'Better Criticals': number
    'DT Normal': number
    'DT Laser': number
    'DT Fire': number
    'DT Plasma': number
    'DT Electrical': number
    'DT EMP': number
    'DT Explosive': number
    'DR Normal': number
    'DR Laser': number
    'DR Fire': number
    'DR Plasma': number
    'DR Electrical': number
    'DR EMP': number
    'DR Explosive': number
    'DR Radiation': number
    'DR Poison': number
}

export interface CritterSkillsBlock {
    'Small Guns': number
    'Big Guns': number
    'Energy Weapons': number
    Unarmed: number
    Melee: number
    Throwing: number
    'First Aid': number
    Doctor: number
    Sneak: number
    Lockpick: number
    Steal: number
    Traps: number
    Science: number
    Repair: number
    Speech: number
    Barter: number
    Gambling: number
    Outdoorsman: number
}

export interface CritterProtoExtra {
    actionFlags: number
    scriptID: number
    headFID: number
    AI: number
    team: number
    flags: number
    baseStats: CritterStatsBlock
    age: number
    gender: number
    bonusStats: CritterStatsBlock
    bonusAge: number
    bonusGender: number
    skills: CritterSkillsBlock
    bodyType: number
    XPValue: number
    killType: number
    // CE ref: critter.cc:1064-1091 — 0 (DAMAGE_TYPE_NORMAL) on the 2 vanilla
    // protos (Sentry Bot, Weak Brahmin) that are 4 bytes short; see PS2.
    damageType: number
}

// --- Scenery extra ---------------------------------------------------------

interface SceneryProtoExtraBase {
    extendedFlags: number
    scriptPID: number
    subType: number
    materialID: number
    soundID: number
}

export interface DoorSceneryExtra extends SceneryProtoExtraBase {
    subType: 0 // SCENERY_SUBTYPE_DOOR
    walkthroughFlag: number
}

export interface StairsSceneryExtra extends SceneryProtoExtraBase {
    subType: 1 // SCENERY_SUBTYPE_STAIRS
    destination: number
    destinationMap: number
}

export interface ElevatorSceneryExtra extends SceneryProtoExtraBase {
    subType: 2 // SCENERY_SUBTYPE_ELEVATOR
    elevatorType: number
    elevatorLevel: number
}

export interface LadderSceneryExtra extends SceneryProtoExtraBase {
    subType: 3 | 4 // LADDER_BOTTOM | LADDER_TOP
    destination: number
}

export interface GenericSceneryExtra extends SceneryProtoExtraBase {
    subType: 5 // SCENERY_SUBTYPE_GENERIC
}

export type SceneryProtoExtra =
    | DoorSceneryExtra
    | StairsSceneryExtra
    | ElevatorSceneryExtra
    | LadderSceneryExtra
    | GenericSceneryExtra

// --- Wall / Tile / Misc extra -----------------------------------------------

// Wall and Tile share the same 3-field shape (tools/proto.py readWall()/
// readTile()); kept as separate types since they come from different proto
// subdirs and TileProto's *parent* Proto lacks lightDistance/lightIntensity
// (see PS3 — the two are otherwise identical here).
export interface WallProtoExtra {
    extendedFlags: number
    scriptID: number
    material: number
}

export interface TileProtoExtra {
    extendedFlags: number
    scriptID: number
    material: number
}

export interface MiscProtoExtra {
    extendedFlags: number
}

// --- Top-level Proto ---------------------------------------------------------

export type ProtoExtra =
    | ItemProtoExtra
    | CritterProtoExtra
    | SceneryProtoExtra
    | WallProtoExtra
    | TileProtoExtra
    | MiscProtoExtra

// CE ref: proto.cc:1663 protoRead() — the true common prefix across every
// proto type is only pid/messageId(textID)/fid(frmPID+frmType); flags/
// lightDistance/lightIntensity are read per-type inside the dispatch switch
// and happen to share this order for items/critters/scenery/walls/misc, but
// TileProto omits lightDistance/lightIntensity entirely (proto.cc:1719 case
// OBJ_TYPE_TILE reads flags first) — see PS3. Modelled here as optional so
// both shapes typecheck without a second interface.
export interface Proto {
    pid: number
    textID: number
    type: number // 0-5, objType from readPRO() — see PROTO_TYPE_* above
    frmPID: number
    frmType: number
    flags: number
    // CE ref: proto_types.h `lightDistance` (light_distance). Was named
    // "lightRadius" in tools/proto.py — a DH2-invented name matching no CE
    // field and no TS consumer — until the 2026-07-04 Q-any pass renamed it
    // to match CE and scripting.ts's proto_data() LIGHT_DISTANCE case, which
    // had been silently reading a nonexistent key (always `?? 0`) since it
    // was written. Requires a pipeline re-run to take effect on real assets.
    lightDistance?: number // absent when type === PROTO_TYPE_TILE
    lightIntensity?: number // absent when type === PROTO_TYPE_TILE
    // Deliberately `any`, not `ProtoExtra`: narrowing this field to the real
    // union would force every one of the ~230 `.pro.extra.*` call sites
    // across ~30 files (Weapon.ts, Critter.ts, Combat.ts, ui_inventory/*,
    // scripting.ts, ...) to add a type guard or cast in the same change,
    // since TypeScript offers no partial-adoption path once a field becomes
    // a discriminated union — a much larger, higher-risk effort than a type-
    // hygiene pass (see ROADMAP.md Q-any). The ProtoExtra union above is
    // fully verified against tools/proto.py and ready for incremental
    // per-file adoption (e.g. `weaponObj.pro.extra as WeaponProtoExtra`)
    // wherever a caller already knows its own obj.type from context.
    extra: any
}
