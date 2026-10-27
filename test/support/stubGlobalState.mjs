// Test stand-in for js/globalState.js (see register.mjs): only the fields the modules under test
// read. Tests set them directly (e.g. globalState.gameTickTime).
const globalState = {
    gameTickTime: 0,
    player: null,
    combat: null,
    eventLog: [],
}
export default globalState
