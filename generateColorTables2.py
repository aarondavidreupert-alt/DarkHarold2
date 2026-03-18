# -*- coding: utf-8 -*-
"""
Created on Wed Mar 18 23:42:12 2026

@author: aaron
"""

import pal, json

palette = pal.readPAL(open("data/color.pal", "rb"))

# color_rgb.json
color_rgb = [[r, g, b] for r, g, b in palette]
json.dump(color_rgb, open("color_rgb.json", "w"))
print("color_rgb.json done")

# colorTable.json: 15-bit RGB -> nearest palette index
color_table = [0] * 0x8000
for i in range(0x8000):
    r = ((i >> 10) & 0x1F) * 8
    g = ((i >> 5) & 0x1F) * 8
    b = (i & 0x1F) * 8
    best, bestDist = 0, float('inf')
    for j, (pr, pg, pb) in enumerate(palette):
        dist = (r-pr)**2 + (g-pg)**2 + (b-pb)**2
        if dist < bestDist:
            best, bestDist = j, dist
    color_table[i] = best
json.dump(color_table, open("colorTable.json", "w"))
print("colorTable.json done")

# color_lut.json: (palIdx * 128 + lightLevel) -> darkened palette index
# lightLevel 0 = full dark, 127 = full bright
lut = [0] * (256 * 128)
for palIdx in range(256):
    r, g, b = palette[palIdx]
    for light in range(128):
        intensity = light / 127.0
        tr = int(r * intensity)
        tg = int(g * intensity)
        tb = int(b * intensity)
        # find nearest palette color
        best, bestDist = 0, float('inf')
        for j, (pr, pg, pb) in enumerate(palette):
            dist = (tr-pr)**2 + (tg-pg)**2 + (tb-pb)**2
            if dist < bestDist:
                best, bestDist = j, dist
        lut[palIdx * 128 + light] = best
json.dump(lut, open("color_lut.json", "w"))
print("color_lut.json done")

print("All done!")