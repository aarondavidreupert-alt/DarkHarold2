// Configuration for the engine internals, controls and UI

export const Config = {
    ui: {
        screenWidth: 800,
        screenHeight: 600,

        scrollPadding: 20, // how far the mouse has to be from an edge to scroll, in pixels
        floatMessageDuration: 3, // how long floating messages stay on screen, in seconds

        showHexOverlay: false, // show hex grid?
        showCoordinates: false, // show coordinates on hex grid?
        showCursor: true, // show hex cursor?
        showPath: false, // show player's path?
        showFloor: true, // show floor tiles?
        showRoof: true, // show roof tiles?
        hideRoofWhenUnder: true, // hide roof when we walk under it?
        showObjects: true, // show objects?
        showWalls: true, // show walls?
        showBoundingBox: false, // show bounding boxes around objects?
        showSpatials: true, // show spatial script triggers?
        showFonts: false, // show all fonts for debugging?
    },

    engine: {
        doSaveDirtyMaps: true, // save dirty maps to in-memory cache?
        doLoadScripts: true, // should we load scripts?
        doUpdateCritters: true, // should we give critters heartbeats?
        doTimedEvents: true, // should we handle registered timed events?
        doSpatials: true, // should we handle spatial triggers?
        doCombat: true, // allow combat?
        doUseWeaponModel: true, // use weapon model for NPC models?
        doLoadItemInfo: true, // load item information (such as inventory images)?
        doAlwaysRun: true, // always run instead of walk?
        doZOrder: true, // Z-order objects?
        doEncounters: true, // allow random encounters?
        doInfiniteUse: false, // allow infinite-range object usage?
        doFloorLighting: true, // use FO2-realistic floor lighting?
        floorLightingMode: 'auto' as 'auto' | 'gpu' | 'cpu', // lighting backend: 'auto' detects GPU capability
        useLightColorLUT: true, // Use intensityColorTable/colorLUT/colorRGB for accurate lighting colors?
        doAudio: true, // enable audio?
        doLogLazyLoads: false, // Log lazy-loading of images? (Noisy)
        doLogScriptLoads: false, // Log script loads? (Noisy)
        doDisasmOnUnimplOp: true, // Disassemble script upon reaching unimplemented opcode?
        // Seconds after which an empty corpse (no loot) is removed from the map.
        // Set to 0 to disable auto-cleanup (corpses persist until map change).
        corpseTimeout: 0,
    },

    combat: {
        allowWalkDuringAnyTurn: false, // Allows the player to walk AP-free out of their turn
        maxAIDepth: 8, // Maximum number of turns the AI can consider (as a bail-out instead of infinitely recursing)
        // Combat difficulty modifier: 75 = easy (player deals more), 100 = normal, 125 = hard (enemies deal more)
        // Mirrors FO2's preference_level: VIOLENCE_LEVEL 0=easy 1=normal 2=hard
        difficultyModifier: 100 as 75 | 100 | 125,
        // Damage calculation ruleset: 0=Vanilla, 1=Glovz, 2=Glovz+MultTweak, 5=YAAM
        // Matches fallout2-ce DamageCalculationType enum values exactly.
        damageCalculationType: 0 as 0 | 1 | 2 | 5,
    },

    controls: {
        cameraDown: 'down',
        cameraUp: 'up',
        cameraLeft: 'left',
        cameraRight: 'right',
        elevationDown: 'q',
        elevationUp: 'e',
        showRoof: 'r',
        showFloor: 'f',
        showObjects: 'o',
        showWalls: 'w',
        talkTo: 't',
        inspect: 'i',
        moveTo: 'm',
        runTo: 'j',
        attack: 'g',
        combat: 'c',
        playerToTargetRaycast: 'y',
        showTargetInventory: 'v',
        use: 'u',
        kill: 'k',
        worldmap: 'l',
        pipboy: 'p',
        calledShot: 'z',
        saveKey: 'n',
        loadKey: 'm',
        inventory: 'b',
    },

    scripting: {
        debugLogShowType: {
            // ── Scripting VM ──────────────────────────────────────────────────────
            stub: true,           // log unimplemented script opcodes (always-on recommended)
            log: false,           // script-level log() calls
            timer: false,         // registered timed events (fire/cancel)
            load: false,          // script file loads and resets
            debugMessage: true,   // debug_message() calls from scripts
            displayMessage: true, // display_message() calls (in-game console output)
            floatMessage: false,  // floating messages above critters
            gvars: false,         // global variable reads/writes
            lvars: false,         // local variable reads/writes
            mvars: false,         // map variable reads/writes
            tiles: true,          // tile/elevation changes
            animation: false,     // animation state transitions
            movement: false,      // critter movement and pathfinding steps
            inventory: true,      // inventory add/remove operations
            party: false,         // party member join/leave/status
            dialogue: false,      // dialogue node entry and exit

            // ── Engine debug categories — flip in DevTools to surface output ──────
            // e.g. Config.scripting.debugLogShowType.combat = true
            combat: false,        // combat flow: turn start/end, enrollment, forceEnd
            ai: false,            // AI turn decisions: packet lookup, action chosen, AP spent
            rolls: false,         // every dice roll: hit chance, roll result, hit/miss/crit
            damage: false,        // damage formula breakdown: RD/CM/ADR/ADT/Base/Adj/Final
            script: false,        // script execution tracing (verbose)
            map: false,           // map load, elevation change, exit grid transitions
            object: false,        // object creation, destruction, flag changes
            audio: false,         // audio load, play, stop events
            renderer: false,      // WebGL draw calls and render state changes
            lighting: false,      // lightmap recalculation and light source updates
            worldmap: false,      // worldmap travel, encounter checks, location transitions
            encounters: false,    // random encounter rolls and table lookups
            saveload: false,      // save/load operations and slot management
        },
    },
}

if (typeof window !== 'undefined') {
    ;(window as any).Config = Config
}
