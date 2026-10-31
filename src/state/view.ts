// The view onto the map: camera position and zoom (wiki/code_quality.md Q15). A leaf module;
// globalState.ts keeps a getter / setter for every field.

import type { Point } from '../geometry.js'

export const view = {
    // position of viewport camera (will be overriden by map starts or scripts)
    cameraPosition: { x: 3580, y: 1020 } as Point,
    // camera zoom factor — 1.0 means 1:1, >1 zoomed in, <1 zoomed out.
    // Affects all world-space rendering (tiles, objects, critters, walls, roofs)
    // but NOT UI/HUD elements (renderImage w/ lit=false, renderFont, HTML overlays).
    cameraZoom: 1.0,
}
