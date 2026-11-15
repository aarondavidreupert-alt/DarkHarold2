"""
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

# Cutouts: pieces of the interface art DarkHarold2 needs as images of their own, where the
# original only has them painted into a larger window background (DH2 additions such as the
# save window's DELETE / NEW buttons sit on a copy of a plate the window already shows). Each
# entry of CUTOUTS names the exported source PNG under art/intrface/ and the rectangle to cut;
# the result is art/intrface/cutout/<name>.png. The pipeline's make_cutouts stage runs this
# after export_images. Add a piece here and the game can load it as a plain image. An entry may
# add "round": the piece keeps only the circle inscribed in its rectangle (transparent outside).
#
#   python tools/makeCutouts.py [artDir]       (default: art)

import os, sys
from PIL import Image, ImageDraw

# name -> (source under art/intrface/, (x, y, width, height), what it is / who uses it[, "round"])
CUTOUTS = {
	"lsgplate": (
		"lsgame.png",
		(379, 345, 99, 24),
		"the save / load window's plate behind DONE (lsgame.frm); src/uiSaveLoad.ts puts DELETE and NEW on copies",
	),
	"pipsocket": (
		"pip.png",
		(52, 365, 18, 19),
		"the Pip-Boy's empty button socket (pip.frm, the button fallen out, second from the top); "
		"src/uiSaveLoad.ts shows it in the LOAD window where the SAVE window has NEW",
		"round",
	),
}


def make_all(artDir="art", overwrite=True):
	"""Write every cutout to <artDir>/intrface/cutout/. Returns the number written."""
	srcDir = os.path.join(artDir, "intrface")
	outDir = os.path.join(srcDir, "cutout")
	os.makedirs(outDir, exist_ok=True)
	written = 0
	for name, entry in CUTOUTS.items():
		source, (x, y, w, h) = entry[0], entry[1]
		round_ = "round" in entry[3:]
		outPath = os.path.join(outDir, name + ".png")
		if not overwrite and os.path.exists(outPath):
			continue
		with Image.open(os.path.join(srcDir, source)) as img:
			if x + w > img.width or y + h > img.height:
				raise ValueError("%s: (%d, %d, %d, %d) is outside %s (%dx%d)" % (name, x, y, w, h, source, img.width, img.height))
			piece = img.convert("RGBA").crop((x, y, x + w, y + h))
			if round_:
				mask = Image.new("L", (w, h), 0)
				ImageDraw.Draw(mask).ellipse((0, 0, w - 1, h - 1), fill=255)
				piece.putalpha(Image.composite(piece.getchannel("A"), mask, mask))
			piece.save(outPath)
		written += 1
	return written


if __name__ == "__main__":
	artDir = sys.argv[1] if len(sys.argv) > 1 else "art"
	n = make_all(artDir)
	print("Wrote %d cutout(s) to %s" % (n, os.path.join(artDir, "intrface", "cutout")))
