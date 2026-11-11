// Player action recorder hooks (DH2 test tooling, no CE equivalent; README → "Action Recorder").
//
// The input paths (playerUse, the action menu, dialogue options, barter, inventory, combat
// buttons, world map travel, save / load) call recordAction() with what the player asked for,
// before it is carried out. Nothing happens unless a recorder installed a sink
// (src/devConsole/recorder.ts: startRecording()), so game behaviour is unchanged.
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
type MapReadyListener = () => void

let sink: Sink | null = null
let mapReadyListener: MapReadyListener | null = null

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

/** Called when a map finished loading (before map_enter_p_proc) or a save was restored: the
 *  recorder / replayer name the map's objects by where they stand at this point. */
export function setMapReadyListener(l: MapReadyListener | null): void {
    mapReadyListener = l
}

export function notifyMapReady(): void {
    mapReadyListener?.()
}

let frameListener: (() => void) | null = null

/** Called at the start of every logical frame (heart.ts): the recorder notes its time. */
export function setFrameListener(l: (() => void) | null): void {
    frameListener = l
}

export function notifyFrame(): void {
    frameListener?.()
}
