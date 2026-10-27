// Loaded with `node --import ./test/support/register.mjs` (npm test).
//
// The compiled engine is one big import cycle (wiki/code_quality.md, Q14): js/logger.js imports
// js/globalState.js, which pulls in party, UI and renderer modules that need a browser. These hooks
// swap those two modules for the small stubs next to this file, so the formula modules under test
// (js/random.js, js/geometry/hexGrid.js, js/gametime.js) load in plain Node. Engine code is unchanged.
import { register } from 'node:module'

register('./stubHooks.mjs', import.meta.url)
