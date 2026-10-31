// The engine services set up at boot: the renderer and the audio engine (wiki/code_quality.md
// Q15). A leaf module; globalState.ts keeps a getter / setter for every field.

import type { AudioEngine } from '../audio.js'
import type { Renderer } from '../renderer.js'

export const services = {
    renderer: null! as Renderer, // set during boot (main.ts / init.ts) before use
    audioEngine: null! as AudioEngine, // set during boot (main.ts / init.ts) before use
    $fpsOverlay: null as HTMLElement | null,
}
