"""
Copyright 2014 darkf

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

# The world map image: the 20 world map tiles (art/intrface/wrldmp00-19.png, from the
# install's WRLDMP*.FRM via export_images) stitched into art/worldmap.png, 1400x1500
# (CE worldmap.cc draws the same tiles, 4 across and 5 down, each 350x300). The
# pipeline's stitch_worldmap stage runs it after export_images.

import os, sys
from PIL import Image

TILES_ACROSS, TILES_DOWN, TILE_W, TILE_H = 4, 5, 350, 300

def stitch(artDir="art", outPath=os.path.join("art", "worldmap.png")):
	img = Image.new("RGBA", (TILE_W * TILES_ACROSS, TILE_H * TILES_DOWN))
	for i in range(TILES_ACROSS * TILES_DOWN):
		tile = Image.open(os.path.join(artDir, "intrface", "wrldmp%02d.png" % i))
		img.paste(tile, ((i % TILES_ACROSS) * TILE_W, (i // TILES_ACROSS) * TILE_H))
	img.save(outPath)
	return outPath

def main():
	print(stitch(*sys.argv[1:3]))

if __name__ == '__main__':
	main()
