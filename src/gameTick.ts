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

import { Worldmap } from './worldmap.js'
import { gameMoviePlay, GAME_MOVIE_FADE_IN, GAME_MOVIE_FADE_OUT, GAME_MOVIE_PAUSE_MUSIC, GAME_MOVIE_STOP_MUSIC } from './gameMovie.js'
import { getRandomInt } from './util.js'
import { checkRads } from './radiation.js'
import { heart } from './heart.js'
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
let critterScriptCursor = -1 // CE scripts.cc _count_
let gameEndingTriggered = false

// Tracks the last elapsed-day count for midnight event detection (GTC5)
let lastMidnightDay = -1

// CE ref: scripts.cc:405 gameTimeEventProcess — midnight queue event.
// Exported so game_time_advance (scripting.ts) can fire it synchronously for
// each day that elapses during a scripted time skip (CE: queueProcessEvents
// per day in opGameTimeAdvance, interpreter_extra.cc:2761).
// Clock jumped forward by `delta` ticks outside the per-tick loop — run every
// crossed midnight and fire the timed events that expired, earliest first
// (CE queueProcessEvents fires overdue events in due-time order).
function processTimeJump(delta: number): void {
    const now = globalState.gameTickTime
    const dayBefore = Math.floor((now - delta) / GameTime.TICKS_PER_DAY)
    const dayAfter = Math.floor(now / GameTime.TICKS_PER_DAY)
    for (let d = dayBefore + 1; d <= dayAfter; d++) processMidnightForDay(d)

    if (!Config.engine.doTimedEvents) return
    const due = Scripting.timeEventList.filter((e) => e.ticks - delta <= 0).sort((a, b) => a.ticks - b.ticks)
    for (const e of Scripting.timeEventList) e.ticks -= delta
    for (const e of due) {
        const idx = Scripting.timeEventList.indexOf(e)
        if (idx === -1) continue
        Scripting.timeEventList.splice(idx, 1)
        if (e.obj && e.obj instanceof Critter && e.obj.dead) continue
        e.fn()
    }
}
GameTime.setTimeJumpHandler(processTimeJump)

export function processMidnightForDay(day: number): void {
    if (lastMidnightDay === -1 || day <= lastMidnightDay) return
    lastMidnightDay = day
    dbg('map', 'QUEUE PROCESS: Midnight!')
    objectUnjamAll()
    scriptsCheckGameEvents(day)
    // CE ref: scripts.cc:424 gameTimeEventProcess → critter.cc:495 _critter_check_rads(gDude)
    const player = globalState.player as Critter | null
    if (player && !player.dead) checkRads(player)
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


            }
        }

        globalState.audioEngine.tick()
    }

    // CE ref: scripts.cc:704 _script_chk_critters — outside combat and dialogue, ONE
    // critter script's critter_p_proc runs per background-loop iteration, round-robin
    // over the critter script list. (DH2 used to run every critter's script every tick,
    // multiplying the rate of anything random a script does by the critter count.)
    // NPC day/night schedules and companion follow/formation are implemented by those
    // scripts (game_time_hour checks; party.h follow macros using tile_distance_objs /
    // rotation_to_tile / animate_move_obj_to_tile) — CE has no engine-side schedule,
    // wander or follow logic, so the DH2 inventions for those were removed 2026-10-06.
    if (didTick && Config.engine.doUpdateCritters && !globalState.inCombat) {
        const scripted = globalState.gMap.getObjects().filter(
            (o) => o.type === 'critter' && o._script && !(o as Critter).dead)
        if (scripted.length > 0) {
            critterScriptCursor = (critterScriptCursor + 1) % scripted.length
            const critter = scripted[critterScriptCursor] as Critter
            Scripting.updateCritter(critter._script!, critter)
        }
    }

    for (const obj of globalState.gMap.getObjects()) {
        obj.updateAnim()
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
export function scriptsCheckGameEvents(day: number): void {
    const gvars = Scripting.getGlobalVars()
    const MOVIE_AFAILED = 4
    const ARTIMER_MOVIE_BASE = 12  // MOVIE_ARTIMER1
    const ARTIMER_DAYS = [90, 180, 270, 360]

    if (gvars[7]) {
        // GVAR_ENEMY_ARROYO non-zero → Arroyo destroyed by the Enclave. CE plays
        // MOVIE_AFAILED (FADE_IN | STOP_MUSIC) once and sets _game_user_wants_to_quit = 2:
        // the game ends straight back to the main menu (no slides).
        if (gameEndingTriggered) return
        gameEndingTriggered = true
        const seen = globalState.seenMovies.has(MOVIE_AFAILED)
        dbg('map', 'ARTIMER: AFAILED — Arroyo destroyed, game over')
        ;(seen ? Promise.resolve() : gameMoviePlay(MOVIE_AFAILED, GAME_MOVIE_FADE_IN | GAME_MOVIE_STOP_MUSIC))
            .then(() => location.reload())
        return
    }

    const fallout2 = gvars[494] ?? 0 // GVAR_FALLOUT_2

    // Find highest applicable ARTIMER (CE picks the highest crossed threshold, not all of them)
    let movieIdx = -1
    for (let i = 3; i >= 0; i--) {
        const crossedThreshold = day >= ARTIMER_DAYS[i]
        // CE scripts.cc:453-466: ARTIMER4 when day >= t4 || FALLOUT_2 >= 3; 1-3 need FALLOUT_2 != 3.
        const eligible = i === 3 ? (crossedThreshold || fallout2 >= 3) : (crossedThreshold && fallout2 !== 3)
        if (eligible) { movieIdx = i; break }
    }
    if (movieIdx === -1) return

    const movieId = ARTIMER_MOVIE_BASE + movieIdx
    if (globalState.seenMovies.has(movieId)) return  // already fired

    dbg('map', `ARTIMER: ARTIMER${movieIdx + 1} triggered (day ${day})`)
    // CE: gameMoviePlay(movie, FADE_IN | FADE_OUT | PAUSE_MUSIC) — marks it seen.
    globalState.seenMovies.add(movieId)
    void gameMoviePlay(movieId, GAME_MOVIE_FADE_IN | GAME_MOVIE_FADE_OUT | GAME_MOVIE_PAUSE_MUSIC)

    // CE ref: scripts.cc:487 — adjustRep: GVAR_TOWN_REP_ARROYO -= 15
    const repIdx = 47
    gvars[repIdx] = (gvars[repIdx] ?? 0) - 15
    Scripting.setGlobalVars(gvars)

    if (movieIdx === 3) {
        // ARTIMER4: hide Arroyo (id=0), reveal Destroyed Arroyo (id=22)
        Worldmap.setAreaVisible(0, false)
        Worldmap.setAreaVisible(22, true)
        dbg('map', 'ARTIMER4: Arroyo → Destroyed Arroyo on worldmap')
    }
}

// FO2-CE ref: radiation.cc radiationGetLevel
