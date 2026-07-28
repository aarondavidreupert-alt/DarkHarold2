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
import { directionOfDelta, hexToScreen, Point } from '../geometry.js'
import globalState from '../globalState.js'
import { lazyLoadImage } from '../images.js'
import { dbg, dbgWarn } from '../logger.js'
import { getActiveUnarmedMode, getActiveUnarmedModeForHand } from '../unarmed.js'
import { Critter } from './Critter.js'
// Imported from Obj (not the barrel) to avoid a cycle through ../object.js.
import { Obj } from './Obj.js'

// Suppress unused-import warning — Obj is referenced indirectly via the
// import-cycle break documented above.
void Obj

declare module './Critter.js' {
    interface Critter {
        getBase(): string
        getAnimation(anim: string): string
        hasAnimation(anim: string): boolean
        staticAnimation(anim: string, callback?: () => void, waitForLoad?: boolean, reversed?: boolean): void
        playWeaponSwapAnim(swapFn: () => void, callback?: () => void): void
        clearAnim(): void
        updateStaticAnim(): void
        updateLoopingAnim(): void
        updateAnim(): void
        getWalkLerp(): { hexA: Point; hexB: Point; t: number } | null
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
    death: { type: 'static' },
    'death-explode': { type: 'static' },
    'death-fire': { type: 'static' },
    'death-plasma': { type: 'static' },
    'death-electro': { type: 'static' },
    'death-laser': { type: 'static' },
    'death-burst': { type: 'static' },
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
        throw 'no image info for ' + art
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

    //console.log("partials: %o", partialActions)
    return partialActions
}

Critter.prototype.getBase = function (this: Critter): string {
    return this.art.slice(0, -2)
}

Critter.prototype.getAnimation = function (this: Critter, anim: string): string {
    const base = this.getBase()

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
                const unarmedSkill = this.getSkill('Unarmed')
                const mode = this.isPlayer
                    ? getActiveUnarmedModeForHand(unarmedSkill, (this as any).activeHand ?? 'leftHand', globalState.punchModeIdx, globalState.kickModeIdx, !(this as any).leftHand?.weapon && !(this as any).rightHand?.weapon)
                    : getActiveUnarmedMode(unarmedSkill, 0)
                const candidate = base + (mode.icon === 'kick' ? 'ar' : 'aq')
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
            const skin = (wObj?.weapon?.getSkin()) ?? 'a'
            return base + skin + 'c'
        }
        case 'weapon-holster': {
            // Xd = put away weapon (played forward)
            const wObj = this.equippedWeapon
            const skin = (wObj?.weapon?.getSkin()) ?? 'a'
            return base + skin + 'd'
        }
        case 'static-idle':
            return base + wep + 'a'
        case 'static':
            return this.art
        case 'hitFront':
            return base + 'ao'   // unarmed 'a' prefix, front hit
        case 'hitBack':
            return base + 'ap'   // unarmed 'a' prefix, back hit (was 'an' = dodge)
        case 'dodge': {
            // Xe = weapon-specific dodge; 'an' = unarmed dodge
            const wObjD = this.equippedWeapon
            const skinD = wObjD?.weapon?.getSkin()
            return (skinD && skinD !== 'a') ? base + skinD + 'e' : base + 'an'
        }
        case 'knockdownFront':
            return base + 'ap'
        case 'knockdownBack':
            return base + 'aq'
        case 'getUpFront':
            return base + 'ar'
        case 'getUpBack':
            return base + 'as'
        case 'knockout':
            return base + 'au'
        case 'fidget': {
            // Xa = idle/fidget/reload — the idle animation IS the fidget in Fallout 2
            const wObj = this.equippedWeapon
            const skin = (wObj?.weapon?.getSkin()) ?? 'a'
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
        case 'death':
            if (this.pro && this.pro.extra.killType === 18) {
                // Boss is special-cased
                dbg('combat', '[Combat] boss death')
                return base + 'bl'
            }
            return base + 'bo' // normal crumple death
        case 'death-explode':
            return base + 'bl' // sliced in half / blown apart
        case 'death-fire':
            return base + 'be' // burning death dance
        case 'death-plasma':
            return base + 'bm' // burned to nothing
        case 'death-electro':
            return base + 'bk' // electrified
        case 'death-laser':
            return base + 'bg' // big hole / vaporised
        case 'death-burst':
            return base + 'bj' // dancing autofire
        default:
            throw 'Unknown animation: ' + anim
    }
}

Critter.prototype.hasAnimation = function (this: Critter, anim: string): boolean {
    return globalState.imageInfo[this.getAnimation(anim)] !== undefined
}

Critter.prototype.updateStaticAnim = function (this: Critter): void {
    if ((window as any).__test?.fastMode) {
        const cb = this.animCallback
        ;(this as any).animCallback = null
        this.frame = 0  // match the normal done-path which resets frame before calling callback
        if (cb) cb()
        return
    }

    const time = window.performance.now()
    const fps = globalState.imageInfo[this.art]?.fps || 8

    if (time - this.lastFrameTime >= 1000 / fps) {
        const reversed = this.anim === 'reverse'
        if (reversed) {
            this.frame--
        } else {
            this.frame++
        }
        this.lastFrameTime = time

        const done = reversed
            ? this.frame === -1
            : this.frame === globalState.imageInfo[this.art].numFrames
        if (done) {
            if (reversed) this.frame++ // clamp back to frame 0
            // animation is done
            if (this.animCallback) {
                this.animCallback()
            }
        }
    }
}

// Advance the idle animation one frame, with a random pause between cycles so critters
// play their idle/fidget loop periodically rather than continuously.
// Never sets animCallback, so inAnim() stays false and movement is never blocked.
Critter.prototype.updateLoopingAnim = function (this: Critter): void {
    const info = globalState.imageInfo[this.art]
    if (!info || !info.numFrames) return
    const time = window.performance.now()

    if (this.nextIdleAnimTime === 0) {
        // Stagger first play per critter so they don't all start in sync on map load
        this.nextIdleAnimTime = time + Math.random() * 5000
    }

    if (time < this.nextIdleAnimTime) {
        // Holding the pause between cycles — sit on frame 0.
        // Track lastFrameTime as nextIdleAnimTime so that when the wait expires the first
        // frame advance fires after exactly one fps interval (avoids a double-interval gap).
        this.frame = 0
        this.lastFrameTime = this.nextIdleAnimTime
        return
    }

    const fps = info.fps || 8
    if (time - this.lastFrameTime >= 1000 / fps) {
        this.frame++
        this.lastFrameTime = time
        if (this.frame >= info.numFrames) {
            this.frame = 0
            // Pause 3–10 s before the next idle cycle
            this.nextIdleAnimTime = time + 3000 + Math.random() * 7000
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
    if (animInfo[this.anim] === undefined) {
        // Unknown anim key — likely stale state from a deserialized save or a script bug.
        // Log identity for diagnostics, then tombstone so the rAF loop stops hammering it.
        dbgWarn('animation', `[updateAnim] unknown anim "${this.anim}" on critter "${this.name || this.pid}" pid=${this.pid} tile=(${this.position.x},${this.position.y}) art="${this.art}" — tombstoning`)
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
        const callback = this.animCallback
        this.clearAnim()
        if (callback) callback()
        return
    }

    const time = window.performance.now()
    let fps = globalState.imageInfo[this.art].fps
    // CE ref: animation.cc:3287 animationComputeTicksPerFrame — ANIM_WALK gets
    // a frame-rate boost during combat. CE combat_speed is 0=fastest, 50=slowest;
    // we map to an additive fps boost of 0–10 (inverted). Skip player critter if
    // player_speedup is disabled (preferences.cc player_speedup checkbox).
    if (globalState.inCombat && (this.anim === 'walk' || this.anim === 'run')) {
        const isPlayer = globalState.player && (this as any) === globalState.player
        if (!isPlayer || Config.engine.playerSpeedup) {
            fps += Math.round((50 - Math.max(0, Math.min(50, Config.combat.combatSpeed))) * 0.2)
        }
    }
    const targetScreen = hexToScreen(this.path.target.x, this.path.target.y)

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

            if (!this.move(hex)) {
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
                throw 'No image map info for: ' + this.art
            }

            // add the new frame's offset to our shift
            const frameInfo = info.frameOffsets[this.orientation][this.frame]
            this.shift.x += frameInfo.x
            this.shift.y += frameInfo.y
        }

        if (this.position.x === this.path.target.x && this.position.y === this.path.target.y) {
            // reached target position
            //console.log("target reached")

            const callback = this.animCallback
            this.clearAnim()

            if (callback) {
                callback()
            }
        }
    }
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
    const cp = getAnimPartialActions(this.art, this.anim).actions[this.path.partial]
    if (!cp) return null
    const span = cp.endFrame - cp.startFrame
    const t = span > 0 ? Math.min(1, Math.max(0, (this.frame - cp.startFrame) / span)) : 0
    return { hexA, hexB, t }
}

Critter.prototype.staticAnimation = function (this: Critter, anim: string, callback?: () => void, waitForLoad = true, reversed = false): void {
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
        const newStartFrame = reversed ? (newInfo.numFrames - 1) : 0
        const newF0 = newInfo.frameOffsets[orient]?.[newStartFrame] ?? { w: 0, h: 0, ox: 0, oy: 0 }
        // For looping animations (idle), anchor on frame 0 geometry regardless of which frame
        // is currently playing. Using the mid-cycle frame's ox would bake iOxF into artOffset,
        // displacing the critter throughout the entire subsequent one-shot animation.
        // CE ref: art.cc artGetFrameOffsets — frame deltas are independent of playback position;
        // CE never carries a mid-animation ox into the object reference point.
        const srcF = (this.anim === 'idle') ? (oldFrames?.[0] ?? oldF) : oldF
        pendingArtOffset = {
            x: Math.floor(newF0.w / 2) - Math.floor(srcF.w / 2) + oldDirOff.x - newDirOff.x + srcF.ox - newF0.ox + prevArtOffset.x,
            y: (newF0.h - srcF.h) + oldDirOff.y - newDirOff.y + srcF.oy - newF0.oy + prevArtOffset.y,
        }
        dbg('animOffset', '[ArtOffset] staticAnimation',
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
        this.art = newArt
        this.lastFrameTime = window.performance.now()
        if (reversed) {
            this.frame = globalState.imageInfo[newArt].numFrames - 1
            this.anim = 'reverse'
        } else {
            this.frame = 0
            this.anim = anim
        }
        this.animCallback = callback || (() => this.clearAnim())
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
            this.staticAnimation('weapon-draw', settle)
        } else {
            settle()
        }
    }

    if (this.hasAnimation('weapon-holster')) {
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
                x: Math.floor(newF0.w / 2) - Math.floor(oldF.w / 2) + oldDirOff.x - newDirOff.x + oldF.ox - newF0.ox + prev.x,
                y: (newF0.h - oldF.h) + oldDirOff.y - newDirOff.y + oldF.oy - newF0.oy + prev.y,
            }
            dbg('animOffset', '[ArtOffset] clearAnim',
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
}
