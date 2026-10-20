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
import { START_TICKS } from '../gametime.js'
import { finishLoadingIfReady } from '../gameTick.js'
import globalState from '../globalState.js'
import { heart } from '../heart.js'
import { Critter } from '../object.js'
import { randomSeedPrerandom } from '../random.js'
import { Scripting } from '../scripting.js'
import { UIMode, uiEndDialogue } from '../ui.js'
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
}

export interface StoryMapResult {
    map: string
    backend: string
    npcs: number
    steps: number
    trace: string[]
    // filled when a trace from the other backend was stored
    comparedWith?: string
    firstDiff?: { line: number; mine: string; other: string } | null
}

export interface StoryReport {
    type: 'story'
    backend: string
    timestamp: number
    maps: StoryMapResult[]
    summary: { maps: number; steps: number; compared: number; differing: number }
}

// ─── State capture ────────────────────────────────────────────────────────────

interface Snapshot {
    map: string
    gvars: { [k: string]: any }
    mvars: { [k: string]: any }
    lvars: { [uid: string]: { [k: string]: any } }
    xp: number
    caps: number
    inv: { [pid: string]: number }
    ui: number
}

function capture(): Snapshot {
    const map = globalState.gMap
    const player = globalState.player as any
    const lvars: Snapshot['lvars'] = {}
    for (const o of map ? map.getObjects() : []) {
        const s = (o as any)._script
        if (s && s.lvars) lvars[String((o as any).uid)] = { ...s.lvars }
    }
    const mapScript = (map?.name ?? '').toLowerCase()
    const inv: Snapshot['inv'] = {}
    for (const item of player?.inventory ?? []) inv[String(item.pid)] = (inv[String(item.pid)] ?? 0) + (item.amount ?? 1)
    return {
        map: map?.name ?? '',
        gvars: { ...Scripting.getGlobalVars() },
        mvars: { ...((Scripting.getMapVars() ?? {})[mapScript] ?? {}) },
        lvars,
        xp: player?.stats?.get?.('Experience') ?? 0,
        caps: player ? Scripting.itemGetTotalCaps(player) : 0,
        inv,
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
    if (a.xp !== b.xp) out.push(`xp:${a.xp}>${b.xp}`)
    if (a.caps !== b.caps) out.push(`caps:${a.caps}>${b.caps}`)
    diffTable('I', a.inv, b.inv, out)
    if (a.ui !== b.ui) out.push(`ui:${a.ui}>${b.ui}`)
    return out.join(' ')
}

// ─── Determinism ──────────────────────────────────────────────────────────────

function hashOf(text: string): number {
    let h = 2166136261 >>> 0
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
    return (h % 0x7ffffffe) + 1
}

/** Before every step: fixed clock, RNG seeded from where in the run we are. */
function pin(key: string): void {
    globalState.gameTickTime = PINNED_TIME
    randomSeedPrerandom(hashOf(key))
}

// ─── One step ─────────────────────────────────────────────────────────────────

function dialogueView(): string {
    if (globalState.uiMode !== UIMode.dialogue) return `ui=${globalState.uiMode}`
    const opts = getOptionElements().map((el) => (el.textContent ?? '').trim())
    return `reply="${getReplyText().slice(0, 60)}" opts=${opts.length}[${opts.map((o) => o.slice(0, 24)).join('|')}]`
}

/** Run one action deterministically and return its trace line. Script errors
 *  are part of the trace (both backends must fail the same way). */
async function step(key: string, label: string, action: () => void): Promise<string> {
    pin(key)
    const before = capture()
    let error = ''
    try {
        action()
    } catch (e) {
        error = ` THROW ${String(e).slice(0, 80)}`
    }
    // let promise callbacks (Lua coroutine resumes, UI updates) settle; the frame loop stays paused
    await new Promise<void>((r) => setTimeout(r, 0))
    if (globalState.inCombat) {
        globalState.combat?.forceEnd()
        await new Promise<void>((r) => setTimeout(r, 0))
        error += isCombatActive() ? ' COMBAT-STUCK' : ' COMBAT'
    }
    if (globalState.uiMode === UIMode.barter) {
        uiEndDialogue()
        error += ' BARTER'
    }
    return `${label} ${dialogueView()} {${diff(before, capture())}}${error}`
}

// ─── One NPC, one map ─────────────────────────────────────────────────────────

async function crawlNpc(npc: Critter, mapName: string, trace: string[], opts: Required<StoryOptions>): Promise<number> {
    const id = `${mapName}/${npc._script?.scriptName ?? '?'}#${npc.uid}`
    const frontier: number[][] = [[]]
    let runs = 0
    let steps = 0
    while (frontier.length > 0 && runs < opts.maxPathsPerNpc) {
        const path = frontier.shift()!
        if (npc.dead || !npc._script || typeof npc._script.talk_p_proc !== 'function') break
        if (globalState.gMap?.name !== mapName) break
        runs++
        movePlayerAdjacent(npc)
        trace.push(await step(`${id}:${path.join('.')}:talk`, `${id} [${path.join('.')}] talk`, () => Scripting.talk(npc._script!, npc)))
        steps++
        let depth = 0
        for (; depth < path.length && globalState.uiMode === UIMode.dialogue; depth++) {
            const els = getOptionElements()
            const k = path[depth]
            if (k >= els.length) break
            const sub = path.slice(0, depth + 1).join('.')
            trace.push(await step(`${id}:${sub}`, `${id} [${sub}] click ${k}`, () => els[k].click()))
            steps++
        }
        if (globalState.uiMode === UIMode.dialogue) {
            if (depth === path.length && path.length < opts.maxDepth) {
                const n = getOptionElements().length
                for (let k = 0; k < n; k++) frontier.push([...path, k])
            }
            trace.push(await step(`${id}:${path.join('.')}:end`, `${id} [${path.join('.')}] end`, () => Scripting.dialogueEnd()))
            steps++
        }
    }
    return steps
}

async function loadMapQuietly(name: string): Promise<boolean> {
    const map = globalState.gMap
    if (!map) return false
    if (map.name === name) return true
    pin(`load:${name}`)
    map.loadMap(name)
    // assets arrive on their own callbacks; the end of the load (map_enter_p_proc)
    // is run here with the clock and RNG pinned, as the paused frame loop would not
    const deadline = performance.now() + MAP_LOAD_TIMEOUT_MS
    while (globalState.isLoading) {
        if (performance.now() > deadline) return false
        await new Promise<void>((r) => setTimeout(r, 20))
        if (globalState.loadingAssetsLoaded === globalState.loadingAssetsTotal) {
            pin(`loaded:${name}`)
            finishLoadingIfReady()
        }
    }
    return map.name === name
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
    }
    const backend = Config.scripting.backend
    const other = backend === 'vm' ? 'lua' : 'vm'
    const report: StoryReport = {
        type: 'story', backend, timestamp: Date.now(), maps: [],
        summary: { maps: 0, steps: 0, compared: 0, differing: 0 },
    }
    const prev = { ...Config.scripting.debugLogShowType }
    Config.scripting.debugLogShowType.stub = false
    Config.scripting.debugLogShowType.dialogue = false
    Config.scripting.debugLogShowType.combat = false
    heart.paused = true
    try {
        for (const mapName of opts.maps) {
            if (!(await loadMapQuietly(mapName))) {
                console.warn(`[AutoCrawler] story: ${mapName} did not load`)
                continue
            }
            const trace: string[] = [`map ${mapName}`]
            const npcs = listTalkableNPCs()
            let steps = 0
            for (const npc of npcs) {
                console.log(`[AutoCrawler] story ${mapName}: ${critterDisplayName(npc)} (${npc._script?.scriptName})`)
                steps += await crawlNpc(npc, mapName, trace, opts)
                if (globalState.gMap?.name !== mapName) {
                    trace.push(`left the map for ${globalState.gMap?.name}`)
                    break
                }
            }
            const result: StoryMapResult = { map: mapName, backend, npcs: npcs.length, steps, trace }
            const key = `${opts.maxPathsPerNpc}/${opts.maxDepth}/${mapName}`
            const stored = await dbGet(`${other}:${key}`)
            if (stored) {
                result.comparedWith = other
                const n = Math.max(stored.length, trace.length)
                result.firstDiff = null
                for (let i = 0; i < n; i++) {
                    if (stored[i] !== trace[i]) {
                        result.firstDiff = { line: i, mine: trace[i] ?? '(end)', other: stored[i] ?? '(end)' }
                        break
                    }
                }
                report.summary.compared++
                if (result.firstDiff) report.summary.differing++
            }
            await dbPut(`${backend}:${key}`, trace)
            report.maps.push(result)
            report.summary.maps++
            report.summary.steps += steps
            console.log(`[AutoCrawler] story ${mapName}: ${npcs.length} NPCs, ${steps} steps` +
                (result.comparedWith ? (result.firstDiff ? `, DIFFERS from ${other} at line ${result.firstDiff.line}` : `, same as ${other}`) : ''))
            setLastReport(report)
        }
    } finally {
        heart.paused = false
        Object.assign(Config.scripting.debugLogShowType, prev)
    }
    setLastReport(report)
    console.log(`[AutoCrawler] story: ${report.summary.maps} maps, ${report.summary.steps} steps, ` +
        `${report.summary.compared} compared, ${report.summary.differing} differing`)
    return report
}
