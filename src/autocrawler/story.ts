// AutoCrawler — story crawler: walks the main-quest maps in story order and
// explores every talkable NPC's dialogue tree path by path, recording what each
// step changes (GVARs, the map's MVARs, every script's LVARs, the player's XP,
// caps and inventory, the map the player is on).
//
// The run is deterministic: the frame loop is paused (no heartbeats, no timed
// events), and before every step the game clock is set to a fixed time and the
// CE RNG is reseeded from the step's position in the run. So a run with
// script_backend=vm and one with script_backend=lua must produce the same
// trace; the first run stores its trace (IndexedDB, per map) and a run on the
// other backend compares against it — the in-game counterpart of luadiff.html.
//
//   play.html?crawl=story#script_backend=vm    (stores the VM trace)
//   play.html?crawl=story#script_backend=lua   (compares; report on autoCrawler.lastReport)
//   autoCrawler.runStoryCrawler({ maps: ['arvillag'] })
//
// Paths: a path is the list of option indices clicked after talk_p_proc. Each
// run talks to the NPC, clicks along the path, records the options it reaches
// as new paths, then ends the dialogue (Scripting.dialogueEnd, as the [Done] /
// Escape route does). State is not restored between runs: later runs see what
// earlier ones did, as a player re-talking would — the same on both backends.

import { isCombatActive } from '../combat.js'
import { Config } from '../config.js'
import * as GameTime from '../gametime.js'
import { START_TICKS } from '../gametime.js'
import { finishLoadingIfReady, setLastMidnightDay } from '../gameTick.js'
import { setGameMovieSkipAll } from '../gameMovie.js'
import globalState from '../globalState.js'
import { heart } from '../heart.js'
import { cloneItem, Critter } from '../object.js'
import { setLuaErrorHook } from '../lua/luaRuntime.js'
import { randomDraws, randomSeedExact, setRandomDrawHook } from '../random.js'
import { Scripting } from '../scripting.js'
import { toTileNum } from '../tile.js'
import { setVMFatalHook } from '../vm.js'
import { UIMode, uiEndDialogue } from '../ui.js'
import { activeBarter } from '../ui_barter.js'
import { uiElevatorDone } from '../ui_elevator.js'
import { uiCloseWorldMap } from '../ui_worldmap.js'
import { critterDisplayName, getOptionElements, getReplyText, listTalkableNPCs, movePlayerAdjacent, setLastReport } from './shared.js'

/** Main-quest order (Arroyo → Klamath → the Den → Modoc → Vault City → Gecko → Broken Hills → New Reno →
 *  Redding → NCR → Vaults 13/15 → San Francisco → Navarro). */
export const STORY_MAPS = [
    'arvillag', 'klamall', 'kladwtwn', 'klatrap', 'denbus1', 'denbus2', 'denres1', 'modmain', 'modinn',
    'vctyctyd', 'vctycocl', 'vctydwtn', 'gecksetl', 'broken1', 'broken2', 'newr1', 'newr2', 'newr3', 'newr4',
    'reddown', 'redment', 'ncr1', 'ncr2', 'ncr3', 'ncr4', 'v13ent', 'v15ent', 'sfchina', 'navarro',
]

const MAX_PATHS_PER_NPC = 24
const MAX_DEPTH = 8
const PINNED_TIME = START_TICKS // a fixed clock for every step: the new-game start time
const MAP_LOAD_TIMEOUT_MS = 30000
const DB_NAME = 'dh2-story-crawler'

export interface StoryOptions {
    maps?: string[]
    maxPathsPerNpc?: number
    maxDepth?: number
    /** steps whose label contains this get a short call stack for every random draw */
    traceDrawsFor?: string
    /** also run every scripted object's examine/look/use/pickup/skill procedures (default true) */
    objects?: boolean
    /** then let game time pass: timed events, map_update_p_proc, critter heartbeats (default true) */
    time?: boolean
}

export interface StoryMapResult {
    map: string
    backend: string
    npcs: number
    steps: number
    loadRng: number // random numbers drawn while the map loaded (map_enter_p_proc and asset callbacks)
    trace: string[]
    // filled when a trace from the other backend was stored
    comparedWith?: string
    firstDiff?: { line: number; mine: string; other: string } | null
    // the first difference counts as a backend difference only before either
    // backend's own run-to-run instability (repeatDiff); after it, the traces may
    // differ from timing alone (anything still running on real time) — "inconclusive"
    verdict?: 'same' | 'backend-difference' | 'inconclusive'
    // against the previous run on the same backend: a difference here is
    // nondeterminism in the crawl itself, not a VM-vs-Lua difference
    repeatDiff?: { line: number; mine: string; other: string } | null
}

export interface StoryReport {
    type: 'story'
    backend: string
    timestamp: number
    maps: StoryMapResult[]
    summary: { maps: number; steps: number; compared: number; differing: number; unstable: number; backendDifferences: number; inconclusive: number }
}

// ─── State capture ────────────────────────────────────────────────────────────

// Objects are named by what they are and where they were first seen (pid@tile,
// ~n for a second one there), not by the global uid or a list position: uids
// shift with everything created before, and one extra object would shift every
// position after it. An object only one backend has shows up as its own name.
let labels = new Map<number, string>()
let taken = new Set<string>()

function resetLabels(): void {
    labels = new Map()
    taken = new Set()
    for (const o of globalState.gMap ? globalState.gMap.getObjects() : []) label(o)
}

function label(o: any): string {
    let l = labels.get(o.uid)
    if (l === undefined) {
        const base = `${(o.pid ?? -1).toString(16)}@${o.position ? toTileNum(o.position) : '-'}`
        l = base
        for (let n = 2; taken.has(l); n++) l = `${base}~${n}`
        taken.add(l)
        labels.set(o.uid, l)
    }
    return l
}

interface Snapshot {
    map: string
    gvars: { [k: string]: any }
    mvars: { [k: string]: any }
    lvars: { [label: string]: { [k: string]: any } }
    tiles: { [label: string]: number } // scripted objects and the player: where they stand
    // critters on their way somewhere: walk/run and the target tile (a script's
    // animate_move_obj_to_tile / reg_anim; the paused frame loop never moves them)
    goals: { [label: string]: string }
    xp: number
    caps: number
    inv: { [pid: string]: number }
    stats: { [name: string]: number }
    ui: number
}

// the player's stats a script can test (do_check, get_critter_stat …)
const PLAYER_STATS = ['STR', 'PER', 'END', 'CHA', 'INT', 'AGI', 'LUK', 'HP', 'Max HP', 'Level']

function capture(): Snapshot {
    const map = globalState.gMap
    const player = globalState.player as any
    const lvars: Snapshot['lvars'] = {}
    const tiles: Snapshot['tiles'] = {}
    const goals: Snapshot['goals'] = {}
    for (const o of map ? map.getObjects() : []) {
        const path = (o as any).path
        if (path?.target) goals[label(o)] = `${(o as any).anim}@${toTileNum(path.target)}`
        const s = (o as any)._script
        if (s && s.lvars) lvars[label(o)] = { ...s.lvars }
        if ((s || (o as any).isPlayer) && (o as any).position) tiles[label(o)] = toTileNum((o as any).position)
    }
    const mapScript = (map?.name ?? '').toLowerCase()
    const inv: Snapshot['inv'] = {}
    for (const item of player?.inventory ?? []) inv[String(item.pid)] = (inv[String(item.pid)] ?? 0) + (item.amount ?? 1)
    return {
        map: map?.name ?? '',
        gvars: { ...Scripting.getGlobalVars() },
        mvars: { ...((Scripting.getMapVars() ?? {})[mapScript] ?? {}) },
        lvars,
        tiles,
        goals,
        xp: player?.stats?.get?.('Experience') ?? 0,
        caps: player ? Scripting.itemGetTotalCaps(player) : 0,
        inv,
        stats: Object.fromEntries(PLAYER_STATS.map((n) => [n, player?.getStat?.(n) ?? 0])),
        ui: globalState.uiMode,
    }
}

function fmt(v: any): string {
    if (v === undefined) return '-'
    if (typeof v === 'object' && v !== null) return v.pid !== undefined ? 'obj' + v.pid : 'obj'
    return String(v)
}

function diffTable(tag: string, a: { [k: string]: any }, b: { [k: string]: any }, out: string[]): void {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of [...keys].sort((x, y) => Number(x) - Number(y) || (x < y ? -1 : 1))) {
        if (fmt(a[k]) !== fmt(b[k])) out.push(`${tag}${k}:${fmt(a[k])}>${fmt(b[k])}`)
    }
}

/** What changed between two snapshots, as one compact string. */
function diff(a: Snapshot, b: Snapshot): string {
    const out: string[] = []
    if (a.map !== b.map) out.push(`map:${a.map}>${b.map}`)
    diffTable('G', a.gvars, b.gvars, out)
    diffTable('M', a.mvars, b.mvars, out)
    const uids = new Set([...Object.keys(a.lvars), ...Object.keys(b.lvars)])
    for (const uid of [...uids].sort()) diffTable(`L${uid}.`, a.lvars[uid] ?? {}, b.lvars[uid] ?? {}, out)
    diffTable('T', a.tiles, b.tiles, out)
    diffTable('W', a.goals, b.goals, out)
    if (a.xp !== b.xp) out.push(`xp:${a.xp}>${b.xp}`)
    if (a.caps !== b.caps) out.push(`caps:${a.caps}>${b.caps}`)
    diffTable('I', a.inv, b.inv, out)
    diffTable('P.', a.stats, b.stats, out)
    if (a.ui !== b.ui) out.push(`ui:${a.ui}>${b.ui}`)
    return out.join(' ')
}

// ─── Determinism ──────────────────────────────────────────────────────────────

function hashOf(text: string): number {
    let h = 2166136261 >>> 0
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
    return (h % 0x7ffffffe) + 1
}

// the clock every step starts at; the time pass moves it on
let pinnedClock = PINNED_TIME

/** Before every step: fixed clock, RNG seeded from where in the run we are. */
function pin(key: string): void {
    globalState.gameTickTime = pinnedClock
    randomSeedExact(hashOf(key))
}

// ─── One step ─────────────────────────────────────────────────────────────────

function dialogueView(): string {
    if (globalState.uiMode !== UIMode.dialogue) return `ui=${globalState.uiMode}`
    const opts = getOptionElements().map((el) => (el.textContent ?? '').trim())
    return `reply="${getReplyText().slice(0, 60)}" opts=${opts.length}[${opts.map((o) => o.slice(0, 24)).join('|')}]`
}

/** Run one action deterministically and return its trace line. Script errors
 *  are part of the trace (both backends must fail the same way). */
let traceDrawsFor = ''

function callers(): string {
    // the frames between getRandom and the step: intrinsic, script procedure, …
    const frames = (new Error().stack ?? '').split('\n').slice(3, 9)
    return frames.map((f) => (f.trim().match(/at (?:Object\.|Script\.)?([\w.$<>]+)/) ?? [])[1] ?? '?').join('<')
}

/** What the message window got since `from` lines (display_msg, float_msg to the log …). */
function logSince(from: number): string {
    const items = document.querySelectorAll('#displayLog li')
    const out: string[] = []
    for (let i = from; i < items.length; i++) out.push((items[i].textContent ?? '').trim().slice(0, 80))
    return out.length ? ` log=[${out.join(' | ')}]` : ''
}

function inventoryOf(o: any): string {
    const inv: { [pid: string]: number } = {}
    for (const item of o?.inventory ?? []) inv[String(item.pid)] = (inv[String(item.pid)] ?? 0) + (item.amount ?? 1)
    return Object.keys(inv).sort((a, b) => Number(a) - Number(b)).map((p) => `${p}x${inv[p]}`).join(',')
}

const PID_BOTTLE_CAPS = 41

/** One purchase in an open barter screen: the merchant's cheapest item (one of
 *  it), paid with exactly the caps the merchant asks (CE _barter_compute_value:
 *  the script's barter modifier, the merchant's reaction, both Barter skills).
 *  The bought item and the caps then show in the step's state change, and the
 *  later dialogues run with them. */
function barterTrade(): string {
    const b = activeBarter
    if (!b) return ' buy=no-screen'
    const unit = (o: any) => o.stackCost(1)
    const wares = b.merchantInventory().filter((o: any) => o.pid !== PID_BOTTLE_CAPS && unit(o) > 0)
        .sort((x: any, y: any) => unit(x) - unit(y) || x.pid - y.pid)
    if (wares.length === 0) return ' buy=nothing'
    const item: any = wares[0]
    b.put('merchant', item, 1)
    const price = b.quote()
    const caps: any = b.playerInventory().find((o: any) => o.pid === PID_BOTTLE_CAPS)
    // an empty offer is never good enough (CE _barter_attempt_transaction): at least one cap
    const pay = Math.max(price, 1)
    if (!caps || (caps.amount ?? 1) < pay) return ` buy=${item.pid}@${price}:short`
    b.put('player', caps, pay)
    if (b.offer()) return ` buy=${item.pid}@${price}:ok`
    // the merchant's answer (CE inventry.msg 28 not good enough / 31 cannot carry)
    return ` buy=${item.pid}@${price}:refused("${getReplyText().slice(0, 40)}")`
}

/** A screen a script opened that the crawl does not drive: note it and close it. */
function closeScreens(subject: any): string {
    let note = ''
    if (globalState.uiMode === UIMode.barter) {
        // the barter the script set up: its price modifier and what the merchant offers
        note += ` BARTER mod=${Scripting.getDialogueBarterMod()} inv=[${inventoryOf(subject)}]` + barterTrade()
        uiEndDialogue()
    }
    if (globalState.uiMode === UIMode.worldMap) {
        uiCloseWorldMap()
        note += ' WORLDMAP'
    }
    if (globalState.uiMode === UIMode.elevator) {
        uiElevatorDone()
        note += ' ELEVATOR'
    }
    return note
}

function fatalKind(text: string): string {
    const m = text.match(/Stack overflow|Division \((?:DIV|MOD)\) by zero/)
    return m ? m[0] : ''
}

async function step(key: string, label: string, action: () => void, subject?: any): Promise<string> {
    const draws: string[] = []
    const logStart = document.querySelectorAll('#displayLog li').length
    if (traceDrawsFor && label.includes(traceDrawsFor)) setRandomDrawHook(() => draws.push(callers()))
    // errors the action does not throw to us: a Lua script error (caught by the
    // runtime) or an exception in a click handler (reported to window, not to click())
    const hidden: string[] = []
    // a fatal script error (CE programFatalError: a stack overflow, division by
    // zero) stops the procedure on both backends: one marker for both
    setVMFatalHook((t) => hidden.push('FATAL ' + fatalKind(t)))
    setLuaErrorHook((t) => hidden.push(fatalKind(t) ? 'FATAL ' + fatalKind(t) : 'LUA ' + t.slice(0, 120)))
    const onError = (e: ErrorEvent) => hidden.push('ERR ' + String(e.message).slice(0, 120))
    window.addEventListener('error', onError)
    pin(key)
    const before = capture()
    const drawsAtStart = randomDraws
    let error = ''
    try {
        action()
    } catch (e) {
        error = ` THROW ${String(e).slice(0, 80)}`
    }
    // the script's own draws happen during the action; draws in the settle below
    // come from asset callbacks (a talking head's fidget once its art arrives),
    // which depend on download timing and are not counted
    const scriptDraws = randomDraws - drawsAtStart
    setRandomDrawHook(null)
    // let promise callbacks (Lua coroutine resumes, UI updates) settle; the frame loop stays paused
    await new Promise<void>((r) => setTimeout(r, 0))
    // what the next game tick would do: a map change a script asked for, or a
    // dialogue a script requested
    try {
        if (Scripting.processMapTransition()) {
            if (!(await finishLoad(`${key}:transition`))) error += ' LOAD-TIMEOUT'
        } else if (Scripting.processDialogueRequest()) {
            await new Promise<void>((r) => setTimeout(r, 0))
        }
    } catch (e) {
        error += ` THROW ${String(e).slice(0, 80)}`
    }
    if (globalState.inCombat) {
        globalState.combat?.forceEnd()
        await new Promise<void>((r) => setTimeout(r, 0))
        error += isCombatActive() ? ' COMBAT-STUCK' : ' COMBAT'
    }
    error += closeScreens(subject)
    // the end of the frame: objects a script destroyed leave the map (the paused
    // frame loop would never take them off, and later steps would run their scripts)
    globalState.gMap?.drainRemovalQueue()
    setLuaErrorHook(null)
    setVMFatalHook(null)
    window.removeEventListener('error', onError)
    if (hidden.length) error += ` [${hidden.join(' ; ')}]`
    const line = `${label} ${dialogueView()} {${diff(before, capture())}} rng:${scriptDraws}${logSince(logStart)}${error}` +
        (draws.length ? ` draws=[${draws.join(' ; ')}]` : '')
    return line
}

// ─── One NPC, one map ─────────────────────────────────────────────────────────

async function crawlNpc(npc: Critter, mapName: string, trace: string[], opts: Required<StoryOptions>): Promise<number> {
    const id = `${mapName}/${npc._script?.scriptName ?? '?'}#${label(npc)}`
    const frontier: number[][] = [[]]
    let runs = 0
    let steps = 0
    while (frontier.length > 0 && runs < opts.maxPathsPerNpc) {
        const path = frontier.shift()!
        if (npc.dead || !npc._script || typeof npc._script.talk_p_proc !== 'function') break
        if (globalState.gMap?.name !== mapName) break
        runs++
        movePlayerAdjacent(npc)
        trace.push(await step(`${id}:${path.join('.')}:talk`, `${id} [${path.join('.')}] talk`, () => Scripting.talk(npc._script!, npc), npc))
        steps++
        let depth = 0
        for (; depth < path.length && globalState.uiMode === UIMode.dialogue; depth++) {
            const els = getOptionElements()
            const k = path[depth]
            if (k >= els.length) break
            const sub = path.slice(0, depth + 1).join('.')
            trace.push(await step(`${id}:${sub}`, `${id} [${sub}] click ${k}`, () => els[k].click(), npc))
            steps++
        }
        if (globalState.uiMode === UIMode.dialogue) {
            if (depth === path.length && path.length < opts.maxDepth) {
                const n = getOptionElements().length
                for (let k = 0; k < n; k++) frontier.push([...path, k])
            }
            trace.push(await step(`${id}:${path.join('.')}:end`, `${id} [${path.join('.')}] end`, () => Scripting.dialogueEnd(), npc))
            steps++
        }
    }
    return steps
}

// CE skill ids as scripts see them in action_being_used (skill.h): the skills a
// player uses on things — First Aid, Doctor, Lockpick, Traps, Science, Repair
const OBJECT_SKILLS = [6, 7, 9, 11, 12, 13]

/** Every scripted object's other entry points, with the player standing next
 *  to it: examine (description_p_proc), look (look_at_p_proc), use (use_p_proc,
 *  not on critters), pick up (pickup_p_proc, items) and the skills above
 *  (use_skill_on_p_proc). Each runs only the script, as CE does before its
 *  engine fallback; a dialogue a script starts is ended at once. */
async function crawlObjects(mapName: string, trace: string[]): Promise<number> {
    const map = globalState.gMap
    const player = globalState.player as any
    if (!map || !player) return 0
    let steps = 0
    for (const obj of map.getObjects().slice()) {
        const s: any = (obj as any)._script
        if (!s || (obj as any).isPlayer || !(obj as any).position) continue
        const isCritter = obj instanceof Critter
        const id = `${mapName}/${s.scriptName ?? '?'}#${label(obj)}`
        const actions: [string, () => void][] = []
        if (typeof s.description_p_proc === 'function') actions.push(['examine', () => Scripting.description(obj, player)])
        if (typeof s.look_at_p_proc === 'function') actions.push(['look', () => Scripting.lookAt(obj, player)])
        if (!isCritter && typeof s.use_p_proc === 'function') actions.push(['use', () => Scripting.use(obj, player)])
        if (obj.type === 'item' && typeof s.pickup_p_proc === 'function') actions.push(['pickup', () => Scripting.pickup(obj, player)])
        if (typeof s.use_skill_on_p_proc === 'function') {
            for (const skill of OBJECT_SKILLS) actions.push([`skill${skill}`, () => Scripting.useSkillOn(player, skill, obj)])
        }
        for (const [what, action] of actions) {
            if (globalState.gMap?.name !== mapName) return steps
            // an earlier step may have destroyed it, or killed the critter
            if (!map.getObjects().includes(obj) || (isCritter && (obj as Critter).dead)) break
            movePlayerAdjacent(obj as Critter)
            trace.push(await step(`${id}:${what}`, `${id} ${what}`, action, obj))
            steps++
            if (globalState.uiMode === UIMode.dialogue) {
                trace.push(await step(`${id}:${what}:end`, `${id} ${what} end`, () => Scripting.dialogueEnd(), obj))
                steps++
            }
        }
    }
    return steps
}

// The time pass: the clock steps forward from the crawl's fixed time, 6 times a
// game minute, 4 times a game hour and once a day (ticks: 10 per second).
const TIME_STEPS = [600, 600, 600, 600, 600, 600, 36000, 36000, 36000, 36000, 864000]

/** What happens on a map while game time passes, step by step and the same way
 *  every run: the clock moves on (CE queueProcessEvents: the timed events that
 *  came due fire in due order, midnight), map_update_p_proc runs on every script
 *  of the map (CE scriptsExecMapUpdateProc, a 600-tick queue event), then every
 *  living scripted critter's critter_p_proc once, in map order (CE runs one per
 *  main-loop pass, round-robin, _script_chk_critters; the crawl has no frames).
 *  A dialogue a heartbeat opens is ended; a fight it starts is ended (COMBAT). */
async function crawlTime(mapName: string, trace: string[]): Promise<number> {
    let steps = 0
    let clock = PINNED_TIME
    setLastMidnightDay(Math.floor(clock / GameTime.TICKS_PER_DAY))
    try {
        for (let k = 0; k < TIME_STEPS.length; k++) {
            if (globalState.gMap?.name !== mapName) break
            const dt = TIME_STEPS[k]
            pinnedClock = clock
            const id = `${mapName}/time${k}`
            trace.push(await step(`${id}:advance`, `${id} +${dt} ticks`, () => {
                GameTime.advanceTicks(dt) // fires the due timed events and midnight
                globalState.gMap?.updateMap()
            }))
            steps++
            clock += dt
            pinnedClock = clock
            if (globalState.uiMode === UIMode.dialogue) {
                trace.push(await step(`${id}:advance:end`, `${id} end`, () => Scripting.dialogueEnd()))
                steps++
            }
            const critters = (globalState.gMap?.getObjects() ?? []).filter(
                (o): o is Critter => o instanceof Critter && !!o._script && !o.dead && !(o as any).isPlayer)
            for (const c of critters) {
                if (globalState.gMap?.name !== mapName) return steps
                if (c.dead || !c._script || typeof c._script.critter_p_proc !== 'function') continue
                const cid = `${id}/${c._script.scriptName ?? '?'}#${label(c)}`
                trace.push(await step(`${cid}:heartbeat`, `${cid} heartbeat`, () => Scripting.updateCritter(c._script!, c), c))
                steps++
                if (globalState.uiMode === UIMode.dialogue) {
                    trace.push(await step(`${cid}:heartbeat:end`, `${cid} end`, () => Scripting.dialogueEnd(), c))
                    steps++
                }
            }
        }
    } finally {
        pinnedClock = PINNED_TIME
    }
    return steps
}

async function loadMapQuietly(name: string): Promise<boolean> {
    const map = globalState.gMap
    if (!map) return false
    if (map.name === name) {
        resetLabels()
        return true
    }
    pin(`load:${name}`)
    map.loadMap(name)
    return (await finishLoad(`loaded:${name}`)) && map.name === name
}

/** Wait for a map load to finish. Assets arrive on their own callbacks; the
 *  end of the load (map_enter_p_proc) is run here with the clock and RNG pinned,
 *  as the paused frame loop would not. */
async function finishLoad(key: string): Promise<boolean> {
    const deadline = performance.now() + MAP_LOAD_TIMEOUT_MS
    while (globalState.isLoading) {
        if (performance.now() > deadline) return false
        await new Promise<void>((r) => setTimeout(r, 20))
        if (globalState.loadingAssetsLoaded === globalState.loadingAssetsTotal) {
            // name the objects where the map file puts them, before map_enter_p_proc
            // moves any (some scripts place critters at random on entry)
            resetLabels()
            pin(key)
            finishLoadingIfReady()
        }
    }
    return true
}

// ─── Trace storage (IndexedDB: traces are megabytes) ──────────────────────────

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => req.result.createObjectStore('traces')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

async function dbGet(key: string): Promise<string[] | undefined> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
        const req = db.transaction('traces').objectStore('traces').get(key)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

async function dbPut(key: string, value: string[]): Promise<void> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
        const tx = db.transaction('traces', 'readwrite')
        tx.objectStore('traces').put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
    })
}

function firstDifference(mine: string[], other: string[]): { line: number; mine: string; other: string } | null {
    const n = Math.max(mine.length, other.length)
    for (let i = 0; i < n; i++) {
        if (mine[i] !== other[i]) return { line: i, mine: mine[i] ?? '(end)', other: other[i] ?? '(end)' }
    }
    return null
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function runStoryCrawler(options: StoryOptions = {}): Promise<StoryReport | null> {
    if (!Config.engine.debug) {
        console.error('[AutoCrawler] Config.engine.debug must be true')
        return null
    }
    if (!globalState.gMap || !globalState.player) {
        console.error('[AutoCrawler] No active map/player — start a game first')
        return null
    }
    const opts: Required<StoryOptions> = {
        maps: options.maps ?? STORY_MAPS,
        maxPathsPerNpc: options.maxPathsPerNpc ?? MAX_PATHS_PER_NPC,
        maxDepth: options.maxDepth ?? MAX_DEPTH,
        traceDrawsFor: options.traceDrawsFor ?? '',
        objects: options.objects ?? true,
        time: options.time ?? true,
    }
    traceDrawsFor = opts.traceDrawsFor
    const backend = Config.scripting.backend
    const other = backend === 'vm' ? 'lua' : 'vm'
    const report: StoryReport = {
        type: 'story', backend, timestamp: Date.now(), maps: [],
        summary: { maps: 0, steps: 0, compared: 0, differing: 0, unstable: 0, backendDifferences: 0, inconclusive: 0 },
    }
    const prev = { ...Config.scripting.debugLogShowType }
    Config.scripting.debugLogShowType.stub = false
    Config.scripting.debugLogShowType.dialogue = false
    Config.scripting.debugLogShowType.combat = false
    heart.paused = true
    // a script's play_gmovie ends at once: a real movie's fade timer, video events and
    // uiMode switches would land in later steps at times that vary from run to run
    setGameMovieSkipAll(true)
    // every map starts from the state the crawl started with (GVARs, MVARs, XP, HP,
    // the inventory and its caps, no timed events), so one map's difference (or noise) does not
    // carry into all the later ones
    const baseline = {
        gvars: { ...Scripting.getGlobalVars() },
        mvars: JSON.parse(JSON.stringify(Scripting.getMapVars() ?? {})),
        xp: (globalState.player as any).stats.getBase('Experience') as number,
        hp: (globalState.player as any).stats.getBase('HP') as number,
        caps: Scripting.itemGetTotalCaps(globalState.player as any),
        inventory: (globalState.player as any).inventory.map(cloneItem) as any[],
    }
    try {
        for (const mapName of opts.maps) {
            Scripting.setGlobalVars(baseline.gvars)
            Scripting.setMapVars(JSON.parse(JSON.stringify(baseline.mvars)))
            ;(globalState.player as any).stats.setBase('Experience', baseline.xp)
            ;(globalState.player as any).stats.setBase('HP', baseline.hp)
            // what the last map's purchases and scripts added or took
            ;(globalState.player as any).inventory = baseline.inventory.map(cloneItem)
            // timers the last map's scripts set would fire in this map's time pass
            Scripting.timeEventList.length = 0
            const capsDelta = baseline.caps - Scripting.itemGetTotalCaps(globalState.player as any)
            if (capsDelta !== 0) Scripting.itemCapsAdjust(globalState.player as any, capsDelta)
            const loadDraws = randomDraws
            if (!(await loadMapQuietly(mapName))) {
                console.warn(`[AutoCrawler] story: ${mapName} did not load`)
                continue
            }
            const start = capture()
            // draws during the load are reported, not compared line by line: asset
            // loading is asynchronous, so counts may vary by a few
            const loadRng = randomDraws - loadDraws
            const npcs = listTalkableNPCs()
            const trace: string[] = [`map ${mapName} player ${JSON.stringify(start.stats)} xp:${start.xp} caps:${start.caps}`,
                `npcs ${npcs.map((n) => `${n._script?.scriptName}#${label(n)}`).join(' ')}`]
            let steps = 0
            for (const npc of npcs) {
                console.log(`[AutoCrawler] story ${mapName}: ${critterDisplayName(npc)} (${npc._script?.scriptName})`)
                steps += await crawlNpc(npc, mapName, trace, opts)
                if (globalState.gMap?.name !== mapName) {
                    trace.push(`left the map for ${globalState.gMap?.name}`)
                    break
                }
            }
            if (opts.objects && globalState.gMap?.name === mapName) {
                console.log(`[AutoCrawler] story ${mapName}: scripted objects`)
                steps += await crawlObjects(mapName, trace)
                if (globalState.gMap?.name !== mapName) trace.push(`left the map for ${globalState.gMap?.name}`)
            }
            if (opts.time && globalState.gMap?.name === mapName) {
                console.log(`[AutoCrawler] story ${mapName}: time passing`)
                steps += await crawlTime(mapName, trace)
                if (globalState.gMap?.name !== mapName) trace.push(`left the map for ${globalState.gMap?.name}`)
            }
            const result: StoryMapResult = { map: mapName, backend, npcs: npcs.length, steps, loadRng, trace }
            // v2: message log + barter in the lines; v3: a purchase in each barter; v4: removed
            // objects leave the map after each step; +o / +t: the object / time pass ran
            const key = `v4${opts.objects ? '+o' : ''}${opts.time ? '+t' : ''}/${opts.maxPathsPerNpc}/${opts.maxDepth}/${mapName}`
            const previous = await dbGet(`${backend}:${key}`)
            if (previous) {
                result.repeatDiff = firstDifference(trace, previous)
                if (result.repeatDiff) report.summary.unstable++
            }
            // where each backend stops agreeing with itself (stored per backend; a
            // backend run once has no known instability yet)
            const myStable = previous ? (result.repeatDiff?.line ?? Infinity) : undefined
            if (myStable !== undefined) await dbPut(`${backend}:${key}:stable`, [String(myStable)])
            const stored = await dbGet(`${other}:${key}`)
            if (stored) {
                result.comparedWith = other
                result.firstDiff = firstDifference(trace, stored)
                report.summary.compared++
                const otherStable = Number((await dbGet(`${other}:${key}:stable`))?.[0] ?? NaN)
                if (!result.firstDiff) result.verdict = 'same'
                else {
                    report.summary.differing++
                    const limit = Math.min(myStable ?? -1, Number.isNaN(otherStable) ? -1 : otherStable)
                    result.verdict = result.firstDiff.line < limit ? 'backend-difference' : 'inconclusive'
                    if (result.verdict === 'backend-difference') report.summary.backendDifferences++
                    else report.summary.inconclusive++
                }
            }
            await dbPut(`${backend}:${key}`, trace)
            report.maps.push(result)
            report.summary.maps++
            report.summary.steps += steps
            console.log(`[AutoCrawler] story ${mapName}: ${npcs.length} NPCs, ${steps} steps` +
                (result.comparedWith ? (result.firstDiff ? `, differs from ${other} at line ${result.firstDiff.line} (${result.verdict})` : `, same as ${other}`) : '') +
                (result.repeatDiff ? `, differs from the previous ${backend} run at line ${result.repeatDiff.line}` : ''))
            setLastReport(report)
        }
    } finally {
        heart.paused = false
        setGameMovieSkipAll(false)
        Object.assign(Config.scripting.debugLogShowType, prev)
    }
    setLastReport(report)
    console.log(`[AutoCrawler] story: ${report.summary.maps} maps, ${report.summary.steps} steps, ` +
        `${report.summary.compared} compared, ${report.summary.differing} differing ` +
        `(${report.summary.backendDifferences} backend differences, ${report.summary.inconclusive} inconclusive), ${report.summary.unstable} unstable`)
    return report
}
