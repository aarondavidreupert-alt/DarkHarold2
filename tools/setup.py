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
import sys, os, glob, json, re, shutil, traceback

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
import exportFonts
import exportPRO
import fomap
import convertLST
import convertEndgame
import convertAudio
import convertMovies
import convertSpeech
import parse_gam
import int2lua
import fallout2Cfg

# global paths/flags
SRC_DIR = None
NO_EXTRACT_DAT = False
NO_MODS = False  # --no-mods: build no mod folders (build_mods), the vanilla game only

# Mod archives the pipeline never reads, though an install may have them: sfall's own
# resources (sfall.dat: its item-highlighting and NPC-control scripts and replacement
# interface art, sfall engine features) and the hi-res patch (f2_res.dat: high-resolution
# interface art and .edg scroll edges, which DarkHarold2's own resolution scaling and zoom
# replace; CE reads neither). See wiki/upu_support.md.
SKIPPED_MOD_ARCHIVES = {
	"sfall.dat": "sfall engine resources (highlighting / party control scripts, interface art)",
	"f2_res.dat": "hi-res patch art and map edges (DarkHarold2 scales the view itself)",
}
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

		# Black Isle's patches, which CE loads over them (game.cc gameInit,
		# "patch%03d.dat"); sfall's mods/ become mod folders (build_mods)
		for i in range(100):
			p = os.path.join(SRC_DIR, "patch%03d.dat" % i)
			if os.path.isfile(p):
				info("Extracting patch%03d.dat..." % i)
				overlay_dat(p, "data")
		# sfall's own settings file, read by get_ini_setting("ddraw.ini|...")
		if not NO_MODS and os.path.isfile(os.path.join(SRC_DIR, "ddraw.ini")):
			shutil.copyfile(os.path.join(SRC_DIR, "ddraw.ini"), os.path.join("data", "ddraw.ini"))
		stale = os.path.join("data", "mod_sources.json")  # written by an older pipeline
		if os.path.exists(stale):
			os.remove(stale)

		info("Done extracting DAT archives.")

	return True

def install_mods():
	"""[(name, label, "dat" | "dir", path)] the install's sfall mods in load order, lowest
	priority first: mods/mods_order.txt top to bottom, a later line winning, a name listed
	twice counting at its last line (sfall LoadOrder.cpp; ddraw.ini: master_patches >
	critter_patches > mods_order.txt > PatchFileXX > patchXXX.dat > sfall.dat >
	critter.dat > f2_res > master.dat). SKIPPED_MOD_ARCHIVES are left out. `name` is the
	mod folder build_mods writes: the archive's or folder's name without extension."""
	order = os.path.join(SRC_DIR, "mods", "mods_order.txt")
	if NO_MODS or not os.path.isfile(order):
		return []
	seen = []
	with open(order, encoding="latin-1") as fh:
		for line in fh:
			entry = re.split(r"[;#]", line, 1)[0].strip()
			if entry:
				seen.append(entry)
	entries = [e for i, e in enumerate(seen) if e not in seen[i + 1:]]
	out = []
	for entry in entries:
		base = os.path.basename(entry.replace("\\", "/")).lower()
		if base in SKIPPED_MOD_ARCHIVES:
			info("Skipping mods/%s: %s" % (entry, SKIPPED_MOD_ARCHIVES[base]))
			continue
		name = re.sub(r"[^a-z0-9_.-]", "_", os.path.splitext(base)[0])
		p = os.path.join(SRC_DIR, "mods", entry)
		if os.path.isfile(p) and base.endswith(".dat"):
			out.append((name, "mods/" + entry, "dat", p))
		elif os.path.isdir(p):
			out.append((name, "mods/" + entry, "dir", p))
		else:
			info("mods_order.txt: mods/%s not found, skipped" % entry)
	return out

def overlay_dat(path, dest):
	"""Extract one .dat into dest/ (paths lower-cased); returns the paths it wrote."""
	names = []
	with open(path, "rb") as f:
		tree = dat2.readDAT(f, posixPaths=True)
		for name, entry in tree.items():
			name = name.lower()
			out = os.path.join(dest, name)
			os.makedirs(os.path.dirname(out), exist_ok=True)
			with open(out, "wb") as fp:
				fp.write(dat2.readFile(f, entry))
			names.append(name)
	return names

def overlay_dir(path, dest):
	"""Copy one mod folder into dest/ (paths lower-cased, as in the .dat files)."""
	names = []
	for root, _dirs, files in os.walk(path):
		for n in files:
			rel = os.path.relpath(os.path.join(root, n), path).replace("\\", "/").lower()
			out = os.path.join(dest, rel)
			os.makedirs(os.path.dirname(out), exist_ok=True)
			shutil.copyfile(os.path.join(root, n), out)
			names.append(rel)
	return names

# Files a mod folder merges into the vanilla one instead of replacing it (they index
# every image / proto; src/modAssets.ts MERGED_FILES)
MOD_MERGED_FILES = ["art/imageMap.json", "proto/pro.json"]

def build_mods(overwrite=True):
	"""Each install mod (install_mods: the Unofficial Patch's mods/upu.dat, ...) becomes a
	folder mods/<name>/ that mirrors the project layout, converted with the same
	converters as the vanilla data, plus mods/<name>/manifest.json listing its files.
	The engine loads a mod's file instead of the vanilla one while the mod is listed in
	the project's mods/mods_order.txt (src/modAssets.ts) — the vanilla files are never
	changed. Lookups a converter needs from files the mod does not have (a map's protos
	and .lst files, a script's message texts) fall back to the mods below it, then the
	vanilla data/. A DH2 addition after sfall's mods/ load order; wiki/upu_support.md."""
	mods = install_mods()
	if not mods:
		info("No install mods to build (mods/mods_order.txt)" + (" - --no-mods" if NO_MODS else ""))
		return True
	lower = [os.path.join("data")]  # data dirs under the mod being built, best first
	for name, label, kind, path in mods:
		out = os.path.join("mods", name)
		manifest = os.path.join(out, "manifest.json")
		if os.path.isdir(out) and not os.path.exists(manifest):
			warn("mods/%s exists and is not a pipeline-built mod (no manifest.json) - not touching it" % name)
			continue
		if not overwrite and os.path.exists(manifest):
			info("Skipping mod %s - %s already exists" % (name, manifest))
			lower.insert(0, os.path.join(out, "data"))
			continue
		if os.path.isdir(out):
			shutil.rmtree(out)
		info("Building mod folder mods/%s from %s..." % (name, label))
		data = os.path.join(out, "data")
		raw = overlay_dat(path, data) if kind == "dat" else overlay_dir(path, data)
		# its settings: mods/<name>.ini next to the archive (get_ini_setting("mods\\upu.ini|..."))
		ini = os.path.join(SRC_DIR, "mods", name + ".ini")
		if os.path.isfile(ini):
			os.makedirs(os.path.join(data, "mods"), exist_ok=True)
			shutil.copyfile(ini, os.path.join(data, "mods", name + ".ini"))
		build_mod_assets(out, data, lower, raw)
		# the raw files the conversion replaced, which the engine never reads (as
		# --delete-originals for the vanilla data; rebuilt from the archive on the next
		# run). .pro / .lst / .gam stay: a later mod's build looks them up.
		for r in raw:
			if re.search(r"\.(frm|fr[0-5]|map|acm|pal)$", r):
				try:
					os.remove(os.path.join(data, r))
				except OSError:
					pass
		for root, _dirs, _fs in os.walk(out, topdown=False):  # converters' empty output folders
			if root != out and not os.listdir(root):
				os.rmdir(root)
		files, merge = [], []
		for root, _dirs, fs in os.walk(out):
			for n in fs:
				rel = os.path.relpath(os.path.join(root, n), out).replace("\\", "/")
				if rel == "manifest.json":
					continue
				(merge if rel in MOD_MERGED_FILES else files).append(rel)
		with open(manifest, "w", encoding="utf-8") as fh:
			json.dump({"name": name, "source": label, "generated": "tools/setup.py build_mods",
				"files": sorted(files), "merge": sorted(merge)}, fh, indent=0)
		info("mods/%s: %d files (%s)" % (name, len(files) + len(merge), manifest))
		add_to_mods_order(name)
		lower.insert(0, data)
	return True

def build_mod_assets(out, data, lower, raw):
	"""Convert one mod's raw files (data = mods/<name>/data, `raw` the paths extracted
	there) into mods/<name>/: the converters of the vanilla stages, run on the mod's
	files only. `lower` lists the data dirs under it, best first."""
	layers = [data] + lower
	has = lambda prefix: any(r.startswith(prefix) for r in raw)
	# images (the mod's own art; art/imageMap.json lists only them - merged at run time)
	if any(r.startswith("art/") and re.search(r"\.fr[m0-5]$", r) for r in raw):
		pal = next((p for p in (os.path.join(d, "color.pal") for d in layers) if os.path.exists(p)), None)
		if pal is None:
			warn("No color.pal - mod art not converted")
		else:
			info("  converting images...")
			try:
				exportImagesPar.convertAll(exportImagesPar.readPAL(pal), data, os.path.join(out, "art"))
			except Exception:
				traceback.print_exc()
				warn("Error converting the mod's images (see traceback above).")
	if any(re.match(r"font\d+\.(aaf|fon)$", r) for r in raw):
		exportFonts.convert_all(data, os.path.join(out, "art", "fonts"), verbose=False)
	# protos (proto/pro.json with the mod's protos only - merged at run time)
	if has("proto/") and any(r.endswith(".pro") for r in raw):
		info("  converting protos...")
		exportPRO.extractPROs(os.path.join(data, "proto"), os.path.join(out, "proto"))
		for sub in os.listdir(os.path.join(out, "proto")):  # extractPROs' empty per-type folders
			d = os.path.join(out, "proto", sub)
			if os.path.isdir(d) and not os.listdir(d):
				os.rmdir(d)
	# .lst files: each the whole list (a mod ships the full list with its additions)
	if any(r.endswith(".lst") for r in raw):
		convertLST.convert_lsts(data, os.path.join(out, "lut", "lst"))
	# global and map variables
	if any(r.endswith(".gam") for r in raw):
		parse_gam.convert_gam(data, data, empty_for_maps_without_gam=False)
	# maps: the mod's own, and every vanilla map whose conversion the mod's .lst / proto
	# files change (fomap takes art names and object subtypes from them)
	maps_out = os.path.join(out, "maps")
	mod_maps = [r for r in raw if r.startswith("maps/") and r.endswith(".map")]
	lookups_changed = any(r.endswith(".lst") or r.endswith(".pro") for r in raw)
	if mod_maps or lookups_changed:
		info("  converting maps...")
		os.makedirs(maps_out, exist_ok=True)
	for r in mod_maps:
		mapName = os.path.splitext(os.path.basename(r))[0]
		try:
			fomap.exportMap(layers, os.path.join(data, r), os.path.join(maps_out, mapName + ".json"))
		except Exception:
			traceback.print_exc()
			warn("Error converting the mod's map %s (see traceback above)." % r)
		mvars = os.path.join(data, "maps", mapName + ".mvars.json")
		if not os.path.exists(mvars) and not any(os.path.exists(os.path.join(d, "maps", mapName + ".mvars.json")) for d in lower):
			with open(mvars, "w") as fh:  # a new map without a .gam (CE: no map vars)
				json.dump({}, fh)
	if lookups_changed:
		mod_names = {os.path.splitext(os.path.basename(r))[0] for r in mod_maps}
		vanilla = sorted(glob.glob(os.path.join("data", "maps", "*.map")))
		if not vanilla:
			warn("No data/maps/*.map (deleted originals?) - the vanilla maps are not checked against the mod's .lst / proto changes")
		for mapFile in vanilla:
			mapName = os.path.splitext(os.path.basename(mapFile))[0].lower()
			current = os.path.join("maps", mapName + ".json")
			if mapName in mod_names or not os.path.exists(current):
				continue
			target = os.path.join(maps_out, mapName + ".json")
			try:
				fomap.exportMap(layers, mapFile, target)
			except Exception:
				traceback.print_exc()
				continue
			# keep it only where the mod changes the result (the image list is a set: fomap
			# writes it in no fixed order)
			for ext in (".json", ".images.json"):
				a, b = os.path.join(maps_out, mapName + ext), os.path.join("maps", mapName + ext)
				if not (os.path.exists(a) and os.path.exists(b)):
					continue
				if ext == ".images.json":
					same = set(json.load(open(a))) == set(json.load(open(b)))
				else:
					same = open(a, "rb").read() == open(b, "rb").read()
				if same:
					os.remove(a)
		if os.path.isdir(maps_out) and not os.listdir(maps_out):
			os.rmdir(maps_out)
	# endgame slides / death endings
	if any(re.search(r"(^|/)(endgame|enddeath)\.txt$|art/intrface/intrface\.lst$", r) for r in raw):
		tmp = os.path.join(out, "_endgame")
		for rel in ("data/endgame.txt", "data/enddeath.txt", "art/intrface/intrface.lst"):
			src = next((p for p in (os.path.join(d, rel) for d in layers) if os.path.exists(p)), None)
			if src:
				os.makedirs(os.path.dirname(os.path.join(tmp, rel)), exist_ok=True)
				shutil.copyfile(src, os.path.join(tmp, rel))
		os.makedirs(os.path.join(out, "lut"), exist_ok=True)
		convertEndgame.convert_endgame(tmp, os.path.join(out, "lut"))
		shutil.rmtree(tmp)
	# sound effects, music, speech, movies (need ffmpeg, as the vanilla stages)
	ffmpeg = convertMovies.findFfmpeg()
	if (has("sound/") or has("art/cuts/")) and ffmpeg is None:
		warn("ffmpeg not found - the mod's sound / movies are not converted")
	elif ffmpeg is not None:
		if os.path.isdir(os.path.join(data, "sound", "sfx")):
			info("  converting sound effects...")
			convertAudio.convertSfxDir(ffmpeg, os.path.join(data, "sound", "sfx"), os.path.join(out, "audio", "sfx"))
		if os.path.isdir(os.path.join(data, "sound", "music")):
			convertAudio.convertMusicDir(ffmpeg, os.path.join(data, "sound", "music"), os.path.join(out, "audio", "music"))
		if os.path.isdir(os.path.join(data, "sound", "speech")):
			convertSpeech.convertAll(os.path.join(data, "sound", "speech"), os.path.join(out, "audio", "speech"))
		if os.path.isdir(os.path.join(data, "art", "cuts")):
			convertMovies.convertAll(os.path.join(data, "art", "cuts"), os.path.join(out, "art", "cuts"))
	# scripts: Lua next to the mod's .int; names from the UPU sources when fetched
	paths = sorted(glob.glob(os.path.join(data, "scripts", "*.int")))
	if paths:
		info("  decompiling %d scripts..." % len(paths))
		done, rows = 0, []
		for path in paths:
			try:
				text = int2lua.decompile_file(path, rows, base=lower, mod=True)
			except Exception as e:
				info("  %s stays bytecode: %s" % (os.path.basename(path), e))
				continue
			with open(os.path.splitext(path)[0] + ".lua", "w", encoding="utf-8", newline="\n") as fh:
				fh.write(text)
			done += 1
		info("  decompiled %d of %d scripts" % (done, len(paths)))
		if rows:
			int2lua.write_report(os.path.join(data, "scripts", "variable_names.tsv"), rows)

def add_to_mods_order(name):
	"""Lists a built mod in the project's mods/mods_order.txt (at the end: the highest
	priority), unless a line already names it, commented out or not."""
	path = os.path.join("mods", "mods_order.txt")
	lines = open(path, encoding="utf-8").read().splitlines() if os.path.exists(path) else []
	for line in lines:
		if re.sub(r"^[;#\s]+", "", line).split(";")[0].split("#")[0].strip().lower() == name:
			return
	lines.append(name)
	os.makedirs("mods", exist_ok=True)
	with open(path, "w", encoding="utf-8", newline="\n") as fh:
		fh.write("\n".join(lines) + "\n")
	info("Added %s to mods/mods_order.txt" % name)

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

def export_fonts(overwrite=True):
	# data/font<N>.aaf / .fon -> art/fonts/font<N>_aaf|_fon.png + .json (src/ui/fontCore.ts).
	if not overwrite and os.path.exists(os.path.join("art", "fonts", "font1_aaf.json")):
		info("Skipping font export - art/fonts already populated")
		return True
	info("Converting fonts...")
	try:
		n = exportFonts.convert_all("data", os.path.join("art", "fonts"), verbose=False)
		info(f"Converted {n} font(s)")
	except Exception:
		traceback.print_exc()
		warn("Error when converting fonts (see traceback above). Will continue setup.")
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
	# DH2-specific conversion. Needs ffmpeg (SFX are decoded mono, as CE plays them —
	# see tools/acmMono.py); music uses acm2wav.exe when present, else ffmpeg.
	if convertMovies.findFfmpeg() is None:
		warn("ffmpeg not found (PATH or project root) - skipping audio conversion")
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

def export_movies(overwrite=True):
	# CE ref: game_movie.cc gameMoviePlay — .MVE playback. Browsers can't decode
	# Interplay MVE, so convert to WebM (VP9/Opus) + a timer-rate JSON used for
	# subtitle/fade timing. Needs ffmpeg on PATH or ffmpeg.exe in the project root;
	# skipped with a warning otherwise.
	info("Converting MVE movies to WebM, please wait while this runs.")
	try:
		convertMovies.convertAll(overwrite=overwrite)
	except Exception:
		traceback.print_exc()
		warn("Error converting movies (see traceback above). Will continue setup.")
	return True

def export_speech(overwrite=True):
	# CE ref: lips.cc _lips_make_speech — talking-head speech ACM -> MP3 for the
	# lip-synced dialogue heads. Needs ffmpeg (as export_movies).
	info("Converting talking-head speech to MP3, please wait while this runs.")
	try:
		convertSpeech.convertAll(overwrite=overwrite)
	except Exception:
		traceback.print_exc()
		warn("Error converting speech (see traceback above). Will continue setup.")
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

def convert_gam_vars(overwrite=True):
	# data/data/vault13.gam -> data/gvars.json, data/maps/*.gam -> data/maps/*.mvars.json
	# (CE game.cc globalVarsRead; read by src/scripting.ts at runtime).
	if not overwrite and os.path.exists(os.path.join("data", "gvars.json")):
		info("Skipping GAM conversion - data/gvars.json already exists")
		return True
	info("Converting global and map variables (.gam -> JSON)...")
	try:
		parse_gam.convert_gam("data")
	except Exception:
		traceback.print_exc()
		warn("Error converting .gam files (see traceback above). Will continue setup.")
	return True

def decompile_scripts(overwrite=True):
	# data/scripts/*.int -> data/scripts/*.lua for the Lua script backend
	# (fallout2.cfg [dh2] script_backend=lua, src/lua/). Generated from the
	# user's own install like every other asset; a script that does not
	# decompile keeps running as .int.
	paths = sorted(glob.glob(os.path.join("data", "scripts", "*.int")))
	if not paths:
		warn("No data/scripts/*.int found - skipping script decompilation")
		return True
	info("Decompiling %d scripts to Lua..." % len(paths))
	done, failed = 0, 0
	rows = []  # the variable list: names and where they come from
	for path in paths:
		out = os.path.splitext(path)[0] + ".lua"
		if not overwrite and os.path.exists(out):
			continue
		try:
			text = int2lua.decompile_file(path, rows)
		except Exception as e:
			failed += 1
			info("  %s stays bytecode: %s" % (os.path.basename(path), e))
			continue
		with open(out, "w", encoding="utf-8", newline="\n") as fh:
			fh.write(text)
		done += 1
	info("Decompiled %d scripts to Lua (%d left as .int)" % (done, failed))
	if rows:
		report = os.path.join("data", "scripts", "variable_names.tsv")
		int2lua.write_report(report, rows)
		info("Variable names and their sources: %s" % report)
	return True

def write_config(overwrite=True):
	# fallout2.cfg with CE defaults + [dh2]. Never replaces an existing file: it holds
	# the user's settings (CE gameConfigInit only writes defaults for missing keys).
	if fallout2Cfg.write_default_cfg("fallout2.cfg"):
		info("Wrote default fallout2.cfg")
	else:
		info("Keeping existing fallout2.cfg")
	if fallout2Cfg.write_default_mods_order():
		info("Wrote mods/mods_order.txt (no mods)")
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
	"export_fonts": export_fonts,
	"export_pros": export_pros,
	"export_maps": export_maps,
	"export_audio": export_audio,
	"export_movies": export_movies,
	"export_speech": export_speech,
	"convert_lsts": convert_lsts,
	"convert_endgame": convert_endgame_data,
	"convert_gam": convert_gam_vars,
	"decompile_scripts": decompile_scripts,
	"write_config": write_config,
	"build_mods": build_mods,
}

# Stages run by default when --stages is not given. export_audio is opt-in
# only (needs acm2wav.exe manually placed in the project root).
DEFAULT_STAGES = [s for s in STAGES if s != "export_audio"]

def main():
	global SRC_DIR, NO_EXTRACT_DAT, NO_EXPORT_IMAGES, NO_MODS
	# a converter's non-ASCII message must not end the run when the output is a
	# file or pipe in a legacy code page (the GUI, a redirected log)
	for stream in (sys.stdout, sys.stderr):
		try:
			stream.reconfigure(errors="replace")
		except AttributeError:
			pass

	import argparse
	parser = argparse.ArgumentParser(description="Import Fallout 2 game data into DarkHarold2's pre-baked asset format.")
	parser.add_argument("install_dir", help="Path to the Fallout 2 installation directory")
	parser.add_argument("--no-extract-dat", action="store_true", help="Skip extracting master.dat/critter.dat (use existing data/)")
	parser.add_argument("--no-export-images", action="store_true", help="Skip FRM-to-PNG image export")
	parser.add_argument("--no-mods", action="store_true",
		help="Build no mod folders from the install's mods/mods_order.txt (e.g. the Unofficial Patch): the vanilla game only")
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
	NO_MODS = args.no_mods

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