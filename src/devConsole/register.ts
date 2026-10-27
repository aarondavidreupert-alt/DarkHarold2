// DH2 developer console (no CE equivalent): which commands go on `window`, and when.
//
// The developer commands (setEggMode(), lightingDebug(), blackBar(), giveCar(), ...)
// are registered only for play.html#dev (the hash may carry other keys too:
// play.html#script_backend=lua&dev). Config.engine.debug can't be the gate: it is on by
// default (the AutoCrawler and src/debug.ts need it). The combat log commands
// (exportEventLog(), __eventLog) are documented for everyone and always registered.

import globalState from '../globalState.js'
import * as Lightmap from '../lightmap.js'
import { blackBar, borderSave, clearBorder, scrollDebug } from '../render/camera.js'
import * as Worldmap from '../worldmap.js'
import { registerEggCommands } from './egg.js'
import { registerLightingCommands } from './lighting.js'
import { registerCacheAndOutlineCommands, registerToggleCommands } from './toggles.js'

// console commands are free-form globals (play.html#dev)
const devWindow = window as unknown as Record<string, unknown>

/** play.html#dev (or #...&dev): the developer console commands are registered. */
export function devConsoleEnabled(): boolean {
    return /(?:^#|&)dev(?:&|$)/.test(location.hash)
}

/** Put the developer commands on `window` (only call it when devConsoleEnabled()). */
export function registerDevConsole(): void {
    registerToggleCommands()
    registerLightingCommands()
    registerEggCommands()
    registerCacheAndOutlineCommands()

    // the scroll-limit editor (render/camera.ts, wiki/scroll_clamping.md)
    devWindow.scrollDebug = scrollDebug
    devWindow.blackBar = blackBar
    devWindow.borderSave = borderSave
    devWindow.clearBorder = clearBorder

    // giveCar([fuel]) — test helper for the car (worldmap/Worldmap.ts, wiki/car_system.md)
    devWindow.giveCar = Worldmap.giveCar

    // debug exposure for console inspection
    devWindow.debugLightmap = Lightmap
    devWindow.debugRenderer = globalState.renderer
    devWindow.debugGlobalState = globalState
}
