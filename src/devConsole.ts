// Barrel — DH2 developer console commands (window.setEggMode(), lightingDebug(), ...),
// split into devConsole/{register,toggles,lighting,egg,eventLog}.ts. The developer
// commands are registered for play.html#dev only (devConsole/register.ts).

export { devConsoleEnabled, registerDevConsole } from './devConsole/register.js'
export { registerEventLogCommands } from './devConsole/eventLog.js'
export { registerToggleCommands, registerCacheAndOutlineCommands } from './devConsole/toggles.js'
export { registerLightingCommands } from './devConsole/lighting.js'
export { registerEggCommands } from './devConsole/egg.js'
