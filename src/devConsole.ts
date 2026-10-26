// Barrel — DH2 developer console commands (window.setEggMode(), lightingDebug(), ...),
// split into devConsole/{toggles,lighting,egg}.ts.

export { registerToggleCommands, registerCacheAndOutlineCommands } from './devConsole/toggles.js'
export { registerLightingCommands } from './devConsole/lighting.js'
export { registerEggCommands } from './devConsole/egg.js'
