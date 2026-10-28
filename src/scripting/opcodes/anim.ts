// Script opcodes: animations (the reg_anim_* batch), fades, explosions and sound names (CE op_reg_anim_*, op_gfade_*, op_explosion, op_sfx_build_*).
// Methods of the Script class (scripting.ts), kept here by topic and installed on its prototype
// there; vmBridge.ts and the Lua prelude call them as before (wiki/code_quality.md Q16).

import type { Script } from '../../scripting.js'
import { Config } from '../../config.js'
import { Critter, Obj, createObjectWithPID } from '../../object.js'
import { correctDeath } from '../../critter.js'
import { dbgWarn } from '../../logger.js'
import { fromTileNum, toTileNum } from '../../tile.js'
import { getLstJson } from '../../data.js'
import globalState from '../../globalState.js'
import { lookupArt, makePID } from '../../pro.js'
import { sfxBuildOpenName, sfxBuildWeaponName } from '../../sfxNames.js'
import {
    AnimEntry,
    AnimForever,
    AnimMove,
    AnimStep,
    SND_SCENERY_ACTION,
    artGetCodeForSfx,
    isGameObject,
    log,
    playAnimId,
    requestScript,
    scriptingState,
    warn,
    withSpatialsOff,
} from '../../scripting.js'

export const animOpcodes = {
    anim_busy(this: Script, obj: Obj) {
        log('anim_busy', [obj])
        if (!isGameObject(obj)) {
            warn('anim_busy: not game object: ' + obj)
            return false
        }
        return obj.inAnim()
    },
    anim(this: Script, obj: Obj, anim: number, param: number) {
        if (!isGameObject(obj)) {
            warn('anim: not a game object: ' + obj)
            return
        }
        if (anim === 1000) {
            // OBJECT_SET_ROTATION — CE ref: interpreter_extra.cc:3421 opAnim
            if (param >= 0 && param < 6) obj.orientation = param
        } else if (anim === 1010) {
            // OBJECT_SET_FRAME — CE ref: interpreter_extra.cc:3427 opAnim
            obj.frame = param
        } else if (anim >= 0 && anim < 65) {
            // CE interpreter_extra.cc opAnim (anim < ANIM_COUNT): _correctDeath, then
            // param 0 plays the animation forward — a knockdown / death animation
            // (ANIM_FALL_BACK … ANIM_FALL_FRONT_BLOOD) leaves the critter lying on its
            // single-frame pose — and `results &= DAM_KNOCKED_DOWN` (CE's literal mask);
            // any other param plays it reversed, the critter ends up lying
            // (PRONE_TO_STANDING reversed = lying on the front) and is knocked down.
            const c = obj.type === 'critter' ? (obj as Critter) : null
            if (c) anim = correctDeath(c, anim)
            const reversed = param !== 0
            const lying = reversed || (anim >= 20 && anim <= 35) // ANIM_FALL_BACK..ANIM_FALL_FRONT_BLOOD
            if (c) {
                c.injuryFlags = (reversed ? c.injuryFlags | 0x02 : c.injuryFlags & 0x02) >>> 0 // DAM_KNOCKED_DOWN
            }
            if (lying && c) {
                // which way it lies, for _dude_standup later (lifecycle.ts naming)
                const onFront = anim === 21 || anim === 35 || anim === 36 // FALL_FRONT(_BLOOD), PRONE_TO_STANDING
                c.knockdownAnim = onFront ? 'knockdownBack' : 'knockdownFront'
                playAnimId(obj, anim, reversed, () => {}) // stays on the last frame
                return
            }
            const saved = scriptingState.animBatch
            scriptingState.animBatch = []
            scriptingState.animBatch.push({ kind: 'animate', obj, anim, delay: 0, reversed })
            this.reg_anim_end()
            scriptingState.animBatch = saved
        } else {
            dbgWarn('script', `anim: unhandled anim value ${anim}`)
        }
    },
    // animation — CE interpreter_extra.cc opRegAnimFunc / opRegAnimAnimate…: nothing in
    // combat; outside reg_anim_begin … reg_anim_end the animation calls do nothing
    // (animation.cc _check_registry).
    reg_anim_func(this: Script, cmd: number, param: any) {
        if (globalState.inCombat) return
        if (cmd === 1)
            this.reg_anim_begin(param) // OP_REG_ANIM_FUNC_BEGIN
        else if (cmd === 2)
            this.reg_anim_clear(param) // OP_REG_ANIM_FUNC_CLEAR
        else if (cmd === 3) this.reg_anim_end() // OP_REG_ANIM_FUNC_END
    },
    // CE animation.cc reg_anim_begin: refused (−1) while a batch is still being built —
    // the steps keep going into that one
    reg_anim_begin(this: Script, _flags: number) {
        if (scriptingState.animBatch !== null) return
        scriptingState.animBatch = []
    },
    // CE animation.cc reg_anim_clear(obj): the object's animations stop.
    reg_anim_clear(this: Script, obj?: Obj) {
        if (obj && isGameObject(obj)) {
            if (scriptingState.animBatch)
                scriptingState.animBatch = scriptingState.animBatch.filter((st: any) => st.obj !== obj)
            if (typeof obj.clearAnim === 'function') obj.clearAnim()
        }
    },
    regAnimPush(this: Script, name: string, obj: Obj, step: AnimStep | AnimMove | AnimForever): void {
        if (globalState.inCombat) return
        if (!isGameObject(obj)) {
            warn(name + ': object is null', 'animation')
            return
        }
        if (scriptingState.animBatch === null) {
            warn(name + ': outside reg_anim_begin', 'animation')
            return
        }
        scriptingState.animBatch.push(step)
    },
    reg_anim_animate(this: Script, obj: Obj, anim: number, delay: number) {
        // CE opRegAnimAnimate: PID 0x100002F's fall (anim 20) only at violence ≥ 2
        if (anim === 20 && obj?.pid === 0x100002f && Config.combat.violenceLevel < 2) return
        this.regAnimPush('reg_anim_animate', obj, { kind: 'animate', obj, anim, delay })
    },
    reg_anim_animate_reverse(this: Script, obj: Obj, anim: number, delay: number) {
        this.regAnimPush('reg_anim_animate_reverse', obj, { kind: 'animate', obj, anim, delay, reversed: true })
    },
    reg_anim_obj_move_to_obj(this: Script, obj: Obj, dest: Obj, delay: number) {
        if (!isGameObject(dest)) return
        this.regAnimPush('reg_anim_obj_move_to_obj', obj, { kind: 'move', obj, to: dest, run: false, delay })
    },
    reg_anim_obj_run_to_obj(this: Script, obj: Obj, dest: Obj, delay: number) {
        if (!isGameObject(dest)) return
        this.regAnimPush('reg_anim_obj_run_to_obj', obj, { kind: 'move', obj, to: dest, run: true, delay })
    },
    reg_anim_end(this: Script) {
        if (scriptingState.animBatch === null) {
            warn('reg_anim_end: no active batch', 'animation')
            return
        }
        const batch = scriptingState.animBatch
        scriptingState.animBatch = null
        // CE animation.cc _anim_preload (reg_anim_end → animationRunSequence): a step whose
        // critter art is missing drops the whole sequence
        if (
            batch.some(
                (e) =>
                    e.kind === 'animate' &&
                    e.anim !== 0 &&
                    e.obj.type === 'critter' &&
                    !(e.obj as Critter).hasAnimation('anim:' + e.anim),
            )
        ) {
            warn('reg_anim_end: a step has no art — the sequence is dropped (CE _anim_preload)', 'animation')
            return
        }

        // CE animation.cc animationRunSequence / _anim_set_continue: step 0 starts at once;
        // then a step with delay 0 starts together with the previous one, N > 0 starts N
        // ticks after the previous one began, and -1 waits until every started step has
        // finished. (A step for an object that is still busy with an earlier one of this
        // batch waits for it — one animation at a time per object.)
        const TICK_MS = 100
        let next = 0
        let running = 0
        let waiting = false
        const busy = new Map<Obj, (() => void)[]>()
        const finish = (obj: Obj | null) => {
            running--
            if (obj) {
                const queue = busy.get(obj)
                const following = queue?.shift()
                if (following) following()
                else busy.delete(obj)
            }
            advance()
        }
        const run = (entry: AnimEntry, done: () => void): void => {
            if (entry.kind === 'func') {
                if (entry.fn !== null) entry.fn()
                return done()
            }
            if (entry.kind === 'move') {
                const dest = (entry.to as any).position ?? entry.to
                const c = entry.obj as Critter
                const arrived = () => {
                    c.clearAnim?.()
                    done()
                }
                if (typeof c.walkTo !== 'function') {
                    entry.obj.position = { ...dest }
                    return done()
                }
                // CE animationRegisterMoveToObject: a path onto the object's tile (it may be
                // occupied) less the last step — two for a multihex object.
                // animationRegisterMoveToTile (_anim_move, a5 = 0): onto the tile; an
                // occupied one stops a step short.
                const gMap = globalState.gMap
                const path = gMap!.recalcPath(c.position, dest, false, c)
                if (path.length === 0) return arrived()
                const toObj = (entry.to as any).position !== undefined
                let drop = 0
                if (toObj) drop = (((entry.to as any).flags ?? 0) & 0x800) !== 0 ? 2 : 1
                else if (gMap!.blockingObjectAt(toTileNum(dest), c.elevation ?? gMap!.currentElevation, 0, c) !== null)
                    drop = 1
                path.length = Math.max(1, path.length - drop)
                if (path.length < 2) return arrived()
                const last = path[path.length - 1]
                if (!c.walkTo({ x: last[0], y: last[1] }, entry.run, arrived, undefined, path)) arrived()
                return
            }
            if (entry.kind === 'forever') {
                const loop = (): void => {
                    if (entry.obj.type === 'critter')
                        (entry.obj as Critter).staticAnimation('anim:' + entry.anim, loop, true)
                    else entry.obj.singleAnimation(false, loop)
                }
                loop()
                return // never ends: a later -1 step waits for good, as in CE
            }
            const obj = entry.obj
            const end = () => {
                obj.clearAnim()
                done()
            }
            // anim=0 is ANIM_STAND — snap to idle rather than playing a cycle
            if (entry.anim === 0) end()
            else playAnimId(obj, entry.anim, entry.reversed === true, end)
        }
        const start = (entry: AnimEntry): void => {
            running++
            const obj = entry.kind === 'func' ? null : entry.obj
            const go = () => run(entry, () => finish(obj))
            if (obj && busy.has(obj)) {
                busy.get(obj)!.push(go)
                return
            }
            if (obj) busy.set(obj, [])
            go()
        }
        function advance(): void {
            while (!waiting && next < batch.length) {
                const entry = batch[next]
                const delay = next === 0 ? 0 : ((entry as any).delay ?? 0)
                if (delay === -1 || delay < -1) {
                    if (running > 0) return
                } else if (delay > 0) {
                    waiting = true
                    next++
                    setTimeout(() => {
                        waiting = false
                        start(entry)
                        advance()
                    }, delay * TICK_MS)
                    return
                }
                next++
                start(entry)
            }
        }
        advance()
    },
    // CE opRegAnimAnimateForever: outside combat, animationRegisterAnimateForever —
    // a step of the current batch that loops `anim` for good.
    reg_anim_animate_forever(this: Script, obj: Obj, anim: number) {
        if (globalState.inCombat) return
        this.regAnimPush('reg_anim_animate_forever', obj, { kind: 'forever', obj, anim })
    },
    animate_move_obj_to_tile(this: Script, obj: Critter, tileNum: any, isRun: number) {
        log('animate_move_obj_to_tile', [obj, tileNum, isRun], 'movement')
        if (!isGameObject(obj)) {
            warn('animate_move_obj_to_tile: not a game object', 'movement', this)
            return
        }
        // XXX: is this correct? FCMALPNK passes a procedure name
        // but is it a call (wouldn't make sense for NOption) or
        // a procedure reference that this should call?
        if (typeof tileNum === 'function') tileNum = tileNum.call(this)
        if (isNaN(tileNum)) {
            warn('animate_move_obj_to_tile: invalid tile num', 'movement', this)
            return
        }

        const tile = fromTileNum(tileNum)
        if (tile.x < 0 || tile.x >= 200 || tile.y < 0 || tile.y >= 200) {
            warn(
                'animate_move_obj_to_tile: invalid tile: ' + tile.x + ', ' + tile.y + ' (' + tileNum + ')',
                'movement',
                this,
            )
            return
        }
        // CE opAnimateMoveObjectToTile: nothing for an inactive critter or in combat;
        // 0x10 (ANIMATE_INTERRUPT) clears the current animation and is dropped; then a
        // walk for 0, a run for anything else
        if (obj.type === 'critter' && (obj.dead || ((obj.injuryFlags ?? 0) & 0x01) !== 0)) return // DAM_KNOCKED_OUT
        if (globalState.inCombat) return
        let flags = Number(isRun) | 0
        if ((flags & 0x10) !== 0) {
            obj.clearAnim()
            flags &= ~0x10
        }
        if (!obj.walkTo(tile, flags !== 0)) {
            warn('animate_move_obj_to_tile: no path', 'movement', this)
            return
        }
    },
    reg_anim_obj_move_to_tile(this: Script, obj: Obj, tileNum: number, delay: number) {
        if (isNaN(tileNum) || tileNum < 0) return
        this.regAnimPush('reg_anim_obj_move_to_tile', obj, {
            kind: 'move',
            obj,
            to: fromTileNum(tileNum),
            run: false,
            delay,
        })
    },
    // CE opRegAnimObjectRunToTile (0x8114) — as move_to_tile, running.
    reg_anim_obj_run_to_tile(this: Script, obj: Obj, tileNum: number, delay: number) {
        if (isNaN(tileNum) || tileNum < 0) return
        this.regAnimPush('reg_anim_obj_run_to_tile', obj, {
            kind: 'move',
            obj,
            to: fromTileNum(tileNum),
            run: true,
            delay,
        })
    },
    animate_stand_obj(this: Script, obj: Critter) {
        if (!isGameObject(obj)) return
        if (typeof obj.clearAnim === 'function') obj.clearAnim()
    },
    // CE opAnimateStandReverse (0x80CD) — ANIM_STAND reversed, outside combat only.
    animate_stand_reverse_obj(this: Script, obj: Obj) {
        const target = isGameObject(obj) ? obj : (this.self_obj as Obj)
        if (!target || globalState.inCombat || target.type !== 'critter') return
        ;(target as Critter).staticAnimation('idle', () => (target as Critter).clearAnim(), true, true)
    },
    // CE _op_anim_action_frame (0x813A) — artGetActionFrame of obj's FRM for `anim`.
    anim_action_frame(this: Script, obj: Obj, anim: number) {
        if (!isGameObject(obj) || !obj.pro) return 0
        try {
            const fid = ((obj.pro.frmType ?? 1) << 24) | ((anim & 0xff) << 16) | (obj.pro.frmPID & 0xfff)
            const info = globalState.imageInfo![lookupArt(fid)]
            const af = info?.actionFrame
            return Array.isArray(af) ? (af[obj.orientation ?? 0] ?? af[0] ?? 0) : (af ?? 0)
        } catch {
            return 0
        }
    },
    // CE opRegAnimPlaySfx (0x813B) — sound step inside the current reg_anim sequence.
    reg_anim_play_sfx(this: Script, obj: Obj, sfx: string, delay: number) {
        if (!isGameObject(obj) || typeof sfx !== 'string') return
        // CE animationRegisterPlaySoundEffect: a step of the current reg_anim batch;
        // outside one (_check_registry) nothing plays.
        const play = () => globalState.audioEngine?.playSfxByName?.(sfx.toLowerCase(), obj)
        if (scriptingState.animBatch !== null) scriptingState.animBatch.push({ kind: 'func', fn: () => play(), delay })
    },
    explosion(this: Script, tile: number, elevation: number, damage: number) {
        log('explosion', [tile, elevation, damage])
        // CE interpreter_extra.cc opExplosion → scriptsRequestExplosion → actionExplode:
        // d(1, damage) (0 when damage is 0) with no source object.
        // (scriptsRequestExplosion: it goes off from the game loop once the script returns)
        requestScript('explosion', () => {
            const explosives = createObjectWithPID(makePID(0 /* items */, 85 /* Plastic Explosives */), -1)
            explosives.position = fromTileNum(tile)
            globalState.gMap!.addObject(explosives)
            withSpatialsOff(() => explosives.explode(null, damage === 0 ? 0 : 1, damage))
            globalState.gMap!.removeObject(explosives)
        })
    },
    gfade_out(this: Script, time: number) {
        log('gfade_out', [time])
        if (!scriptingState.fadeOverlay) {
            scriptingState.fadeOverlay = document.createElement('div')
            Object.assign(scriptingState.fadeOverlay.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                background: 'black',
                opacity: '0',
                pointerEvents: 'none',
                zIndex: '8000',
                transition: `opacity ${time}ms linear`,
            })
            document.body.appendChild(scriptingState.fadeOverlay)
        }
        // Force reflow so the transition fires from 0
        void scriptingState.fadeOverlay.offsetWidth
        scriptingState.fadeOverlay.style.opacity = '1'
    },
    gfade_in(this: Script, time: number) {
        log('gfade_in', [time])
        if (!scriptingState.fadeOverlay) return
        scriptingState.fadeOverlay.style.transition = `opacity ${time}ms linear`
        scriptingState.fadeOverlay.style.opacity = '0'
        scriptingState.fadeOverlay.addEventListener(
            'transitionend',
            () => {
                if (scriptingState.fadeOverlay) {
                    scriptingState.fadeOverlay.remove()
                    scriptingState.fadeOverlay = null
                }
            },
            { once: true },
        )
    },
    // sound
    play_sfx(this: Script, sfx: string) {
        if (!globalState.audioEngine) return
        globalState.audioEngine.playSfx(sfx.toLowerCase())
    },
    // CE opSfxBuildOpenName (0x80A5) — game_sound.cc sfxBuildOpenName
    sfx_build_open_name(this: Script, obj: Obj, action: number): string | null {
        if (!isGameObject(obj)) return null
        return sfxBuildOpenName(obj, action)
    },
    // CE opSfxBuildCharName (0x813D) — game_sound.cc sfxBuildCharName
    sfx_build_char_name(this: Script, obj: Obj, anim: number, extra: number): string | null {
        if (!isGameObject(obj) || !obj.pro) return null
        const base = getLstJson('art/critters/critters', obj.pro.frmPID & 0xfff)?.frm
        if (!base) return null
        const weapon = anim === 38 /* ANIM_TAKE_OUT */ ? extra : ((obj.frmPID ?? obj.pro.frmPID) & 0xf000) >> 12
        const code = artGetCodeForSfx(anim, weapon)
        if (!code) return null
        let [w, a] = code
        if (anim === 21 || anim === 20) {
            // ANIM_FALL_FRONT / ANIM_FALL_BACK
            if (extra === 2)
                w = 'Y' // CHARACTER_SOUND_EFFECT_PASS_OUT
            else if (extra === 3) w = 'Z' // CHARACTER_SOUND_EFFECT_DIE
        } else if ((anim === 16 || anim === 17) && extra === 4) {
            // punch/kick + CONTACT
            w = 'Z'
        }
        return `${base}${w}${a}`.toUpperCase()
    },
    // CE opSfxBuildAmbientName (0x813E)
    sfx_build_ambient_name(this: Script, name: string) {
        return `A${String(name).padStart(6).slice(0, 6)}1`.toUpperCase()
    },
    // CE opSfxBuildInterfaceName (0x813F) / opSfxBuildItemName (0x8140) — both use
    // gameSoundBuildInterfaceName in CE.
    sfx_build_interface_name(this: Script, name: string) {
        return `N${String(name).padStart(6).slice(0, 6)}1`.toUpperCase()
    },
    sfx_build_item_name(this: Script, name: string) {
        return `N${String(name).padStart(6).slice(0, 6)}1`.toUpperCase()
    },
    // CE opSfxBuildWeaponName (0x8141) — game_sound.cc sfxBuildWeaponName
    sfx_build_weapon_name(this: Script, effectType: number, weapon: Obj, hitMode: number, target: Obj) {
        // CE hit modes 0 / 2 (left / right weapon primary) and 4 (punch) are the primary ones
        return sfxBuildWeaponName(
            effectType,
            weapon,
            hitMode !== 0 && hitMode !== 2 && hitMode !== 4,
            isGameObject(target) ? target : null,
        )
    },
    // CE opSfxBuildSceneryName (0x8142)
    sfx_build_scenery_name(this: Script, name: string, action: number, actionType: number) {
        const typeCode = actionType === 1 /* SOUND_EFFECT_ACTION_TYPE_PASSIVE */ ? 'P' : 'A'
        return `S${typeCode}${SND_SCENERY_ACTION[action] ?? 'O'}${String(name).padStart(4).slice(0, 4)}1`.toUpperCase()
    },
}
