// Player action recorder hooks (DH2 test tooling, no CE equivalent; README → "Action Recorder").
//
// The input paths (playerUse, the action menu, dialogue options, barter, inventory, combat
// buttons, world map travel, save / load) call recordAction() with what the player asked for,
// before it is carried out. Nothing happens unless a recorder installed a sink
// (src/devConsole/recorder.ts: on by default with [dh2] record_actions=1, or startRecording()).
//
// This module is a leaf on purpose: it imports nothing, so every input module can call it
// without adding an import cycle. Objects are passed as they are (field `o`, `item`); the
// recorder turns them into stable references.

/** One player action: `t` is its type, the rest its arguments (see recorder.ts → ActionType). */
export interface ActionEntry {
    t: string
    [key: string]: unknown
}

type Sink = (entry: ActionEntry) => ActionEntry | null
type Listener = () => void

let sink: Sink | null = null

/** Install (or with null remove) the recorder. */
export function setActionSink(s: Sink | null): void {
    sink = s
}

export function isRecordingActions(): boolean {
    return sink !== null
}

/** Record one player action. Returns the stored entry (callers may add what they learn
 *  later, e.g. whether a walk runs), or null when nothing records. */
export function recordAction(entry: ActionEntry): ActionEntry | null {
    return sink ? sink(entry) : null
}

function listenerSet<A extends unknown[]>() {
    const set = new Set<(...args: A) => void>()
    return {
        /** add a listener; returns its remover */
        add(l: (...args: A) => void): () => void {
            set.add(l)
            return () => set.delete(l)
        },
        notify(...args: A): void {
            for (const l of [...set]) {
                l(...args)
            }
        },
    }
}

const mapReady = listenerSet<[]>()
/** A map finished loading (before map_enter_p_proc) or a save's map was restored: the recorder
 *  and the replay name the map's objects by where they stand at this point. */
export const addMapReadyListener = mapReady.add
export function notifyMapReady(): void {
    mapReady.notify()
}

/** A save to come back to: its name and timestamp (the save's id differs between browsers). */
export interface SaveRef {
    name: string
    timestamp: number
}

const gameLoaded = listenerSet<[SaveRef, Record<string, unknown> | undefined]>()
/** A save finished loading (saveload.ts load(), the end of applyState: map_enter / load procs ran,
 *  the game is about to run again) — where a recording piece starts. `save` is the save itself
 *  (its recording and history continue in the new piece's history). */
export const addGameLoadedListener = gameLoaded.add
export function notifyGameLoaded(ref: SaveRef, save?: Record<string, unknown>): void {
    gameLoaded.notify(ref, save)
}

const newGame = listenerSet<[]>()
/** NEW GAME: the character is made and the first map is about to load (init.ts startNewGame). */
export const addNewGameListener = newGame.add
export function notifyNewGame(): void {
    newGame.notify()
}

let frameListener: Listener | null = null

/** Called at the start of every logical frame (heart.ts): the recorder notes its time. */
export function setFrameListener(l: Listener | null): void {
    frameListener = l
}

export function notifyFrame(): void {
    frameListener?.()
}

let replaying = false
const replayStart = listenerSet<[]>()
/** A replay (src/autocrawler/replay.ts) is running: nothing records, and the recording piece of
 *  the game the replay replaces ends. */
export const addReplayStartListener = replayStart.add
export function setReplaying(on: boolean): void {
    replaying = on
    if (on) {
        replayStart.notify()
    }
}
export function isReplaying(): boolean {
    return replaying
}

/** What a save stores of the recording (saveload.ts save()): `recording`, the piece since the last
 *  load / NEW GAME up to this moment, and `history`, every piece before it back to the chain's
 *  start (compressed). Set by the recorder. */
export interface SaveRecording {
    recording: Record<string, unknown>
    history?: Record<string, unknown>
}
let saveRecordingProvider: (() => SaveRecording | null) | null = null
export function setSaveRecordingProvider(p: (() => SaveRecording | null) | null): void {
    saveRecordingProvider = p
}
export function recordingForSave(): SaveRecording | null {
    return saveRecordingProvider ? saveRecordingProvider() : null
}

/** How the replay (src/autocrawler/replay.ts) runs an entry of a window it doesn't import:
 *  the window registers a handler for its entry types while it is open (the loot, steal and
 *  companion-trade windows) or once (the perk dialog, the character screen, the Pip-Boy rest);
 *  the handler gets the recorded entry (items as `ip`, their PID). */
export type ReplayControl = (entry: ActionEntry) => unknown

const replayControls = new Map<string, ReplayControl>()

export function setReplayControl(type: string, control: ReplayControl | null): void {
    if (control) {
        replayControls.set(type, control)
    } else {
        replayControls.delete(type)
    }
}

export function getReplayControl(type: string): ReplayControl | undefined {
    return replayControls.get(type)
}

/** The index of the first item with PID `pid` in `list` (-1: none), for replay controls. */
export function indexOfPid(list: readonly { pid?: number }[], pid: unknown): number {
    return list.findIndex((o) => o.pid === pid)
}
