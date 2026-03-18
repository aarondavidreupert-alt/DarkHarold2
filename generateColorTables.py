# -*- coding: utf-8 -*-
"""
Created on Wed Mar 18 23:39:53 2026

@author: aaron
"""

# Save as generateColorTables.py and run it
import pal, json

palette = pal.readPAL(open("data/color.pal", "rb"))

# color_rgb.json: list of [r, g, b] per palette index
color_rgb = [[r, g, b] for r, g, b in palette]
json.dump(color_rgb, open("color_rgb.json", "w"))

# colorTable.json: maps 15-bit RGB -> palette index (nearest color)
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

print("Done! colorTable.json and color_rgb.json generated.")