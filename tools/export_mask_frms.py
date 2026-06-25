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

# Encoding strategy confirmed by spatial pixel inspection (tools/_debug_masks.py):
#
# egg.frm: center has LOW raw bytes (~1), perimeter/shell has HIGH raw bytes
#   (~120). CE's blend math makes low-bytes = opaque wall, high-bytes =
#   transparent wall — i.e. transparency is a RING at the oval perimeter, not
#   a simple oval cutout. DH2 wants the simpler "center transparent" oval to
#   reveal the player. Fix: rescale from 0-128, then INVERT non-zero alpha so
#   center (low raw) → high alpha → mix(1,0,1)=0 → transparent, perimeter
#   (high raw) → low alpha → mix(1,0,low)≈opaque.
#
# hilight1.frm (upper glint): center has HIGH raw bytes (~247). Goal: lighten
#   the area proportional to raw byte. Encode as semi-transparent white
#   (R=G=B=255, A=raw_byte). Plain alpha compositing over any backdrop adds
#   white at the mask weight — a reliable lighten without needing mix-blend-mode.
#
# hilight2.frm (lower shadow): HIGH raw bytes at corners (it's an arc shape).
#   Goal: darken proportional to raw byte. Encode as semi-transparent black
#   (R=G=B=0, A=raw_byte). Plain alpha compositing adds black at mask weight
#   — reliable darken without mix-blend-mode.
#
# For hilight1/2: mix-blend-mode: screen/multiply on a solid-white source was
#   unreliable (white is multiply's identity = no effect; screen(white,x)=white
#   always; and CSS blend modes can be silently ignored depending on compositing
#   context). Plain colored alpha compositing is simpler and always works.
# Opacity scale for hilight1/hilight2. CE's blend-table math gives a max
# visual change of roughly 10-15% brightness, not a full overlay. Tune this
# constant if the effect looks too strong or too weak.
HIGHLIGHT_STRENGTH = 1.0  # full range — CSS opacity on #dialogueHighlightUpper/Lower
                          # controls displayed strength (see ui.css / setDialogueHighlights() in console)

# hilight2 is the lower-left shadow/glow at the bottom-left of the dialogue
# CRT screen. CE's _dark_BlendTable is derived from _colorTable[22187], which
# is CE's additive colorMixAddTable at indices [86][171] — an additive mix of
# palette[86]=[120,148,120] and palette[171]=[212,172,124] clamps to near-white,
# so the "blend base" is bright, not dark. The visual result in-game is a warm
# amber/orange glow (vacuum-tube cathode warmth bleeding around the glass edge),
# which the user confirmed matches the original FO2 game at HIGHLIGHT_STRENGTH=1.0.
# NOTE: a 2026-06-24 attempt to "fix" this to (160,144,124) based on a 50/50
# averaging interpretation of colorTable was wrong — CE uses additive blending
# in _colorTable, not averaging. That change made the effect look "white and dim."
# Empirically validated value restored:
HILIGHT2_COLOR = (255, 140, 30)  # amber — user-confirmed match for FO2 original

FILES = [
    ("data/art/intrface/egg.frm",     "art/intrface/egg.png",     "egg"),
    ("data/art/intrface/hilight1.frm","art/intrface/hilight1.png","lighten"),
    ("data/art/intrface/hilight2.frm","art/intrface/hilight2.png","darken"),
]


def exportFRMAsMask(frmFile, outFile, mode):
    with open(frmFile, "rb") as f:
        frmInfo = frmpixels.readFRMInfo(f, exportImage=True)
    framePixels = frmInfo['framePixels']
    frameOffsets = frmInfo['frameOffsets']

    maxW = max(max(fo['w'] for fo in offset) for offset in frameOffsets)
    maxH = max(max(fo['h'] for fo in offset) for offset in frameOffsets)
    totalW = maxW * frmInfo['totalFrames']

    finalImg = Image.new("RGBA", (totalW, maxH), (0, 0, 0, 0))
    currentX = 0

    for nDir in range(frmInfo['numDirections']):
        for frameNum, frame in enumerate(framePixels[nDir]):
            offsets = frameOffsets[nDir][frameNum]
            w, h = offsets['w'], offsets['h']
            pixels = np.reshape(frame, (h, w))

            rgba = np.zeros((h, w, 4), np.uint8)

            if mode == "egg":
                # Rescale from 0-128, then invert non-zero alpha so that the
                # oval CENTER (low raw bytes) becomes high alpha (transparent
                # wall) and the perimeter (high raw bytes) becomes low alpha
                # (opaque wall) — producing the "center reveals player" oval.
                alpha = np.clip(pixels.astype(np.float32) * (255.0 / 128.0), 0, 255).astype(np.uint8)
                inverted = np.where(alpha > 0, 255 - alpha, 0).astype(np.uint8)
                rgba[:, :, 0] = 255
                rgba[:, :, 1] = 255
                rgba[:, :, 2] = 255
                rgba[:, :, 3] = inverted

            elif mode == "lighten":
                # Semi-transparent white: R=G=B=255, alpha encodes blend weight.
                # CE's formula: (256-v)>>4 — low raw bytes = high effect, high
                # raw bytes = low/zero effect (direction inverted vs raw value).
                # Then the blend table applies max ~15% brightness change at
                # full intensity. HIGHLIGHT_STRENGTH scales to that range.
                # Plain alpha compositing (no mix-blend-mode) is reliable across
                # all compositing contexts.
                raw = pixels.astype(np.float32)
                alpha = np.where(raw > 0,
                    np.clip((255.0 - raw) * HIGHLIGHT_STRENGTH, 0, 255),
                    0).astype(np.uint8)
                rgba[:, :, 0] = 255
                rgba[:, :, 1] = 255
                rgba[:, :, 2] = 255
                rgba[:, :, 3] = alpha

            elif mode == "darken":
                # Warm amber glow (vacuum tube warmth from below/behind glass).
                # Not pure black — the CE blend table for this highlight was
                # derived from a warm palette color, and the user confirms the
                # in-game effect had a yellowish/orange tint. Tune HILIGHT2_COLOR.
                raw = pixels.astype(np.float32)
                alpha = np.where(raw > 0,
                    np.clip((255.0 - raw) * HIGHLIGHT_STRENGTH, 0, 255),
                    0).astype(np.uint8)
                rgba[:, :, 0] = HILIGHT2_COLOR[0]
                rgba[:, :, 1] = HILIGHT2_COLOR[1]
                rgba[:, :, 2] = HILIGHT2_COLOR[2]
                rgba[:, :, 3] = alpha

            img = Image.fromarray(rgba)
            finalImg.paste(img, (currentX, 0))
            currentX += maxW

    finalImg.save(outFile)
    return maxW, maxH


def main():
    for frmPath, outPath, mode in FILES:
        if not os.path.exists(frmPath):
            print(f"SKIP (not found): {frmPath}")
            continue
        w, h = exportFRMAsMask(frmPath, outPath, mode)
        print(f"{outPath}: {w}x{h} ({mode})")


if __name__ == '__main__':
    main()
