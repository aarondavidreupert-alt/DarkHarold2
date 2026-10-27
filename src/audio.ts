/*
Copyright 2015 darkf

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

import { getCurrentMapInfo } from './data.js'
import globalState from './globalState.js'
import { dbg, dbgWarn } from './logger.js'
import { getFileJSON, getRandomInt } from './util.js'
import { getWeaponSounds, ImpactMaterial } from './soundMap.js'
import { assetUrl } from './modAssets.js'
import type { Obj } from './object.js'
import { soundSourceVolume } from './soundVolume.js'
import { Config } from './config.js'
import { getHourMilitary } from './gametime.js'

// Has the page had a user gesture yet? (browser autoplay policy; true where the
// UserActivation API is missing)
function audioUnlocked(): boolean {
    return navigator.userActivation?.hasBeenActive ?? true
}

// Bump when the pipeline's SFX/speech output changes, so browsers drop cached copies
// (2 = mono SFX/speech, 2026-10-11).
export const AUDIO_ASSET_QUERY = '?r=2'

// Audio engine for handling music and sound effects

export interface AudioEngine {
    // source: the object making the sound (CE _gsound_compute_relative_volume)
    playSfx(sfx: string, source?: Obj | null): void
    playSfxByName(stem: string, source?: Obj | null): void
    hasSfx(stem: string): boolean
    playMusic(music: string): void
    playSound(soundName: string): HTMLAudioElement | null
    playWeaponSfx(
        soundId: string,
        type: 'attack' | 'attack_burst' | 'impact' | 'reload' | 'empty',
        material?: ImpactMaterial,
        source?: Obj | null,
    ): void
    stopMusic(): void
    pauseMusic(): void
    resumeMusic(): void
    stopAll(): void
    tick(): void
    setVolume(channel: 'master' | 'music' | 'sfx' | 'speech', value: number): void
}

export class NullAudioEngine implements AudioEngine {
    playSfx(sfx: string): void {}
    playSfxByName(stem: string): void {}
    hasSfx(stem: string): boolean {
        return false
    }
    playMusic(music: string): void {}
    playSound(soundName: string): HTMLAudioElement | null {
        return null
    }
    playWeaponSfx(
        soundId: string,
        type: 'attack' | 'attack_burst' | 'impact' | 'reload' | 'empty',
        material?: ImpactMaterial,
    ): void {}
    stopMusic(): void {}
    pauseMusic(): void {}
    resumeMusic(): void {}
    stopAll(): void {}
    tick(): void {}
    setVolume(_channel: 'master' | 'music' | 'sfx' | 'speech', _value: number): void {}
}

// CE worldmap.cc wmSfxIdxName: at night (game hour ≤ 600 or ≥ 1800) the birds are crickets —
// brdchir1 → cricket, brdchirp → cricket1 (wmRemapSfxList)
function nightRemap(name: string): string {
    if (name !== 'brdchir1' && name !== 'brdchirp') return name
    const hour = getHourMilitary()
    if (hour > 600 && hour < 1800) return name
    return name === 'brdchir1' ? 'cricket' : 'cricket1'
}

export class HTMLAudioEngine implements AudioEngine {
    //lastSfxTime: number = 0
    nextSfxTime: number = 0 // game tick of the next ambient sfx event (0: not scheduled)
    nextSfx: string | null = null
    lastAmbientTime = -Infinity // CE _lastTime_1 (real time)
    musicAudio: HTMLAudioElement | null = null
    // CE game_sound.cc: the track to restart when a zero volume is raised (_gsound_background_df_vol)
    lastMusic: string | null = null
    musicOffByVolume = false
    pausedMusic: HTMLAudioElement | null = null

    // Volume levels (0.0–1.0 internally; Preferences UI uses 0–100). CE game_config.cc
    // gameConfigInit: every volume starts at 22281 of 32767 (fallout2.cfg sets them otherwise).
    masterVolume: number = 22281 / 32767
    musicVolume: number = 22281 / 32767
    sfxVolume: number = 22281 / 32767
    // FO2-CE ref: settings.cc:93 speech_volume (0–32767 in CE, normalised to 0.0–1.0 here)
    speechVolume: number = 22281 / 32767

    // Web Audio pipeline for SFX (decodeAudioData + one-shot buffers).
    // Music stays on HTMLAudioElement — loop + streaming are simpler there.
    // SFX/speech that played "2× too fast" were converted as stereo although CE
    // plays them mono — fixed in the pipeline (tools/acmMono.py), not here.
    private ctx: AudioContext | null = null
    private sfxCache: Map<string, AudioBuffer> = new Map()
    private sfxPending: Map<string, Promise<AudioBuffer | null>> = new Map()
    // Negative cache: names that 404'd or failed to decode.  Keeps the console
    // quiet on repeated plays (e.g. every burst fire for a missing burst wav).
    private sfxMissing: Set<string> = new Set()
    private sfxLookup: Record<string, unknown> | null = null

    // GainNodes for the Web Audio SFX chain.  Created lazily on first getCtx().
    private sfxGainNode: GainNode | null = null
    private masterGainNode: GainNode | null = null

    private getCtx(): AudioContext {
        if (!this.ctx) {
            const Ctor = window.AudioContext ?? window.webkitAudioContext
            this.ctx = new Ctor() as AudioContext
            // Build gain chain: source → sfxGainNode → masterGainNode → destination
            this.sfxGainNode = this.ctx.createGain()
            this.masterGainNode = this.ctx.createGain()
            this.sfxGainNode.gain.value = this.sfxVolume
            this.masterGainNode.gain.value = this.masterVolume
            this.sfxGainNode.connect(this.masterGainNode)
            this.masterGainNode.connect(this.ctx.destination)
        }
        return this.ctx!
    }

    private async loadSfx(name: string): Promise<AudioBuffer | null> {
        // Before the first click/key the browser refuses to start an AudioContext
        // (and warns on every attempt); such sounds can't be heard anyway.
        if (!audioUnlocked()) return null
        const cached = this.sfxCache.get(name)
        if (cached) return cached
        if (this.sfxMissing.has(name)) return null
        const pending = this.sfxPending.get(name)
        if (pending) return pending

        const ctx = this.getCtx()
        const promise = (async () => {
            try {
                const res = await fetch(assetUrl('audio/sfx/' + name + '.wav' + AUDIO_ASSET_QUERY))
                if (!res.ok) {
                    dbgWarn('audio', '[Audio] could not load:', name, `(${res.status})`)
                    this.sfxMissing.add(name)
                    return null
                }
                const buf = await ctx.decodeAudioData(await res.arrayBuffer())
                this.sfxCache.set(name, buf)
                return buf
            } catch (e) {
                dbgWarn('audio', '[Audio] decode failed:', name, e)
                this.sfxMissing.add(name)
                return null
            } finally {
                this.sfxPending.delete(name)
            }
        })()
        this.sfxPending.set(name, promise)
        return promise
    }

    private async playBuffer(name: string, buf: AudioBuffer, source: Obj | null = null): Promise<void> {
        const ctx = this.getCtx()
        // Browsers suspend the context until the first user gesture.  Awaiting
        // resume() here ensures source.start() doesn't fire into a suspended
        // context (which would silently drop the sound).
        if (ctx.state === 'suspended') {
            try {
                await ctx.resume()
            } catch {
                /* will retry on next play */
            }
        }
        const node = ctx.createBufferSource()
        node.buffer = buf
        // Route through sfxGainNode → masterGainNode → destination for volume control; an
        // off-screen source through its own gain first (CE _gsound_compute_relative_volume)
        const relative = soundSourceVolume(source)
        if (relative < 1) {
            const gain = ctx.createGain()
            gain.gain.value = relative
            node.connect(gain)
            gain.connect(this.sfxGainNode!)
        } else {
            node.connect(this.sfxGainNode!)
        }
        node.start()
        // Log every actual play (not just first-load) so the console reflects
        // sound events 1:1 — including cache hits like repeated door toggles.
        dbg('audio', '[Sound]', name)
    }

    playSfx(sfx: string, source: Obj | null = null): void {
        if (!Config.engine.soundsEnabled) return // [sound] sounds=0
        // Fire-and-forget; errors are logged inside loadSfx / playBuffer.
        this.loadSfx(sfx)
            .then((buf) => {
                if (buf) return this.playBuffer(sfx, buf, source)
                return undefined
            })
            .catch((e) => dbgWarn('audio', '[Audio] playSfx failed:', sfx, e))
    }

    playMusic(music: string): void {
        this.stopMusic()
        this.lastMusic = music
        if (!Config.engine.soundsEnabled || !Config.engine.musicEnabled) return // [sound] sounds=0 / music=0
        // CE backgroundSoundSetVolume: a zero music or master volume disables the music
        if (this.musicVolume === 0 || this.masterVolume === 0) {
            this.musicOffByVolume = true
            return
        }
        this.musicAudio = this.playSound('music/' + music)
        if (this.musicAudio) {
            this.musicAudio.loop = true
            this.musicAudio.volume = this.musicElementVolume()
        }
    }

    // CE plays the background music at gMusicVolume × 0.94 (under the master mix)
    private musicElementVolume(): number {
        return this.musicVolume * 0.94 * this.masterVolume
    }

    // CE backgroundSoundPause / Resume (loadsave.cc: under the save / load window)
    pauseMusic(): void {
        if (this.musicAudio && !this.musicAudio.paused) {
            this.musicAudio.pause()
            this.pausedMusic = this.musicAudio
        }
    }

    resumeMusic(): void {
        const el = this.pausedMusic
        this.pausedMusic = null
        if (el && el === this.musicAudio) el.play().catch((e) => dbg('audio', '[Audio] play() blocked:', e))
    }

    playSound(soundName: string): HTMLAudioElement | null {
        const sound = new Audio()
        sound.addEventListener(
            'canplaythrough',
            () => {
                dbg('audio', '[Sound]', soundName)
                if (audioUnlocked()) {
                    sound.play().catch((e) => dbg('audio', '[Audio] play() blocked:', e))
                    return
                }
                // Music before the first user gesture: start it on that gesture.
                if (!sound.loop) return
                const start = () => {
                    window.removeEventListener('pointerdown', start, true)
                    window.removeEventListener('keydown', start, true)
                    if (this.musicAudio === sound) sound.play().catch((e) => dbg('audio', '[Audio] play() blocked:', e))
                }
                window.addEventListener('pointerdown', start, true)
                window.addEventListener('keydown', start, true)
            },
            false,
        )
        sound.addEventListener(
            'error',
            () => {
                // File missing (404) or unsupported format — fail silently to avoid console spam
                dbgWarn('audio', '[Audio] could not load:', soundName)
            },
            false,
        )
        sound.src = assetUrl('audio/' + soundName + '.wav' + AUDIO_ASSET_QUERY)
        return sound
    }

    // Is `stem` in sound/sfx/sndlist.lst (lut/lst/sound_sfx_sndlist.json)?
    hasSfx(stem: string): boolean {
        if (!this.sfxLookup) {
            this.sfxLookup = getFileJSON('lut/lst/sound_sfx_sndlist.json') ?? {}
        }
        return stem.toUpperCase() in this.sfxLookup!
    }

    playSfxByName(stem: string, source: Obj | null = null): void {
        if (!this.sfxLookup) {
            this.sfxLookup = getFileJSON('lut/lst/sound_sfx_sndlist.json') ?? {}
        }
        if (!(stem.toUpperCase() in this.sfxLookup!)) {
            dbgWarn('audio', `[Audio] SFX stem not found: ${stem}`)
            return
        }
        this.playSfx(stem, source)
    }

    playWeaponSfx(
        soundId: string,
        type: 'attack' | 'attack_burst' | 'impact' | 'reload' | 'empty',
        material: ImpactMaterial = 'flesh',
        source: Obj | null = null,
    ): void {
        if (!soundId) return
        const sounds = getWeaponSounds(soundId, material)
        const file = sounds[type]
        if (!file) return

        // Many vanilla burst-capable weapons (e.g. Minigun, wa<id>=f) ship
        // without a dedicated wa<id>2xxx1 burst sample.  Rather than log a
        // 404, fall back to the single-shot attack sound.
        if (type === 'attack_burst') {
            this.loadSfx(file)
                .then((buf) => {
                    if (buf) return this.playBuffer(file, buf, source)
                    return this.loadSfx(sounds.attack).then((fb) => {
                        if (fb) return this.playBuffer(sounds.attack, fb, source)
                        return undefined
                    })
                })
                .catch((e) => dbgWarn('audio', '[Audio] playWeaponSfx burst failed:', file, e))
            return
        }

        // Some weapons (e.g. assault rifle, sniper, plasma/laser rifle) ship only
        // with a material-neutral wh<id>1xxx1 impact sound, not per-material variants.
        // Check the sfx_lookup; if the material-specific file is absent, try xxx.
        if (type === 'impact') {
            if (!this.sfxLookup) {
                this.sfxLookup = getFileJSON('lut/lst/sound_sfx_sndlist.json') ?? {}
            }
            if (!(file.toUpperCase() in this.sfxLookup!)) {
                const xxxImpact = `wh${soundId.toLowerCase()}1xxx1`
                if (xxxImpact.toUpperCase() in this.sfxLookup!) {
                    this.playSfx(xxxImpact, source)
                }
                return
            }
        }

        this.playSfx(file, source)
    }

    setVolume(channel: 'master' | 'music' | 'sfx' | 'speech', value: number): void {
        // value is 0–100 from the UI; normalise to 0.0–1.0
        const v = Math.max(0, Math.min(100, value)) / 100
        if (channel === 'master' || channel === 'music') {
            if (channel === 'master') {
                this.masterVolume = v
                if (this.masterGainNode) this.masterGainNode.gain.value = v
            } else {
                this.musicVolume = v
            }
            // Music uses HTMLAudioElement so update its volume directly.
            if (this.musicAudio) this.musicAudio.volume = this.musicElementVolume()
            // CE gameSoundSetMasterVolume / backgroundSoundSetVolume: at 0 the music stops
            // (backgroundSoundDisable); raised again, the track starts over
            if (this.musicVolume === 0 || this.masterVolume === 0) {
                if (this.musicAudio) {
                    this.stopMusic()
                    this.musicOffByVolume = true
                }
            } else if (this.musicOffByVolume) {
                this.musicOffByVolume = false
                if (this.lastMusic) this.playMusic(this.lastMusic)
            }
        } else if (channel === 'speech') {
            // FO2-CE ref: settings.cc:93 speech_volume — stored for future speech playback.
            this.speechVolume = v
        } else {
            this.sfxVolume = v
            if (this.sfxGainNode) this.sfxGainNode.gain.value = v
        }
    }

    // CE game_sound.cc backgroundSoundDelete — stop the music and free its stream. Every restart
    // goes through playMusic (a new element); a paused element that kept its src would keep
    // its HTTP connection, and a few map changes would use up the browser's six per host.
    stopMusic(): void {
        const el = this.musicAudio
        this.musicOffByVolume = false
        if (!el) return
        this.musicAudio = null
        el.pause()
        el.removeAttribute('src')
        el.load()
    }

    stopAll(): void {
        this.nextSfxTime = 0
        this.nextSfx = null
        this.stopMusic()
    }

    // CE worldmap.cc wmSfxRollNextIdx: a roll over the map's ambient sfx chances; a roll
    // past the last chance gives none ('').
    rollNextSfx(): string {
        const curMapInfo = getCurrentMapInfo()
        if (!curMapInfo) return ''
        const sfx = curMapInfo.ambientSfx
        if (!sfx || sfx.length === 0) return ''
        const total = sfx.reduce((sum: number, x: [string, number]) => sum + x[1], 0)
        let chance = getRandomInt(0, total)
        for (const [name, freq] of sfx) {
            if (chance >= freq) {
                chance -= freq
                continue
            }
            return name
        }
        return ''
    }

    // CE game_sound.cc ambientSoundEffectEventProcess: every 10 × random(15, 20) game ticks
    // the rolled map sfx plays — not in combat, and not within 5 s (real time) of the last
    // one; the next one is rolled when this one fires.
    tick(): void {
        const curMapInfo = getCurrentMapInfo()
        if (!curMapInfo?.ambientSfx || curMapInfo.ambientSfx.length === 0) return
        const now = globalState.gameTickTime
        if (this.nextSfxTime === 0) {
            this.nextSfx = this.rollNextSfx()
            this.nextSfxTime = now + 10 * getRandomInt(15, 20)
            return
        }
        if (now < this.nextSfxTime) return
        const sfx = globalState.inCombat ? '' : this.nextSfx
        this.nextSfx = this.rollNextSfx()
        this.nextSfxTime = now + 10 * getRandomInt(15, 20)
        if (sfx) {
            const real = window.performance.now()
            if (real - this.lastAmbientTime >= 5000) this.playSfx(nightRemap(sfx))
            this.lastAmbientTime = real
        }
    }
}
