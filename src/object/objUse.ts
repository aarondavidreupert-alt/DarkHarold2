// Obj: using an object (doors, containers, ladders, stairs, scripted use), explosives going off,
// picking up and dropping (CE proto_instance.cc _obj_use*, actions.cc _obj_pickup / _obj_drop,
// item.cc explosives). Methods of the Obj class, moved here verbatim and installed on its
// prototype by Obj.ts (wiki/code_quality.md Q16).

import type { Obj } from './Obj.js'
import {
    ANIM,
    SCENERY_SOUND_EFFECT,
    critterWeaponCode,
    playCharAnimSfx,
    playCharSfx,
    playOpenSfx,
    sfxBuildCharName,
} from '../sfxNames.js'
import { ANIM_STAND, critterDamage } from '../critter.js'
import { Combat } from '../combat/Combat.js'
import { Config } from '../config.js'
import type { Critter } from './Critter.js'
import * as Lightmap from '../lightmap.js'
import { Point, hexDirectionTo, hexNeighbors } from '../geometry.js'
import * as Scripting from '../scripting.js'
import { computeExplosionDamage, explosionRingCritters, scriptsExplodeScenery } from '../combat/explosion.js'
import { dbg, dbgWarn } from '../logger.js'
import { drawHP } from '../hudRefresh.js'
import { fromTileNum, toTileNum } from '../tile.js'
import { getProtoMsg, getRandomInt } from '../util.js'
import globalState from '../globalState.js'
import { world } from '../state/world.js'
import { services } from '../state/services.js'
import { isChargedMiscItem, useChargedMiscItem } from '../miscItem.js'
import { lazyLoadImage } from '../images.js'
import { makePID } from '../pro.js'
import { uiDrawWeapon } from '../hudRefresh.js'
import { uiLog } from '../messageLog.js'
import {
    BOOKS,
    MISC_USE_CONSUMED,
    PROTO_ID_FLARE,
    PROTO_ID_LIT_FLARE,
    createObjectWithPID,
    explosionRunning,
    itemOwner,
    objState,
    refillHand,
    setObjectOpen,
    toggleObjectOpen,
    useBook,
    useExplosive,
    useFlare,
} from './Obj.js'

export const objUseMethods = {
    // Returns whether or not the object was used
    use(this: Obj, source?: Critter, useScript?: boolean): boolean {
        // CE proto_instance.cc _obj_use_misc_item: Ramirez's box, the Raiders map, Cat's Paw #5,
        // the Pip-Boy enhancers and the survey map run their use_p_proc (no override) and are
        // then used up (_obj_use_item rc 1: itemRemove + _obj_destroy)
        if (MISC_USE_CONSUMED.has(this.pid)) {
            const owner = itemOwner(this)
            if (owner) {
                if (useScript !== false && this._script?.use_p_proc !== undefined) Scripting.use(this, owner)
                if ((this.amount ?? 1) > 1) this.amount -= 1
                else {
                    const i = owner.inventory.indexOf(this)
                    if (i !== -1) owner.inventory.splice(i, 1)
                    const a = owner
                    for (const hand of ['leftHand', 'rightHand'] as const)
                        if (a[hand] === this) refillHand(owner, hand, this)
                    if (owner.isPlayer) uiDrawWeapon()
                }
                return true
            }
        }
        if (this.canUse === false && !this.isContainer) {
            dbg('object', "[Object] can't use object")
            return false
        }

        // CE _obj_use_container: a locked container — its locked sound and proto.msg 487, and
        // no script; _obj_use_door: a locked door plays its locked sound, its script decides
        if (this.locked && (this.isContainer || this.isDoor)) {
            playOpenSfx(this, SCENERY_SOUND_EFFECT.locked)
            if (this.isContainer) {
                if (source?.isPlayer ?? true) uiLog(getProtoMsg(487) ?? 'It is locked.')
                return false
            }
        }

        if (useScript !== false && this._script && this._script.use_p_proc !== undefined) {
            if (source === undefined) {
                source = world.player!
            }
            if (Scripting.use(this, source!) === true) {
                dbg('object', '[Object] useObject: overridden by script')
                return true // script overrided us
            }
        } else if (this.script !== undefined && !this._script) {
            dbgWarn('object', '[Object] used object has script but is not loaded: ' + this.script)
        }

        if (this.subtype === 'drug') {
            if (source === undefined) source = world.player as Critter
            if (globalState.drugHandler) {
                const handled = globalState.drugHandler(this, source)
                if (handled) {
                    // CE ref: item.cc itemUse() — drug item is consumed on use.
                    const owner = source ?? (world.player as Critter)
                    if (owner) {
                        const idx = owner.inventory.indexOf(this)
                        if (idx !== -1) {
                            if (this.amount > 1) this.amount--
                            else owner.inventory.splice(idx, 1)
                        } else {
                            // in a hand: one off the stack, the last one replaced (itemReplace)
                            const ownerAny = owner
                            const hand =
                                ownerAny.leftHand === this
                                    ? 'leftHand'
                                    : ownerAny.rightHand === this
                                      ? 'rightHand'
                                      : null
                            if (hand && (this.amount ?? 1) > 1) this.amount--
                            else if (hand) refillHand(owner as Critter, hand, this)
                        }
                    }
                    if (source?.isPlayer) drawHP(source.getStat('HP'))
                }
                return handled
            }
        }

        // CE ref: proto_instance.cc:1245 — First Aid Kit / Doctor's Bag trigger skills.
        if (this.subtype === 'misc' && globalState.miscItemUseHandler) {
            if (source === undefined) source = world.player as Critter
            if (globalState.miscItemUseHandler(this, source)) return true
        }

        // CE ref: item.cc:2246-2280 _item_m_use_charged_item() — Stealth Boy / Geiger Counter toggle.
        if (isChargedMiscItem(this)) {
            if (source === undefined) source = world.player as Critter
            useChargedMiscItem(this, source ?? null)
            return true
        }

        if (this.isExplosive) {
            useExplosive(this, source!)
            return true
        }

        // CE _obj_use_item → _obj_use_book
        if (BOOKS[this.pid]) {
            useBook(this)
            return true
        }

        // CE _obj_use_item → _obj_use_flare
        if (this.pid === PROTO_ID_FLARE) {
            useFlare(this, source ?? (world.player as Critter))
            return true
        }

        // Play the interact animation on the source critter (non-blocking: the
        // interaction effect proceeds concurrently). Skipped for ladders because
        // the climb animation already handles the timing in the isLadder branch.
        if (source && !this.isLadder && source.hasAnimation('use')) {
            source.staticAnimation('use', () => source.clearAnim())
        }

        if (this.isDoor) {
            // CE _obj_use_door: closing over something in the doorway — proto.msg 597
            if (this.open) {
                const gMap = world.gMap
                const elevation = this.elevation ?? gMap!.currentElevation
                if (gMap!.blockingObjectAt(toTileNum(this.position), elevation, 0, this) !== null) {
                    uiLog(getProtoMsg(597) ?? 'The doorway seems to be blocked.')
                    return false
                }
            }
            setObjectOpen(this, !this.open, true, true, true)
        } else if (this.isContainer) {
            // CE _obj_use_container: proto.msg 485 "You search the %s." / 486 "You close the %s."
            if (source?.isPlayer ?? true)
                uiLog(
                    (
                        getProtoMsg(this.open ? 486 : 485) ?? (this.open ? 'You close the %s.' : 'You search the %s.')
                    ).replace('%s', this.getName()),
                )
            toggleObjectOpen(this, true, true)
        } else if (this.isStairs) {
            // CE proto_instance.cc useStairs: builtTile -1 fails; destinationMap > 0 is
            // another map, anything else this one.
            if (this.extra.destination === -1 || this.extra.destination === undefined) return false
            const destTile = fromTileNum(this.extra.destination & 0xffff)
            const destElev = ((this.extra.destination >> 28) & 0xf) >> 1

            if (!(this.extra.destinationMap > 0)) {
                // same map, new destination
                dbg('object', `[Object] stairs: tile=(${destTile.x}, ${destTile.y}), elev=${destElev}`)

                world.player!.position = destTile
                world.gMap!.changeElevationFaded(destElev)
                // CE ref: map.cc:386 mapSetElevation fires only map_update_p_proc, not map_enter_p_proc
                world.gMap!.updateMap()
            } else {
                dbg(
                    'object',
                    `[Object] stairs → ${this.extra.destinationMap} @ (${destTile.x}, ${destTile.y}), elev=${destElev}`,
                )
                world.gMap!.loadMapByID(this.extra.destinationMap, destTile, destElev)
            }
        } else if (this.isLadder) {
            const isTop = this.pro!.extra.subType === 4
            // CE ref: proto_instance.cc:1512 useLadderDown/useLadderUp — reads tile and
            // elevation from the packed destinationBuiltTile field (same format as stairs);
            // builtTile -1 fails, destinationMap != 0 is a map transition (tools/fomap.py
            // reads it since 2026-10-24; before, every ladder stayed on its map).
            if (this.extra.destination === -1 || this.extra.destination === undefined) return false
            const destTile = fromTileNum(this.extra.destination & 0xffff)
            const destElev = ((this.extra.destination >> 28) & 0xf) >> 1
            const destMap = this.extra.destinationMap ?? 0
            dbg(
                'object',
                `[Object] ladder (${isTop ? 'top' : 'bottom'} → map ${destMap} tile=${destTile.x},${destTile.y} elev=${destElev})`,
            )

            if (destMap < 0) {
                // CE mapHandleTransition: -1 town map, -2 world map — no vanilla ladder has either
                dbgWarn('object', `[Object] ladder to map ${destMap} (town / world map) not supported`)
                return false
            }
            const transition = () => {
                if (destMap !== 0) {
                    world.gMap!.loadMapByID(destMap, destTile, destElev)
                    return
                }
                world.player!.position = destTile
                world.gMap!.changeElevationFaded(destElev)
                // CE ref: map.cc:386 mapSetElevation fires only map_update_p_proc
                world.gMap!.updateMap()
            }

            const actor = source ?? world.player
            if (!isTop) {
                // CE actions.cc _action_climb_ladder (SCENERY_TYPE_LADDER_UP): facing the
                // ladder, a drawn weapon put away (ANIM_PUT_AWAY), ANIM_CLIMB_LADDER with its
                // sound (actions.cc:1050), _obj_use, then the weapon taken out (ANIM_TAKE_OUT)
                actor!.orientation = hexDirectionTo(actor!.position, this.position)
                const weaponCode = critterWeaponCode(actor!)
                const takeOut = () => {
                    if (weaponCode > 0 && actor!.hasAnimation('weapon-draw')) {
                        playCharAnimSfx(actor!, ANIM.takeOut, weaponCode)
                        actor!.staticAnimation('weapon-draw', () => actor!.clearAnim())
                    }
                }
                const climb = () => {
                    playCharSfx(actor!, sfxBuildCharName(actor!, 4 /* ANIM_CLIMB_LADDER */))
                    if (actor!.hasAnimation('climb'))
                        actor!.staticAnimation('climb', () => {
                            actor!.clearAnim()
                            transition()
                            takeOut()
                        })
                    else {
                        transition()
                        takeOut()
                    }
                }
                if (weaponCode > 0 && actor!.hasAnimation('weapon-holster')) {
                    playCharAnimSfx(actor!, ANIM.putAway)
                    actor!.staticAnimation('weapon-holster', climb)
                } else {
                    climb()
                }
                return true // updateMap() runs in transition()
            } else if (actor!.hasAnimation('use')) {
                // A ladder down: the normal magic-hands use (CE _action_use_an_item_on_object)
                actor!.staticAnimation('use', () => {
                    actor!.clearAnim()
                    transition()
                })
                return true
            }
            transition()
            return true
        } else if (this.type === 'item') {
            // CE _protinst_use_item: an item with no use of its own — "That does nothing."
            // (proto.msg 582)
            if (source?.isPlayer ?? true) uiLog(getProtoMsg(582) ?? 'That does nothing.')
            return false
        } else {
            this.singleAnimation()
            // CE _obj_use: a scenery use no script overrode — "You see: %s." (proto.msg 480) with
            // objectGetName: the proto's pro_scen.msg name (obj.name is set for items only)
            if (this.type === 'scenery' && (source?.isPlayer ?? true))
                uiLog((getProtoMsg(480) ?? 'You see: %s.').replace('%s', this.getName()))
        }

        world.gMap!.updateMap()
        return true
    },
    // CE actions.cc actionExplode — the explosion sprite on the tile and the six around
    // it, the critter on the tile plus up to 6 more in the blast rings (radius 3,
    // _compute_explosion_on_extras), each taking d(min, max) − explosion DT/DR with
    // knockback; then damage_p_proc for the scripts in range (_scr_explode_scenery).
    // `_radius` is unused: CE's scripted explosions always use the rocket radius.
    // `animate` false (CE actionExplode's animate): the blast lands at once, no sprites.
    // False (CE −2, _action_in_explode) while another animated explosion is still running.
    explode(
        this: Obj,
        source: Obj | null,
        minDmg: number,
        maxDmg: number,
        _radius: number = 3,
        animate = true,
    ): boolean {
        if (animate && explosionRunning()) return false
        const killer = (source ?? this) as Critter // explosive itself as killer when source is null
        const center = { x: this.position.x, y: this.position.y }
        const elevation = this.elevation ?? world.gMap?.currentElevation ?? 0
        const blast = () => this.explosionBlast(killer, center, elevation, minDmg, maxDmg)
        if (!animate) {
            blast()
            return true
        }
        objState.explosionStarted = performance.now()
        const explosion = createObjectWithPID(makePID(5 /* misc */, 14 /* Explosion */), -1)
        explosion.position = { ...center }

        const adjExplosions = hexNeighbors(center).map((pos) => {
            const adj = createObjectWithPID(makePID(5 /* misc */, 14 /* Explosion */), -1)
            adj.position = { x: pos.x, y: pos.y }
            return adj
        })

        lazyLoadImage(explosion.art, () => {
            if (!world.gMap) {
                objState.explosionStarted = -1
                return
            }
            world.gMap.addObject(explosion)
            for (const adj of adjExplosions) {
                world.gMap!.addObject(adj)
                adj.singleAnimation(false, () => {
                    adj.anim = null
                    world.gMap?.destroyObject(adj)
                })
            }
            services.audioEngine?.playSfxByName('whn1xxx1', this) // CE actionExplode

            let fired = false
            explosion.singleAnimation(false, () => {
                // updateAnim keeps calling a finished animation's callback until the anim
                // is cleared; the blast happens once.
                explosion.anim = null
                if (fired) return
                fired = true
                objState.explosionStarted = -1
                world.gMap?.destroyObject(explosion)
                blast()
            })
        })
        return true
    },
    explosionBlast(this: Obj, killer: Critter, center: Point, elevation: number, minDmg: number, maxDmg: number): void {
        const gMap = world.gMap
        if (!gMap) return

        const atTile = gMap.blockingObjectAt(toTileNum(center), elevation, 0, null)
        const main = atTile && atTile.type === 'critter' && !(atTile as Critter).dead ? (atTile as Critter) : null
        const victims = [...(main ? [main] : []), ...explosionRingCritters(center, elevation, main, false)]
        dbg('object', `[Object] explosion: ${minDmg}-${maxDmg}, ${victims.length} critter(s)`)
        const wasDead = new Set(victims.filter((v) => v.dead))
        for (const v of victims) {
            if (v.dead) continue
            const { damage, knockback } = computeExplosionDamage(minDmg, maxDmg, v, getRandomInt)
            critterDamage(v, damage, killer, true, true, 'Explosive', undefined, {
                attackerAnim: ANIM_STAND,
                weapon: null,
                knockback,
                knockbackRotation: hexDirectionTo(center, v.position),
                // CE actionExplode → _check_death(ANIM_EXPLODED_TO_NOTHING, MAX_BLOOD) (the
                // max-blood path critter_dmg uses too)
                scriptDamage: true,
            })
            if (v.isPlayer) drawHP(v.getStat('HP'))
        }
        // CE actions.cc _report_explosion: the source gets the XP of every critter that newly
        // died (the dude only), survivors remember it as who hit them, and out of combat the
        // first survivor starts a fight with it (scriptsRequestCombat, after this)
        let xp = 0
        let anyDefender: Critter | null = null
        for (const v of victims) {
            if (v === killer) continue
            if (v.dead) {
                if (killer?.isPlayer && !wasDead.has(v)) xp += v.pro?.extra?.XPValue ?? 0
            } else if (killer) {
                ;(v as any).whoHitMe = killer
                anyDefender ??= v
            }
        }
        if (killer?.isPlayer) Combat.giveExps(xp)
        if (anyDefender && killer && !world.inCombat) {
            const attacker = anyDefender
            // CE: CombatStartData { attacker: the survivor, defender: the source, no bonuses }
            setTimeout(() => {
                if (world.inCombat || attacker.dead) return
                Combat.start(undefined, {
                    attacker,
                    defender: killer,
                    actionPointsBonus: 0,
                    accuracyBonus: 0,
                    damageBonus: 0,
                    minDamage: 0,
                    maxDamage: 0x7fffffff,
                    overrideAttackResults: false,
                    attackerResults: 0,
                    targetResults: 0,
                })
            }, 0)
        }

        scriptsExplodeScenery(this, center, elevation, (obj, target) => {
            if (!obj._script) return
            try {
                Scripting.damage(obj, target, null as any, 20) // fixed param 20
            } catch (e) {
                dbgWarn('object', `[Object] damage_p_proc error for ${obj.script}:`, e)
            }
        })

        world.gMap?.destroyObject(this)
    },
    // CE actions.cc actionPickUp: walk to the item (in combat: AP-limited walk + 3 AP,
    // _check_scenery_ap_cost), ANIM_MAGIC_HANDS_GROUND, and on its action frame the pickup
    // sound and proto_instance.cc _obj_pickup — the item's pickup_p_proc (an override keeps
    // it where it is), then itemAttemptAdd (proto.msg 905 when too heavy).
    pickup(this: Obj, source: Critter) {
        let done = false
        const objPickup = () => {
            if (done) return
            done = true
            services.audioEngine.playSfxByName('ipickup1', source)
            if (this._script) {
                dbg('object', '[Object] picking up %o', this)
                if (Scripting.pickup(this, source)) return // script handled it
            }
            if (!source.canCarry(this, this.amount ?? 1)) {
                uiLog(getProtoMsg(905) ?? 'You cannot pick that up. You are at your maximum weight capacity.')
                return
            }
            source.addInventoryItem(this, this.amount)
            world.gMap!.destroyObject(this)
        }
        const playPickup = () => {
            if (source.hasAnimation('pickUp')) {
                source.staticAnimation(
                    'pickUp',
                    () => {
                        objPickup()
                        source.clearAnim()
                    },
                    false,
                    undefined,
                    objPickup,
                )
            } else {
                objPickup()
                source.clearAnim()
            }
        }
        source.walkInFrontOfToAct(this.position, playPickup)
    },
    // CE proto_instance.cc _obj_drop(owner, item): the owner's is_dropping_p_proc
    // (source_obj = the item), then the item's drop_p_proc (source_obj = the owner);
    // either can override and keep the item. Otherwise it leaves the owner (inventory or
    // hand / armor slot) and lands on the owner's tile. True when it was dropped.
    drop(this: Obj, source: Obj): boolean {
        if (source._script && Scripting.isDropping(source, this)) return false
        if (this._script && Scripting.drop(this, source)) return false

        const owner = source as any
        const i = source.inventory.indexOf(this)
        if (i !== -1) source.inventory.splice(i, 1)
        else for (const slot of ['leftHand', 'rightHand', 'armor']) if (owner[slot] === this) owner[slot] = null
        this.flags = (this.flags ?? 0) & ~0x7000000 // no longer in a hand / worn

        services.audioEngine.playSfxByName('iputdown')
        world.gMap!.addObject(this) // add to objects
        if (this.pid === PROTO_ID_LIT_FLARE && Config.engine.doFloorLighting) Lightmap.rebuildLight() // its light now on the floor
        const idx = world.gMap!.getObjects().length - 1 // our new index
        this.move({ x: source.position.x, y: source.position.y }, idx)
        return true
    },
}
