// DH2 debug (not in CE): world map counters for the developer console commands
// encounterStats() / encounterLog() / setWalkSpeed() (src/devConsole/worldmapDebug.ts).
// No imports, so encounters.ts and Worldmap.ts can both write to it.

export const wmDebug = {
    // encounterLog(true): one console line per encounter roll
    log: false,
    // setWalkSpeed(x): world map travel speed, 1 = CE (one walking step a frame on foot)
    walkSpeed: 1,

    // the travel loop (Worldmap.ts updateWorldmapPlayer)
    openMs: 0, // real time the world map loop ran
    frames: 0, // loop frames in that time
    walkMs: 0, // real time the party was walking
    walkFrames: 0,
    steps: 0, // pixels walked
    gameTicks: 0, // game time the walk advanced (1/10 s)

    // the roll (encounters.ts rndEncounterOccurred)
    waitFrames: 0, // frames inside CE's 1.5 s between rolls
    skipSameX: 0, // under 3 px from the last encounter's x / y (CE)
    skipSameY: 0,
    skipInArea: 0, // in a town circle
    rolls: 0, // rolls that reached the chance check
    expected: 0, // sum of the rolls' chances (expected encounters)
    hits: 0, // encounters rolled (spotted or not)
    spotted: 0,
    byChance: {} as { [percent: number]: number }, // rolls per square chance
}

export function resetWmDebugStats(): void {
    const keep = { log: wmDebug.log, walkSpeed: wmDebug.walkSpeed }
    Object.assign(wmDebug, {
        openMs: 0,
        frames: 0,
        walkMs: 0,
        walkFrames: 0,
        steps: 0,
        gameTicks: 0,
        waitFrames: 0,
        skipSameX: 0,
        skipSameY: 0,
        skipInArea: 0,
        rolls: 0,
        expected: 0,
        hits: 0,
        spotted: 0,
        byChance: {},
        ...keep,
    })
}
