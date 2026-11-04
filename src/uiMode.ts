// Top-level UI mode the game is currently in (globalState.uiMode). Its own module with no
// imports, so globalState.ts does not import the UI (wiki/code_quality.md Q14); uiPanels.ts and
// ui.ts re-export it.
export enum UIMode {
    none = 0,
    dialogue = 1,
    barter = 2,
    loot = 3,
    inventory = 4,
    worldMap = 5,
    elevator = 6,
    calledShot = 7,
    skilldex = 8,
    useSkill = 9,
    contextMenu = 10,
    saveLoad = 11,
    char = 12,
    pipBoy = 13,
    automap = 14,
    options = 15,
    mainMenu = 16,
    characterCreator = 17,
    dialog = 18,
    companionControl = 19,
    movie = 20, // gameMovie.ts modal player — pauses tickGame like other panels
}
