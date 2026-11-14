// The game logic's clock: one time per frame (DH2; CE reads getTicks() wherever it needs it).
//
// heart.ts sets it at the start of every logical frame; tickGame (the 10 Hz game tick, the
// critter-script loop), the critter and object animations, projectile flight and the script
// timers read it through gameNow(). So every read inside one frame agrees, and a frame's logic
// depends only on that frame's time — which the action recorder stores per frame, so a replay
// reproduces walks and critter timing exactly (wiki/action_recorder.md → "Determinism"). In
// play nothing changes but that: the logic reads the same time a few ms earlier or later within
// the frame. Drawing (in-between positions, float text, fades) keeps reading performance.now().
//
// A leaf module (no imports): tests and every logic module can use it.

let frameTime = -1

/** Set by heart.ts at the start of each logical frame (the replay sets its virtual time). */
export function setFrameTime(t: number): void {
    frameTime = t
}

/** The current frame's time in ms (performance.now() of its start). Before the first frame, and
 *  outside a browser, the real clock. */
export function gameNow(): number {
    if (frameTime >= 0) {
        return frameTime
    }
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
