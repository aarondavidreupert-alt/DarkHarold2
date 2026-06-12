// Copyright 2024-2026 darkf
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Bitmap font rendering — barrel.
// See wiki/ts-split-refactor.md → "Per-file split proposals" §17.

export {
    SymbolInfo,
    SymbolInfoMap,
    FontRenderer,
    FontWidget,
    makeFontLabel,
    renderBitmapText,
} from './ui/fontCore.js'

export { FoText } from './ui/foText.js'

export { setNumberDial, renderBignum } from './ui/numberDials.js'

import { FontRenderer } from './ui/fontCore.js'

// ---- Singletons (lazy: assets are only fetched on first use) ---------------

export const font1 = new FontRenderer('art/fonts/font1_aaf', 'art/fonts/font1_aaf.json')
export const font2 = new FontRenderer('art/fonts/font2_aaf', 'art/fonts/font2_aaf.json')
export const font3 = new FontRenderer('art/fonts/font3_aaf', 'art/fonts/font3_aaf.json')
export const font4 = new FontRenderer('art/fonts/font4_aaf', 'art/fonts/font4_aaf.json')
