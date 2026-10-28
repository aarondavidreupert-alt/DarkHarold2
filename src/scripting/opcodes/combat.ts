// Script opcodes: combat and party opcodes (CE op_attack_complex, op_terminate_combat, op_party_add, ...).
// Methods of the Script class (scripting.ts), kept here by topic and installed on its prototype
// there; vm_bridge.ts and the Lua prelude call them as before (wiki/code_quality.md Q16).

import type { Script } from '../../scripting.js'
import { Combat, isCombatActive } from '../../combat.js'
import { Config } from '../../config.js'
import { Critter, Obj } from '../../object.js'
import * as SfallArrays from '../../sfallArrays.js'
import * as SfallHooks from '../../sfallHooks.js'
import globalState from '../../globalState.js'
import { info, isGameObject, log, requestScript, scriptingState } from '../../scripting.js'

export const combatOpcodes = {
    // combat
    attack_complex(
        this: Script,
        obj: Obj,
        calledShot: number,
        numAttacks: number,
        bonus: number,
        minDmg: number,
        maxDmg: number,
        attackerResults: number,
        targetResults: number,
    ) {
        info('[enter combat via attack_complex]')
        // CE opAttackComplex: self attacks the target. Nothing happens when either is
        // inactive (dead / knocked out) or hidden, or the target is fleeing.
        if (!Config.engine.doCombat) return
        const initiator = this.self_obj as Critter
        const target = obj as Critter
        if (!initiator || !isGameObject(obj) || target.type !== 'critter') return
        const inactive = (c: Critter) => c.dead || (c.injuryFlags & 0x01) !== 0 || c.visible === false
        if (inactive(initiator) || inactive(target)) return
        if (target.fleeing) return
        if (isCombatActive() || globalState.combat) {
            // In combat: the attacker engages the target.
            if (!initiator.hostile && !initiator.isPlayer) {
                initiator.hostile = true
                initiator.whoHitMe = target
            }
            return
        }
        initiator.whoHitMe = target
        // Mark the initiating critter hostile before combat starts so the LOS
        // scan in nextTurn() counts it as active and doesn't skip its turn.
        if (!initiator.isPlayer) initiator.hostile = true
        // CombatStartData: bonus → accuracy, min/max damage; equal attacker / target
        // results override the hit's results (CE's quirk: the target's are used).
        // CE scriptsRequestCombat: the fight starts from the game loop once the script returns
        requestScript('combat', () =>
            Combat.start(initiator, {
                attacker: initiator,
                defender: target,
                actionPointsBonus: 0,
                accuracyBonus: bonus,
                damageBonus: 0,
                minDamage: minDmg,
                maxDamage: maxDmg,
                overrideAttackResults: attackerResults === targetResults,
                attackerResults,
                targetResults,
            }),
        )
    },
    terminate_combat(this: Script) {
        info('[terminate_combat]')
        if (globalState.combat) globalState.combat.forceEnd()
    },
    // CE opAttackSetup (0x8143) — attacker engages defender (starts combat if needed).
    attack_setup(this: Script, attacker: Obj, defender: Obj) {
        if (!isGameObject(attacker) || !isGameObject(defender)) return
        const a = attacker as Critter,
            d = defender as Critter
        if (a.dead || a.visible === false) return
        if (d.dead || d.visible === false) return
        if ((d as any).isFleeing) return // CRITTER_MANUEVER_FLEEING
        if (globalState.inCombat) {
            // in combat: ENGAGING with the defender as who hit it (unless already engaging)
            if (!a.engaging) {
                a.engaging = true
                a.whoHitMe = d
            }
            if (!a.isPlayer) a.hostile = true
        } else if (Config.engine.doCombat) {
            // scriptsRequestCombat with neutral start data
            if (!a.isPlayer) a.hostile = true
            requestScript('combat', () =>
                Combat.start(a.isPlayer ? undefined : a, {
                    attacker: a,
                    defender: d,
                    actionPointsBonus: 0,
                    accuracyBonus: 0,
                    damageBonus: 0,
                    minDamage: 0,
                    maxDamage: 0x7fffffff,
                    overrideAttackResults: false,
                    attackerResults: 0,
                    targetResults: 0,
                }),
            )
        }
    },
    // party
    party_member_obj(this: Script, pid: number) {
        log('party_member_obj', [pid], 'party')
        return globalState.gParty.getPartyMemberByPID(pid) || 0
    },
    party_add(this: Script, obj: Critter) {
        log('party_add', [obj])
        globalState.gParty.addPartyMember(obj)
        if (scriptingState.currentDialogueObject) SfallHooks.gameModeSpecial(true) // sfall: joins in dialogue
    },
    party_remove(this: Script, obj: Critter) {
        // CE ref: interpreter_extra.cc:3956 — silently no-ops when obj isn't a
        // party member (dismissal dialogue hook).
        log('party_remove', [obj])
        globalState.gParty.dismissPartyMember(obj)
        if (scriptingState.currentDialogueObject) SfallHooks.gameModeSpecial(true) // sfall: leaves in dialogue
    },
    // CE opPartyMemberList (0x8271): a temporary array of the party (party_member.cc
    // get_all_party_members_objects: the dude first; without include_hidden only
    // living, visible critters)
    party_member_list(this: Script, includeHidden: number) {
        const members = [globalState.player, ...(globalState.gParty?.getPartyMembers() ?? [])].filter(
            (o: any) => o && (includeHidden || (o.type === 'critter' && !o.dead && o.visible !== false)),
        )
        return SfallArrays.arrayFromObjects(members as object[])
    },
}
