// Copyright 2022 darkf
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

import { getAiPacket } from './aiPackets.js'
import { tickAddictions } from './drugs.js'
import { heart } from './heart.js'
import { hexNeighbors, hexDistance } from './geometry.js'
import globalState from './globalState.js'
import { dbg, dbgWarn } from './logger.js'
import { Critter, objectUnjamAll } from './object.js'
import {
    changeCursor,
} from './playerUse.js'
import {
    clampCameraPosition,
    getObjectUnderCursor,
    SCREEN_HEIGHT,
    SCREEN_WIDTH,
} from './renderer.js'
import { getActiveScrollBarBounds } from './render/camera.js'
import { hexToScreen } from './geometry.js'
import { Scripting } from './scripting.js'
import {
    uiHideCombatHover,
    uiLog,
    UIMode,
    uiShowCombatHover,
} from './ui.js'
import * as Endgame from './endgame.js'
import * as GameTime from './gametime.js'
import { Config } from './config.js'

// Next gameTickTime at which map_update_p_proc should fire across all map
// scripts. Fallout 2 schedules this via a 600-tick queue event, so we mirror
// the cadence here and reschedule from a local counter rather than a
// persisted field (map entry resets the cadence anyway).
let nextMapUpdateTick = 600

// Tracks the last elapsed-day count for midnight event detection (GTC5)
let lastMidnightDay = -1

// CE ref: scripts.cc:405 gameTimeEventProcess — midnight queue event.
// Exported so game_time_advance (scripting.ts) can fire it synchronously for
// each day that elapses during a scripted time skip (CE: queueProcessEvents
// per day in opGameTimeAdvance, interpreter_extra.cc:2761).
export function processMidnightForDay(day: number): void {
    if (lastMidnightDay === -1 || day <= lastMidnightDay) return
    lastMidnightDay = day
    dbg('map', 'QUEUE PROCESS: Midnight!')
    objectUnjamAll()
    scriptsCheckGameEvents(day)
}

export function tickGame(): void {
    if (globalState.isInitializing || globalState.isWaitingOnRemote) {
        return
    } else if (globalState.isLoading) {
        if (globalState.loadingAssetsLoaded === globalState.loadingAssetsTotal) {
            globalState.isLoading = false
            if (globalState.loadingLoadedCallback) {
                globalState.loadingLoadedCallback()
            }
        } else {
            return
        }
    }

    // FO2-CE ref: Skill targeting mode keeps the game loop running so the
    // player can scroll the map and see hover feedback while picking a target.
    // All other UI modes (dialogue, inventory, etc.) pause the loop.
    if (globalState.uiMode !== UIMode.none && globalState.uiMode !== UIMode.useSkill) {
        return
    }
    const time = window.performance.now()

    if (time - globalState.lastFPSTime >= 500) {
        globalState.$fpsOverlay.textContent = 'fps: ' + heart.timer.getFPS()
        globalState.lastFPSTime = time

        if (globalState.lastUpdateTime != undefined) {
            globalState.$fpsOverlay.textContent += ' update: ' + globalState.lastUpdateTime + 'ms'
        }

        if (globalState.lastDrawTime) {
            globalState.$fpsOverlay.textContent += ' draw: ' + globalState.lastDrawTime + 'ms'
        }
    }

    if (globalState.gameHasFocus) {
        const mousePos = heart.mouse.getPosition()
        // Screen-edge scrolling in world units per tick. Dividing the
        // base step by zoom keeps the *on-screen* scroll rate constant
        // regardless of how zoomed in or out the player is: zoomed in,
        // a 15-px-world step would fly across half the screen; zoomed
        // out, it would barely register.
        const scrollStep = 15 / (globalState.cameraZoom || 1.0)
        if (mousePos[0] <= Config.ui.scrollPadding) {
            globalState.cameraPosition.x -= scrollStep
        }
        if (mousePos[0] >= SCREEN_WIDTH - Config.ui.scrollPadding) {
            globalState.cameraPosition.x += scrollStep
        }

        if (mousePos[1] <= Config.ui.scrollPadding) {
            globalState.cameraPosition.y -= scrollStep
        }
        if (mousePos[1] >= SCREEN_HEIGHT - Config.ui.scrollPadding) {
            globalState.cameraPosition.y += scrollStep
        }
        // Clamp to map bounds so we never scroll past the world edge.
        // CE ref: tile.cc:537 gTileBorderMin/MaxX/Y.
        clampCameraPosition()

        if (time >= globalState.lastMousePickTime + 750) {
            // every .75 seconds, check the object under the cursor
            globalState.lastMousePickTime = time

            const obj = getObjectUnderCursor((obj) => obj.isSelectable)
            if (obj !== null) {
                changeCursor('pointer')
                // Show combat hover info for critters during combat
                if (globalState.inCombat && obj instanceof Critter && !obj.dead) {
                    uiShowCombatHover(obj as Critter, globalState.cursorPos.x, globalState.cursorPos.y)
                } else {
                    uiHideCombatHover()
                }
            } else {
                changeCursor('auto')
                uiHideCombatHover()
            }
        }

    }

    // Expire old float messages regardless of focus state.
    // CE ref: text_object.cc:337 — delay = gTextObjectsLineDelay * linesCount + gTextObjectsBaseDelay
    // lineDelay derived from baseDelay per preferences.cc:548: (baseDelay - 1.0) * 0.4 (seconds)
    for (let i = 0; i < globalState.floatMessages.length; i++) {
        const fm = globalState.floatMessages[i]
        const baseDelay = Config.ui.textBaseDelay
        const lineDelay = (baseDelay - 1.0) * 0.4
        const lineCount = (fm.msg.match(/\n/g)?.length ?? 0) + 1
        const expiryMs = (baseDelay + lineDelay * lineCount) * 1000
        if (time >= fm.startTime + expiryMs) {
            globalState.floatMessages.splice(i--, 1)
            continue
        }
    }

    const didTick = time - globalState.lastGameTick >= 1000 / 10 // 10 Hz game tick
    if (didTick) {
        globalState.lastGameTick = time
        globalState.gameTickTime++

        // CE ref: scripts.cc:368 gameTimeAddTicks — end game after 13 elapsed years
        if (globalState.gameTickTime >= 13 * GameTime.TICKS_PER_YEAR) {
            Endgame.setupDeathEnding(Endgame.DEATH_REASON_TIMEOUT)
            Endgame.playDeathEnding().catch((e: unknown) => dbgWarn('endgame', 'GTC7 timeout ending error: ' + String(e)))
        }

        // CE ref: scripts.cc:405 gameTimeEventProcess — midnight queue event.
        // Fires once per in-game day: unjams all doors and checks story-movie triggers.
        const currentDay = GameTime.getTotalDays()
        if (lastMidnightDay === -1) {
            lastMidnightDay = currentDay // initialize on first tick
        } else {
            processMidnightForDay(currentDay)
            // _critter_check_rads() — radiation decay, intentionally deferred
        }

        if (Config.engine.doTimedEvents && !globalState.inCombat) {
            // check and update timed events
            const timedEvents = Scripting.timeEventList
            let numEvents = timedEvents.length
            for (let i = 0; i < numEvents; i++) {
                const event = timedEvents[i]
                const obj = event.obj

                // remove events for dead objects
                if (obj && obj instanceof Critter && obj.dead) {
                    dbg('timer', '[Events] removing timed event for dead object')
                    timedEvents.splice(i--, 1)
                    numEvents--
                    continue
                }

                event.ticks--
                if (event.ticks <= 0) {
                    Scripting.info('timed event triggered', 'timer')
                    event.fn()
                    timedEvents.splice(i--, 1)
                    numEvents--
                }
            }
        }

        // Fallout 2 fires map_update_p_proc for every script on the map
        // every 600 ticks (60 game seconds) via an EVENT_TYPE_MAP_UPDATE_EVENT
        // queued by mapUpdateEventProcess. Mirror that cadence here so
        // scripts can check `game_time_hour` and drive NPC behavior (shop
        // hours, sleep schedules, etc.) without any engine-level gates.
        if (!globalState.inCombat && globalState.gMap) {
            if (nextMapUpdateTick < globalState.gameTickTime) {
                // Catch up after a save load or fresh start where gameTickTime
                // has jumped forward past the initial sentinel.
                nextMapUpdateTick = globalState.gameTickTime + 600
            } else if (globalState.gameTickTime >= nextMapUpdateTick) {
                nextMapUpdateTick = globalState.gameTickTime + 600
                globalState.gMap.updateMap()

                // Poison decay is now handled by a CE-faithful timed event queue in scripting.ts.
                // CE ref: critter.cc poisonEventProcess — the event is scheduled by poison()
                // at 10*(505-5*level) ticks, fires in the timed-event loop above.

                // Addiction withdrawal tick for the player.
                const player = globalState.player as Critter | null
                if (player && !player.dead) tickAddictions(player)

                // Radiation symptom tick (FO2-CE ref: radiation.cc radiationEventProcess)
                if (player && !player.dead && player.radiationLevel > 0) {
                    applyRadiationSymptoms(player)
                }
            }
        }

        globalState.audioEngine.tick()
    }

    for (const obj of globalState.gMap.getObjects()) {
        if (obj.type === 'critter') {
            const critter = obj as Critter
            if (
                didTick &&
                Config.engine.doUpdateCritters &&
                !globalState.inCombat &&
                !critter.dead &&
                !obj.inAnim() &&
                obj._script
            ) {
                Scripting.updateCritter(obj._script, critter)
            }

            // Wander: move to a random neighbor every tick when not in combat
            // and the critter has a wander_type > 0 in its AI packet.
            // FO2-CE ref: ai.cc critterAttemptWander
            if (
                didTick &&
                !globalState.inCombat &&
                !critter.dead &&
                !critter.inAnim() &&
                !obj._script
            ) {
                const pkt = getAiPacket(critter.aiNum)
                if (pkt.wanderType > 0 && Math.random() < 0.05) {
                    // CE ref: ai.cc wander_type — 1=short, 2=large, 3=unrestricted.
                    // DH2 caps wander to a radius around the spawn position (captured lazily).
                    if (!critter.wanderOrigin) {
                        critter.wanderOrigin = { x: critter.position.x, y: critter.position.y }
                    }
                    const radius = pkt.wanderType === 1 ? 5 : pkt.wanderType === 2 ? 15 : Infinity
                    const neighbors = hexNeighbors(critter.position)
                    const barBounds = getActiveScrollBarBounds()
                    // Prefer neighbours inside the radius and within the visible bar bounds
                    // so wandering NPCs don't stray into the black overlay region.
                    const validNeighbors = neighbors.filter(n => {
                        if (radius !== Infinity && hexDistance(n, critter.wanderOrigin!) > radius) return false
                        if (barBounds) {
                            const s = hexToScreen(n.x, n.y)
                            if (s.x < barBounds.minX || s.x > barBounds.maxX ||
                                s.y < barBounds.minY || s.y > barBounds.maxY) return false
                        }
                        return true
                    })
                    const pool = validNeighbors.length > 0 ? validNeighbors : neighbors
                    const dest = pool[Math.floor(Math.random() * pool.length)]
                    if (dest) critter.walkTo(dest, false)
                }
            }
        }

        obj.updateAnim()
    }

    // Party follow: move companions toward the player each tick
    if (didTick && !globalState.inCombat && globalState.gParty.party.length > 0) {
        globalState.gParty.followPlayer()
    }

    globalState.gMap?.drainRemovalQueue()

    globalState.lastUpdateTime = Math.floor(window.performance.now() - time)
}

// CE ref: scripts.cc:438 _scriptsCheckGameEvents
// Fires daily ARTIMER story-movie events. Each ARTIMER triggers once (via seenMovies)
// and decrements GVAR_TOWN_REP_ARROYO by 15.  ARTIMER4 also hides Arroyo and
// reveals Destroyed Arroyo on the worldmap.  GVAR_ENEMY_ARROYO triggers the
// AFAILED death ending (Arroyo destroyed by the Enclave).
//
// Default day thresholds from sfall_config.cc:56-59:
//   artimer1=90, artimer2=180, artimer3=270, artimer4=360
// Movie IDs from game_movie.h (MOVIE_AFAILED=4, MOVIE_ARTIMER1-4=12-15)
// GVAR indices (0-based, game_vars.h): ENEMY_ARROYO=7, TOWN_REP_ARROYO=47, FALLOUT_2=494
// City indices (worldmap.h City enum): CITY_ARROYO=0, CITY_DESTROYED_ARROYO=22
function scriptsCheckGameEvents(day: number): void {
    const gvars = Scripting.getGlobalVars()
    const MOVIE_AFAILED = 4
    const ARTIMER_MOVIE_BASE = 12  // MOVIE_ARTIMER1
    const ARTIMER_DAYS = [90, 180, 270, 360]

    if (gvars[7]) {
        // GVAR_ENEMY_ARROYO non-zero → Arroyo destroyed by Enclave; play AFAILED ending.
        if (!globalState.seenMovies.has(MOVIE_AFAILED)) {
            globalState.seenMovies.add(MOVIE_AFAILED)
            dbg('map', 'ARTIMER: AFAILED — Arroyo destroyed, triggering death ending')
            Endgame.setupDeathEnding(Endgame.DEATH_REASON_TIMEOUT)
            Endgame.playDeathEnding().catch((e: unknown) =>
                dbgWarn('endgame', 'GTC5 AFAILED ending error: ' + String(e)))
        }
        return
    }

    const fallout2Complete = (gvars[494] ?? 0) >= 3  // GVAR_FALLOUT_2 >= 3 → main quest done

    // Find highest applicable ARTIMER (CE picks the highest crossed threshold, not all of them)
    let movieIdx = -1
    for (let i = 3; i >= 0; i--) {
        const crossedThreshold = day >= ARTIMER_DAYS[i]
        const eligible = i === 3 ? (crossedThreshold || fallout2Complete) : (crossedThreshold && !fallout2Complete)
        if (eligible) { movieIdx = i; break }
    }
    if (movieIdx === -1) return

    const movieId = ARTIMER_MOVIE_BASE + movieIdx
    if (globalState.seenMovies.has(movieId)) return  // already fired

    globalState.seenMovies.add(movieId)
    dbg('map', `ARTIMER: ARTIMER${movieIdx + 1} triggered (day ${day})`)

    // CE ref: scripts.cc:487 — adjustRep: GVAR_TOWN_REP_ARROYO -= 15
    const repIdx = 47
    gvars[repIdx] = (gvars[repIdx] ?? 0) - 15
    Scripting.setGlobalVars(gvars)

    if (movieIdx === 3) {
        // ARTIMER4: hide Arroyo (id=0), reveal Destroyed Arroyo (id=22)
        globalState.knownAreas.delete(0)
        globalState.knownAreas.add(22)
        dbg('map', 'ARTIMER4: Arroyo → Destroyed Arroyo on worldmap')
    }
}

// FO2-CE ref: radiation.cc radiationGetLevel
function applyRadiationSymptoms(player: Critter): void {
    const rads = player.radiationLevel
    if (rads >= 1000) {
        uiLog('Radiation: You are dying!')
        player.stats.modifyBase('HP', -10)
    } else if (rads >= 600) {
        uiLog('Radiation: Critical!')
        player.stats.modifyBase('HP', -4)
    } else if (rads >= 450) {
        uiLog('Radiation: Acute sickness')
    } else if (rads >= 300) {
        uiLog('Radiation: Nausea')
    }
    // Below 150 rads is safe — no symptoms
}
