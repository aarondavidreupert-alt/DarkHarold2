# jsFO Codebase Map

Reference map for [jsFO](https://github.com/ajxs/jsFO) — an earlier browser-based Fallout engine in plain ES6 JavaScript. Much less complete than DarkHarold2; used as a patterns reference only, not as an authority for game mechanics.

---

## Source Structure

```
jsFO/
├── src/
│   ├── core/
│   │   ├── main.js         Entry point
│   │   ├── GameState.js    Game state object
│   │   ├── assets.js       Asset loading (FRM/PNG)
│   │   ├── rendering.js    Canvas 2D renderer
│   │   ├── vm.js           Script VM (very minimal)
│   │   ├── geometry.js     Hex coordinate math
│   │   ├── map_objects.js  Map object types
│   │   ├── interface.js    UI logic
│   │   ├── new_game.js     New game setup
│   │   ├── global.js       Global constants
│   │   ├── browser.js      Browser utilities
│   │   └── debug.js        Debug helpers
│   ├── gamestate/          Game state modules
│   └── loader/             Asset conversion scripts
├── index.html
├── package.json            Babel ES6 → ES5
└── makefile
```

---

## Module-by-Module Notes

| File | Purpose | DarkHarold2 counterpart |
|------|---------|------------------------|
| `src/core/main.js` | Entry point, game loop setup | `src/main.ts`, `src/heart.ts` |
| `src/core/GameState.js` | Central game state object | `src/globalState.ts` |
| `src/core/assets.js` | FRM → canvas image loading | `src/images.ts`, `frmpixels.py` |
| `src/core/rendering.js` | Canvas 2D sprite/font blitting (`blitFRM`, `blitFontString`) | `src/webglrenderer.ts` (WebGL 2.0) |
| `src/core/vm.js` | Script bytecode VM — very primitive | `src/vm.ts`, `src/vm_bridge.ts` |
| `src/core/geometry.js` | Hex geometry utilities | `src/geometry.ts` |
| `src/core/map_objects.js` | Object type definitions | `src/object.ts` |
| `src/core/interface.js` | UI panels | `src/ui*.ts` modules |
| `src/core/global.js` | Constants | `src/config.ts` |

---

## Key Divergences from DarkHarold2

| Topic | jsFO | DarkHarold2 |
|-------|------|-------------|
| Rendering | Canvas 2D (`getContext('2d')`, `drawImage`) | WebGL 2.0 (custom GLSL shaders) |
| Language | Plain ES6 JavaScript (Babel transpilation) | TypeScript (strict mode, ES2021) |
| VM completeness | ~5 opcodes, mostly commented out | ~118 opcodes wired |
| Build | GNU make + babel-cli | `npx tsc` |
| Lighting | Not implemented | CPU + GPU lightmap with FO2-accurate color LUT |
| Persistence | Not implemented | IndexedDB (maps, automap, saves) |

---

## Patterns Worth Noting

**`blitFRM()` / `blitFRMOutline()` in `rendering.js`**
Shows how FRM sprite frames map to canvas regions — useful reference for the frame-atlas layout even though DarkHarold2 uses WebGL.

**Opcode dispatch in `vm.js`**
Uses a plain object literal keyed on hex values (`{ 0x800D: () => {...} }`), the same pattern as DarkHarold2's `opMap` in `src/vm.ts`.

**Asset loading in `assets.js`**
Converts FRM files to canvas images at load time. DarkHarold2 pre-bakes these to PNG during the asset pipeline (`frmpixels.py`) instead of doing it at runtime.

---

## Assessment

jsFO is useful as a sanity check on coordinate math and FRM layout, and as evidence of how others approached the same browser rendering problem. The VM and game logic are too incomplete to be authoritative references for any game mechanic. Use fallout2-ce for all game logic, formulas, and data structures.
