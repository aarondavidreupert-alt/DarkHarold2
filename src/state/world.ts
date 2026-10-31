// The game world's state: the map, the player and party, combat, time and the world map's areas
// (wiki/code_quality.md Q15: globalState split by owner). A leaf module (type imports only), so
// tests and low-level modules can use it; globalState.ts keeps a getter / setter for every field.

import type { Combat } from '../combat.js'
import type { AreaMap } from '../data.js'
import type { Point } from '../geometry.js'
import type { GameMap, SerializedMap } from '../map.js'
import type { Party } from '../party.js'
import type { Player } from '../player.js'

export const world = {
    gMap: null as GameMap | null,
    player: null as Player | null,
    gParty: null! as Party, // party.ts creates it when it loads
    combat: null as Combat | null,
    inCombat: false,
    currentElevation: 0, // current map elevation
    gameTickTime: 0, // in Fallout 2 ticks (elapsed seconds * 10)
    centerTile: { x: 0, y: 0 } as Point,
    // maps left this session (saved with the game)
    dirtyMapCache: {} as { [mapName: string]: SerializedMap },
    mapAreas: null as AreaMap | null,
    knownAreas: new Set<number>(),
    // CE ref: game_movie.cc gameMovieIsSeen — bitmask of movies that have been triggered.
    // Used by _scriptsCheckGameEvents to fire ARTIMER story events only once.
    seenMovies: new Set<number>(),
}
