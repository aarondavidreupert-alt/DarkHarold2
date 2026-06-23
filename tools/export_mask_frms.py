"""
Copyright 2026

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
"""

# Standalone, targeted converter for the handful of "intensity mask" FRMs
# whose raw pixel bytes are blend-weights, not palette-color indices meant
# to be displayed (egg.frm, hilight1.frm, hilight2.frm — see
# wiki/rendering.md "Egg Transparency Effect" and "Dialogue Talking-Head
# Screen Highlights"). Resolving these through the normal Fallout palette
# (frmpixels.exportFRM, used by the main tools/exportImagesPar.py pipeline)
# paints each gradient step a different hue — wrong for mask data, though
# harmless-looking for ordinary sprites.
#
# Deliberately NOT wired into the main pipeline (tools/frmpixels.py,
# tools/exportImagesPar.py are untouched) — re-running the full asset
# pipeline to fix 3 files is slow and unnecessary. Run this directly:
#   pipenv run python tools/export_mask_frms.py
#
# Writes the raw byte values unquantized into the alpha channel of a
# solid-white RGBA image, so consuming code (WebGL shader / canvas blend)
# can sample alpha directly as the original intensity with no palette-
# induced color noise. egg.png was previously hand-patched this same way,
# alpha-only, but as a binary cutoff rather than preserving the real
# gradient (see shaders/fragment.glsl comment) — this restores the gradient.

import os
import numpy as np
from PIL import Image

import frmpixels

# scale=None means store the raw byte as-is (0-255 alpha). egg.frm's mask
# bytes are documented (wiki/rendering.md "Egg Transparency Effect") and
# confirmed by inspection (observed max ~122) to live on a 0-128 scale, not
# 0-255 — CE's blend math divides by 128 (`intensityColorTable[...][128-mask]`).
# Stored raw, a GL/canvas alpha sample (which normalizes by 255) would read
# as roughly half the intended strength. Rescaling here so the PNG's alpha
# directly *is* the final 0-1 blend fraction keeps all downstream consumers
# simple (no magic "divide by 128" constant needed at every call site).
FILES = [
    ("data/art/intrface/egg.frm", "art/intrface/egg.png", 128),
    ("data/art/intrface/hilight1.frm", "art/intrface/hilight1.png", None),
    ("data/art/intrface/hilight2.frm", "art/intrface/hilight2.png", None),
]


def exportFRMAsMask(frmFile, outFile, scale=None):
    with open(frmFile, "rb") as f:
        frmInfo = frmpixels.readFRMInfo(f, exportImage=True)
    framePixels = frmInfo['framePixels']
    frameOffsets = frmInfo['frameOffsets']

    maxW = max(max(fo['w'] for fo in offset) for offset in frameOffsets)
    maxH = max(max(fo['h'] for fo in offset) for offset in frameOffsets)
    totalW = maxW * frmInfo['totalFrames']

    finalImg = Image.new("RGBA", (totalW, maxH), (255, 255, 255, 0))
    currentX = 0

    for nDir in range(frmInfo['numDirections']):
        for frameNum, frame in enumerate(framePixels[nDir]):
            offsets = frameOffsets[nDir][frameNum]
            w, h = offsets['w'], offsets['h']
            pixels = np.reshape(frame, (h, w))

            alpha = pixels.astype(np.float32)
            if scale is not None:
                alpha = np.clip(alpha * (255.0 / scale), 0, 255)
            alpha = alpha.astype(np.uint8)

            rgba = np.zeros((h, w, 4), np.uint8)
            rgba[:, :, 0] = 255
            rgba[:, :, 1] = 255
            rgba[:, :, 2] = 255
            rgba[:, :, 3] = alpha

            img = Image.fromarray(rgba, "RGBA")
            finalImg.paste(img, (currentX, 0))
            currentX += maxW

    finalImg.save(outFile)
    return maxW, maxH


def main():
    for frmPath, outPath, scale in FILES:
        if not os.path.exists(frmPath):
            print(f"SKIP (not found): {frmPath}")
            continue
        w, h = exportFRMAsMask(frmPath, outPath, scale)
        print(f"{outPath}: {w}x{h}" + (f" (rescaled from 0-{scale})" if scale else ""))


if __name__ == '__main__':
    main()
