// Combat: projectiles and thrown items - misses, lines of fire, flight, where a thrown item lands
// (CE combat.cc _compute_ranged_miss / _shoot_along_path, animation.cc projectile flight).
// Methods of the Combat class, moved here verbatim and installed on its prototype by Combat.ts
// (wiki/code_quality.md Q16).

import type { Combat } from './Combat.js'
import { Config } from '../config.js'
import {
    Critter,
    Obj,
    PROTO_ID_FLARE,
    PROTO_ID_LIT_FLARE,
    createObjectWithPID,
    refillHand,
    useFlare,
} from '../object.js'
import * as GameTime from '../gametime.js'
import * as Lightmap from '../lightmap.js'
import {
    Point,
    hexDirectionTo,
    hexFromScreen,
    hexInDirection,
    hexInDirectionDistance,
    hexLine,
    hexLineBeyond,
    hexToScreen,
} from '../geometry.js'
import { world } from '../state/world.js'
import { assets } from '../state/assets.js'
import { lazyLoadImage } from '../images.js'
import { loadPRO } from '../pro.js'
import { nextShootObstacle } from './lineOfFire.js'
import { objectDistance, weaponAttackType } from './hitChance.js'
import { randomBetween } from '../random.js'
import { toTileNum } from '../tile.js'
import { uiDrawWeapon } from '../hudRefresh.js'
import { RangedMiss } from './Combat.js'

export const combatProjectileMethods = {
    // CE combat.cc _shoot_along_path — walks the line of fire from the attacker to
    // `endTile`; each critter met rolls its own to-hit per remaining round. Rounds on the
    // main target are returned; others accumulate in `extras` (max 6 victims).
    shootAlongPath(
        this: Combat,
        attacker: Critter,
        defender: Critter,
        endTile: Point,
        rounds: number,
        extras: Map<Critter, number>,
        continuous = false,
    ): number {
        let remaining = rounds
        let mainHits = 0
        let current = attacker.position
        let critter: Obj | null = attacker
        while (critter !== null) {
            if (
                (remaining <= 0 && !continuous) ||
                (current.x === endTile.x && current.y === endTile.y) ||
                extras.size >= 6
            )
                break
            critter = nextShootObstacle(attacker, current, endTile, critter)
            if (critter === null) break
            if (critter.type !== 'critter') break

            const accuracy = this.getHitChance(attacker, critter as Critter, 'torso').hit
            if (continuous) remaining = 1
            let roundsHit = 0
            while (randomBetween(1, 100) <= accuracy && remaining > 0) {
                remaining -= 1
                roundsHit += 1
            }
            if (roundsHit !== 0) {
                if (critter === defender) mainHits += roundsHit
                // CE: a burst adds up a critter's hits over the lines; continuous fire
                // keeps the first.
                else if (!continuous || !extras.has(critter as Critter))
                    extras.set(critter as Critter, (extras.get(critter as Critter) ?? 0) + roundsHit)
            }
            current = critter.position
        }
        // CE: continuous fire's path hits never count on the main target
        return continuous ? 0 : mainHits
    },
    // CE combat.cc _check_ranged_miss — looks for someone on the line of fire to take a
    // missed shot. Vanilla quirk kept by CE: the final test requires OBJECT_SHOOT_THRU on
    // the obstacle, which the shoot-mode walk never returns, so it rolls but never hits.
    checkRangedMiss(this: Combat, attacker: Critter, defender: Critter, range: number, region: string): boolean {
        const to = hexLineBeyond(attacker.position, defender.position, range)
        let success = false
        let critter: Obj | null = attacker
        let curr = attacker.position
        while (curr.x !== to.x || curr.y !== to.y) {
            critter = nextShootObstacle(attacker, curr, to, critter)
            if (critter === null) break
            if (critter.type !== 'critter') {
                success = true
                break
            }
            if (critter !== defender) {
                const c = critter as Critter
                const chance = c.dead ? 5 : Math.trunc(this.getHitChance(attacker, c, region).hit / 3)
                if (randomBetween(1, 100) <= chance) {
                    success = true
                    break
                }
            }
            curr = critter.position
        }
        const SHOOT_THRU = 0x80000000
        if (!success || critter === null || (((critter.flags ?? 0) >>> 0) & SHOOT_THRU) === 0) return false
        return false // unreachable in practice (see above)
    },
    // CE combat.cc attackCompute, ranged/throw tail: a shot that hit nothing flies on to
    // _tile_num_beyond(attacker, defender, range) (a grenade lands up to distance/2 away
    // in a random direction); the first shoot-blocking object past the defender — or
    // whatever blocks the landing tile — takes one round at ×2.
    // CE combat.cc attackCompute, ranged miss tail: the shot flies on to _tile_num_beyond
    // (grenades scatter up to distance/2 around the target); the first shoot-blocker past
    // the target becomes attack->tile and, if it is a live critter, the accidental victim.
    // Pure — the damage is applied by applyRangedMiss after the projectile arrived.
    computeRangedMiss(
        this: Combat,
        attacker: Critter,
        defender: Critter,
        weaponObj: Obj,
        dmgType: string,
    ): RangedMiss | null {
        const gMap = world.gMap
        const weapon = (weaponObj as any).weapon
        if (!gMap || !weapon) return null
        const range = weapon.getMaximumRange()

        const isGrenade =
            weaponAttackType(weaponObj) === 'throw' &&
            (dmgType === 'Explosive' || dmgType === 'Plasma' || dmgType === 'EMP')
        let tile: Point
        if (isGrenade) {
            const distance = objectDistance(attacker, attacker.position, defender) // attackCompute: objectGetDistanceBetween
            const throwDistance = Math.max(1, randomBetween(1, Math.max(1, Math.trunc(distance / 2))))
            tile = hexInDirectionDistance(defender.position, randomBetween(0, 5), throwDistance)
        } else {
            tile = hexLineBeyond(attacker.position, defender.position, range)
        }

        let accidental: Obj | null = gMap.straightPathObstacle(defender, defender.position, tile, 1, defender)
        if (accidental === null || accidental === defender) {
            accidental = gMap.blockingObjectAt(toTileNum(tile), defender.elevation, 0, null)
        }
        const SHOOT_THRU = 0x80000000
        if (accidental === null || (((accidental.flags ?? 0) >>> 0) & SHOOT_THRU) !== 0) {
            return { tile, victim: null, landing: tile }
        }
        // A wall or scenery blocker: a thrown item comes to rest on the hex before it.
        if (accidental.type !== 'critter') {
            const line = hexLine(defender.position, accidental.position) ?? []
            const before = line.length >= 2 ? line[line.length - 2] : defender.position
            return { tile: { ...accidental.position }, victim: null, landing: { x: before.x, y: before.y } }
        }
        // Only critters take damage in DH2 (CE's damage to scenery has no effect either).
        const victim = accidental as Critter
        const pos = { ...victim.position }
        if (victim.dead || victim === attacker) return { tile: pos, victim: null, landing: pos }
        return { tile: pos, victim, landing: pos }
    },
    // The proto pid of the weapon's projectile when it has a visible one (CE
    // _action_ranged: weaponGetProjectilePid, projectileProto->fid != -1).
    projectilePid(this: Combat, weaponObj: Obj): number | null {
        const pid = weaponObj.pro?.extra?.projPID
        if (pid === undefined || pid === null || pid < 0) return null
        const pro = loadPRO(pid, pid & 0xffff)
        if (!pro || pro.frmPID === undefined || pro.frmPID === -1) return null
        return pid
    },
    // CE animation.cc _make_straight_path_func (a6 = 32 for non-critters): a Bresenham
    // line in screen pixels between the two hex centres, one node every 32 steps.
    straightPathNodes(this: Combat, from: Point, to: Point): { tile: Point; x: number; y: number }[] {
        const center = (t: Point) => {
            const p = hexToScreen(t.x, t.y)
            return { x: p.x, y: p.y - 1 }
        }
        const a = center(from),
            b = center(to)
        const stepX = Math.sign(b.x - a.x),
            stepY = Math.sign(b.y - a.y)
        const ddx = 2 * Math.abs(b.x - a.x),
            ddy = 2 * Math.abs(b.y - a.y)
        let x = a.x,
            y = a.y,
            count = 0
        const nodes: { tile: Point; x: number; y: number }[] = []
        const record = () => {
            if (++count !== 32) return
            count = 0
            const tile = hexFromScreen(x, y)
            const c = center(tile)
            nodes.push({ tile, x: x - c.x, y: y - c.y })
        }
        if (ddx <= ddy) {
            let middle = ddx - ddy / 2
            for (;;) {
                record()
                if (y === b.y || nodes.length >= 200) break
                if (middle >= 0) {
                    x += stepX
                    middle -= ddy
                }
                y += stepY
                middle += ddx
            }
        } else {
            let middle = ddy - ddx / 2
            for (;;) {
                record()
                if (x === b.x || nodes.length >= 200) break
                if (middle >= 0) {
                    y += stepY
                    middle -= ddx
                }
                x += stepX
                middle += ddy
            }
        }
        return nodes
    },
    // CE actions.cc _action_ranged + animation.cc animateMoveObjectToTileStraight /
    // _object_straight_move: the projectile appears on the hex next to the attacker
    // (_combat_bullet_start), faces the target and moves one path node per frame at the
    // FRM's fps (+ combat speed in combat, ANIM_WALK), cycling its frames; on arrival it
    // is removed and `onArrive` applies the impact.
    flyProjectile(
        this: Combat,
        attacker: Critter,
        target: Critter,
        dest: Point,
        pid: number,
        onArrive: () => void,
    ): void {
        const gMap = world.gMap
        if (!gMap || window.__test?.fastMode) return onArrive()
        const rotation = hexDirectionTo(attacker.position, target.position)
        const start = hexInDirection(attacker.position, rotation)
        const nodes = start ? this.straightPathNodes(start, dest) : []
        if (!start || nodes.length === 0) return onArrive()

        const proj = createObjectWithPID(pid, -1)
        proj.position = { ...start }
        proj.orientation = rotation
        proj.frame = 0
        lazyLoadImage(proj.art, () => {
            if (world.gMap !== gMap) return onArrive()
            gMap.addObject(proj)
            proj.shift = { x: 0, y: 0 }
            const info = assets.imageInfo![proj.art]
            const fps = (info?.fps || 10) + (world.inCombat ? Config.combat.combatSpeed : 0)
            // Shown on the start hex for one frame, then one node per frame; the last node
            // stays visible for a frame before the projectile is removed (CE hides it in
            // the next animation step).
            let index = 0
            let last = window.performance.now()
            proj.updateAnim = function (this: Obj): void {
                const now = window.performance.now()
                if (now - last < 1000 / fps) return
                last = now
                if (index >= nodes.length) {
                    this.updateAnim = () => {}
                    gMap.destroyObject(this)
                    onArrive()
                    return
                }
                if (info && info.numFrames > 1) this.frame = (this.frame + 1) % info.numFrames
                const node = nodes[index++]
                this.position = { x: node.tile.x, y: node.tile.y }
                this.shift = { x: node.x, y: node.y }
            }
        })
    },
    // CE actions.cc _action_ranged (ANIM_THROW_ANIM): itemRemove(attacker, weapon, 1)    // CE actions.cc _action_ranged (ANIM_THROW_ANIM): itemRemove(attacker, weapon, 1)
    // makes one item of the stack the projectile while the rest stays in the hand
    // (itemReplace); it lands on `landing` — the target's tile on a hit, where the miss
    // stopped otherwise — and stays there. Grenades (explosive / plasma / EMP) explode
    // and are gone.
    takeThrownItem(this: Combat, attacker: Critter, weaponObj: Obj): Obj | null {
        if (weaponObj.pid === undefined) return null
        const a = attacker
        let item: Obj
        if ((weaponObj.amount ?? 1) > 1) {
            weaponObj.amount -= 1
            item = createObjectWithPID(weaponObj.pid)
            item.amount = 1
        } else {
            const idx = attacker.inventory.indexOf(weaponObj)
            if (idx !== -1) attacker.inventory.splice(idx, 1)
            for (const hand of ['leftHand', 'rightHand'] as const) {
                if (a[hand] === weaponObj) refillHand(attacker, hand, weaponObj) // CE actions.cc:763 itemReplace
            }
            item = weaponObj
        }
        if (attacker.isPlayer) uiDrawWeapon()
        // CE actions.cc _action_ranged → combat_ai.cc _cAIPrepWeaponItem: a thrown flare is
        // lit first when it is dark (ambient < 85 %) and the thrower has INT 3+.
        if (item.pid === PROTO_ID_FLARE && attacker.getStat('INT') >= 3 && GameTime.getAmbientLight() < 65536 * 0.85)
            useFlare(item, attacker)
        return item
    },
    placeThrownItem(this: Combat, item: Obj, landing: Point, weaponObj: Obj, dmgType: string): void {
        const gMap = world.gMap
        if (!gMap || this.isExplosiveAttack(weaponObj, dmgType)) return
        gMap.addObject(item)
        item.move({ x: landing.x, y: landing.y }, gMap.getObjects().length - 1, false)
        if (item.pid === PROTO_ID_LIT_FLARE && Config.engine.doFloorLighting) Lightmap.rebuildLight() // the flare lights where it lands
    },
}
