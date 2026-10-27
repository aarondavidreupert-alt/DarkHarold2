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

// FRM animation state machine for Critter. Methods are attached to
// Critter.prototype via TypeScript declaration merging. Split out of
// object.ts per wiki/ts-split-refactor.md §2.

import { Config } from '../config.js'
import { directionOfDelta, hexDistance, Point } from '../geometry.js'
import { randomBetween } from '../random.js'
import { objectOnScreen } from '../renderer.js'
import globalState from '../globalState.js'
import { lazyLoadImage } from '../images.js'
import { dbg, dbgWarn } from '../logger.js'
import { artGetCode } from '../pro.js'
import { ANIM, critterWeaponCode, playCharAnimSfx } from '../sfxNames.js'
import { currentUnarmed } from '../unarmed.js'
import { Critter } from './Critter.js'
// Imported from Obj (not the barrel) to avoid a cycle through ../object.js.
import { Obj } from './Obj.js'
import { canUseDoor } from '../map/pathfinder.js'
import { drawAP } from '../ui_hud.js'

// Suppress unused-import warning — Obj is referenced indirectly via the
// import-cycle break documented above.
void Obj

declare module './Critter.js' {
    interface Critter {
        getBase(): string
        getAnimation(anim: string): string
        hasAnimation(anim: string): boolean
        setIdleArt(): void
        staticAnimation(
            anim: string,
            callback?: () => void,
            waitForLoad?: boolean,
            reversed?: boolean,
            onActionFrame?: () => void,
        ): void
        // FA3: fired once when the current static animation reaches its FRM action frame
        // (CE art.h ArtFrame.actionFrame), or just before animCallback if it never does.
        actionFrameCallback?: (() => void) | null
        fireActionFrame(): void
        playWeaponSwapAnim(swapFn: () => void, callback?: () => void): void
        clearAnim(): void
        updateStaticAnim(): void
        updateLoopingAnim(): void
        updateAnim(): void
        getWalkLerp(): { hexA: Point; hexB: Point; t: number } | null
        walkFrameCE(): void
        walkFrameBlend(): { x: number; y: number }
    }
}

// Animation kind lookup — 'static' anims play once / loop in place, 'move'
// anims (walk/run) advance position via partial-action chunks.
const animInfo: { [anim: string]: { type: string } } = {
    idle: { type: 'static' },
    attack: { type: 'static' },
    'weapon-reload': { type: 'static' },
    walk: { type: 'move' },
    'static-idle': { type: 'static' },
    static: { type: 'static' },
    use: { type: 'static' },
    pickUp: { type: 'static' },
    climb: { type: 'static' },
    hitFront: { type: 'static' },
    // Sentinel for a finished death animation — updateAnim() returns immediately,
    // freezing the critter on its last death frame permanently.
    dead: { type: 'static' },
    'weapon-draw': { type: 'static' },
    'weapon-holster': { type: 'static' },
    // FO2-CE ref: animation.cc — single-shot forward play (updateStaticAnim, !reversed branch)
    single: { type: 'static' },
    reverse: { type: 'static' },
    fidget: { type: 'static' },
    hitBack: { type: 'static' },
    dodge: { type: 'static' },
    knockdownFront: { type: 'static' },
    knockdownBack: { type: 'static' },
    getUpFront: { type: 'static' },
    getUpBack: { type: 'static' },
    knockout: { type: 'static' },
    run: { type: 'move' },
}

interface PartialAction {
    startFrame: number
    endFrame: number
    step: number
}

function getAnimDistance(art: string): number {
    const info = globalState.imageInfo[art]
    if (info === undefined) {
        throw new Error('no image info for ' + art)
    }

    // Direction E (index 1) gives purely horizontal screen displacement of +32px per hex.
    // Direction NE (index 0) is oblique with a smaller, sometimes-negative x component
    // that makes the /32 formula produce wrong (too-low) step counts.
    // CE ref: Art.xOffsets[rotation] — rotation 1 (E) is the correct anchor.
    const lastShift = info.frameOffsets[1][info.numFrames - 1].ox
    return Math.max(1, Math.floor((lastShift + 16) / 32))
}

function getAnimPartialActions(art: string, anim: string): { movement: number; actions: PartialAction[] } {
    const partialActions = { movement: 0, actions: [] as PartialAction[] }
    let numPartials = 1

    if (anim === 'walk' || anim === 'run') {
        numPartials = getAnimDistance(art)
        partialActions.movement = numPartials
    }

    if (numPartials === 0) {
        numPartials = 1
    }

    const delta = Math.floor(globalState.imageInfo[art].numFrames / numPartials)
    let startFrame = 0
    let endFrame = delta
    for (let i = 0; i < numPartials; i++) {
        partialActions.actions.push({ startFrame: startFrame, endFrame: endFrame, step: i })
        startFrame += delta
        endFrame += delta // ?
    }

    // extend last partial action to the last frame
    partialActions.actions[partialActions.actions.length - 1].endFrame = globalState.imageInfo[art].numFrames

    return partialActions
}

Critter.prototype.getBase = function (this: Critter): string {
    return this.art.slice(0, -2)
}

Critter.prototype.getAnimation = function (this: Critter, anim: string): string {
    const base = this.getBase()

    // 'anim:<id>' — a CE anim id (animation.h), e.g. the death and corpse anims
    // chosen by critter/deathAnim.ts; art code from CE art.cc _art_get_code.
    if (anim.startsWith('anim:')) {
        // CE buildFid keeps the fid's weapon code (the wielded weapon's animation code);
        // without that FRM, the unarmed one.
        const id = Number(anim.slice(5))
        const held = this.equippedWeapon
        const weaponCode = held && held.pid !== undefined ? ((held as any).pro?.extra?.animCode ?? 0) : 0
        const armed = weaponCode ? artGetCode(id, weaponCode) : null
        if (armed && globalState.imageInfo[base + armed[0] + armed[1]] !== undefined) return base + armed[0] + armed[1]
        const code = artGetCode(id, 0)
        return code ? base + code[0] + code[1] : base + 'aa'
    }

    // try weapon animation first
    const weaponObj = this.equippedWeapon
    if (weaponObj !== null && Config.engine.doUseWeaponModel === true) {
        if (!weaponObj.weapon) {
            throw Error()
        }
        const wepAnim = weaponObj.weapon.getAnim(anim)
        if (wepAnim) {
            const key = base + wepAnim
            // CE ref: art.cc buildFid() — only use armed FRM set when it exists in the atlas;
            // fall through to unarmed fallback below when the FRM is absent.
            if (globalState.imageInfo[key] !== undefined) return key
        }
    }

    const wep = 'a'
    switch (anim) {
        case 'attack':
            if (weaponObj === null) {
                // Unarmed: pick punch ('aq') or kick ('ar') based on active hand/mode
                const mode = currentUnarmed(this).mode
                const candidate = base + (mode.family === 'kick' ? 'ar' : 'aq')
                if (globalState.imageInfo[candidate] !== undefined) return candidate
                return base + 'aa' // fallback to idle if FRM not present
            }
            dbg('animation', '[Animation] default attack animation instead of weapon animation')
            return base + wep + 'a'
        case 'idle':
            return base + wep + 'a'
        case 'walk':
            return base + wep + 'b'
        case 'run':
            return base + wep + 't'
        case 'shoot':
            return base + wep + 'j'
        case 'weapon-reload':
            return base + wep + 'a'
        case 'weapon-draw': {
            // Xc = pull out weapon (played forward)
            const wObj = this.equippedWeapon
            const skin = wObj?.weapon?.getSkin() ?? 'a'
            return base + skin + 'c'
        }
        case 'weapon-holster': {
            // Xd = put away weapon (played forward)
            const wObj = this.equippedWeapon
            const skin = wObj?.weapon?.getSkin() ?? 'a'
            return base + skin + 'd'
        }
        case 'static-idle':
            return base + wep + 'a'
        case 'static':
            return this.art
        case 'hitFront':
            return base + 'ao' // unarmed 'a' prefix, front hit
        case 'hitBack':
            return base + 'ap' // unarmed 'a' prefix, back hit (was 'an' = dodge)
        case 'dodge': {
            // Xe = weapon-specific dodge; 'an' = unarmed dodge
            const wObjD = this.equippedWeapon
            const skinD = wObjD?.weapon?.getSkin()
            return skinD && skinD !== 'a' ? base + skinD + 'e' : base + 'an'
        }
        // CE actions.cc:402 — knocked down by a hit from the front = ANIM_FALL_BACK ('ba'),
        // from behind = ANIM_FALL_FRONT ('bb'); getting up from them is
        // ANIM_BACK_TO_STANDING ('cj') / ANIM_PRONE_TO_STANDING ('ch').
        case 'knockdownFront':
            return base + 'ba'
        case 'knockdownBack':
            return base + 'bb'
        case 'getUpFront':
            return base + 'cj'
        case 'getUpBack':
            return base + 'ch'
        case 'knockout':
            return base + 'au'
        case 'fidget': {
            // Xa = idle/fidget/reload — the idle animation IS the fidget in Fallout 2
            const wObj = this.equippedWeapon
            const skin = wObj?.weapon?.getSkin() ?? 'a'
            return base + skin + 'a'
        }
        case 'use':
            return base + 'al'
        case 'pickUp':
            return base + 'ak'
        case 'climb':
            return base + 'ae'
        //case "punch": return base + 'aq'
        case 'called-shot':
            return base + 'na'
        default:
            throw new Error('Unknown animation: ' + anim)
    }
}

// Stand with the wielded weapon (CE keeps the fid's weapon code); without that FRM
// (imageInfo lists every critter FRM there is — e.g. the tribal has no SMG art) the
// critter stands unarmed, as CE's artExists check does.
Critter.prototype.setIdleArt = function (this: Critter): void {
    if (!this.inAnim() && !this.dead) this.art = this.getAnimation('idle')
}

Critter.prototype.hasAnimation = function (this: Critter, anim: string): boolean {
    return globalState.imageInfo[this.getAnimation(anim)] !== undefined
}

// FA3 — CE ref: art.h ArtFrame.actionFrame; animation.cc fires the action-frame event
// (hit / impact / projectile release) when the animation's frame index reaches it.
// The pipeline stores it per direction (tools/frmpixels.py exportFRMs).
function actionFrameFor(art: string, orientation: number): number | null {
    const af = globalState.imageInfo[art]?.actionFrame
    if (Array.isArray(af)) return typeof af[orientation] === 'number' ? af[orientation] : (af[0] ?? null)
    return typeof af === 'number' ? af : null
}

Critter.prototype.fireActionFrame = function (this: Critter): void {
    const cb = this.actionFrameCallback
    this.actionFrameCallback = null
    if (cb) cb()
}

Critter.prototype.updateStaticAnim = function (this: Critter): void {
    if ((window as any).__test?.fastMode) {
        this.fireActionFrame()
        const cb = this.animCallback
        ;(this as any).animCallback = null
        this.frame = 0 // match the normal done-path which resets frame before calling callback
        if (cb) cb()
        return
    }

    const time = window.performance.now()
    const fps = globalState.imageInfo[this.art]?.fps || 10 // CE art.cc artGetFramesPerSecond: 0 → 10

    if (time - this.lastFrameTime >= 1000 / fps) {
        const reversed = this.anim === 'reverse'
        // CE _object_animate: forward adds the new frame's delta; reverse removes the
        // current frame's delta before stepping back.
        if (reversed) {
            ceOffsetAdd(this, this.frame, -1)
            this.frame--
        } else {
            this.frame++
            ceOffsetAdd(this, this.frame, 1)
        }
        this.lastFrameTime = time

        if (this.actionFrameCallback && !reversed) {
            const af = actionFrameFor(this.art, this.orientation ?? 0)
            if (af !== null && this.frame >= af) this.fireActionFrame()
        }

        const done = reversed ? this.frame === -1 : this.frame === globalState.imageInfo[this.art].numFrames
        if (done) {
            if (reversed) this.frame++ // clamp back to frame 0
            // An action frame past the last frame (or missing data) still resolves first.
            this.fireActionFrame()
            // animation is done
            if (this.animCallback) {
                this.animCallback()
            }
        }
    }
}

// CE animation.cc _dude_fidget (a ticker while a map is up, off in combat): one random critter
// standing on screen plays its stand animation once, the stand sound for the dude or for an
// 'm…'-art critter within PER × 2 hexes; the next one comes clamp(20 / candidates, 1, 7) s
// plus 0–3 s later (7 s when there was none). The Woodsman encounter's PID 0x10000FA is left out.
let fidgetLastTime = 0
let fidgetNextDelay = 0
function dudeFidget(time: number): void {
    const gMap = globalState.gMap
    const dude = globalState.player
    if (!gMap || !dude || globalState.inCombat || dude.visible === false) return
    if (time - fidgetLastTime <= fidgetNextDelay) return
    fidgetLastTime = time
    const candidates: Critter[] = []
    for (const o of gMap.getObjects()) {
        if (candidates.length >= 100) break
        if (o.type !== 'critter' || o.visible === false || (o as Critter).dead) continue
        const c = o as Critter
        if (c.anim && c.anim !== 'idle') continue // ANIM_STAND only
        if (gMap.mapID === 97 && c.pid === 0x10000fa) continue // MAP_SPECIAL_RND_WOODSMAN
        if (objectOnScreen(c)) candidates.push(c)
    }
    let delay = 7
    if (candidates.length > 0) {
        const c = candidates[randomBetween(0, candidates.length - 1)]
        const name = c.art?.split('/').pop() ?? ''
        if (
            c === dude ||
            ((name[0] === 'm' || name[0] === 'M') && hexDistance(c.position, dude.position) < dude.getStat('PER') * 2)
        ) {
            playCharAnimSfx(c, 0 /* ANIM_STAND */)
        }
        c.nextIdleAnimTime = time // its one cycle starts (a frame from now)
        c.lastFrameTime = time
        delay = Math.trunc(20 / candidates.length)
    }
    fidgetNextDelay = randomBetween(0, 3000) + 1000 * Math.max(1, Math.min(7, delay))
}

// Advance the idle animation one frame: a critter stands on frame 0 until _dude_fidget picks
// it, then plays its stand animation once. Never sets animCallback, so inAnim() stays false
// and movement is never blocked.
Critter.prototype.updateLoopingAnim = function (this: Critter): void {
    const info = globalState.imageInfo[this.art]
    if (!info || !info.numFrames) return
    const time = window.performance.now()
    dudeFidget(time)

    if (this.nextIdleAnimTime === 0) this.nextIdleAnimTime = Infinity // standing still until picked

    if (time < this.nextIdleAnimTime) {
        // Holding the pause between cycles — sit on frame 0.
        // Track lastFrameTime as nextIdleAnimTime so that when the wait expires the first
        // frame advance fires after exactly one fps interval (avoids a double-interval gap).
        this.frame = 0
        this.lastFrameTime = this.nextIdleAnimTime
        return
    }

    const fps = info.fps || 10 // CE art.cc artGetFramesPerSecond: 0 → 10
    if (time - this.lastFrameTime >= 1000 / fps) {
        this.frame++
        ceOffsetAdd(this, this.frame, 1)
        this.lastFrameTime = time
        if (this.frame >= info.numFrames) {
            this.frame = 0
            this.ceOff = ceStandOffset(this) // the fidget ends with _dude_stand
            this.nextIdleAnimTime = Infinity // until _dude_fidget picks it again
        }
    }
}

Critter.prototype.updateAnim = function (this: Critter): void {
    // 'dead' is a permanent sentinel set by critterKill after the death animation
    // completes — do nothing so the corpse stays frozen on its last frame.
    if (this.anim === 'dead') return

    if (!this.anim || this.anim === 'idle') {
        this.updateLoopingAnim()
        return
    }
    if (animInfo[this.anim] === undefined && this.anim.startsWith('anim:')) {
        return this.updateStaticAnim()
    }
    if (animInfo[this.anim] === undefined) {
        // Unknown anim key — likely stale state from a deserialized save or a script bug.
        // Log identity for diagnostics, then tombstone so the rAF loop stops hammering it.
        dbgWarn(
            'animation',
            `[updateAnim] unknown anim "${this.anim}" on critter "${this.name || this.pid}" pid=${this.pid} tile=(${this.position.x},${this.position.y}) art="${this.art}" — tombstoning`,
        )
        this.anim = 'dead'
        return
    }
    if (animInfo[this.anim].type === 'static') {
        return this.updateStaticAnim()
    }

    // Move animation (walk/run) but path was not serialized — recover to idle.
    if (!this.path) {
        this.clearAnim()
        return
    }

    if ((window as any).__test?.fastMode) {
        this.position = { x: this.path.target.x, y: this.path.target.y }
        this.path.walked = this.path.path.length - 1
        const callback = this.animCallback
        this.clearAnim()
        if (callback) callback()
        return
    }

    const time = window.performance.now()
    let fps = globalState.imageInfo[this.art].fps
    // CE animation.cc animationComputeTicksPerFrame: in combat ANIM_WALK (not running)
    // gets fps += combat_speed (the 0..50 preference, higher is faster); the dude only
    // with player_speedup.
    if (globalState.inCombat && this.anim === 'walk') {
        const isPlayer = globalState.player && (this as any) === globalState.player
        if (!isPlayer || Config.engine.playerSpeedup) {
            fps += Math.max(0, Math.min(50, Config.combat.combatSpeed))
        }
    }
    if (Config.engine.walkModel !== 'dh2') {
        if (time - this.lastFrameTime >= 1000 / fps) {
            this.lastFrameTime = time
            this.walkFrameCE()
        }
        return
    }

    const partials = getAnimPartialActions(this.art, this.anim)
    const currentPartial = partials.actions[this.path.partial]

    if (time - this.lastFrameTime >= 1000 / fps) {
        // advance frame
        this.lastFrameTime = time

        if (this.frame + 1 >= currentPartial.endFrame) {
            // completed an action frame (partial action)

            // do we have another partial action?
            if (this.path.partial + 1 < partials.actions.length) {
                // then proceed to next partial action
                this.path.partial++
            } else {
                // otherwise we're done animating this, loop
                this.path.partial = 0
            }

            // move to the start of the next partial action
            this.frame = partials.actions[this.path.partial].startFrame

            // reset shift
            this.shift = { x: 0, y: 0 }

            // move to new path hex
            let pos = this.path.path[this.path.index++]
            const hex = { x: pos[0], y: pos[1] }

            // (counted first: move() side effects can end the walk — refundWalk)
            const path = this.path
            path.walked = (path.walked ?? 0) + 1
            if (!this.move(hex)) {
                path.walked--
                return
            }
            if (!this.path) {
                // it's possible for move() to have side effects which can clear the anim
                return
            }

            // set orientation towards new path hex
            pos = this.path.path[this.path.index]
            if (pos) {
                const dir = directionOfDelta(this.position.x, this.position.y, pos[0], pos[1])
                if (dir == null) {
                    throw Error()
                }
                this.orientation = dir
            }
        } else {
            // advance frame
            this.frame++

            const info = globalState.imageInfo[this.art]
            if (info === undefined) {
                throw new Error('No image map info for: ' + this.art)
            }

            // add the new frame's offset to our shift
            const frameInfo = info.frameOffsets[this.orientation][this.frame]
            this.shift.x += frameInfo.x
            this.shift.y += frameInfo.y
        }

        if (this.position.x === this.path.target.x && this.position.y === this.path.target.y) {
            // reached target position

            const callback = this.animCallback
            this.clearAnim()

            if (callback) {
                callback()
            }
        }
    }
}

// CE ref: animation.cc _object_move — one walk/run frame: next frame (the cycle wraps
// freely), add its FRM delta to the sub-tile offset, and step to the next path hex
// once the offset reaches that direction's hex step (tile.cc _off_tile /
// dword_51D984), carrying the remainder into the new hex. The last hex ends the walk
// on the hex centre.
const HEX_STEP_X = [16, 32, 16, -16, -32, -16]
const HEX_STEP_Y = [-12, 0, 12, 12, 0, -12]

function crossedHexStep(dir: number, sx: number, sy: number): boolean {
    const x = HEX_STEP_X[dir],
        y = HEX_STEP_Y[dir]
    return (x > 0 && x <= sx) || (x < 0 && x >= sx) || (y > 0 && y <= sy) || (y < 0 && y >= sy)
}

Critter.prototype.walkFrameCE = function (this: Critter): void {
    const info = globalState.imageInfo[this.art]
    if (!info || !this.path || !this.shift) return
    this.frame = (this.frame + 1) % info.numFrames
    const d = info.frameOffsets[this.orientation]?.[this.frame]
    if (d) {
        this.shift.x += d.x
        this.shift.y += d.y
    }
    const dir = this.orientation
    if (!crossedHexStep(dir, this.shift.x, this.shift.y)) return

    const rest = { x: this.shift.x - HEX_STEP_X[dir], y: this.shift.y - HEX_STEP_Y[dir] }
    let pos = this.path.path[this.path.index++]
    if (!pos) return
    this.shift = { x: 0, y: 0 } // objectSetLocation clears the offset
    // CE animation.cc _object_move: a blocker on the next hex (one that moved into the path)
    // — a door the critter can use opens (move()); anything else makes it re-path to the goal,
    // within the hexes it set out to walk (their AP are paid), or the walk ends there.
    const gMap = globalState.gMap
    if (gMap) {
        const elevation = (this as any).elevation ?? gMap.currentElevation
        const blocker = gMap.blockingObjectAt(pos[1] * 200 + pos[0], elevation, 0, this)
        const usableDoor = !!blocker && blocker.subtype === 'door' && !blocker.jammed && canUseDoor(this, blocker)
        if (blocker && !usableDoor) {
            const budget = this.path.path.length - this.path.index + 1 // hexes still to walk
            const repath = gMap.recalcPath(this.position, this.path.target, true, this)
            if (repath.length < 2 || repath.length - 1 > budget) {
                dbg('movement', `[walk] ${this.name || this.pid}: blocked at (${pos[0]}, ${pos[1]}), walk ends`)
                const callback = this.animCallback
                this.clearAnim()
                // in combat the turn goes on (the AI and the player's AP bookkeeping wait for it);
                // out of combat the rest of the action is dropped, as CE's ended sequence
                if (globalState.inCombat && callback) callback()
                return
            }
            this.path.path = repath
            this.path.index = 2
            pos = repath[1]
            const nd = directionOfDelta(this.position.x, this.position.y, pos[0], pos[1])
            if (nd != null) this.orientation = nd
        }
    }
    // (counted first: move() side effects can end the walk — refundWalk)
    const path = this.path
    path.walked = (path.walked ?? 0) + 1
    if (!this.move({ x: pos[0], y: pos[1] })) {
        path.walked--
        return
    }
    if (!this.path) return // move() side effects can end the walk

    if (this.position.x === this.path.target.x && this.position.y === this.path.target.y) {
        const callback = this.animCallback
        this.clearAnim()
        if (callback) callback()
        return
    }
    const next = this.path.path[this.path.index]
    if (next) {
        const nd = directionOfDelta(this.position.x, this.position.y, next[0], next[1])
        if (nd != null) this.orientation = nd
    }
    this.shift = rest
}

// 'smooth' walk model: how far (0..1) the current frame has progressed toward the next.
Critter.prototype.walkFrameBlend = function (this: Critter): { x: number; y: number } {
    if (Config.engine.walkModel !== 'smooth' || !this.shift || (this.anim !== 'walk' && this.anim !== 'run'))
        return { x: 0, y: 0 }
    const info = globalState.imageInfo[this.art]
    if (!info) return { x: 0, y: 0 }
    const fps = info.fps || 10
    const t = Math.max(0, Math.min(1, ((window.performance.now() - this.lastFrameTime) * fps) / 1000))
    const d = info.frameOffsets[this.orientation]?.[(this.frame + 1) % info.numFrames]
    return d ? { x: d.x * t, y: d.y * t } : { x: 0, y: 0 }
}

// Walk-step interpolation state for smooth moving-light stamping (wiki/lighting.md
// §player-light). While walking, the sprite glides from `position` (t=0) toward
// the next path hex (t=1); `t` is the frame's progress within the current partial
// action. Returns null when not walking (or no next hex) → caller stamps normally.
Critter.prototype.getWalkLerp = function (this: Critter): { hexA: Point; hexB: Point; t: number } | null {
    if (this.shift === null || !this.path) return null
    const nextPos = this.path.path?.[this.path.index]
    if (!nextPos) return null
    const hexB: Point = { x: nextPos[0], y: nextPos[1] }
    const hexA: Point = { x: this.position.x, y: this.position.y }
    if (hexA.x === hexB.x && hexA.y === hexB.y) return null
    const info = globalState.imageInfo[this.art]
    if (!info) return null
    if (Config.engine.walkModel !== 'dh2') {
        // CE model: progress = how much of this direction's hex step the offset covers.
        const dir = this.orientation
        const t = HEX_STEP_X[dir] !== 0 ? this.shift.x / HEX_STEP_X[dir] : this.shift.y / HEX_STEP_Y[dir]
        return { hexA, hexB, t: Math.min(1, Math.max(0, t)) }
    }
    const cp = getAnimPartialActions(this.art, this.anim).actions[this.path.partial]
    if (!cp) return null
    const span = cp.endFrame - cp.startFrame
    const t = span > 0 ? Math.min(1, Math.max(0, (this.frame - cp.startFrame) / span)) : 0
    return { hexA, hexB, t }
}

Critter.prototype.staticAnimation = function (
    this: Critter,
    anim: string,
    callback?: () => void,
    waitForLoad = true,
    reversed = false,
    onActionFrame?: () => void,
): void {
    // Capture current state synchronously — these are the old-art values we need for the
    // offset formula. We do NOT switch this.art/this.frame here so the renderer keeps
    // showing the old sprite until the new texture is confirmed loaded.
    const oldArt = this.art
    const oldFrame = this.frame
    const prevArtOffset = { x: this.artOffset.x, y: this.artOffset.y }
    const newArt = this.getAnimation(anim)

    // Compute the transition offset now using imageInfo (always available at startup).
    // Deferred to startAnim only as artOffset assignment so old art stays visible while
    // the GL texture for newArt is being loaded asynchronously.
    //
    // Exact zero-jump formula (CE ref: animation.cc artGetRotationOffsets + artGetFrameOffsets):
    //   artOffset.x = floor(newW0/2) - floor(oldWF/2) + oldDirOff.x - newDirOff.x + oldOx[F] - newOx[0]
    //   artOffset.y = (newH0 - oldHF) + oldDirOff.y - newDirOff.y + oldOy[F] - newOy[0]
    // x: half-width term compensates for the horizontal-center anchor (floor(w/2) from tile x).
    // y: height term compensates for the bottom-edge anchor (tileY - h); a taller sprite
    //    pushes the bottom edge down, so a height decrease shifts the sprite up without correction.
    let pendingArtOffset = prevArtOffset
    const oldInfo = globalState.imageInfo[oldArt]
    const newInfo = globalState.imageInfo[newArt]
    if (oldInfo && newInfo) {
        const orient = this.orientation ?? 0
        const oldDirOff = oldInfo.directionOffsets[orient] ?? { x: 0, y: 0 }
        const newDirOff = newInfo.directionOffsets[orient] ?? { x: 0, y: 0 }
        const oldFrames = oldInfo.frameOffsets[orient]
        const clampedOld = Math.min(oldFrame, (oldFrames?.length ?? 1) - 1)
        const oldF = oldFrames?.[clampedOld] ?? { w: 0, h: 0, ox: 0, oy: 0 }
        const newStartFrame = reversed ? newInfo.numFrames - 1 : 0
        const newF0 = newInfo.frameOffsets[orient]?.[newStartFrame] ?? { w: 0, h: 0, ox: 0, oy: 0 }
        // For looping animations (idle), anchor on frame 0 geometry regardless of which frame
        // is currently playing. Using the mid-cycle frame's ox would bake iOxF into artOffset,
        // displacing the critter throughout the entire subsequent one-shot animation.
        // CE ref: art.cc artGetFrameOffsets — frame deltas are independent of playback position;
        // CE never carries a mid-animation ox into the object reference point.
        const srcF = this.anim === 'idle' ? (oldFrames?.[0] ?? oldF) : oldF
        pendingArtOffset = {
            x:
                Math.floor(newF0.w / 2) -
                Math.floor(srcF.w / 2) +
                oldDirOff.x -
                newDirOff.x +
                srcF.ox -
                newF0.ox +
                prevArtOffset.x,
            y: newF0.h - srcF.h + oldDirOff.y - newDirOff.y + srcF.oy - newF0.oy + prevArtOffset.y,
        }
        dbg(
            'animOffset',
            '[ArtOffset] staticAnimation',
            `${oldArt}@f${clampedOld}(w=${oldF.w},ox=${oldF.ox},oy=${oldF.oy})`,
            srcF !== oldF ? `[anchor:f0(w=${srcF.w},ox=${srcF.ox})]` : '',
            `→ ${newArt}@f${newStartFrame}(w=${newF0.w},ox=${newF0.ox},oy=${newF0.oy})`,
            `dir${orient} dirOff(${oldDirOff.x},${oldDirOff.y})→(${newDirOff.x},${newDirOff.y})`,
            `prev(${prevArtOffset.x},${prevArtOffset.y})`,
            `→ artOffset(${pendingArtOffset.x},${pendingArtOffset.y})`,
        )
    }

    const startAnim = () => {
        // Atomically switch art state so the renderer never sees newArt with a stale offset,
        // and frame 0 is held for a full fps interval (lastFrameTime = now, not 0).
        this.artOffset = pendingArtOffset
        // CE _object_animate art change: obj->x/y += old art's rotation offset + the new
        // start frame's delta (a walk ended on the hex centre, objectSetLocation).
        if (this.shift !== null) this.ceOff = { x: 0, y: 0 }
        if (newArt !== oldArt) {
            const oldDir = globalState.imageInfo[oldArt]?.directionOffsets[this.orientation ?? 0]
            if (oldDir) {
                this.ceOff = { x: this.ceOff.x + oldDir.x, y: this.ceOff.y + oldDir.y }
            }
        }
        this.art = newArt
        this.lastFrameTime = window.performance.now()
        if (reversed) {
            this.frame = globalState.imageInfo[newArt].numFrames - 1
            this.anim = 'reverse'
        } else {
            this.frame = 0
            this.anim = anim
        }
        ceOffsetAdd(this, this.frame, 1)
        this.animCallback = callback || (() => this.clearAnim())
        this.actionFrameCallback = onActionFrame ?? null
        // Frame 0 can itself be the action frame.
        if (onActionFrame && !reversed && actionFrameFor(newArt, this.orientation ?? 0) === 0) this.fireActionFrame()
    }

    if (waitForLoad) {
        lazyLoadImage(newArt, startAnim)
    } else {
        startAnim()
    }
}

// Play a weapon swap animation sequence: holster (old weapon) → swapFn() → draw (new weapon).
// swapFn is called between the holster and draw phases to perform the actual weapon change
// (e.g., toggle activeHand or reassign a hand slot). If either animation FRM is absent from
// the asset map, that phase is silently skipped so the swap still completes.
Critter.prototype.playWeaponSwapAnim = function (this: Critter, swapFn: () => void, callback?: () => void): void {
    const settle = () => {
        this.clearAnim()
        if (callback) callback()
    }

    const playDraw = () => {
        swapFn()
        if (this.hasAnimation('weapon-draw')) {
            // Xc = pull out weapon, played forward
            // CE ref: animation.cc:1188 animationRegisterTakeOutWeapon —
            // sfxBuildCharName(owner, ANIM_TAKE_OUT, weaponAnimationCode).
            playCharAnimSfx(this, ANIM.takeOut, critterWeaponCode(this))
            this.staticAnimation('weapon-draw', settle)
        } else {
            settle()
        }
    }

    if (this.hasAnimation('weapon-holster')) {
        // CE ref: interface.cc:1824 — sfxBuildCharName(gDude, ANIM_PUT_AWAY, UNUSED).
        playCharAnimSfx(this, ANIM.putAway)
        this.staticAnimation('weapon-holster', playDraw)
    } else {
        playDraw()
    }
}

Critter.prototype.clearAnim = function (this: Critter): void {
    // Dead critters stay frozen on their last death frame — never reset to idle.
    if (this.dead) return

    // Capture old state BEFORE super.clearAnim() resets frame/shift.
    const wasWalking = this.shift !== null
    const oldArt = this.art
    const oldFrame = this.frame

    // Call the Obj base clearAnim — Critter's own prototype overrides, so use the parent prototype.
    Obj.prototype.clearAnim.call(this)
    if (this.path?.paid) {
        this.AP?.refundWalk(this.path)
        if (this.isPlayer && globalState.inCombat && this.AP)
            drawAP(this.AP.getAvailableCombatAP(), this.AP.getTotalMaxAP(), this.AP.move)
    }
    this.path = null

    const newArt = this.getAnimation('idle')
    if (wasWalking) {
        // CE ref: objectSetLocation (object.cc) resets obj->x/y on every tile change during walk,
        // so artOffset is always 0 when the critter arrives at idle after walking.
        this.artOffset = { x: 0, y: 0 }
    } else {
        // Apply the same zero-jump formula as staticAnimation so the settle to idle is
        // visually seamless. Using current artOffset as prev preserves the exact screen
        // position at the last draw frame. Note: for FRM sets that are not a perfect closed
        // loop (K_cycle ≠ 0), artOffset may be non-zero after each full draw/holster cycle;
        // a walk resets it to {0,0} via objectSetLocation (CE ref: object.cc).
        const orient = this.orientation ?? 0
        const oldInfo = globalState.imageInfo[oldArt]
        const newInfo = globalState.imageInfo[newArt]
        let newArtOffset: Point = { x: 0, y: 0 }
        if (oldInfo && newInfo) {
            const oldDirOff = oldInfo.directionOffsets[orient] ?? { x: 0, y: 0 }
            const newDirOff = newInfo.directionOffsets[orient] ?? { x: 0, y: 0 }
            const oldFrames = oldInfo.frameOffsets[orient]
            const clampedOld = Math.min(oldFrame, (oldFrames?.length ?? 1) - 1)
            const oldF = oldFrames?.[clampedOld] ?? { w: 0, h: 0, ox: 0, oy: 0 }
            const newF0 = newInfo.frameOffsets[orient]?.[0] ?? { w: 0, h: 0, ox: 0, oy: 0 }
            const prev = this.artOffset
            newArtOffset = {
                x:
                    Math.floor(newF0.w / 2) -
                    Math.floor(oldF.w / 2) +
                    oldDirOff.x -
                    newDirOff.x +
                    oldF.ox -
                    newF0.ox +
                    prev.x,
                y: newF0.h - oldF.h + oldDirOff.y - newDirOff.y + oldF.oy - newF0.oy + prev.y,
            }
            dbg(
                'animOffset',
                '[ArtOffset] clearAnim',
                `${oldArt}@f${clampedOld}(w=${oldF.w},h=${oldF.h},ox=${oldF.ox},oy=${oldF.oy})`,
                `→ ${newArt}@f0(w=${newF0.w},h=${newF0.h},ox=${newF0.ox},oy=${newF0.oy})`,
                `dir${orient} dirOff(${oldDirOff.x},${oldDirOff.y})→(${newDirOff.x},${newDirOff.y})`,
                `prev(${prev.x},${prev.y})`,
                `→ artOffset(${newArtOffset.x},${newArtOffset.y})`,
            )
        }
        this.artOffset = newArtOffset
    }

    // reset to idle pose
    this.anim = 'idle'
    this.art = newArt
    this.ceOff = ceStandOffset(this) // CE _dude_stand
}

// CE obj->x/y bookkeeping (Config.engine.animOffsetModel 'ce'): add `sign` times the
// FRM delta of `frame` (no-op past the last frame).
function ceOffsetAdd(c: Critter, frame: number, sign: 1 | -1): void {
    const d = globalState.imageInfo[c.art]?.frameOffsets[c.orientation ?? 0]?.[frame]
    if (!d) return
    c.ceOff = { x: c.ceOff.x + sign * d.x, y: c.ceOff.y + sign * d.y }
}

// CE animation.cc _dude_stand: obj->x/y = 0, or with a weapon in hand the summed
// deltas of the take-out animation plus the unarmed stand art's rotation offset.
function ceStandOffset(c: Critter): Point {
    // weapon code of the current fid: the art name's second-to-last letter
    const skin = c.art.charAt(c.art.length - 2)
    if (!skin || skin === 'a') return { x: 0, y: 0 }
    const orient = c.orientation ?? 0
    const base = c.getBase()
    const takeOut = globalState.imageInfo[base + skin + 'c']
    const stand = globalState.imageInfo[base + 'aa']
    if (!takeOut || !stand) return { x: 0, y: 0 }
    let x = 0,
        y = 0
    for (const f of takeOut.frameOffsets[orient] ?? []) {
        x += f.x
        y += f.y
    }
    const so = stand.directionOffsets[orient] ?? { x: 0, y: 0 }
    return { x: x + so.x, y: y + so.y }
}
