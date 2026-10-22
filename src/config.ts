// Configuration for the engine internals, controls and UI

// The windows that can be dragged (DH2 addition) — fallout2.cfg [dh2] drag_<name>.
export type DragWindow = 'inventory' | 'character' | 'characterCreator' | 'options' | 'skilldex' | 'pipboy'
    | 'automap' | 'loot' | 'dialogue' | 'dialogueReview' | 'elevator' | 'calledShot' | 'moveItems'
    | 'saveLoad' | 'perks' | 'dialogBox'
export const DRAG_WINDOWS: DragWindow[] = ['inventory', 'character', 'characterCreator', 'options', 'skilldex',
    'pipboy', 'automap', 'loot', 'dialogue', 'dialogueReview', 'elevator', 'calledShot', 'moveItems', 'saveLoad',
    'perks', 'dialogBox']

export const Config = {
    ui: {
        // DH2 addition: windows can be dragged by their background (CE windows are fixed).
        // fallout2.cfg [dh2] drag_windows=0 turns it off, drag_<window>=0 per window.
        dragWindows: true,
        // DH2 debug readouts (no CE equivalent): the mouse-hex / tile / light / camera /
        // bbox lines at the top left and the combat-turn line at the top right (off),
        // and the fps counter (on). fallout2.cfg [dh2] debug_overlay / fps_overlay,
        // console setDebugOverlay(on) / setFpsOverlay(on).
        showDebugOverlay: false,
        showFPS: true,
        dragWindow: {} as Partial<Record<DragWindow, boolean>>,
        screenWidth: 800,
        screenHeight: 600,

        // How far from the screen edge the map starts scrolling, in pixels. CE
        // game_mouse.cc gameMouseHandleScrolling scrolls only on the edge itself; 10 px
        // because a browser window can't always put the pointer on its last pixel.
        // fallout2.cfg [dh2] scroll_edge=<px>.
        scrollPadding: 10,

        showHexOverlay: false, // show hex grid?
        showCoordinates: false, // show coordinates on hex grid?
        showCursor: true, // show hex cursor?
        showPath: false, // show player's path?
        showFloor: true, // show floor tiles?
        showRoof: true, // show roof tiles?
        hideRoofWhenUnder: true, // hide roof when we walk under it?
        // Also FULLY hide the roof of a building the player stands BEHIND (north of),
        // not just under. DEFAULT OFF — it hides the whole building roof whenever a
        // roof sits ~2-3 tiles south of the player (i.e. most of the time you're near
        // a building), which is too aggressive and not CE behaviour. The intended fix
        // for the behind-building case is egg-style roof transparency (a soft oval),
        // not a full vanish. Kept as an opt-in via setRoofPeek(). See wiki/rendering.md RD06.
        roofPeek: false,
        showEgg: true, // egg transparency: make walls/scenery in front of the player semi-transparent
        // Egg-transparency on ROOFS: a roof tile that would occlude the player but is NOT
        // already hidden by the under-building flood-fill (you're standing BEHIND a
        // building) gets the same soft egg oval as walls. Toggle: setRoofEgg().
        // See wiki/rendering.md RD06. (Restored 2026-10-06; lost in b282cca.)
        roofEgg: true,
        // DH2 option, not in CE: render all DOM UI text in the Fallout pixel font
        // (art/fonts/font1_aaf.woff, CE FONT 101) instead of the browser font.
        // Set in fallout2.cfg: [dh2] pixel_font=0 to use the browser font instead.
        pixelFont: true,
        // DH2 option, not in CE: a Use action on an elevator (its car / door scenery) walks
        // the player in, as stepping in does (CE: the elevator's spatial script only).
        // fallout2.cfg: [dh2] elevator_use=0 for the CE action menu.
        elevatorUse: true,
        eggMode: 'dh2-egg' as 'alpha' | 'dh2-egg' | 'ce-egg' | 'bbox' | 'beta', // 'alpha'=flat transparent, 'dh2-egg'=CE egg.png mask (DH2 hand-tuned occlusion test), 'ce-egg'=CE egg.png mask using the byte-for-byte CE occlusion test (no DH2 deviations), 'bbox'=CE egg.png mask using a screen-space bounding-box overlap + draw-order depth test (DH2-original, not CE-derived), 'beta'=floor hex debug overlay (no wall transparency)
        eggAlpha:  undefined as number | undefined, // outer alpha — undefined = use default 0.4
        eggRadius: undefined as number | undefined, // hex radius — undefined = use default 8
        // Stealth Boy OBJECT_TRANS_GLASS semi-transparent rendering.
        // stealthAlpha: sprite alpha (0–1). Console: Config.ui.stealthAlpha = 0.3
        stealthAlpha: undefined as number | undefined, // undefined = use default 0.9
        // stealthGrayscale: true  = CE-accurate: tint ghost, brightness drives opacity
        //                           (u_stealth=1; sprite colour fully replaced by tint)
        //                   false = DH2 non-CE: original sprite colours at reduced alpha
        // Console: Config.ui.stealthGrayscale = false
        stealthGrayscale: true,
        // stealthTint: [r, g, b] 0–1. CE exact = [0.29, 1.0, 1.0] (teal _colorTable[10239]).
        // Console: Config.ui.stealthTint = [1, 1, 1]   // white ghost
        //          Config.ui.stealthTint = [0.29, 1, 1] // CE-exact teal
        stealthTint: [1.0, 1.0, 1.0] as [number, number, number],
        showObjects: true, // show objects?
        showWalls: true, // show walls?
        showBoundingBox: false, // show bounding boxes around objects?
        showSpatials: true, // show spatial script triggers?
        showFonts: false, // show all fonts for debugging?
        // FO2-CE ref: preferences.cc TargetHighlight enum (game_config.h:111)
        //   0=off, 1=on (always), 2=targeting-only (only while attack cursor)
        targetHighlight: 'targeting-only' as 'off' | 'on' | 'targeting-only', // CE settings.h default
        // FO2-CE ref: settings.h:33 item_highlight — persistent preference
        // (default true), not a held key. While on, whatever single item is
        // under the mouse cursor gets outlined (see input.ts mousemoved).
        // The DH2-only "hold a key to highlight every item" sweep is a
        // separate runtime flag: globalState.highlightItemsKeyHeld.
        itemHighlight: true,
        // DH2-specific tunables for the combat/item outline pass (CI11/CI12,
        // wiki/known_bugs.md). CE draws the outline as a thin silhouette
        // border only; DH2's offset-stamp technique (4 near-overlapping 1px
        // copies) renders as a solid fill in practice — kept deliberately,
        // by request, with separate alpha controls for the fill vs the
        // protruding border sliver. Tune via setOutlineFillAlpha()/
        // setOutlineBorderAlpha() in the browser console.
        outlineFillAlpha: 0.2,
        outlineBorderAlpha: 0.5,
        // FO2-CE ref: preferences.cc — combat message verbosity
        combatMessages: 'verbose' as 'brief' | 'verbose',
        // FO2-CE ref: preferences.cc — subtitles toggle
        subtitles: false,
        // sfall ddraw.ini [Misc] SkipOpeningMovies — skip IPLOGO/INTRO/CREDITS at start-up.
        skipOpeningMovies: false,
        // FO2-CE ref: preferences.cc PREF_LANGUAGE_FILTER — profanity filter toggle (cosmetic only in DH2)
        languageFilter: false,
        // FO2-CE ref: preferences.cc text_base_delay — on-screen text linger time, 1.0–6.0 s
        textBaseDelay: 3.5,
        // CE settings.preferences.combat_taunts — AI combat float messages (combat_ai.cc:3308 _combatai_msg)
        combatTaunts: true,
        // CE settings.preferences.combat_looks — examine whatever the attack cursor points at (game_mouse.cc:745)
        combatLooks: false,
        // CE settings.system.color_cycling / cycle_speed_factor (cycle.cc colorCycleInit,
        // cycleSetSpeedFactor): palette cycling on, and its periods multiplied by the factor.
        colorCycling: true,
        cycleSpeedFactor: 1,
        // CE settings.preferences.brightness — palette gamma, 1.0–1.18 (color.cc colorSetBrightness)
        brightness: 1.0,
        // CE settings.preferences.mouse_sensitivity — 1.0–2.5 (stored; the browser owns the pointer speed)
        mouseSensitivity: 1.0,
    },

    engine: {
        debug: true, // set true to enable debug/cheat utilities in src/debug.ts
        // DH2 developer hotkeys (teleport h, elevation q/e, layer toggles r/f/o/w, tile
        // inspector i, kill k, ...; none of them exist in CE). Off so they can't fire
        // while playing or typing; console: setDevKeys(true).
        devKeys: false,
        // Walk/run movement model (console: setWalkModel('ce' | 'dh2' | 'smooth')):
        //   'ce'     — CE animation.cc _object_move: per-frame FRM deltas accumulate, the
        //              critter steps a hex when the offset reaches the hex step and keeps
        //              the remainder; the cycle never restarts at a hex
        //   'dh2'    — the old DarkFO model: fixed frame chunks per hex, offset reset
        //   'smooth' — 'ce' plus a render-time blend toward the next frame (not CE)
        walkModel: 'ce' as 'ce' | 'dh2' | 'smooth',
        // Sprite offset across animations (console: setAnimOffsetModel('ce' | 'dh2')):
        //   'ce'  — CE obj->x/y accumulator: + old art's direction offset + new frame-0
        //           delta at an art change (animation.cc _object_animate), + each frame's
        //           delta, reset by _dude_stand when an action ends; drawn as
        //           tile + art direction offset + obj->x - width/2 (object.cc objectGetRect)
        //   'dh2' — the DH2 artOffset that pins the anchor point at every art change
        animOffsetModel: 'ce' as 'ce' | 'dh2',
        // Object draw order (fallout2.cfg [dh2] object_sort):
        //   'ce'     — CE object.cc: ascending tile number (_obj_order_comp_func_even/odd sort
        //              the view's hexes by tile offset), on a tile flat objects first, the
        //              rest in the order they were put there (_obj_insert)
        //   'ce-dh2' — 'ce', plus walls before other objects on a shared tile (DH2 tie-break)
        //   'dh2'    — the old DH2 screen-space pairwise test (hexIsInFrontOf), no sort on
        //              load; not a total order, so the result depends on the array's history
        objectSort: 'ce-dh2' as 'ce' | 'ce-dh2' | 'dh2',
        doSaveDirtyMaps: true, // save dirty maps to in-memory cache?
        doLoadScripts: true, // should we load scripts?
        doUpdateCritters: true, // should we give critters heartbeats?
        doTimedEvents: true, // should we handle registered timed events?
        doSpatials: true, // should we handle spatial triggers?
        doCombat: true, // allow combat?
        doUseWeaponModel: true, // use weapon model for NPC models?
        doLoadItemInfo: true, // load item information (such as inventory images)?
        doAlwaysRun: false, // always run instead of walk? CE default = false (settings.h:38)
        // FO2-CE ref: preferences.cc player_speedup — apply combat-speed boost to player walk animation.
        playerSpeedup: true,
        // DH2 option, not in CE: smooth hour-of-day ambient light curve (gametime.ts).
        // false = CE lighting: only map scripts' set_light_level changes the light.
        // Set in fallout2.cfg: [dh2] day_night_cycle=0/1.
        dayNightCycle: true,
        // sfall pipboy_available_at_game_start (CE pipboy.cc _pip_init_): the Pip-Boy opens
        // before the Vault Suit movie. Set in fallout2.cfg: [dh2] pipboy_available_at_game_start=1.
        pipboyAvailableAtStart: false,
        doZOrder: true, // Z-order objects?
        doEncounters: true, // allow random encounters?
        doInfiniteUse: false, // allow infinite-range object usage?
        doFloorLighting: true, // use FO2-realistic floor lighting?
        floorLightingMode: 'auto' as 'auto' | 'gpu' | 'cpu', // lighting backend: 'auto' detects GPU capability
        // Light *propagation/blocking* algorithm (separate from floorLightingMode, which
        // only controls how an already-computed tile_intensity grid gets drawn to the floor).
        // 'dh2' = the literal CE-ported 36-case switch table (src/lightmap.ts), DH2 default.
        // 'derived' = DH2-original hex-grid BFS shadowcasting, inferred from reverse-engineering
        // the literal switch — NOT verified bit-exact against CE. See wiki/lighting.md →
        // "Derived lighting mode (DH2 inference)".
        // 'naive' = pure hex-distance falloff with NO occlusion at all (light bleeds through
        // walls) — a comparison baseline only, see wiki/lighting.md →
        // "Naive lighting mode (distance-only baseline)".
        // Compare live via setLightPropagationMode() and lightingDebug() in the browser console.
        lightPropagationMode: 'dh2' as 'dh2' | 'derived' | 'naive',
        // Object sprite lighting Y mode. Controls how wall/critter/scenery sprites
        // sample the tile-intensity texture. Toggle live via setObjectLightingMode();
        // tune the smooth kernel via setObjectLightSmooth(px). See wiki/alignment.md §8.
        //   'wall-clamp' (default) — world-Y pinned EXACTLY to the foot row; samples
        //                        the floor light field per column via the shared floor
        //                        path, so the wall inherits the floor's interpolation
        //                        (setLightingBilinear) and matches the floor in front
        //                        of it. No per-wall blend. No stripes.
        //   'foot-y'           — anchor world-Y to the sprite's ground-contact point
        //                        with a ±6 soft band; world-X per-fragment.
        //   'tile-y'           — anchor world-Y to the object's tile row (inverse hex).
        //   'flat'             — CE-faithful: ONE intensity for the whole sprite
        //                        (sampled at the tile centre). No gradient, no stripes.
        //   'foot-smooth'      — foot-y + a world-space blur kernel to soften the
        //                        per-column "vertical stripe" texture on wall faces.
        //   'tile-smooth'      — tile-y + the same blur kernel.
        //   'off'              — full per-fragment sampling (dark tops on tall sprites).
        objectLightingMode: 'wall-clamp' as 'tile-y' | 'foot-y' | 'off' | 'flat' | 'foot-smooth' | 'tile-smooth' | 'wall-clamp',
        // Blur kernel radius (world px) for the '*-smooth' object lighting modes.
        // Larger = smoother wall faces but softer light detail. Tune: setObjectLightSmooth(px).
        objectLightSmoothPx: 12,
        // Wall top-edge fade depth (in art texels): walls fade their lit
        // contribution to ambient within N texels of the sprite's painted top edge,
        // so the wall top blends into the roof above. The edge is read from the
        // sprite's own alpha silhouette in the shader, so the fade follows the
        // painted isometric slant automatically (no slope/orientation input).
        // Applies to wall-type objects in every lighting mode. 0 = off.
        // DEFAULT OFF (0) — opt-in. The fade is gated on obj.type === 'wall', but
        // Fallout's 'wall' proto type is noisy (includes furniture like bar counters)
        // while some wall-looking decorations are 'scenery', and interior walls are
        // the same type as exterior ones — so there is no clean signal for "wall that
        // meets a roof", and the fade both over- and under-applies. Kept available for
        // experimentation via setWallTopFade(px); wall-clamp (the real win) is
        // independent and stays on. Split per orientation: `wallTopFadePx` = E-W-run
        // walls (extendedFlags 0x8000000/0x40000000), `wallTopFadePxNWSE` = the rest.
        // See wiki/alignment.md §8.
        wallTopFadePx: 0,
        wallTopFadePxNWSE: 0,
        // How the tile-intensity texture (unit 5) is interpolated when sampled by
        // the world shaders. Plain 'linear' bleeds across the hex column stagger and
        // shows NW-SE stripes; the other modes remove them. Toggle live via
        // setLightingBilinear('off'|'linear'|'column-center'|'hex-lerp'|'bicubic').
        // See wiki/alignment.md §7.
        //   'off'           — NEAREST, crisp hex cells (debug baseline)
        //   'linear'        — LINEAR, fast but striped (kept for comparison)
        //   'column-center' — LINEAR within a column only, no cross-column bleed
        //   'hex-lerp'      — 3-tap barycentric over the 3 nearest hexes (default; smoothest, correct)
        //   'bicubic'       — Catmull-Rom down the column, smoother falloff, no stagger
        lightingInterpolation: 'hex-lerp' as 'off' | 'linear' | 'column-center' | 'hex-lerp' | 'bicubic',
        // How a moving critter's own light (mainly the player's radius-4 torch) is
        // stamped into the lightmap while walking. The lightmap is a per-tile integer
        // grid, so CE stamps at the logical hex and the light cone snaps tile-to-tile
        // on arrival (CE-faithful). The smooth modes split the stamp across tiles so
        // the cone's centre tracks the gliding sprite. Only affects the 'dh2'
        // propagation mode; toggle live via setPlayerLightSmooth(). See wiki/lighting.md.
        //   'ce'        — stamp at the integer hex; CE-faithful tile-snap.
        //   'blend'     — 2-tile lerp between the current and next path hex, weighted
        //                 by walk progress t (frame within the step).
        //   'egg-split' — (default) barycentric split across the tiles under the
        //                 animated foot (hexToScreen + shift), tracking the sprite
        //                 exactly. Chosen as default: derives from the same render
        //                 position as the sprite/egg (can't desync), and needs only
        //                 position+shift (no path/frame dependency), so it also smooths
        //                 non-path movement. Visually identical to 'blend'.
        playerLightSmooth: 'egg-split' as 'ce' | 'blend' | 'egg-split',
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
        // FO2-CE ref: settings.h game_difficulty — 0=Easy/1=Normal/2=Hard → modifier 75/100/125.
        // Affects skill checks, barter, and worldmap encounter rolls (not combat damage).
        gameDifficultyModifier: 100 as 75 | 100 | 125,
        // CE settings.preferences.running_burning_guy (preferences screen) — default on.
        runningBurningGuy: true,
        // FO2-CE ref: settings.h combat_difficulty — 0=Easy/1=Normal/2=Hard → modifier 75/100/125.
        // Affects combat damage scaling only (CE ref: combat.cc combatDifficultyGetMultiplicator).
        difficultyModifier: 100 as 75 | 100 | 125,
        // Damage calculation ruleset: 0=Vanilla, 1=Glovz, 2=Glovz+MultTweak, 5=YAAM
        // Matches fallout2-ce DamageCalculationType enum values exactly.
        damageCalculationType: 0 as 0 | 1 | 2 | 5,
        // CE preferences.cc combat_speed 0..50 (game_config.cc default 0): added to the walk
        // fps in combat (animationComputeTicksPerFrame) — higher is faster.
        combatSpeed: 0,
        // FO2-CE ref: preferences.cc — VIOLENCE_LEVEL: 0=none, 1=minimum, 2=normal, 3=maximum
        violenceLevel: 3 as 0 | 1 | 2 | 3, // CE settings.h: VIOLENCE_LEVEL_MAXIMUM_BLOOD
    },

    // DH2 developer keys (Config.engine.devKeys) and the camera arrows. The game keys are
    // CE's fixed gameHandleKey layout (src/hotkeys.ts).
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
        playerToTargetRaycast: 'y',
        showTargetInventory: 'v',
        use: 'u',
        kill: 'k',
        worldmap: 'l',
        // CE: KEYBIND_KEY_HIGHLIGHT_ITEMS — outlines all items while held.
        highlightItems: ' ',
    },

    scripting: {
        // Which engine runs the game scripts. 'lua' (default): the decompiled
        // data/scripts/<name>.lua (tools/int2lua.py, src/lua/), falling back to the
        // .int for a script without one, and to the VM if the Lua runtime does not
        // start. 'vm': the .int bytecode (src/vm.ts). DH2 addition.
        // Set in fallout2.cfg: [dh2] script_backend=lua/vm.
        backend: 'lua' as 'vm' | 'lua',
        // Lua mods, in load order: mods/<name>/scripts/<script>.lua replaces the
        // generated data/scripts/<script>.lua; a later mod overrides an earlier one.
        // DH2 addition, needs backend 'lua'. Set in fallout2.cfg: [dh2] mods=a,b.
        mods: [] as string[],
        // Script fixes (tools/int2lua.py SCRIPT_FIXES, wiki/lua_scripts.md "Script fixes"):
        // the decompiled Lua repairs a few Black Isle script bugs the way the sources
        // meant (L7: bhrnddst's caravan guards get caps, not their rifle). Deliberate
        // deviations from the shipped scripts and from CE; 0 runs the original
        // behaviour. Lua backend only. Set in fallout2.cfg: [dh2] script_fixes=0/1.
        scriptFixes: true,
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
            animOffset: false,    // artOffset zero-jump formula inputs/outputs at every FRM switch
            movement: false,      // critter movement and pathfinding steps
            inventory: true,      // inventory add/remove operations
            party: false,         // party member join/leave/status
            dialogue: false,      // dialogue node entry and exit

            // ── Engine debug categories — flip in DevTools to surface output ──────
            // e.g. Config.scripting.debugLogShowType.combat = true
            combat: true,        // combat flow: turn start/end, enrollment, forceEnd
            ai: false,            // AI turn decisions: packet lookup, action chosen, AP spent
            rolls: false,         // every dice roll: hit chance, roll result, hit/miss/crit
            skills: false,        // skill check rolls and outcomes
            damage: false,        // damage formula breakdown: RD/CM/ADR/ADT/Base/Adj/Final
            script: false,        // script execution tracing (verbose)
            lua: true,            // Lua script backend: load fallbacks, script errors
            map: false,           // map load, elevation change, exit grid transitions
            object: false,        // object creation, destruction, flag changes
            audio: true,         // audio load, play, stop events
            renderer: false,      // WebGL draw calls and render state changes
            lighting: false,      // lightmap recalculation and light source updates
            worldmap: false,      // worldmap travel, encounter checks, location transitions
            encounters: false,    // random encounter rolls and table lookups
            saveload: false,      // save/load operations and slot management
            endgame: false,       // endgame slideshow and death ending selection
            automap: false,       // automap IDB reads, writes, and migrations
        },
    },
}

if (typeof window !== 'undefined') {
    ;(window as any).Config = Config
}
