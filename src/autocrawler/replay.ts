// AutoCrawler — replay of an action recording (src/devConsole/recorder.ts, README → "Action
// Recorder", wiki/autocrawler.md → "Replay"). DH2 test tooling, no CE equivalent.
//
// The replay loads the recording's start snapshot, then drives the engine frame by frame with
// the frame loop paused (as the story crawler does) and issues each recorded action through the
// same code the input handler called (playerUse, the action menu's actions, dialogueReply, the
// barter screen, the inventory window, the combat buttons, the world map). Before each action it
// waits for the recorded frame (or the window the action needs), checks the state the recording
// noted (map, elevation, player tile, the GVARs), reseeds the RNG as the recorder did, and pins
// the game clock to the recorded tick. Each mismatch is a divergence in the report.
//
//   autoCrawler.runReplay(recording, { stopOnDivergence: true })
//   replayRecording()                     (console; src/devConsole/recorder.ts)
//   npm run storycrawl -- --replay x.dh2rec.json   (headless, both backends)

import { setMapReadyListener } from '../actionLog.js'
import { Combat } from '../combat.js'
import { resetLoopSchedule } from '../gameTick.js'
import globalState from '../globalState.js'
import { heart } from '../heart.js'
import { Critter, Obj } from '../object.js'
import { playerAttackDoor, playerKeyAttack, playerUse } from '../playerUse.js'
import { randomDraws, randomSeedExact } from '../random.js'
import { deleteSave, load, putSave, saveList, type SaveGame } from '../saveload.js'
import * as Scripting from '../scripting.js'
import { uiState } from '../state/uiState.js'
import { world } from '../state/world.js'
import { fromTileNum } from '../tile.js'
import { hexDistance } from '../geometry.js'
import { cycleActiveItemAction, swapHands } from '../ui.js'
import { activeBarter } from '../uiBarter.js'
import { setAmountOverrides } from '../uiBarter/swap.js'
import { performObjectAction, type ObjectActionName } from '../uiContextMenu.js'
import { inventoryList, uiMoveSlot } from '../uiInventory/dragdrop.js'
import { closeInventory, runInventoryItemAction, showInventory } from '../uiInventory.js'
import { UIMode } from '../uiMode.js'
import { uiPort } from '../uiPort.js'
import { enterAreaEntrance } from '../uiWorldmap.js'
import { beginUseItemOn, usePendingItemOn } from '../useItemOn.js'
import { enterArea, enterWilderness, getPlayerWorldPos, partyInitWalking } from '../worldmap/Worldmap.js'
import {
    decodeFrameTimes,
    entrySeed,
    gvarHash,
    gvarSnapshot,
    ObjectLabels,
    playerTile,
    type RecordedEntry,
    type Recording,
} from './recording.js'

export interface ReplayOptions {
    /** stop at the first divergence (default false: report all, up to maxDivergences) */
    stopOnDivergence?: boolean
    /** real time a step may wait for its frame / window / map load (default 60 s) */
    stepTimeoutMs?: number
    maxDivergences?: number
    /** a player tile this many hexes from the recorded one counts as drift, not a divergence
     *  (default 1; 0 = exact). Time read inside a frame is not recorded (the game reads the
     *  clock many times a frame), so a walk can end up a hex off; the walk targets are absolute
     *  and the RNG is reseeded at each action, so drift does not build up. */
    tileTolerance?: number
}

export interface ReplayDivergence {
    /** entry index, or -1 for the end state */
    i: number
    t: string
    what: string
    recorded: unknown
    replayed: unknown
}

export interface ReplayReport {
    type: 'replay'
    backend: string
    recordedOn: string
    timestamp: number
    entries: number
    replayed: number
    durationMs: number
    divergences: ReplayDivergence[]
    firstDivergence: ReplayDivergence | null
    /** why the replay ended early */
    stopped?: string
    /** random numbers drawn between entries that differ from the recording (information only:
     *  asset callbacks draw too) */
    rngDifferences: number
    /** player tiles within tileTolerance of the recorded one, but not on it */
    tileDrift: number
    /** the first entries whose draws differ: [entry, recorded, replayed] */
    rngTrace: [number, number, number][]
}

let lastReplayReport: ReplayReport | null = null
export function getLastReplayReport(): ReplayReport | null {
    return lastReplayReport
}

// ─── Engine driving ─────────────────────────────────────────────────────────

// The replay's clock. Animations, the 10 Hz game tick (tickGame) and idle timers run on
// performance.now(); while a replay steps the paused frame loop, performance.now() returns this
// virtual time, and every step is one frame at the time the recording's frame-time track gives
// it — so the game sees the recorded frames at the recorded times, however fast the steps run.
const realNow = performance.now.bind(performance)
let virtualNow = 0
const FRAME_MS = 1000 / 30
let frameTimes: number[] = [] // the recording's frame times (ms since the frame before)
let replayFrame = 0 // frames the replay ran
let frameOffset = 0 // replayFrame - recorded frame (moves when a load or a turn takes other frames)

function useVirtualClock(on: boolean): void {
    if (on) {
        virtualNow = realNow()
        performance.now = () => virtualNow
    } else {
        performance.now = realNow
    }
}

/** One logical frame, `dt` virtual ms after the one before (heart._stepOnly with the frame
 *  forced: the paused loop's rAF keeps moving _lastTick). */
function stepFrame(dt: number): void {
    const before = virtualNow
    virtualNow += dt
    heart._lastTick = before
    heart._frameAccum = heart._targetTickTime ?? FRAME_MS
    heart._stepOnly(virtualNow)
    replayFrame++
}

/** Step frames until pred() holds (false after `timeoutMs` real time). */
async function stepUntil(pred: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = realNow() + timeoutMs
    while (!pred()) {
        if (realNow() > deadline) {
            return false
        }
        stepFrame(frameTimes[replayFrame - frameOffset] ?? FRAME_MS)
        await new Promise<void>((r) => setTimeout(r, 0))
    }
    return true
}

function waitReal(pred: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = realNow() + timeoutMs
    return new Promise((resolve) => {
        const poll = () => {
            if (pred()) {
                resolve(true)
            } else if (realNow() > deadline) {
                resolve(false)
            } else {
                setTimeout(poll, 50)
            }
        }
        poll()
    })
}

/** Store `save` for a moment, load it and wait until the game runs again (the recorder's start
 *  and the replay's). */
export async function loadSnapshot(save: SaveGame): Promise<boolean> {
    let loaded = false
    setMapReadyListener(() => {
        loaded = true
    })
    try {
        const id = await new Promise<number>((resolve) => putSave(save, resolve))
        load(id)
        const ok = await waitReal(() => loaded && !globalState.isLoading, 60000)
        deleteSave(id)
        return ok
    } finally {
        setMapReadyListener(null)
    }
}

// ─── Per-entry helpers ──────────────────────────────────────────────────────

function playerIdle(): boolean {
    const p = world.player
    return !!p && (!p.anim || p.anim === 'idle')
}

/** The window an entry's action needs open before it can run. */
const NEEDS_UI: { [t: string]: UIMode } = {
    dlg: UIMode.dialogue,
    bMove: UIMode.barter,
    bOffer: UIMode.barter,
    bEnd: UIMode.barter,
    region: UIMode.calledShot,
    wmWalk: UIMode.worldMap,
    wmArea: UIMode.worldMap,
    wmWild: UIMode.worldMap,
    wmEnter: UIMode.worldMap,
}

function findItem(pid: unknown, slot?: unknown): Obj | null {
    const p = world.player as any
    if (!p || typeof pid !== 'number') {
        return null
    }
    if (typeof slot === 'string' && slot !== 'inventory') {
        return p[slot]?.pid === pid ? p[slot] : null
    }
    const inBag = inventoryList().find((o) => o.pid === pid)
    if (inBag) {
        return inBag
    }
    for (const s of ['leftHand', 'rightHand', 'armor']) {
        if (p[s]?.pid === pid) {
            return p[s]
        }
    }
    return (p.inventory as Obj[]).find((o) => o.pid === pid) ?? null
}

async function findSave(name: unknown, timestamp: unknown): Promise<number | null> {
    const saves = await new Promise<SaveGame[]>((resolve) => saveList(resolve))
    const s = saves.find((x) => x.name === name && x.timestamp === timestamp)
    return s?.id ?? null
}

// ─── Entry point ────────────────────────────────────────────────────────────

export async function runReplay(rec: Recording, options: ReplayOptions = {}): Promise<ReplayReport> {
    const stepTimeoutMs = options.stepTimeoutMs ?? 60000
    const tileTolerance = options.tileTolerance ?? 1
    const maxDivergences = options.maxDivergences ?? 200
    const started = realNow()
    const report: ReplayReport = {
        type: 'replay',
        backend: (window as any).Config?.scripting?.backend ?? '?',
        recordedOn: rec.backend,
        timestamp: Date.now(),
        entries: rec.entries.length,
        replayed: 0,
        durationMs: 0,
        divergences: [],
        firstDivergence: null,
        rngDifferences: 0,
        tileDrift: 0,
        rngTrace: [],
    }
    const diverge = (i: number, t: string, what: string, recorded: unknown, replayed: unknown): void => {
        const d = { i, t, what, recorded, replayed }
        report.firstDivergence ??= d
        if (report.divergences.length < maxDivergences) {
            report.divergences.push(d)
        }
        console.warn(
            `[Replay] #${i} ${t}: ${what} recorded ${JSON.stringify(recorded)}, replayed ${JSON.stringify(replayed)}`,
        )
    }

    if (!(await loadSnapshot(rec.start))) {
        report.stopped = 'the start snapshot did not load'
        return finish(report, started)
    }

    const labels = new ObjectLabels()
    labels.reset()
    randomSeedExact(entrySeed(rec.seed, -1))
    useVirtualClock(true)
    resetLoopSchedule()
    frameTimes = decodeFrameTimes(rec.frames ?? '')
    replayFrame = 0
    frameOffset = 0
    world.gameTickTime = rec.startTick
    // the recorded GVARs, kept up to date from the entries' deltas
    const recGvars = gvarSnapshot()
    let lastMap = world.gMap?.name ?? ''
    let lastElevation = world.currentElevation
    let cursor = 0 // the entry being replayed
    let mapLoads = 0 // map loads seen (each 'map' entry waits for one)
    let lastDraws = randomDraws

    // a map finished loading: label its objects and reseed, as the recorder did for the next 'map' entry
    setMapReadyListener(() => {
        labels.reset()
        mapLoads++
        let j = cursor
        while (j < rec.entries.length && rec.entries[j].t !== 'map') {
            j++
        }
        randomSeedExact(entrySeed(rec.seed, j))
        lastDraws = randomDraws
    })
    // a called shot's callback, for the 'region' entry after it
    const realCalledShot = uiPort.uiCalledShot
    let calledShot: ((region: string) => void) | null = null
    uiPort.uiCalledShot = (art, target, callback) => {
        calledShot = callback ?? null
        realCalledShot(art, target, callback)
    }
    const prevPaused = heart.paused
    heart.paused = true
    let mapEntriesSeen = 0

    const checkTile = (i: number, t: string, recorded: number): void => {
        const now = playerTile()
        if (now === recorded) {
            return
        }
        const off = world.player?.position ? hexDistance(fromTileNum(recorded), world.player.position) : Infinity
        if (off <= tileTolerance) {
            report.tileDrift++
        } else {
            diverge(i, t, 'player tile', recorded, now)
        }
    }

    const check = (i: number, e: RecordedEntry): void => {
        if (e.mp !== undefined) {
            lastMap = e.mp
        }
        if (e.el !== undefined) {
            lastElevation = e.el
        }
        if ((world.gMap?.name ?? '') !== lastMap) {
            diverge(i, e.t, 'map', lastMap, world.gMap?.name)
        }
        if (world.currentElevation !== lastElevation) {
            diverge(i, e.t, 'elevation', lastElevation, world.currentElevation)
        }
        checkTile(i, e.t, e.pl)
        if (!!e.cb !== world.inCombat) {
            diverge(i, e.t, 'in combat', !!e.cb, world.inCombat)
        }
        Object.assign(recGvars, e.gv ?? {})
        const now = gvarSnapshot()
        const differing = Object.keys(recGvars).filter((k) => recGvars[k] !== now[k])
        if (differing.length) {
            diverge(
                i,
                e.t,
                'GVARs',
                Object.fromEntries(differing.slice(0, 8).map((k) => [k, recGvars[k]])),
                Object.fromEntries(differing.slice(0, 8).map((k) => [k, now[k]])),
            )
            Object.assign(recGvars, Object.fromEntries(differing.map((k) => [k, now[k]]))) // report each once
        }
        if ((e.rn ?? 0) !== randomDraws - lastDraws) {
            report.rngDifferences++
            if (report.rngTrace.length < 20) {
                report.rngTrace.push([i, e.rn ?? 0, randomDraws - lastDraws])
            }
        }
    }

    const perform = async (i: number, e: RecordedEntry): Promise<void> => {
        const obj = typeof e.o === 'string' ? labels.resolve(e.o) : null
        if (typeof e.o === 'string' && !obj) {
            diverge(i, e.t, 'object', e.o, null)
            return
        }
        const hex = typeof e.h === 'number' ? fromTileNum(e.h) : null
        const p = world.player!
        switch (e.t) {
            case 'walk':
            case 'use':
                playerUse(obj, { hex: hex!, run: e.run as boolean | undefined, ctrl: !!e.ctrl })
                break
            case 'skill':
                uiState.uiMode = UIMode.useSkill
                uiState.skillMode = e.s as number
                playerUse(obj, { hex: hex! })
                break
            case 'act':
                performObjectAction(obj!, e.a as ObjectActionName)
                break
            case 'walkKey':
                if (e.run) {
                    p.stopSneakToRun()
                }
                p.walkTo(hex!, !!e.run)
                break
            case 'attackKey':
                playerKeyAttack(hex!)
                break
            case 'attackDoor':
                playerAttackDoor(obj!)
                break
            case 'region':
                if (calledShot) {
                    calledShot(e.r as string)
                } else {
                    diverge(i, e.t, 'called-shot window', e.r, null)
                }
                break
            case 'useOn': {
                const item = findItem(e.ip)
                if (!item) {
                    return diverge(i, e.t, 'item', e.ip, null)
                }
                beginUseItemOn(item)
                usePendingItemOn(obj)
                break
            }
            case 'dlg': {
                const text = String(Scripting.scriptingState.dialogueOptionTexts[e.opt as number] ?? '').slice(0, 24)
                if (text !== e.x) {
                    diverge(i, e.t, 'option text', e.x, text)
                }
                Scripting.dialogueReply(e.opt as number)
                break
            }
            case 'bMove': {
                const b = activeBarter
                const from = e.fl as 'p' | 'm' | 'l' | 'r'
                const idx = b ? b.list(from).findIndex((o) => o.pid === e.ip) : -1
                if (!b || idx < 0) {
                    return diverge(i, e.t, 'barter item', e.ip, null)
                }
                await b.move(from + idx, e.w as 'left' | 'right' | 'leftInv' | 'rightInv')
                break
            }
            case 'bOffer':
                activeBarter?.offer()
                break
            case 'bEnd':
                activeBarter?.end()
                break
            case 'inv': {
                const item = findItem(e.ip, e.sl)
                if (!item) {
                    return diverge(i, e.t, 'item', e.ip, null)
                }
                const open = uiState.uiMode === UIMode.inventory
                if (!open) {
                    showInventory()
                }
                await runInventoryItemAction(item, e.sl as string, e.a as string)
                if (!open && uiState.uiMode === UIMode.inventory) {
                    closeInventory()
                }
                break
            }
            case 'invMove': {
                const open = uiState.uiMode === UIMode.inventory
                if (!open) {
                    showInventory()
                }
                let data = e.d as string
                if (data === 'i') {
                    const idx = inventoryList().findIndex((o) => o.pid === e.ip)
                    if (idx < 0) {
                        return diverge(i, e.t, 'item', e.ip, null)
                    }
                    data = 'i' + idx
                }
                await uiMoveSlot(data, e.to as string)
                if (!open && uiState.uiMode === UIMode.inventory) {
                    closeInventory()
                }
                break
            }
            case 'combat':
                if (!world.inCombat) {
                    Combat.start(e.dude ? (p as Critter) : undefined)
                }
                break
            case 'endTurn':
                if (world.inCombat && world.combat?.inPlayerTurn) {
                    world.combat.nextTurn()
                }
                break
            case 'endCombat':
                if (world.inCombat) {
                    world.combat?.attemptEnd()
                }
                break
            case 'hitMode':
                cycleActiveItemAction()
                break
            case 'hands':
                swapHands()
                break
            case 'wmWalk':
                partyInitWalking(e.x as number, e.y as number)
                break
            case 'wmArea': {
                const area = world.mapAreas?.[e.id as number]
                if (area) {
                    enterArea(area)
                } else {
                    diverge(i, e.t, 'area', e.id, null)
                }
                break
            }
            case 'wmWild':
                enterWilderness()
                break
            case 'wmEnter': {
                const area = world.mapAreas?.[e.id as number]
                if (area) {
                    enterAreaEntrance(area, e.en as number)
                } else {
                    diverge(i, e.t, 'area', e.id, null)
                }
                break
            }
            case 'save':
                break // the replay stores no saves
            case 'load': {
                const id = await findSave(e.n, e.ts)
                if (id === null) {
                    diverge(i, e.t, 'save in this browser', e.n, null)
                    report.stopped = `save '${String(e.n)}' is not in this browser (exportSave() it from the recording browser)`
                    return
                }
                load(id)
                break
            }
            default:
                diverge(i, e.t, 'unknown entry type', e.t, null)
        }
    }

    try {
        for (; cursor < rec.entries.length; cursor++) {
            const i = cursor
            const e = rec.entries[i]
            if (e.t === 'amount') {
                continue
            } // given to the action before it (setAmountOverrides)
            if (e.t === 'map') {
                mapEntriesSeen++
                const ok = await stepUntil(
                    () => mapLoads >= mapEntriesSeen && !globalState.isLoading && world.gMap?.name === e.mp,
                    stepTimeoutMs,
                )
                if (!ok) {
                    diverge(i, e.t, 'map load', e.mp, world.gMap?.name)
                    if (options.stopOnDivergence) {
                        break
                    }
                }
                frameOffset = replayFrame - e.f // a load takes its own (real) time: on from the recorded frame
                check(i, e)
                report.replayed++
                continue
            }
            // the recorded frame, then what the action needs (a window, the party's world-map
            // position, the player's turn); a wait past the recorded frame moves the offset
            const ui = NEEDS_UI[e.t]
            let ready = await stepUntil(() => replayFrame - frameOffset >= e.f, stepTimeoutMs)
            const needs = (): boolean => {
                if (globalState.isLoading) {
                    return false
                }
                if (ui !== undefined) {
                    if (uiState.uiMode !== ui) {
                        return false
                    }
                    if (ui === UIMode.worldMap && e.wx !== undefined) {
                        const pos = getPlayerWorldPos()
                        if (!pos || Math.abs(pos.x - (e.wx as number)) > 2 || Math.abs(pos.y - (e.wy as number)) > 2) {
                            return false
                        }
                    }
                    return true
                }
                if (e.cb) {
                    return world.inCombat && !!world.combat?.inPlayerTurn && playerIdle()
                }
                return true
            }
            if (ready && !needs()) {
                ready = await stepUntil(needs, stepTimeoutMs)
                frameOffset = replayFrame - e.f
            }
            if (!ready) {
                diverge(
                    i,
                    e.t,
                    ui !== undefined ? 'window' : e.cb ? "the player's turn" : 'frame',
                    ui ?? e.f,
                    uiState.uiMode,
                )
            }
            check(i, e)
            if (options.stopOnDivergence && report.firstDivergence) {
                break
            }
            // as the recorder: reseed, the recorded clock, the recorded Move Items quantities
            randomSeedExact(entrySeed(rec.seed, i))
            if (!world.inCombat) {
                world.gameTickTime = rec.startTick + e.k
            }
            const amounts: number[] = []
            for (let j = i + 1; j < rec.entries.length && rec.entries[j].t === 'amount'; j++) {
                amounts.push(rec.entries[j].n as number)
            }
            setAmountOverrides(amounts)
            try {
                await perform(i, e)
            } catch (err) {
                diverge(i, e.t, 'exception', null, String(err).slice(0, 200))
            }
            lastDraws = randomDraws
            report.replayed++
            if (report.stopped || (options.stopOnDivergence && report.firstDivergence)) {
                break
            }
        }
        // the end state
        if (rec.end && !report.stopped && !(options.stopOnDivergence && report.firstDivergence)) {
            const endFrame = rec.end.f
            await stepUntil(() => replayFrame - frameOffset >= endFrame, stepTimeoutMs)
            const end = rec.end
            if ((world.gMap?.name ?? '') !== end.mp) {
                diverge(-1, 'end', 'map', end.mp, world.gMap?.name)
            }
            if (world.currentElevation !== end.el) {
                diverge(-1, 'end', 'elevation', end.el, world.currentElevation)
            }
            checkTile(-1, 'end', end.pl)
            const hash = gvarHash(gvarSnapshot())
            if (hash !== end.gvHash) {
                diverge(-1, 'end', 'GVAR hash', end.gvHash, hash)
            }
        }
        if (options.stopOnDivergence && report.firstDivergence && !report.stopped) {
            report.stopped = `diverged at entry ${report.firstDivergence.i}`
        }
    } finally {
        setMapReadyListener(null)
        setAmountOverrides([])
        uiPort.uiCalledShot = realCalledShot
        useVirtualClock(false)
        heart.paused = prevPaused
    }
    return finish(report, started)
}

function finish(report: ReplayReport, started: number): ReplayReport {
    report.durationMs = Math.round(realNow() - started)
    lastReplayReport = report
    console.log(
        `[Replay] ${report.replayed}/${report.entries} entries, ${report.divergences.length} divergences, ${report.tileDrift} tile drift` +
            (report.firstDivergence
                ? ` (first at #${report.firstDivergence.i} ${report.firstDivergence.t}: ${report.firstDivergence.what})`
                : '') +
            (report.stopped ? `; stopped: ${report.stopped}` : '') +
            `, ${(report.durationMs / 1000).toFixed(1)} s`,
    )
    return report
}
