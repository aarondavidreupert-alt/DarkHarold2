// Barrel — `WebGLRenderer extends Renderer`. The class declaration plus
// state, texture/shader/program plumbing live in `render/webglContext.ts`.
// The prototype methods for the CPU/GPU lit floor (renderLitFloorCPU,
// renderLitFloorGPU) live in `render/webglLighting.ts`. The prototype
// methods for tile/object/font draw calls (drawTileMap, renderRoof,
// renderFloor, renderObject, renderObjectOutlined, renderFrame, renderText,
// renderImage, renderFont) live in `render/webglDraw.ts`. The two
// side-effect imports below wire those methods onto WebGLRenderer.prototype
// at module-load time, before any caller constructs the class.
export { WebGLRenderer, ShaderSources } from './render/webglContext.js'
export { isCEOccludingWall, isCEOccludingWallLiteral, isBBoxOccludingWall } from './render/webglDraw.js'
import './render/webglLighting.js'
import './render/webglDraw.js'
