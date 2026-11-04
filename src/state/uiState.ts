// The interface's state: which screen is open (UI mode), the cursor, hover / highlight, float
// messages, the selected skill and punch / kick modes (wiki/code_quality.md Q15). A leaf module;
// globalState.ts keeps a getter / setter for every field.

import type { CursorMode, FloatMessage } from '../globalState.js'
import type { Point } from '../geometry.js'
import type { Obj } from '../object.js'
import { Skills } from '../skills.js'
import { UIMode } from '../uiMode.js'

export const uiState = {
    uiMode: UIMode.none,
    skillMode: Skills.None,
    gameUIDisabled: false,
    gameHasFocus: false, // do we have input focus?
    lastMousePickTime: 0, // time when we last checked what's under the mouse cursor

    // Cursor system
    cursorMode: 'move' as CursorMode,
    preScrollCursorMode: 'move' as CursorMode,
    cursorPos: { x: 0, y: 0 } as Point,
    showLookCursor: false,
    hoverActionIcon: null as string | null, // the ARROW cursor's primary-action icon (input.ts)
    hexCursorText: null as { text: string; color: string } | null, // the MOVE cursor's AP / X (input.ts)
    commandModeTimer: null as number | null,

    // CE ref: game_config.h:37 item_highlight — held purely as runtime input
    // state, NOT a saved preference. This is a DH2-specific QoL sweep (hold
    // a key to outline every item on screen) with no CE equivalent; kept
    // separate from Config.ui.itemHighlight, which is the actual CE
    // preference (a persistent options checkbox controlling whether hovering
    // the mouse over a single item outlines it — see input.ts mousemoved).
    highlightItemsKeyHeld: false,
    // CE ref: game_mouse.cc:680 — the single item currently under the mouse
    // cursor, outlined while Config.ui.itemHighlight is on. Cleared/updated
    // on every mousemove in input.ts.
    hoveredItem: null as Obj | null,

    floatMessages: [] as FloatMessage[],

    punchModeIdx: 0,
    kickModeIdx: 0,
}
