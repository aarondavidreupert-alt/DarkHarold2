import { ammoGetCapacity, ammoGetQuantity, ammoUseTopBox, weaponReload } from '../weaponAmmo.js'
import { Config } from '../config.js'
import { critterKill } from '../critter.js'
import * as GameTime from '../gametime.js'
import { hexDistance, hexLine, Point } from '../geometry.js'
import { world } from '../state/world.js'
import { uiState } from '../state/uiState.js'
import { services } from '../state/services.js'
import { assets } from '../state/assets.js'
import { eventLogPush, dbg, dbgWarn } from '../logger.js'
import { Critter, itemIsHidden, Obj } from '../object.js'
import { invenUnwield } from '../inventoryWield.js'
import { weaponCanBeReloadedWith } from '../weaponAmmo.js'
import { Player } from '../player.js'
import { uiEndCombat, uiEndButtonsGreenLights, uiEndButtonsRedLights, uiStartCombat } from '../ui.js'
import { drawAC, drawAP, drawHP } from '../hudRefresh.js'
import { uiLog } from '../messageLog.js'
import { getProtoMsg, getRandomInt } from '../util.js'
import { randomBetween } from '../random.js'
import { perkNameById } from '../perks.js'
import { currentUnarmed, type UnarmedMode } from '../unarmed.js'
import type { AiPacket } from '../aiPackets.js'
import { sfxBuildWeaponName } from '../sfxNames.js'
import { ActionPoints } from './actionPoints.js'
import { AI } from './AI.js'
import { combatIsShotBlocked } from './lineOfFire.js'
import { sfallIniGetString } from '../sfallIni.js'

// CE combat.cc burstModInit: ddraw.ini [Misc] ComputeSprayMod (off by default) and its
// ComputeSpray_CenterMult / CenterDiv (1 / 3) and TargetMult / TargetDiv (1 / 2); a
// multiplier above its divisor is cut to it. Null when the mod is off.
export function burstModSettings(): {
    centerMult: number
    centerDiv: number
    targetMult: number
    targetDiv: number
} | null {
    const int = (key: string, def: number) => {
        const v = parseInt(sfallIniGetString('ddraw.ini|Misc|' + key) ?? '', 10)
        return isNaN(v) ? def : v
    }
    if (int('ComputeSprayMod', 0) === 0) return null
    const centerDiv = Math.max(1, int('ComputeSpray_CenterDiv', 3))
    const targetDiv = Math.max(1, int('ComputeSpray_TargetDiv', 2))
    return {
        centerDiv,
        targetDiv,
        centerMult: Math.min(int('ComputeSpray_CenterMult', 1), centerDiv),
        targetMult: Math.min(int('ComputeSpray_TargetMult', 1), targetDiv),
    }
}
import { explosionRingCritters } from './explosion.js'
import { critterSetWhoHitMe } from './whoHitMe.js'
import { isWithinPerception } from '../perception.js'
import { type CriticalHitDescription } from '../criticalEffects/ceTables.js'
import { CRITICAL_HIT_TABLES, PLAYER_CRITICAL_HIT_TABLE } from '../criticalEffects/table.js'
import {
    combatStandup,
    critterIsProne,
    knockoutEventProcess,
    removeKnockoutEvents,
    DAM_CRIP_RANDOM,
    DAM_DEAD,
    DAM_DESTROY,
    DAM_DROP,
    DAM_DUD,
    DAM_EXPLODE,
    DAM_HIT_SELF,
    DAM_HURT_SELF,
    DAM_KNOCKED_DOWN,
    DAM_KNOCKED_OUT,
    DAM_LOSE_AMMO,
    DAM_LOSE_TURN,
    DAM_ON_FIRE,
    DAM_RANDOM_HIT,
} from './results.js'
import { objectDistance, weaponAttackType } from './hitChance.js'
import { installMethods } from '../installMethods.js'
import { combatAttackMethods } from './combatAttack.js'
import { combatDisplayMethods } from './combatDisplay.js'
import { combatProjectileMethods } from './combatProjectiles.js'
import { combatAiTurnMethods } from './combatAiTurn.js'
import { combatAiActionMethods } from './combatAiActions.js'

// A combat in a save game (CE combatSave)
export interface SavedCombat {
    order: number[]
    whoseTurn: number
    turnNum: number
    combatExps: number
    playerAP: { combat: number; move: number }
}

// Turn-based combat system

// Module state the Combat methods share (an object, so the methods in the combat/combat*.ts
// files can change it too).
export const combatState = {
    // Re-entry guard: prevents Combat.start() from firing while a combat instance
    // is still tearing down (e.g. map-script callbacks during end() can otherwise
    // immediately restart combat).
    combatActive: false,
    // CE combat.cc _main_ctd: the attack being (or last) resolved; sfall's combat_data
    // (sfall_metarules.cc mf_combat_data → combat_get_data) reads it while in combat
    mainAttack: null as Attack | null,
}
export function isCombatActive(): boolean {
    return combatState.combatActive
}

export function combatGetData(): Attack | null {
    return combatState.combatActive ? combatState.mainAttack : null
}

/** Free-form combat trace, gated by Config.scripting.debugLogShowType.combat.
 *  Player-visible combat messages go through uiLog() — never mix the two.
 *  Structured events go through eventLogPush() so they survive into the save. */
export function combatDebug(...args: any[]): void {
    dbg('combat', ...args)
}

export function combatWarn(...args: any[]): void {
    dbgWarn('combat', ...args)
}

export function actorName(c: Critter): string {
    return c.isPlayer ? 'you' : (c.name ?? c.art ?? 'unknown')
}

export const PERK_WEAPON_PENETRATE = 60 // perk_defs.h
export const PERK_WEAPON_KNOCKBACK = 61
export const PERK_WEAPON_ENHANCED_KNOCKOUT = 117
export const CRITTER_INVULNERABLE = 0x400 // proto critter flags
export const CRITTER_NO_KNOCKBACK = 0x4000
const OBJECT_SHOOT_THRU = 0x80000000

// CE hit locations in table order (HIT_LOCATION_HEAD … HIT_LOCATION_UNCALLED).
export const HIT_LOCATIONS = [
    'head',
    'leftArm',
    'rightArm',
    'torso',
    'rightLeg',
    'leftLeg',
    'eyes',
    'groin',
    'uncalled',
]

// CE combat.cc _cf_table — critical-failure flags by the weapon's critical-failure type
// (unarmed, melee, firearms, energy, grenades, rocket launcher, flamers) and effect.
export const CF_TABLE: readonly (readonly number[])[] = [
    [0, DAM_LOSE_TURN, DAM_LOSE_TURN, DAM_HURT_SELF | DAM_KNOCKED_DOWN, DAM_CRIP_RANDOM],
    [0, DAM_LOSE_TURN, DAM_DROP, DAM_RANDOM_HIT, DAM_HIT_SELF],
    [0, DAM_LOSE_AMMO, DAM_DROP, DAM_RANDOM_HIT, DAM_DESTROY],
    [
        DAM_LOSE_TURN,
        DAM_LOSE_TURN | DAM_LOSE_AMMO,
        DAM_DROP | DAM_LOSE_TURN,
        DAM_RANDOM_HIT,
        DAM_EXPLODE | DAM_LOSE_TURN,
    ],
    [DAM_DUD, DAM_DROP, DAM_DROP | DAM_HURT_SELF, DAM_RANDOM_HIT, DAM_EXPLODE],
    [DAM_LOSE_TURN, DAM_DUD, DAM_DESTROY, DAM_RANDOM_HIT, DAM_EXPLODE | DAM_LOSE_TURN | DAM_KNOCKED_DOWN],
    [0, DAM_LOSE_TURN, DAM_RANDOM_HIT, DAM_DESTROY, DAM_EXPLODE | DAM_LOSE_TURN | DAM_ON_FIRE],
]

// CE item.cc weaponGetCriticalFailureType — the proto's criticalFailureType (DH2
// `critFail`); no weapon (or -1) is row 0.
export function weaponCriticalFailureType(weaponObj: Obj | null): number {
    const t = weaponObj?.pro?.extra?.critFail
    return typeof t === 'number' && t >= 0 && t < CF_TABLE.length ? t : 0
}

// CE combat.cc attackComputeCriticalHit: gPlayerCriticalHitTable for the player, else
// gCriticalHitTables[killType].
export function criticalHitDescription(defender: Critter, location: number, effect: number): CriticalHitDescription {
    if (defender.isPlayer) return PLAYER_CRITICAL_HIT_TABLE[location][effect]
    const table = CRITICAL_HIT_TABLES[defender.killType ?? 0] ?? CRITICAL_HIT_TABLES[0]
    return table[location][effect]
}

// CE stat.cc statRoll: success when d10 <= stat + modifier (STAT_STRENGTH … STAT_LUCK).
const PRIMARY_STATS = ['STR', 'PER', 'END', 'CHA', 'INT', 'AGI', 'LUK']
export function statRoll(c: Critter, stat: number, modifier: number): boolean {
    const value = c.getStat(PRIMARY_STATS[stat]) + modifier
    return randomBetween(1, 10) <= value
}

// The attack is in a mode other than the primary one (CE hit modes other than the left /
// right primary and the punch): a weapon's burst or secondary mode
export function weaponSecondaryMode(weaponObj: Obj | null | undefined): boolean {
    const mode = (weaponObj as any)?.weapon?.mode
    return mode === 'burst' || mode === 'secondary'
}

// CE combat.cc _check_for_death: damage that takes the critter to 0 HP adds DAM_DEAD.
export function checkForDeath(c: Critter, damage: number, flags: number): number {
    if (!c || c.type !== 'critter') return flags
    if (((c.pro as any)?.extra?.flags ?? 0) & CRITTER_INVULNERABLE) return flags
    if (damage > 0 && c.getStat('HP') - damage <= 0) flags |= DAM_DEAD
    return flags
}

// Take `item` out of the critter's hands (a critter's empty hand is its fist).
export function removeFromHands(c: Critter, item: Obj): void {
    const h = c as any
    for (const hand of ['leftHand', 'rightHand']) {
        if (h[hand] === item) h[hand] = c.isPlayer ? undefined : Critter.makeFist()
    }
}

// CE Attack (combat.h) — one attack worked out by attackCompute and then shown and
// applied. `oops` is the intended target, `defender` whoever is hit.
interface AttackExtra {
    critter: Critter
    damage: number
    flags: number
    knockback: number
}
export interface Attack {
    attacker: Critter
    defender: Critter
    oops: Critter
    weapon: Obj | null
    hitMode: UnarmedMode | undefined
    hitLocation: string
    attackerFlags: number
    defenderFlags: number
    attackerDamage: number
    defenderDamage: number
    defenderKnockback: number
    criticalMessageId: number
    ammoQuantity: number
    accuracyBonus: number
    tile: Point | null
    landing: Point | null
    explosionTile: Point | null
    extras: AttackExtra[]
    damageType: string
    unarmedAnim: number // ANIM_THROW_PUNCH / ANIM_KICK_LEG for an unarmed attack, else -1
}

// CE item.cc weaponGetDamageType: with no weapon, the critter proto's damage type
// (critterGetDamageType) — Normal for most, plasma / electrical for a few creatures
const DAMAGE_TYPE_NAMES = ['Normal', 'Laser', 'Fire', 'Plasma', 'Electrical', 'EMP', 'Explosive']
export function unarmedDamageType(critter: Critter): string {
    return DAMAGE_TYPE_NAMES[critter.pro?.extra?.damageType ?? 0] ?? 'Normal'
}

// CE combat.cc attackInit
export function attackInit(attacker: Critter, defender: Critter, weaponObj: Obj | null, region: string): Attack {
    return {
        attacker,
        defender,
        oops: defender,
        weapon: weaponObj,
        hitMode: weaponObj === null ? currentUnarmed(attacker).mode : undefined,
        hitLocation: region,
        attackerFlags: 0,
        defenderFlags: 0,
        attackerDamage: 0,
        defenderDamage: 0,
        defenderKnockback: 0,
        criticalMessageId: -1,
        ammoQuantity: 0,
        accuracyBonus: 0,
        tile: null,
        landing: null,
        explosionTile: null,
        extras: [],
        damageType:
            weaponObj === null
                ? unarmedDamageType(attacker)
                : ((weaponObj as any).weapon?.getDamageType?.() ?? 'Normal'),
        unarmedAnim: -1,
    }
}

// CE CombatStartData (combat.h) — attack_complex's bonuses for the first attack.
export interface CombatStartData {
    attacker: Critter
    defender: Critter
    actionPointsBonus: number
    accuracyBonus: number
    damageBonus: number
    minDamage: number
    maxDamage: number
    overrideAttackResults: boolean
    attackerResults: number
    targetResults: number
}

// CE combat.cc attackComputeDamage — the combat-difficulty damage modifier applies
// only to attackers outside the player's team.
export function combatDifficultyDamageModifier(attacker: Critter): number {
    const player = world.player
    if (player && attacker.teamNum === player.teamNum) return 100
    return Config.combat.difficultyModifier
}

// CE item.cc weaponGetDamage — randomBetween(min, max + Melee Damage) for melee and
// unarmed attacks; sfall's Bonus HtH Damage fix (CE default on) also raises the
// player's minimum by 2 per rank.
export function rollWeaponDamage(attacker: Critter, min: number, max: number, melee: boolean): number {
    if (!melee) return getRandomInt(min, max)
    if (attacker.isPlayer) min += 2 * attacker.perks.filter((p) => p === 'Bonus HtH Damage').length
    return getRandomInt(min, max + attacker.getStat('Melee'))
}

// A ranged miss (CE attack->tile and the accidental victim); `landing` is where a
// thrown item comes to rest.
export interface RangedMiss {
    tile: Point
    victim: Critter | null
    landing: Point
}

// CE _combat_check_bad_shot results.
export type BadShot =
    'ok' | 'noAmmo' | 'outOfRange' | 'notEnoughAp' | 'dead' | 'aimBlocked' | 'armCrippled' | 'bothArmsCrippled'

// Per-turn state of the CE AI port (Combat.doAITurn phases).
export interface AiTurnState {
    safetyChecked?: boolean // CE _ai_try_attack's weapon safety check ran this turn
    phase: 'start' | 'drugs' | 'prefs' | 'attack' | 'end'
    target: Critter | null
    attempts: number
    drugUsed: boolean
    healed: boolean
    healSearchDone: boolean
    envSearched: boolean
    chemActive: boolean | null
    chemCount: number
    endStep: number
    whoHitSet: boolean
}

// CE item.cc gHealingItemPids: stimpak, super stimpak, healing powder.
export const HEALING_PIDS = [40, 144, 273]

// CE game_dialog.cc _custom_settings stores a run-away choice as RUN_AWAY_MODE_X − 1, the
// index into combat_ai.cc _hp_run_away_value {0, 25, 40, 60, 75, 100} that
// aiSetRunAwayMode uses: Abject coward 0 % (min_hp = max HP), … Never! 100 % (min_hp 0).
// 'none' is what DH2 stored for "You need a tourniquet" before 2026-10-24.
const RUN_AWAY_HP_PCT: { [mode: string]: number } = {
    coward: 0,
    finger_hurts: 25,
    bleeding: 40,
    not_feeling_good: 60,
    tourniquet: 75,
    never: 100,
    none: 75,
}

// CE AiPacket.min_hp — the flee threshold (_combat_ai: HP < min_hp). It is the ai.txt
// value; a party member's run-away setting (aiSetRunAwayMode) sets it to
// max HP − max HP × percent / 100.
export function aiMinHp(obj: Critter, packet: AiPacket): number {
    const custom = packet.disposition === 'custom' ? obj.customAiOverrides?.runAwayMode : undefined
    if (custom !== undefined && RUN_AWAY_HP_PCT[custom] !== undefined) {
        const maxHp = obj.getStat('Max HP') ?? obj.getStat('HP')
        return maxHp - Math.trunc((maxHp * RUN_AWAY_HP_PCT[custom]) / 100)
    }
    return packet.minHp
}

// CE AiPacket.hurt_too_much (_rmatchHurtVals): blind, crippled (any limb),
// crippled_legs, crippled_arms.
export function aiHurtTooMuch(obj: Critter, packet: AiPacket): boolean {
    for (const h of packet.hurtTooMuch) {
        if (h === 'blind' && obj.isBlinded) return true
        const legs = obj.crippledLeftLeg || obj.crippledRightLeg
        const arms = obj.crippledLeftArm || obj.crippledRightArm
        if (h === 'crippled' && (legs || arms)) return true
        if (h === 'crippled_legs' && legs) return true
        if (h === 'crippled_arms' && arms) return true
    }
    return false
}

// CE combat_ai.cc aiCanUseItem: a primary chem desire, or — for a human / super mutant
// / ghoul / child with INT >= 3 — a healing item when HP is at the chem_use ratio.
export function aiCanUseItem(obj: Critter, item: Obj, packet: AiPacket): boolean {
    if (packet.chemPrimaryDesire.includes(item.pid)) return true
    if ((obj.pro?.extra?.bodyType ?? 0) !== 0) return false
    const kt = obj.killType ?? 0
    if (kt !== 0 && kt !== 1 && kt !== 2 && kt !== 3 && kt !== 4) return false
    if (obj.getStat('INT') < 3) return false
    if (!HEALING_PIDS.includes(item.pid)) return false
    const ratio =
        packet.chemUse === 'clean'
            ? 0
            : packet.chemUse === 'stims_when_hurt_little'
              ? 60
              : packet.chemUse === 'stims_when_hurt_lots'
                ? 30
                : 50
    const maxHp = obj.getStat('Max HP') ?? obj.getStat('HP')
    return obj.getStat('HP') <= Math.trunc((maxHp * ratio) / 100)
}

// CE _inven_find_id after _ai_retrieve_object: the picked-up item in the inventory
// (addInventoryItem may stack it into an existing entry).
export function inventoryCopyOf(obj: Critter, item: Obj): Obj | null {
    return obj.inventory.find((i) => i === item) ?? obj.inventory.find((i) => i.pid === item.pid) ?? null
}

// CE _ai_try_attack: ((defender->fid & 0xF000) >> 12) == 0 — nothing in the hand the
// critter fights with (its weapon code), read from the held item, not the sprite.
export function defenderUnarmedNow(c: Critter): boolean {
    const w = c.equippedWeapon
    return !w || w.pid === undefined
}

// CE weaponGetAttackTypeForHitMode: a fist (no item) or no weapon is unarmed.
export function attackTypeOf(weaponObj: Obj | null): 'unarmed' | 'melee' | 'throw' | 'ranged' | 'none' {
    if (!weaponObj || weaponObj.pid === undefined) return 'unarmed'
    return weaponAttackType(weaponObj)
}

// Returns true when the weapon can be fired (melee/unarmed always ok; ranged ok if rounds > 0)
export function aiHaveAmmo(weaponObj: Obj | null): boolean {
    if (!weaponObj) return true // unarmed — always valid
    // CE combat_ai.cc aiHaveAmmo: the Solar Scorcher only works in daylight (ambient > 95 %)
    if (weaponObj.pid === 390) return GameTime.getAmbientLight() > 65536 * 0.95 // PROTO_ID_SOLAR_SCORCHER
    if (ammoGetCapacity(weaponObj) === 0) return true // melee/unarmed — no ammo needed
    return ammoGetQuantity(weaponObj) > 0
}

// CE combat_ai.cc aiHaveAmmo(critter, weapon, &ammo): the Solar Scorcher in daylight;
// otherwise the first inventory ammo the weapon takes. Its quirk is kept: each ammo box
// that doesn't fit puts the critter's right-hand item away (_inven_unwield) — unless the
// weapon has an animation code and the right hand reaches 3 hexes or more.
export function aiFindAmmo(critter: Critter, weaponObj: Obj): { ok: boolean; ammo: Obj | null } {
    if (weaponObj.pid === 390) return { ok: GameTime.getAmbientLight() > 65536 * 0.95, ammo: null }
    for (const item of critter.inventory.slice()) {
        if (item.subtype !== 'ammo') continue
        if (weaponCanBeReloadedWith(weaponObj, item)) return { ok: true, ammo: item }
        const animCode = weaponObj.pro?.extra?.animCode ?? 0
        const right = critter.rightHand as Obj | null
        if (right && (animCode === 0 || Combat.weaponRange(critter, right) < 3)) invenUnwield(critter, 'rightHand')
    }
    return { ok: false, ammo: null }
}

// CE combat_ai.cc aiAttemptWeaponReload(critter, animate = 0): the right-hand weapon not
// full is reloaded from the inventory (aiHaveAmmo); a party member's reload sounds the
// weapon's READY. Called at the end of combat and after a barter.
export function aiAttemptWeaponReload(c: Critter): void {
    const w = c.rightHand as Obj | null
    if (!w || w.pid === undefined) return
    const cap = ammoGetCapacity(w)
    if (ammoGetQuantity(w) >= cap) return
    const ammo = aiFindAmmo(c, w).ammo
    if (!ammo) return
    const rc = weaponReload(w, ammo)
    if (rc === 0) ammoUseTopBox(ammo, c.inventory)
    if (rc !== -1 && world.gParty?.isPartyMember(c) && !window.__test?.fastMode) {
        services.audioEngine?.playSfxByName?.(sfxBuildWeaponName(0, w, false, null).toLowerCase(), c)
    }
}

// Clears the DH2-only 'blue' neutral-critter outline (see
// Combat.refreshHighlights()) map-wide. Needed on combat end since neutral
// critters are never part of `this.combatants` — the normal per-combatant
// outline-clearing loops never reach them.
function clearNeutralOutlines(): void {
    if (!world.gMap) return
    for (const obj of world.gMap.getObjects()) {
        if (obj instanceof Critter && obj.outline === 'blue') {
            obj.outline = null
        }
    }
}

// A combat encounter
// CE item.cc itemGetType: the item's proto type, except the Shiv (PROTO_ID_SHIV 383), which
// counts as ITEM_TYPE_MISC — the AI's weapon searches pass it over.
export function ceItemType(item: Obj): string | undefined {
    return item.pid === 383 ? 'misc' : item.subtype
}

// the class + interface merge is intended: the interface carries the methods installed below
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Combat {
    combatants: Critter[]
    playerIdx: number
    player: Player
    turnNum: number
    numTurns = 0 // CE _combatNumTurns: rounds completed
    whoseTurn: number
    inPlayerTurn: boolean
    hasAttacked = false // set true when the first attack fires this combat session
    playerHadTurn = false // set true the first time the player's turn starts
    combatExps = 0 // CE _combat_exps: kill XP collected this combat, given at its end

    constructor(objects: Obj[], triggerTeams: Set<number> = new Set()) {
        // Gather a list of combatants (critters meeting a certain criteria)
        this.combatants = objects.filter((obj) => {
            if (obj instanceof Critter) {
                // CE combat.cc _combat_begin: every critter on the elevation is in the
                // combat list; only combatants (`hostile`, CE _list_com) take turns, the
                // others join by _combatai_want_to_join at the start of a round.
                if (obj.dead || !obj.visible) return false
                void triggerTeams

                // NOTE: AI is initialized here for simplicity; could be moved to Critter later
                if (!obj.isPlayer && !obj.ai) obj.ai = new AI(obj)

                if (obj.stats === undefined) throw new Error('no stats')
                obj.dead = false
                obj.AP = new ActionPoints(obj)
                // CE combat.cc _combatInitAIInfoList (_combat_begin): friendlyDead, lastTarget
                // and lastItem start empty (lastMove is set by CE but never read)
                obj.aiFriendlyDead = null
                obj.aiLastTarget = null
                obj.aiLastItem = null
                return true
            }

            return false
        }) as Critter[]

        // CE combat.cc _combat_begin: whoHitMe starts empty for every critter on the elevation
        // (sequenceInit / team combat then set the attacker's and defender's)
        for (const o of objects) if (o instanceof Critter) o.whoHitMe = null

        // The first round's order comes from sequenceInit (Combat.start); later rounds
        // are sorted by Sequence (combatSequence).
        this.playerIdx = this.combatants.findIndex((x) => x.isPlayer)
        if (this.playerIdx === -1) throw new Error("combat: couldn't find player?")

        this.player = this.combatants[this.playerIdx] as Player
        this.turnNum = 1
        this.numTurns = 0
        this.whoseTurn = this.playerIdx - 1
        this.inPlayerTurn = true

        // Stop the player from walking combat is initiating
        this.player.clearAnim()

        if (!window.__test?.fastMode) services.audioEngine.playSfxByName('icombat1')
        uiStartCombat()
    }

    log(msg: any) {
        // Combat-related debug log (browser console only, never game console)
        combatDebug(msg)
    }

    // CE combat.cc _gcsd — attack_complex's start data, for the first combatant's turn.
    gcsd: CombatStartData | null = null

    // CE combat_ai.cc _caiHasWeapPrefType — _weapPrefOrderings[best_weapon + 1].
    static readonly WEAP_PREF_ORDERINGS: { [best: string]: string[] } = {
        no_pref: ['ranged', 'throw', 'melee', 'unarmed'],
        melee: ['melee'],
        melee_over_ranged: ['melee', 'ranged'],
        ranged_over_melee: ['ranged', 'melee'],
        ranged: ['ranged'],
        unarmed: ['unarmed'],
        unarmed_over_throw: ['unarmed', 'throw'],
        random: [],
        never: [],
    }

    // CE combat_ai.cc _ai_search_inven_weap: the best weapon in the inventory (other
    // than the one in hand) the attacker can use right now. Only bipeds, robots and
    // PROTO_ID_0x1000098 search. Static: the party-member control screen uses it too
    // (checkAP false, no defender).
    static aiSearchInvenWeap(attacker: Critter, defender: Critter | null, checkAP = true): Obj | null {
        const bodyType = attacker.pro?.extra?.bodyType ?? 0
        if (bodyType !== 0 && bodyType !== 1 && attacker.pid !== 0x1000098) return null
        const packet = attacker.ai?.packet ?? new AI(attacker).packet
        const prefs = Combat.WEAP_PREF_ORDERINGS[packet.bestWeapon] ?? []
        const inHand = attacker.equippedWeapon
        const ap = attacker.AP?.getAvailableCombatAP() ?? 0
        let best: Obj | null = null
        for (const item of attacker.inventory) {
            const weapon = (item as any).weapon
            if (ceItemType(item) !== 'weapon' || !weapon || item === inHand) continue
            if (checkAP && weapon.getAPCost(1) > ap) continue
            // _ai_can_use_weapon: arms good enough, the attack FRM, enough skill, and the
            // attack type is one the packet's best_weapon allows
            const twoHanded = ((item.pro?.extra?.weaponFlags ?? 0) & 0x02) !== 0
            if (attacker.crippledLeftArm && attacker.crippledRightArm) continue
            if ((attacker.crippledLeftArm || attacker.crippledRightArm) && twoHanded) continue
            const attackArt = attacker.getBase() + weapon.getAnim('attack')
            if (!assets.imageInfo![attackArt]) continue
            if (attacker.getSkill(weapon.weaponSkillType) < packet.minToHit) continue
            const attackType = weaponAttackType(item)
            if (!prefs.includes(attackType)) continue
            // CE _ai_search_inven_weap: an empty ranged weapon only with ammo for it (aiHaveAmmo)
            if (attackType === 'ranged' && ammoGetQuantity(item) === 0 && !aiFindAmmo(attacker, item).ok) continue
            best = Combat.aiBestWeapon(attacker, packet, best, item, defender)
        }
        return best
    }

    // CE combat_ai.cc _ai_search_inven_armor: party members only — the inventory armor
    // with the highest AC + Σ(DR + DT) over all damage types, if it beats the worn one.
    static aiSearchInvenArmor(critter: Critter): Obj | null {
        if (!world.gParty?.isPartyMember(critter)) return null
        const DAMAGE_TYPES = ['Normal', 'Laser', 'Fire', 'Plasma', 'Electrical', 'EMP', 'Explosive']
        const score = (a: Obj): number => {
            const ex = a.pro?.extra ?? {}
            let v = ex.AC ?? 0
            for (const t of DAMAGE_TYPES) v += (ex.stats?.['DR ' + t] ?? 0) + (ex.stats?.['DT ' + t] ?? 0)
            return v
        }
        const armor = critter.getEquippedArmor()
        let armorScore = armor ? score(armor) : 0
        let bestArmor: Obj | null = null
        for (const candidate of critter.inventory) {
            if (candidate.subtype !== 'armor' || candidate === armor) continue
            const v = score(candidate)
            if (v > armorScore) {
                armorScore = v
                bestArmor = candidate
            }
        }
        return bestArmor
    }

    // CE combat_ai.cc _ai_best_weapon — the attack type's place in the packet's
    // preference order first, then average damage (× the critters a blast would catch,
    // × 2 with a weapon perk — sfall's fixes), then cost. A weapon that would hurt the
    // team (_combat_safety_invalidate_weapon) has no place; a hidden (natural) weapon
    // always wins; flares lose. No weapon counts as unarmed when the punch reaches.
    private static aiBestWeapon(
        attacker: Critter,
        packet: AiPacket,
        w1: Obj | null,
        w2: Obj,
        defender: Critter | null,
    ): Obj | null {
        const best = packet.bestWeapon
        if (best === 'random') return randomBetween(1, 100) <= 50 ? w1 : w2
        const prefs = Combat.WEAP_PREF_ORDERINGS[best] ?? []
        const combat = world.combat
        const PROTO_ID_FLARE = 79
        const score = (w: Obj | null): { avg: number; order: number; cost: number; hidden: boolean } => {
            if (!w) {
                // punch range (1) against the defender's distance
                const reach = defender ? objectDistance(attacker, attacker.position, defender) <= 1 : false
                const order = reach ? prefs.indexOf('unarmed') : -1
                return { avg: 0, order: order === -1 ? 999 : order, cost: 0, hidden: false }
            }
            const ex = w.pro?.extra ?? {}
            let avg = Math.trunc(((ex.minDmg ?? 0) + (ex.maxDmg ?? 0)) / 2)
            const dmgType = (w as any).weapon?.getDamageType?.() ?? 'Normal'
            const attackType = weaponAttackType(w)
            const isGrenade =
                attackType === 'throw' && (dmgType === 'Explosive' || dmgType === 'Plasma' || dmgType === 'EMP')
            const radius = isGrenade ? 2 : attackType === 'ranged' && dmgType === 'Explosive' ? 3 : 0
            if (radius > 0 && defender) {
                const caught = explosionRingCritters(defender.position, defender.elevation, null, isGrenade).filter(
                    (c) => c !== attacker,
                ).length
                avg *= caught + 1
            }
            if ((ex.perk ?? -1) !== -1) avg *= 2
            const unsafe =
                !!defender && !!combat && combat.combatSafetyInvalidateWeapon(attacker, w, 'primary', defender, false)
            const order = unsafe ? -1 : prefs.indexOf(attackType)
            const hidden = itemIsHidden(w) // CE itemIsHidden (ITEM_HIDDEN proto flag)
            return { avg, order: order === -1 ? 999 : order, cost: ex.cost ?? 0, hidden }
        }
        const a = score(w1)
        if (a.hidden) return w1
        const b = score(w2)
        if (b.hidden) return w2
        if (a.order === b.order) {
            if (a.order === 999) return null
            if (Math.abs(b.avg - a.avg) <= 5) return b.cost > a.cost ? w2 : w1
            return b.avg > a.avg ? w2 : w1
        }
        if (w1 && w1.pid === PROTO_ID_FLARE) return w2
        if (w2.pid === PROTO_ID_FLARE && w1) return w1
        // CE combat_ai.cc:1963: best_weapon == -1 (unset) or >= UNARMED_OVER_THROW — an explicit
        // no_pref keeps the preference order
        if (
            (packet.bestWeaponUnset || best === 'unarmed_over_throw' || best === 'never') &&
            Math.abs(b.avg - a.avg) > 5
        ) {
            return b.avg > a.avg ? w2 : w1
        }
        return a.order > b.order ? w2 : w1
    }

    // The Weapon mode naming a weapon's secondary attack: 'burst' for burst /
    // continuous fire, 'secondary' for any other; null without one.
    static secondaryModeName(weapon: any): string | null {
        const mode = weapon?.attackModeOf?.(2) ?? 0
        if (mode === 0) return null
        return mode === 7 || mode === 8 ? 'burst' : 'secondary'
    }

    perish(obj: Critter, attacker?: Critter, damageType?: string) {
        const victimDisplay = obj.isPlayer ? 'You' : obj.name
        const attackerDisplay = attacker ? (attacker.isPlayer ? 'you' : attacker.name) : 'something'
        uiLog(`${victimDisplay} is killed by ${attackerDisplay}!`)
        eventLogPush({
            actor: attacker ? actorName(attacker) : null,
            action: 'death',
            target: actorName(obj),
            result: 'dead',
            damageType: damageType ?? null,
            message: `${victimDisplay} killed by ${attackerDisplay}`,
        })
        // critterDamage has normally killed it already (death anim + its CE DIE sound,
        // critter/lifecycle.ts); guard against a path that didn't.
        if (!obj.dead) critterKill(obj, attacker, undefined, { animate: true }, damageType)

        // Inventory stays on the critter — the player loots it via the context menu,
        // just like a container.

        // CE combat.cc _damage_object: a kill by the player or the player's team adds
        // the victim's proto experience to _combat_exps unless its destroy_p_proc
        // overrode it; _combat_over hands it out.
        const player = world.player
        if (
            attacker &&
            player &&
            !obj.isPlayer &&
            (attacker.isPlayer || attacker.teamNum === player.teamNum) &&
            !obj._script?._didOverride
        ) {
            this.combatExps += obj.pro?.extra?.XPValue ?? 0
        }
    }

    // CE combat.cc _combat_give_exps — "%s you earn %d exp. points." with a random
    // prefix (622-625), or 626 when unhurt (35%).
    private giveExps(): void {
        const xp = this.combatExps
        this.combatExps = 0
        Combat.giveExps(xp)
    }

    // CE combat.cc _combat_give_exps — the XP and proto.msg 621 with a random prefix
    static giveExps(xp: number): void {
        const player = world.player as Player | null
        if (xp <= 0 || !player || player.dead) return
        const before = player.stats.get('Experience')
        player.addExperience(xp)
        const gained = player.stats.get('Experience') - before
        let prefixId = 622 + randomBetween(0, 3)
        if (player.getStat('HP') === player.getStat('Max HP') && randomBetween(0, 100) > 65) prefixId = 626
        const fmt = getProtoMsg(621)
        const prefix = getProtoMsg(prefixId)
        if (fmt && prefix) uiLog(fmt.replace('%s', prefix).replace('%d', String(gained)))
    }

    // CE combat.cc _combat_sequence — between rounds: non-combatants that want to join
    // do (_combat_add_noncoms); knocked-out and disengaging critters leave the fight;
    // 5 seconds of game time pass.
    private combatSequence(): Critter[] {
        this.notifyFriends(this.player)
        const joiners: Critter[] = []
        for (const c of this.combatants) {
            if (c.isPlayer || c.dead || c.hostile) continue
            if (this.wantToJoin(c)) {
                c.hostile = true
                c.engaging = false // maneuver = NONE
                c.disengaging = false
                joiners.push(c)
                combatDebug(`${actorName(c)} joins the fight`)
            }
        }
        for (const c of this.combatants) {
            if (c.isPlayer || c.dead || !c.hostile) continue
            if ((c.injuryFlags & DAM_KNOCKED_OUT) !== 0 || c.disengaging) {
                c.hostile = false
                c.engaging = false
                combatDebug(`${actorName(c)} leaves the fight`)
            }
        }
        this.sortBySequence()
        GameTime.advanceSeconds(5)
        return joiners
    }

    // CE combat.cc _combat_sequence → qsort(_compare_faster): Sequence, then Luck, highest first.
    // (Called at the round's start, whoseTurn 0: the new round begins with the fastest.)
    private sortBySequence(): void {
        this.combatants.sort(
            (a, b) => b.getStat('Sequence') - a.getStat('Sequence') || b.getStat('LUK') - a.getStat('LUK'),
        )
        this.playerIdx = this.combatants.indexOf(this.player)
    }

    // CE combat.cc _combat_sequence_init: the first round is the attacker, the defender,
    // then the dude (unless he is one of them); they hit each other first (whoHitMe).
    sequenceInit(attacker: Critter | null, defender: Critter | null): void {
        let next = 0
        const place = (c: Critter | null) => {
            if (!c) return
            const i = this.combatants.indexOf(c)
            if (i === -1) return
            const tmp = this.combatants[next]
            this.combatants[next] = c
            this.combatants[i] = tmp
            next += 1
        }
        place(attacker)
        place(defender)
        if (attacker !== this.player && defender !== this.player) place(this.player)
        if (attacker && defender) {
            critterSetWhoHitMe(attacker, defender)
            critterSetWhoHitMe(defender, attacker)
        }
        this.playerIdx = this.combatants.indexOf(this.player)
        this.whoseTurn = -1
    }

    // CE combat.cc _combat_should_end — over when the player is the only combatant, or
    // all combatants are on the player's team and none of them was hit by a team-mate.
    private shouldEnd(): boolean {
        const team = this.player.teamNum
        const active = this.combatants.filter((c) => !c.dead && (c.isPlayer || c.hostile))
        if (active.length <= 1) return true
        for (const c of active) {
            if (c.teamNum !== team) return false
            const hit: Critter | null = c.whoHitMe ?? null
            if (hit && hit.teamNum === team) return false
        }
        return true
    }

    // CE combat.cc combatAttemptEnd — the player may end combat only when every hostile
    // combatant wants to stop and no hostile non-combatant wants to join (else combat.msg
    // 103, "Combat cannot end with nearby hostile creatures.").
    attemptEnd(): void {
        const team = this.player.teamNum
        const relevant = (c: Critter) => {
            const hit: Critter | null = c.whoHitMe ?? null
            return c.teamNum !== team || (!!hit && hit.teamNum === c.teamNum)
        }
        for (const c of this.combatants) {
            if (c.isPlayer || c.dead || !relevant(c)) continue
            if (c.hostile ? !this.wantToStop(c) : this.wantToJoin(c)) {
                uiLog(this.getCombatMsg(103)!)
                return
            }
        }
        this.finish('normal')
    }

    nearestOfTeamPublic(obj: Critter, team: number): Critter | null {
        return this.nearestOfTeam(obj, team)
    }

    nearestOfTeam(obj: Critter, team: number): Critter | null {
        let best: Critter | null = null
        for (const c of this.combatants) {
            if (c.dead || c.teamNum !== team) continue
            if (!best || hexDistance(obj.position, c.position) < hexDistance(obj.position, best.position)) best = c
        }
        return best
    }

    // CE combat_ai.cc isWithinPerception (src/perception.ts)
    isWithinPerception(obj: Critter, target: Critter | null): boolean {
        return isWithinPerception(obj, target)
    }

    // CE item.cc weaponGetRange: the action's range; a throw is capped at 3 × ST (the
    // player's ST + 2 per Heave Ho!, at most 10); no weapon reaches 1 (2 with
    // CRITTER_LONG_LIMBS).
    attackRange(critter: Critter, weaponObj: Obj | null): number {
        return Combat.weaponRange(critter, weaponObj)
    }

    static weaponRange(critter: Critter, weaponObj: Obj | null): number {
        if (!weaponObj || weaponObj.pid === undefined) return (critter.pro?.extra?.flags ?? 0) & 0x2000 ? 2 : 1
        let range = (weaponObj as any).weapon.getMaximumRange()
        if (attackTypeOf(weaponObj) === 'throw') {
            let st = critter.getStat('STR')
            if (critter.isPlayer) st = Math.min(10, st + 2 * critter.perks.filter((p) => p === 'Heave Ho!').length)
            range = Math.min(range, 3 * st)
        }
        return range
    }

    nearestOfTeamExcept(obj: Critter, inCombat = false): Critter | null {
        let best: Critter | null = null
        for (const c of this.combatants) {
            if (c === obj || c.dead || c.teamNum !== obj.teamNum) continue
            if (inCombat && (!this.isActiveCombatant(c) || !c.whoHitMe)) continue
            if (!best || hexDistance(obj.position, c.position) < hexDistance(obj.position, best.position)) best = c
        }
        return best
    }

    static start(forceTurn?: Critter, gcsd?: CombatStartData, teamCombat?: [Critter, Critter]): void {
        if (combatState.combatActive) {
            combatDebug('ignoring Combat.start(): already active')
            return
        }
        combatState.combatActive = true
        // begin combat
        world.inCombat = true
        const player = world.player!
        const triggerTeams = new Set([player.teamNum])
        if (forceTurn && forceTurn.teamNum >= 0) {
            // NPC-initiated: enroll only the player's team and the attacker's team.
            triggerTeams.add(forceTurn.teamNum)
        } else {
            // Player-initiated (attack button / encounter): collect all NPC teams on
            // the map so enemy critters can participate. nextTurn() gates actual
            // activity via the hostile flag, so neutral critters still do nothing.
            for (const obj of world.gMap!.getObjects()) {
                if (obj instanceof Critter && !obj.dead && !obj.isPlayer && obj.teamNum >= 0)
                    triggerTeams.add(obj.teamNum)
            }
            // CE ref: combat.cc combatBeginSequence enrolls all map critters.
            // teamNum=-1 (neutral — no team_num in ai.txt) critters must also be
            // enrolled so they can retaliate after being attacked (nextTurn's
            // hasAttacked+LOS gate then marks them hostile and gives them a turn).
            triggerTeams.add(-1)
        }
        combatDebug(`start: triggerTeams=[${[...triggerTeams].join(',')}]`)
        world.combat = new Combat(world.gMap!.getObjects(), triggerTeams)
        world.combat.gcsd = gcsd ?? null
        // CE combat.cc _combat_begin: damageLastTurn starts at 0 for every combatant
        for (const c of world.combat.combatants) c.damageLastTurn = 0

        if (teamCombat) {
            // CE combat_ai.cc _caiSetupTeamCombat (worldmap encounters only): every
            // critter is ENGAGING, and _caiTeamCombatInit gives each member of the two
            // teams the nearest member of the other as whoever hit it.
            const c = world.combat
            const [attackerTeamObj, targetTeamObj] = teamCombat
            for (const critter of c.combatants) {
                if (critter.dead || critter.isPlayer) continue
                critter.engaging = true
                if (critter.teamNum === attackerTeamObj.teamNum) {
                    critter.whoHitMe = c.nearestOfTeamPublic(critter, targetTeamObj.teamNum)
                } else if (critter.teamNum === targetTeamObj.teamNum) {
                    critter.whoHitMe = c.nearestOfTeamPublic(critter, attackerTeamObj.teamNum)
                }
            }
        }
        world.combat.sequenceInit(forceTurn ?? gcsd?.attacker ?? null, gcsd?.defender ?? null)

        eventLogPush({
            actor: null,
            action: 'combat-start',
            triggerTeams: [...triggerTeams],
            combatants: world.combat.combatants.map((c) => actorName(c)),
            message: 'Combat started',
        })

        world.combat.nextTurn()
        world.gMap!.updateMap()
    }

    // CE combat.cc _combat_delete_critter: out of the turn order (the current turn stays
    // with whoever has it)
    removeCombatant(c: Critter): void {
        const i = this.combatants.indexOf(c)
        if (i === -1) return
        this.combatants.splice(i, 1)
        // at or before the current turn: the index moves down, so the next turn is still the
        // critter after the one acting
        if (i <= this.whoseTurn) this.whoseTurn--
        this.playerIdx = this.combatants.indexOf(this.player)
    }

    // CE combat.cc combatSave: the turn order by object id, whose turn it is, the round,
    // the XP collected and the player's AP / free move.
    serializeState(): SavedCombat {
        return {
            order: this.combatants.map((c) => c.uid),
            whoseTurn: this.combatants[this.whoseTurn]?.uid ?? -1,
            turnNum: this.turnNum,
            combatExps: this.combatExps,
            playerAP: { combat: this.player.AP?.combat ?? 0, move: this.player.AP?.move ?? 0 },
        }
    }

    // CE loadsave.cc → combat.cc combatLoad: a save made in combat resumes the fight —
    // the saved order (critters no longer there drop out) and turn;
    // on the player's turn the saved AP carry on.
    static restore(data: SavedCombat): void {
        if (combatState.combatActive) return
        combatState.combatActive = true
        world.inCombat = true
        const c = new Combat(world.gMap!.getObjects())
        world.combat = c
        const byUid = new Map(c.combatants.map((x) => [x.uid, x] as [number, Critter]))
        // exactly the saved list (CE reads the cids back); the player is always in it
        const ordered = data.order.map((u) => byUid.get(u)).filter((x): x is Critter => !!x)
        if (!ordered.includes(c.player)) ordered.unshift(c.player)
        c.combatants = ordered
        c.playerIdx = ordered.indexOf(c.player)
        c.combatExps = data.combatExps ?? 0
        const turn = Math.max(
            0,
            ordered.findIndex((x) => x.uid === data.whoseTurn),
        )
        c.whoseTurn = turn - 1
        c.turnNum = Math.max(1, (data.turnNum ?? 1) - 1)
        c.playerHadTurn = true
        c.hasAttacked = true
        c.nextTurn()
        if (c.inPlayerTurn && c.player.AP && data.playerAP) {
            c.player.AP.combat = data.playerAP.combat
            c.player.AP.move = data.playerAP.move
            drawAP(c.player.AP.getAvailableCombatAP(), c.player.AP.getTotalMaxAP(), c.player.AP.move)
        }
    }

    // Combat over (CE _combat_over): used by the round check, the end-combat button
    // (attemptEnd) and an elevation change.
    end() {
        this.finish('normal')
    }

    private finish(result: 'normal' | 'forced'): void {
        this.joinQueue = null
        // Set all combatants to non-hostile and remove their outline
        for (const combatant of this.combatants) {
            combatant.hostile = false
            combatant.outline = null
        }
        clearNeutralOutlines()
        this.combatOver()

        combatDebug('end combat')
        eventLogPush({ actor: null, action: 'combat-end', result, message: 'Combat ended' })
        world.combat = null // todo: invert control
        world.inCombat = false
        combatState.combatActive = false
        this.dudeWakeUp()

        // CE ref: interface.cc:1455 interfaceBarEndButtonsHide — plays icibcxx1 when buttons close
        if (!window.__test?.fastMode) services.audioEngine.playSfxByName('icibcxx1')
        this.player.AP?.resetAP() // CE ref: combat.cc:2811
        this.giveExps() // CE ref: combat.cc:2816
        world.gMap!.updateMap()
        uiEndCombat()
    }

    // CE combat.cc _combat_over: living NPCs reload their weapon (aiAttemptWeaponReload,
    // no animation) and every combatant's maneuver (fleeing / disengaging) and
    // damage-last-turn are cleared.
    private combatOver(): void {
        // CE combat.cc _combat_over: who hit whom is forgotten for every critter on the elevation
        for (const o of world.gMap?.getObjects() ?? []) if (o.type === 'critter') (o as any).whoHitMe = null
        for (const c of this.combatants) {
            c.fleeing = false
            c.disengaging = false
            c.damageLastTurn = 0
            c.aiFriendlyDead = null
            c.aiLastItem = null
            c.engaging = false
            c._aiTurn = undefined
            if (c.isPlayer || c.dead) continue
            aiAttemptWeaponReload(c)
        }
    }

    // CE combat.cc _combat_over: a player still on the ground comes to and stands up.
    private dudeWakeUp(): void {
        const p = this.player
        if (!p || p.dead || !critterIsProne(p)) return
        removeKnockoutEvents(p)
        knockoutEventProcess(p)
    }

    forceEnd() {
        dbgWarn('combat', `[forceEnd] stack: ${new Error().stack?.split('\n').slice(1, 4).join(' | ')}`)
        for (const combatant of this.combatants) {
            combatant.hostile = false
            combatant.outline = null
        }
        clearNeutralOutlines()
        this.combatOver()
        combatDebug('end combat (forced by script)')
        eventLogPush({ actor: null, action: 'combat-end', result: 'forced', message: 'Combat ended (forced)' })
        world.combat = null
        world.inCombat = false
        this.dudeWakeUp()
        if (!window.__test?.fastMode) services.audioEngine.playSfxByName('icibcxx1')
        this.player.AP?.resetAP() // CE ref: combat.cc:2811
        this.giveExps() // CE ref: combat.cc:2816
        world.gMap?.updateMap()
        uiEndCombat()
        // Defer flag reset so the current script execution frame finishes
        // before a new combat can be started (prevents the map_update_p_proc
        // → attack_complex → Combat.start() re-entry loop).
        Promise.resolve().then(() => {
            combatState.combatActive = false
        })
    }

    /**
     * Line-of-sight check (CE ref: object.cc:2583 _obj_sight_blocking_at).
     * Blocks on any wall- or scenery-type object lacking OBJECT_LIGHT_THRU
     * (0x20000000) along the interior hex-line. Hidden objects are ignored.
     */
    hasLineOfSight(from: Point, to: Point): boolean {
        if (!world.gMap) return true
        const line = hexLine(from, to) ?? []
        if (line.length <= 2) return true // adjacent — always visible
        const interior = line.slice(1, -1)
        const mapObjects = world.gMap.getObjects()
        const LIGHT_THRU = 0x20000000
        for (const pos of interior) {
            for (const o of mapObjects) {
                const t = o.type
                if (t !== 'wall' && t !== 'scenery') continue
                if (o.position?.x !== pos.x || o.position?.y !== pos.y) continue
                const flags = o.flags ?? 0
                if (o.visible === false || (flags & 0x01) !== 0) continue // CE OBJECT_HIDDEN = 0x01
                if ((flags & LIGHT_THRU) !== 0) continue
                return false
            }
        }
        return true
    }

    // CE combat.cc _combat_add_noncoms: the critters that joined at the round's end, still
    // to take their immediate turn (null while none are pending)
    private joinQueue: Critter[] | null = null

    nextTurn(): void {
        this.refreshHighlights()
        if (this.joinQueue !== null) return this.nextJoinTurn()

        // CE combat.cc _combat_turn: the player's damageLastTurn resets once the input ends.
        if (this.combatants[this.whoseTurn]?.isPlayer) this.player.damageLastTurn = 0

        this.turnNum++
        this.whoseTurn++

        if (this.whoseTurn >= this.combatants.length) {
            this.whoseTurn = 0
            // CE combat.cc _combat: after each round _combat_sequence (joins, leaves, 5 s
            // of game time — knockout wake-ups fire), _combatNumTurns += 1, then
            // _combat_should_end.
            const joiners = this.combatSequence()
            this.numTurns++
            if (this.shouldEnd()) {
                this.end()
                return
            }
            if (joiners.length > 0) {
                this.joinQueue = joiners
                return this.nextJoinTurn()
            }
        }
        this.beginTurn()
    }

    // CE _combat_add_noncoms: a joiner gets its full AP and an immediate _combat_turn (and
    // acts again in its place of the next round); then the round begins
    private nextJoinTurn(): void {
        const next = this.joinQueue?.shift()
        if (!next) {
            this.joinQueue = null
            this.whoseTurn = 0
            return this.beginTurn()
        }
        if (next.dead || !next.AP) return this.nextJoinTurn()
        this.whoseTurn = this.combatants.indexOf(next)
        this.inPlayerTurn = false
        next.AP.resetAP()
        if (this.turnSkipped(next)) return this.nextJoinTurn()
        if (critterIsProne(next)) return combatStandup(next, () => this.beginAITurn(next))
        this.beginAITurn(next)
    }

    private beginTurn(): void {
        // CE: attack_complex's start data covers the first combatant's turn only.
        if (this.turnNum > 2) this.gcsd = null

        // CE combat.cc _combat: _combat_set_move_all at the start of every round — each
        // combatant gets its full AP, which counts as AC until it acts (unusedApAC).
        if (this.whoseTurn === 0) this.setMoveAll()

        if (this.player.AP && !this.combatants[this.whoseTurn].isPlayer)
            drawAC(this.player.getStat('AC') + this.unusedApAC(this.player))

        if (this.combatants[this.whoseTurn].isPlayer) {
            // player turn — reset AP
            this.playerHadTurn = true
            this.inPlayerTurn = true
            this.player.AP!.resetAP()
            if (this.turnSkipped(this.player)) return this.nextTurn()
            if (critterIsProne(this.player)) combatStandup(this.player)
            drawAP(this.player.AP!.getAvailableCombatAP(), this.player.AP!.getTotalMaxAP(), this.player.AP!.move)
            drawHP(this.player.getStat('HP'))
            drawAC(this.player.getStat('AC'))
            // CE ref: combat.cc:3276 / interface.cc interfaceBarEndButtonsRenderGreenLights —
            // green lights + icombat2 when player's turn begins (buttons enabled)
            if (!window.__test?.fastMode) services.audioEngine.playSfxByName('icombat2')
            uiEndButtonsGreenLights()
            eventLogPush({
                actor: actorName(this.player),
                action: 'turn-begin',
                AP: this.player.AP!.getAvailableMoveAP(),
                HP: this.player.getStat('HP'),
                message: `${actorName(this.player)}: turn begins`,
            })
        } else {
            this.inPlayerTurn = false
            drawAP(0, this.player.AP!.getTotalMaxAP(), 0, false)
            // CE ref: interface.cc interfaceBarEndButtonsRenderRedLights —
            // red lights + icombat1 during AI turns (buttons disabled)
            if (!window.__test?.fastMode) services.audioEngine.playSfxByName('icombat1')
            uiEndButtonsRedLights()
            const critter = this.combatants[this.whoseTurn]
            // CE: only combatants act — party members too join first (_combat_add_noncoms,
            // via _combatai_notify_friends at the end of a round)
            if (critter.dead === true) return this.nextTurn()
            if (!critter.hostile) {
                // A bystander still runs the friendlyDead step of CE _combat_ai: away from
                // a body it saw fall without seeing the killer (_combatai_notify_onlookers).
                const fd: Critter | null = critter.aiFriendlyDead ?? null
                if (fd && !critter.isPlayer) {
                    critter.AP!.resetAP()
                    if (hexDistance(critter.position, fd.position) >= 10) critter.aiFriendlyDead = null
                    else if (this.aiMoveAway(critter, fd, 10, false, () => this.nextTurn())) return
                }
                return this.nextTurn()
            }

            critter.AP!.resetAP()
            // CE combat.cc _combat_turn: knocked out, dead or losing the turn → no turn
            // (DAM_LOSE_TURN is used up); a prone critter first stands up (3 AP).
            if (this.turnSkipped(critter)) return this.nextTurn()
            if (critterIsProne(critter)) {
                return combatStandup(critter, () => this.beginAITurn(critter))
            }
            this.beginAITurn(critter)
        }
    }

    // The critters that take turns (CE _list_com): the player and the combatants (`hostile`;
    // party members too, once they joined).
    private isActiveCombatant(c: Critter): boolean {
        return !c.dead && (c.isPlayer || c.hostile)
    }

    // CE combat.cc _combat_set_move_all — full AP for every combatant at a round's start.
    private setMoveAll(): void {
        for (const c of this.combatants) if (this.isActiveCombatant(c)) c.AP?.resetAP()
    }

    // CE stat.cc critterGetStat(STAT_ARMOR_CLASS): in combat, a critter's unused AP counts
    // as AC while it isn't its turn — the full AP before it acts in a round, the leftover
    // after (non-combatants have 0, CE _combat_begin). The player's HtH Evade with no
    // weapon in either hand doubles it and adds Unarmed / 12.
    unusedApAC(c: Critter): number {
        if (!world.inCombat || !c.AP || !this.isActiveCombatant(c)) return 0
        if (this.combatants[this.whoseTurn] === c) return 0
        let apMult = 1,
            evade = 0
        if (c.isPlayer && c.hasPerk(perkNameById(93) ?? 'HtH Evade')) {
            const armed = (h: any) =>
                !!h && h.pid !== undefined && h.subtype === 'weapon' && (h.weapon?.getAnim?.('idle') ?? 'aa') !== 'aa'
            if (!armed(c.leftHand) && !armed(c.rightHand)) {
                apMult = 2
                evade = Math.trunc(c.getSkill('Unarmed') / 12)
            }
        }
        return c.AP.getAvailableCombatAP() * apMult + evade
    }

    // CE combat.cc _combat_turn head: DAM_KNOCKED_OUT | DAM_DEAD | DAM_LOSE_TURN skip the
    // turn and DAM_LOSE_TURN is cleared.
    private turnSkipped(c: Critter): boolean {
        const r = c.injuryFlags
        if ((r & (DAM_KNOCKED_OUT | DAM_DEAD | DAM_LOSE_TURN)) === 0) return false
        c.injuryFlags = (r & ~DAM_LOSE_TURN) >>> 0
        combatDebug(`${actorName(c)} loses the turn (results 0x${r.toString(16)})`)
        return true
    }

    /** CE ref: combat.cc:2669 _combat_update_critter_outline_for_los() — red
     *  outline for hostile combatants, green for same-team (including
     *  companions); CE assigns these purely by team comparison, not a perk.
     *  Update to match the current targetHighlight preference and cursorMode.
     *  Call whenever cursorMode changes or preferences change mid-combat.
     *
     *  DH2 addition (no CE equivalent — CE's outline system only ever covers
     *  active combatants): also outline neutral critters (not hostile, not
     *  same team) in a distinct blue, so an unprovoked target can be located
     *  and attacked even through walls, the same way hostile/friendly
     *  outlines already show through occluding geometry (CI11).
     *
     *  Classifies every live critter on the current elevation in one pass —
     *  NOT restricted to `this.combatants` — because Combat.start() sweeps
     *  every team on the map into `triggerTeams` for a player-initiated
     *  fight (so enemy critters elsewhere can join in), which pulls
     *  not-yet-hostile, different-team critters into `this.combatants` too.
     *  An earlier version skipped those here (not yet hostile → no red/green)
     *  while ALSO excluding them from the neutral pass (already "a
     *  combatant" → skip), leaving them with no outline at all the moment
     *  combat started via the attack button before anyone had actually
     *  been shot. */
    refreshHighlights(): void {
        if (!world.player || !world.gMap) return
        const th = Config.ui.targetHighlight as string | boolean
        const wantHighlight = th === 'on' || th === true || (th === 'targeting-only' && uiState.cursorMode === 'attack')

        for (const obj of world.gMap.getObjects()) {
            if (!(obj instanceof Critter)) continue
            if (obj.dead || obj.isPlayer || !obj.visible) continue
            if (!wantHighlight) {
                obj.outline = null
                continue
            }
            const sameTeam = obj.teamNum === world.player.teamNum
            if (Config.ui.combatOutline === 'ce') {
                // CE combat.cc _combat_update_critter_outline_for_los: in the dude's line of
                // fire green / red by team; out of it, within PER × 5 hexes (half through
                // glass, OBJECT_TRANS_GLASS) OUTLINE_TYPE_32; farther, none
                const player = world.player
                if (!combatIsShotBlocked(player, player.position, obj.position, obj).blocked) {
                    obj.outline = sameTeam ? 'green' : 'red'
                } else {
                    let range = player.getStat('PER') * 5
                    if (((obj.flags ?? 0) & 0x20000) !== 0) range = Math.trunc(range / 2)
                    obj.outline = hexDistance(player.position, obj.position) <= range ? 'unseen' : null
                }
                continue
            }
            obj.outline = sameTeam ? 'green' : obj.hostile ? 'red' : 'blue'
        }
    }
}

// Combat's methods kept in other files by topic (wiki/code_quality.md Q16): installed on the prototype
// here, typed through the interface merge below. Import those files only through this module: it
// must be loaded first, so that their objects exist when it installs them.
type CombatMethods = typeof combatAttackMethods &
    typeof combatDisplayMethods &
    typeof combatProjectileMethods &
    typeof combatAiTurnMethods &
    typeof combatAiActionMethods
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
export interface Combat extends CombatMethods {}
installMethods(
    Combat.prototype,
    combatAttackMethods,
    combatDisplayMethods,
    combatProjectileMethods,
    combatAiTurnMethods,
    combatAiActionMethods,
)
