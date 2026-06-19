"""
Copyright 2015-2017 darkf

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

# Setup script to import Fallout 2 data for DarkFO

from __future__ import print_function
import sys, os, glob, json, traceback

def error(msg):
	print("ERROR:", msg)
	sys.exit(1)

def warn(msg):
	print("WARNING:", msg)

def info(msg):
	print(msg)

# Check for numpy and pillow (required)
info("Checking for necessary Python modules...")

try: import numpy
except ImportError:
	error("NumPy not found. Please install it from http://www.numpy.org or http://www.lfd.uci.edu/~gohlke/pythonlibs/#numpy . Make sure the version matches your installed version of Python (%d.%d)." % (sys.version_info.major, sys.version_info.minor))

try: from PIL import Image
except ImportError:
	error("Pillow not found. Please see https://pillow.readthedocs.io/en/4.0.x for installation instructions. Make sure the version matches your installed version of Python (%d.%d)." % (sys.version_info.major, sys.version_info.minor))

# import local modules — all siblings of this file under tools/, so no
# sys.path manipulation needed: Python adds the running script's own
# directory to sys.path[0] automatically. Run as `python tools/setup.py ...`
# from the project root so the *output* paths below (data/, art/, proto/,
# maps/, lut/) still land in the project root regardless of where this
# script file lives.
import dat2
import parseCritTable
import parseElevatorTable
import exportImagesPar
import exportPRO
import fomap
import convertLST
import convertEndgame
import convertAudio

# global paths/flags
SRC_DIR = None
NO_EXTRACT_DAT = False
NO_EXPORT_IMAGES = False
EXE_PATH = None

def setup_check():
	global EXE_PATH

	# Check whether everything we need to set up is included in the given source directory

	print("Checking installation directory (%s)..." % SRC_DIR)

	def install_file_exists(path):
		return os.path.exists(os.path.join(SRC_DIR, path))

	if not os.path.exists(SRC_DIR):
		error("Installation directory (%s) does not exist." % SRC_DIR)
	if not (install_file_exists("master.dat") and install_file_exists("critter.dat")):
		error("Installation directory does not contain master.dat or critter.dat, please ensure they exist.")
	if not install_file_exists("fallout2.exe"):
		warn("Installation directory does not contain fallout2.exe. Please ensure this is the right directory and the file exists. Some features may not be available without it!")
	else:
		EXE_PATH = os.path.join(SRC_DIR, "fallout2.exe")

	return True

def parse_crit_table(overwrite=True):
	outFile = "lut/criticalTables.json"
	if not overwrite and os.path.exists(outFile):
		info(f"Skipping critical table parse - {outFile} already exists")
		return True

	if EXE_PATH is not None:
		info("Parsing critical table from fallout2.exe...")
		try:
			with open(EXE_PATH, "rb") as fp:
				# TODO: Don't hardcode paths, and need version check!
				critTables = parseCritTable.readCriticalTables(fp, 0x000fef78, 0x00106597)
				json.dump(critTables, open(outFile, "w"))
				info("Done parsing critical table")
		except Exception:
			traceback.print_exc()
			warn("Error occurred while parsing critical table (see traceback above).")
	else:
		warn("Cannot parse critical table, missing fallout2.exe")

	return True

def parse_elevator_table(overwrite=True):
	outFile = "lut/elevators.json"
	if not overwrite and os.path.exists(outFile):
		info(f"Skipping elevator table parse - {outFile} already exists")
		return True

	if EXE_PATH is not None:
		info("Parsing elevator table from fallout2.exe...")
		try:
			with open(EXE_PATH, "rb") as fp:
				elevators = parseElevatorTable.parseElevators(fp)
				json.dump(elevators, open(outFile, "w"))
				info("Done parsing elevator table")
		except Exception:
			traceback.print_exc()
			warn("Error occurred while parsing elevator table (see traceback above).")
	else:
		warn("Cannot parse elevator table, missing fallout2.exe")

	return True

def extract_dats(overwrite=True):
	if not overwrite and os.path.exists("data") and os.path.exists(os.path.join("data", "color.pal")):
		info("Skipping DAT extraction - data/ already populated")
		return True

	# Create data directory
	if not os.path.exists("data"):
		os.mkdir("data")

	def extract_dat(path):
		with open(path, "rb") as f:
			dat2.dumpFiles(f, "data")

	if not NO_EXTRACT_DAT:
		# Extract DATs
		info("Extracting master.dat...")
		extract_dat(os.path.join(SRC_DIR, "master.dat"))

		info("Extracting critter.dat...")
		extract_dat(os.path.join(SRC_DIR, "critter.dat"))

		info("Done extracting DAT archives.")

	return True

def export_images(overwrite=True):
	if not overwrite and os.path.exists("art") and os.listdir("art"):
		info("Skipping image export - art/ already populated")
		return True

	# Export FRMs/FR[0-9]s

	try:
		palette = exportImagesPar.readPAL(os.path.join("data", "color.pal"))
	except IOError:
		error("Couldn't read data/color.pal")

	# Export them to art/, which will be created if it does not already exist.
	info("Converting images, please wait while this runs.")

	try:
		exportImagesPar.convertAll(palette, "data", "art", verbose=True)
	except Exception:
		traceback.print_exc()
		warn("Error when converting images (see traceback above). Will not finish converting images, but will continue setup.")
		return False

	return True

def export_pros(overwrite=True):
	outFile = os.path.join("proto", "pro.json")
	if not overwrite and os.path.exists(outFile):
		info(f"Skipping PRO export - {outFile} already exists")
		return True

	# Export PROs

	info("Converting prototypes (PROs), please wait while this runs.")

	exportPRO.extractPROs(os.path.join("data", "proto"), "proto")

	return True

def export_audio(overwrite=True):
	# CE ref: n/a — DH2-specific conversion. Requires acm2wav.exe at CWD
	# (project root) and data/sound/{sfx,music} from extract_dats().
	if not os.path.exists("acm2wav.exe"):
		warn("acm2wav.exe not found in project root - skipping audio conversion")
		return True
	if not os.path.exists("data/sound/sfx") and not os.path.exists("data/sound/music"):
		warn("data/sound/{sfx,music} not found - run DAT extraction first")
		return True

	if not overwrite and os.path.exists("audio") and os.listdir("audio"):
		info("Skipping audio conversion - audio/ already populated")
		return True

	info("Converting ACM audio to WAV, please wait while this runs.")
	try:
		convertAudio.main()
	except Exception:
		traceback.print_exc()
		warn("Error converting audio (see traceback above). Will continue setup.")
	return True

def convert_lsts(overwrite=True):
	if not overwrite and os.path.exists("lut/lst") and os.listdir("lut/lst"):
		info("Skipping LST conversion - lut/lst/ already populated")
		return True

	info("Converting LST files to pre-baked JSON arrays...")
	try:
		convertLST.convert_lsts()
	except Exception:
		traceback.print_exc()
		warn("Error converting LST files (see traceback above). Will continue setup.")
	return True

def convert_endgame_data(overwrite=True):
	info("Converting endgame.txt and enddeath.txt to JSON...")
	try:
		convertEndgame.convert_endgame("data", "lut")
	except Exception:
		traceback.print_exc()
		warn("Error converting endgame data (see traceback above). Will continue setup.")
	return True

def export_maps(overwrite=True):
	# Export MAPs

	info("Converting map files, please wait while this runs.")

	if not os.path.exists("maps"):
		os.mkdir("maps")

	for mapFile in glob.glob(os.path.join("data", "maps", "*.map")):
		mapName = os.path.basename(mapFile).lower()
		outFile = os.path.join("maps", os.path.splitext(mapName)[0] + ".json")

		if not overwrite and os.path.exists(outFile):
			continue

		try:
			info(f"Converting map {mapFile}, will write the result to {outFile}")
			fomap.exportMap("data", mapFile, outFile)
		except Exception:
			traceback.print_exc()
			warn("Error converting map %s (see traceback above). Will continue converting the rest." % mapFile)

	return True

# Raw extracted source files that are fully superseded by converted output
# (art/*.png, proto/pro.json, maps/*.json, audio/*.wav) and confirmed never
# read directly by the running engine (grepped against src/*.ts). This is a
# deliberate allowlist, NOT a blanket "delete data/" — data/scripts/*.int
# (script bytecode), data/text/** (dialog/message files), data/data/*.txt
# (lookup tables), and data/gvars.json are all read directly at runtime by
# the engine and must never be deleted.
DELETE_ORIGINALS_GLOBS = [
	"data/art/**/*.frm",
	"data/art/**/*.fr[0-9]",
	"data/proto/**/*.pro",
	"data/maps/*.map",       # exact suffix - never matches *.mvars.json
	"data/sound/**/*.acm",
	"data/sound/**/*.ACM",
]

def find_originals():
	"""Return the list of raw source files eligible for deletion (see
	DELETE_ORIGINALS_GLOBS). Pure query, deletes nothing."""
	found = []
	for pattern in DELETE_ORIGINALS_GLOBS:
		found.extend(glob.glob(pattern, recursive=True))
	return found

def delete_originals(paths=None):
	"""Delete raw source files already converted to their final output
	format. Call find_originals() first to preview what will be removed -
	this function performs no confirmation itself, callers (CLI/GUI) own
	that responsibility."""
	if paths is None:
		paths = find_originals()
	deleted, failed = 0, 0
	for path in paths:
		try:
			os.remove(path)
			deleted += 1
		except OSError as e:
			warn(f"Could not delete {path}: {e}")
			failed += 1
	info(f"Deleted {deleted} original source file(s)" + (f", {failed} failed" if failed else ""))
	return deleted, failed

# Stage name -> function, in pipeline order. Shared by the CLI (--stages)
# and tools/pipeline_gui.py, which shells out to this script as a
# subprocess so a setup_check() failure (sys.exit via error()) only ends
# the child process, never the GUI itself.
STAGES = {
	"crit_table": parse_crit_table,
	"elevator_table": parse_elevator_table,
	"extract_dats": extract_dats,
	"export_images": export_images,
	"export_pros": export_pros,
	"export_maps": export_maps,
	"export_audio": export_audio,
	"convert_lsts": convert_lsts,
	"convert_endgame": convert_endgame_data,
}

# Stages run by default when --stages is not given. export_audio is opt-in
# only (needs acm2wav.exe manually placed in the project root).
DEFAULT_STAGES = [s for s in STAGES if s != "export_audio"]

def main():
	global SRC_DIR, NO_EXTRACT_DAT, NO_EXPORT_IMAGES

	import argparse
	parser = argparse.ArgumentParser(description="Import Fallout 2 game data into DarkHarold2's pre-baked asset format.")
	parser.add_argument("install_dir", help="Path to the Fallout 2 installation directory")
	parser.add_argument("--no-extract-dat", action="store_true", help="Skip extracting master.dat/critter.dat (use existing data/)")
	parser.add_argument("--no-export-images", action="store_true", help="Skip FRM-to-PNG image export")
	parser.add_argument("--stages", default=None,
		help="Comma-separated list of stages to run (default: all except export_audio). "
		     "Choices: " + ",".join(STAGES))
	parser.add_argument("--overwrite", dest="overwrite", action="store_true", default=True,
		help="Regenerate every output file even if it already exists (default)")
	parser.add_argument("--skip-existing", dest="overwrite", action="store_false",
		help="Skip a stage if its output already exists, instead of regenerating it")
	parser.add_argument("--delete-originals", action="store_true",
		help="After conversion, delete raw source files already converted "
		     "(data/**/*.frm, *.pro, *.map, *.acm) - not needed for a real "
		     "install. Prompts for confirmation unless --yes is also given.")
	parser.add_argument("--yes", action="store_true", help="Don't prompt for confirmation before --delete-originals")

	args = parser.parse_args(sys.argv[1:])

	SRC_DIR = args.install_dir
	NO_EXTRACT_DAT = args.no_extract_dat
	NO_EXPORT_IMAGES = args.no_export_images

	if args.stages:
		selected = [s.strip() for s in args.stages.split(",") if s.strip()]
		for s in selected:
			if s not in STAGES:
				error(f"Unknown stage: {s}. Choices: {', '.join(STAGES)}")
	else:
		selected = list(DEFAULT_STAGES)
		if NO_EXPORT_IMAGES and "export_images" in selected:
			selected.remove("export_images")

	setup_check()
	for name in selected:
		STAGES[name](overwrite=args.overwrite)

	if args.delete_originals:
		originals = find_originals()
		if not originals:
			info("No original source files found to delete.")
		else:
			proceed = args.yes
			if not proceed:
				resp = input(f"This will permanently delete {len(originals)} raw source "
					f"file(s) already converted to art/proto/maps/audio output. Continue? [y/N] ")
				proceed = resp.strip().lower() == "y"
			if proceed:
				delete_originals(originals)
			else:
				info("Skipped deleting originals.")

	info("")
	info("Setup complete. Please review the messages above, looking for any warnings.")
	info("Please run tsc after this to compile the source files.")

if __name__ == "__main__":
	main()