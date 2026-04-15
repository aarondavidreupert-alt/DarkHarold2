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
import { getRandomInt } from './util.js'
import { ACTION_SOUNDS, getWeaponSounds, ImpactMaterial, resolveSound } from './soundMap.js'

// Audio engine for handling music and sound effects

export interface AudioEngine {
    playSfx(sfx: string): void
    playMusic(music: string): void
    playSound(soundName: string): HTMLAudioElement | null
    playActionSfx(action: string): void
    playWeaponSfx(soundId: string, type: 'attack' | 'attack_burst' | 'impact' | 'reload' | 'empty', material?: ImpactMaterial): void
    stopMusic(): void
    stopAll(): void
    tick(): void
}

export class NullAudioEngine implements AudioEngine {
    playSfx(sfx: string): void {}
    playMusic(music: string): void {}
    playSound(soundName: string): HTMLAudioElement | null {
        return null
    }
    playActionSfx(action: string): void {}
    playWeaponSfx(soundId: string, type: 'attack' | 'attack_burst' | 'impact' | 'reload' | 'empty', material?: ImpactMaterial): void {}
    stopMusic(): void {}
    stopAll(): void {}
    tick(): void {}
}

export class HTMLAudioEngine implements AudioEngine {
    //lastSfxTime: number = 0
    nextSfxTime: number = 0
    nextSfx: string | null = null
    musicAudio: HTMLAudioElement | null = null

    // Web Audio pipeline for SFX.
    // FO2 .wav files are 22050 Hz. HTMLAudioElement plays them at the output
    // device's rate without resampling, so they sound ~2× too fast on modern
    // 44100/48000 Hz output. AudioContext.decodeAudioData resamples correctly.
    // Music stays on HTMLAudioElement — loop + streaming are simpler there.
    private ctx: AudioContext | null = null
    private sfxCache: Map<string, AudioBuffer> = new Map()
    private sfxPending: Map<string, Promise<AudioBuffer | null>> = new Map()
    // Negative cache: names that 404'd or failed to decode.  Keeps the console
    // quiet on repeated plays (e.g. every burst fire for a missing burst wav).
    private sfxMissing: Set<string> = new Set()

    private getCtx(): AudioContext {
        if (!this.ctx) {
            const Ctor = (window as any).AudioContext ?? (window as any).webkitAudioContext
            this.ctx = new Ctor()
        }
        return this.ctx!
    }

    private async loadSfx(name: string): Promise<AudioBuffer | null> {
        const cached = this.sfxCache.get(name)
        if (cached) return cached
        if (this.sfxMissing.has(name)) return null
        const pending = this.sfxPending.get(name)
        if (pending) return pending

        const ctx = this.getCtx()
        const promise = (async () => {
            try {
                const res = await fetch('audio/sfx/' + name + '.wav')
                if (!res.ok) {
                    console.warn('[Audio] could not load:', name, `(${res.status})`)
                    this.sfxMissing.add(name)
                    return null
                }
                const buf = await ctx.decodeAudioData(await res.arrayBuffer())
                this.sfxCache.set(name, buf)
                console.log('[Sound]', name)
                return buf
            } catch (e) {
                console.warn('[Audio] decode failed:', name, e)
                this.sfxMissing.add(name)
                return null
            } finally {
                this.sfxPending.delete(name)
            }
        })()
        this.sfxPending.set(name, promise)
        return promise
    }

    private async playBuffer(buf: AudioBuffer): Promise<void> {
        const ctx = this.getCtx()
        // Browsers suspend the context until the first user gesture.  Awaiting
        // resume() here ensures source.start() doesn't fire into a suspended
        // context (which would silently drop the sound).
        if (ctx.state === 'suspended') {
            try { await ctx.resume() } catch { /* will retry on next play */ }
        }
        const source = ctx.createBufferSource()
        source.buffer = buf
        source.connect(ctx.destination)
        source.start()
    }

    playSfx(sfx: string): void {
        // Fire-and-forget; errors are logged inside loadSfx / playBuffer.
        this.loadSfx(sfx).then(buf => {
            if (buf) return this.playBuffer(buf)
            return undefined
        }).catch(e => console.warn('[Audio] playSfx failed:', sfx, e))
    }

    playMusic(music: string): void {
        this.stopMusic()
        this.musicAudio = this.playSound('music/' + music)
        if (this.musicAudio) this.musicAudio.loop = true
    }

    playSound(soundName: string): HTMLAudioElement | null {
        var sound = new Audio()
        sound.addEventListener('canplaythrough', () => {
            console.log('[Audio] playing:', soundName)
            sound.play().catch(e => console.log('[Audio] play() blocked:', e))
        }, false)
        sound.addEventListener('error', () => {
            // File missing (404) or unsupported format — fail silently to avoid console spam
            console.warn('[Audio] could not load:', soundName)
        }, false)
        sound.src = 'audio/' + soundName + '.wav'
        return sound
    }

    playActionSfx(action: string): void {
        const entry = ACTION_SOUNDS[action]
        if (!entry) return
        this.playSfx(resolveSound(entry))
    }

    playWeaponSfx(soundId: string, type: 'attack' | 'attack_burst' | 'impact' | 'reload' | 'empty', material: ImpactMaterial = 'flesh'): void {
        if (!soundId) return
        const sounds = getWeaponSounds(soundId, material)
        const file = sounds[type]
        if (!file) return

        // Many vanilla burst-capable weapons (e.g. Minigun, wa<id>=f) ship
        // without a dedicated wa<id>2xxx1 burst sample.  Rather than log a
        // 404, fall back to the single-shot attack sound.
        if (type === 'attack_burst') {
            this.loadSfx(file).then(buf => {
                if (buf) return this.playBuffer(buf)
                return this.loadSfx(sounds.attack).then(fb => {
                    if (fb) return this.playBuffer(fb)
                    return undefined
                })
            }).catch(e => console.warn('[Audio] playWeaponSfx burst failed:', file, e))
            return
        }

        this.playSfx(file)
    }

    stopMusic(): void {
        if (this.musicAudio) this.musicAudio.pause()
    }

    stopAll(): void {
        this.nextSfxTime = 0
        this.nextSfx = null
        this.stopMusic()
    }

    rollNextSfx(): string {
        // Randomly obtain the next map sfx
        const curMapInfo = getCurrentMapInfo()
        if (!curMapInfo) return ''

        const sfx = curMapInfo.ambientSfx
        const sumFreqs = sfx.reduce((sum: number, x: [string, number]) => sum + x[1], 0)
        let roll = getRandomInt(0, sumFreqs)

		for (var i = 0; i < sfx.length; i++) {
			var freq = sfx[i][1]
			if (roll < freq) return sfx[i][0]
			roll -= freq
		}
		// fallback statt throw
		return sfx[0][0]
    }

    tick(): void {
        var time = window.performance.now()

        if (!this.nextSfx) this.nextSfx = this.rollNextSfx()

        if (time >= this.nextSfxTime) {
            // play next sfx in queue
            this.playSfx(this.nextSfx)

            // queue up next sfx
            this.nextSfx = this.rollNextSfx()
            this.nextSfxTime = time + getRandomInt(15, 20) * 1000
        }
    }
}
