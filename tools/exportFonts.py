"""
Copyright 2026 DarkHarold2 contributors

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

# Fallout fonts → sprite atlas + symbol map for src/ui/fontCore.ts.
#
#   art/fonts/font<N>_aaf.png/.json  interface fonts (FONT 100+N), from data/font<N>.aaf
#   art/fonts/font<N>_fon.png/.json  text fonts, from data/font<N>.fon
#
# 16x16 grid of cells, one per byte 0-255; each cell is `maxHeight` tall. The JSON maps
# char code → {x, y, w, h} (w = advance width without letter spacing, h = cell height)
# plus "meta" with the font's CE metrics.
#
# AAF (CE font_manager.cc interfaceFontLoad / interfaceFontDrawImpl): big-endian header
# "AAFF", maxHeight, letterSpacing, wordSpacing, lineSpacing; 256 glyphs of width,
# height, offset; then the pixel bytes (intensity 0-7). Glyphs are drawn BOTTOM-aligned:
# `ptr += (maxHeight - glyph->height) * pitch` (font_manager.cc:371). Lower-case
# letters carry two empty rows at the bottom that g/p/q/y/j use for their descenders,
# so the cell must keep that alignment. The space advances by wordSpacing
# (font_manager.cc:246), not by glyph 32's width.
#
# FON (CE text_font.cc): little-endian, 1 bit per pixel, every glyph full height.

import json
import math
import os
import struct
import sys

from PIL import Image

AAF_INTENSITY_MAX = 7


def _grid_size(widths, height):
    rows = math.ceil(len(widths) / 16)
    row_widths = [sum(widths[r * 16:(r + 1) * 16]) for r in range(rows)]
    return max(row_widths + [1]), rows * height


def export_aaf(data):
    if data[0:4] != b"AAFF":
        raise ValueError("not an AAF font")
    max_height, letter_spacing, word_spacing, line_spacing = struct.unpack(">4H", data[4:12])
    glyphs = [struct.unpack(">2HL", data[12 + i * 8:20 + i * 8]) for i in range(256)]
    pixel_base = 12 + 256 * 8

    img = Image.new("RGBA", _grid_size([g[0] for g in glyphs], max_height), (0, 0, 0, 0))
    pix = img.load()
    info = {}
    x = 0
    for code, (w, h, offset) in enumerate(glyphs):
        if code % 16 == 0:
            x = 0
        y = (code // 16) * max_height
        advance = word_spacing if code == 32 else w
        info[str(code)] = {"x": x, "y": y, "w": advance, "h": max_height}
        top = y + max_height - h  # bottom-aligned, as CE draws it
        for py in range(h):
            row = pixel_base + offset + py * w
            for px in range(w):
                v = data[row + px]
                if v > 0:
                    # White with intensity as alpha (fontCore tints with a CSS filter).
                    a = int(min(v, AAF_INTENSITY_MAX) / AAF_INTENSITY_MAX * 255)
                    pix[x + px, top + py] = (a, a, a, a)
        x += w
    info["meta"] = {
        "maxHeight": max_height,
        "letterSpacing": letter_spacing,
        "wordSpacing": word_spacing,
        "lineSpacing": line_spacing,
    }
    return img, info


def export_fon(data):
    n_chars, height, gap_size, _, _ = struct.unpack("<5i", data[0:20])
    entries = [struct.unpack("<2i", data[20 + i * 8:28 + i * 8]) for i in range(n_chars)]
    font_data = data[20 + n_chars * 8:]

    img = Image.new("RGBA", _grid_size([e[0] for e in entries], height), (0, 0, 0, 0))
    pix = img.load()
    info = {}
    x = 0
    for code, (w, offset) in enumerate(entries):
        if code % 16 == 0:
            x = 0
        y = (code // 16) * height
        info[str(code)] = {"x": x, "y": y, "w": w, "h": height}
        bytes_per_line = (w + 7) // 8
        for py in range(height):
            for px in range(w):
                o = offset + py * bytes_per_line + px // 8
                if o < len(font_data) and font_data[o] & (1 << (7 - px % 8)):
                    pix[x + px, y + py] = (255, 255, 255, 255)
        x += w
    info["meta"] = {"maxHeight": height, "letterSpacing": gap_size, "wordSpacing": 0, "lineSpacing": 0}
    return img, info


def convert_all(data_dir="data", out_dir="art/fonts", verbose=True):
    os.makedirs(out_dir, exist_ok=True)
    count = 0
    for i in range(10):
        for ext, exporter in (("aaf", export_aaf), ("fon", export_fon)):
            src = os.path.join(data_dir, "font%d.%s" % (i, ext))
            if not os.path.exists(src):
                continue
            with open(src, "rb") as f:
                img, info = exporter(f.read())
            base = os.path.join(out_dir, "font%d_%s" % (i, ext))
            img.save(base + ".png")
            with open(base + ".json", "w") as f:
                json.dump(info, f)
            count += 1
            if verbose:
                print("font%d.%s -> %s.png (%dx%d)" % (i, ext, base, img.size[0], img.size[1]))
    return count


if __name__ == "__main__":
    data_dir = sys.argv[1] if len(sys.argv) > 1 else "data"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "art/fonts"
    convert_all(data_dir, out_dir)
