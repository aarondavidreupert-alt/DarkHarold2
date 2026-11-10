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

# fallout2.cfg for a fresh install - CE game_config.cc gameConfigInit defaults
# plus DarkHarold2's [dh2] section (read by src/uiOptions/fallout2Cfg.ts).
# CE writes the file itself on exit (gameConfigSave); a browser can't, so the
# pipeline creates it once. An existing file is never overwritten - it may hold
# the user's own settings - but the options it lacks (added to DarkHarold2 after it
# was written) are appended with their comments, as CE gameConfigInit fills in the
# defaults of missing keys.

import os

DEFAULT_CFG = r"""; fallout2.cfg - DarkHarold2
;
; Default values of CE game_config.cc gameConfigInit. DarkHarold2 reads this file at
; startup (src/uiOptions/fallout2Cfg.ts). A browser can't write it back, so changes
; made in the Options screen are kept in localStorage and override this file. Clear
; the site data to fall back to these values.
;
; Keys DarkHarold2 does not use ([system], [debug], most of [sound]) are kept so the
; file stays a valid Fallout 2 CE config.

[system]
executable=game
master_dat=master.dat
master_patches=data
critter_dat=critter.dat
critter_patches=data
language=english
scroll_lock=0
interrupt_walk=1
art_cache_size=8
color_cycling=1
hashing=1
splash=0
free_space=20480

[preferences]
; 0 easy, 1 normal, 2 hard
game_difficulty=1
combat_difficulty=1
; 0 none, 1 minimal, 2 normal, 3 maximum blood
violence_level=3
; 0 off, 1 on, 2 targeting only
target_highlight=2
item_highlight=1
combat_looks=0
; 0 brief, 1 verbose
combat_messages=1
combat_taunts=1
language_filter=0
running=0
subtitles=0
; 0 (normal) .. 50 (fastest)
combat_speed=0
player_speed=0
text_base_delay=3.5
text_line_delay=1.399994
; 1.0 .. 1.18
brightness=1.0
; 1.0 .. 2.5
mouse_sensitivity=1.0
running_burning_guy=1

[sound]
initialize=1
device=-1
port=-1
irq=-1
dma=-1
sounds=1
music=1
speech=1
; 0 .. 32767
master_volume=22281
music_volume=22281
sndfx_volume=22281
speech_volume=22281
cache_size=448
music_path1=sound\music\
music_path2=sound\music\

[debug]
mode=environment
show_tile_num=0
show_script_messages=0
show_load_info=0
output_map_data_info=0

[dh2]
; DarkHarold2-only options (CE ignores this section).
; 1 = smooth hour-of-day light curve, 0 = CE lighting (only map scripts' set_light_level)
day_night_cycle=1
; 1 = Fallout pixel font for UI text, 0 = browser font
pixel_font=1
; 1 = a Use action on elevators walks the player in (DH2), 0 = CE: only walking in calls them
elevator_use=1
; walk/run movement: ce (CE _object_move), dh2 (old DarkFO chunks), smooth (ce + frame blend)
walk_model=ce
; sprite offset across animation changes: ce (CE obj->x/y), dh2 (old anchor pinning)
anim_offset_model=ce
; object draw order: ce (CE: by tile), ce-dh2 (CE + walls first on a tile), dh2 (old screen-space test)
object_sort=ce-dh2
; mouse clicks: dh2 = a move-cursor click uses / attacks what is under it, an arrow-cursor
; click opens the action menu; ce = CE: a move click always walks, an arrow click does the
; primary action (talk, pick up, use, look), holding the button opens the action menu
mouse_mode=dh2
; damage formula (sfall's DamageFormula; wiki/damage_formula.md): vanilla = Fallout 2's own,
; glovz = Glovz's (DR before multipliers, armour matters more), glovz_tweak = Glovz with the
; critical multiplier as +25 % steps, yaam = YAAM (ammo DR modifier lowers DT instead)
damage_formula=vanilla
; Talk: dh2 = the player walks up to the critter first, ce = CE: talks from where they
; stand when the critter is under 9 hexes away and in line of sight (outside combat)
talk_mode=dh2
; offering a running item in barter (a burning flare, an armed explosive, a switched-on Geiger
; counter or Stealth Boy): dh2 = the merchant says what is wrong with it, ce = CE's
; "No, your offer is not good enough."
barter_running_item=dh2
; combat start: dh2 = the first blow lands while the HUD's combat panel slides open,
; ce = CE: the panel opens first, then the turns start
combat_start=dh2
; 1 = the Fullscreen button reads "Exit Fullscreen" in fullscreen, 0 = it is hidden there
; (Esc leaves fullscreen; the button shows again outside)
fullscreen_exit_button=1
; map scrolling at the screen edge and with the arrow keys: dh2 = smooth, ce = CE's
; 32 x 24 px steps
scroll_mode=dh2
; mouse wheel: zoom = zooms the map (DH2), ce = scrolls the map as in CE
mouse_wheel=zoom
; 1 = a short fade from black when the elevation changes (DH2), 0 = CE's instant switch
elevation_fade=1
; combat outlines: dh2 = red hostile, green team, blue for neutrals (seen through walls);
; ce = CE: red / green by team for critters in the line of fire, a dim outline for those
; out of sight within Perception x 5 hexes, none farther
combat_outline=dh2
; save / load slots: dh2 = any number, always a free one, DELETE removes a save;
; ce = CE's ten slots and no deleting (with more saves, only the first ten are listed)
save_slots=dh2
; walls in front of the player: dh2-egg = CE's egg mask with DH2's occlusion test,
; ce-egg = CE's egg with CE's exact test, alpha = flat transparency, bbox = bounding boxes
egg_mode=dh2-egg
; game scripts: lua = the decompiled data/scripts/*.lua (tools/int2lua.py; a script
; without one runs its .int), vm = the .int bytecode
script_backend=lua
; mods in load order, e.g. mods=upu,b (folders under mods/; a later one wins); empty = mods/mods_order.txt
mods=
; 1 = the decompiled scripts fix a few Black Isle bugs as the sources meant (wiki/lua_scripts.md "Script fixes"), 0 = keep the original behaviour
script_fixes=1
; 1 = the Pip-Boy opens before the Vault Suit movie (sfall option), 0 = CE
pipboy_available_at_game_start=0
; main menu button labels: white = DH2, ce = CE's yellow (like the menu's footer text)
menu_text=white
; random-encounter chance on the world map in percent of worldmap.txt's (100 = CE, 200 = twice as often)
encounter_rate=100
; one random-encounter roll per this many game hours of walking (DH2; 24 = about once a day);
; 0 = CE: one roll per 1.5 s of real time, which depends on the frame rate (~45 game hours at 60 fps)
encounter_interval=24
; world map travel speed in steps per real second, independent of the frame rate (DH2; 30 = the
; pace of CE at 30 fps); 0 = CE: one step a frame, so the speed follows the frame rate (60 fps cap)
worldmap_fps=30
; what the scripts' "can see" check (obj_can_see_obj) sees through: ce = any object that blocks
; walking blocks sight (a knee-high bush too); shoot = not objects shots fly over (bushes, rubble,
; low walls); light = not objects light passes (also windows, fences, glass) (DH2 option)
sight_through=ce
; a town entered from the world map (an entrance without its own tile): exit = at the map's
; world-map exit grid (DH2), ce = the map header's start
worldmap_entry=exit
; 1 = a car left in a random-encounter map gets the "Car Outta Gas" circle on the world map (DH2), 0 = CE
car_marker=1
; 1 = an item dragged out of the inventory window is dropped (DH2), 0 = CE (the item menu's Drop only)
inventory_drag_drop=1
; 1 = the developer console commands (skipTemple(), revealWorldmap(), giveCar(), ...) in the
; browser console on every start; 0 = only with play.html#dev
dev_console=0
; dragging windows by their background (DH2 addition; CE windows are fixed)
; drag_windows=0 turns it off everywhere; drag_<window>=0/1 per window
drag_windows=1
drag_inventory=1
drag_character=1
drag_characterCreator=1
drag_options=1
drag_skilldex=1
drag_pipboy=1
drag_automap=1
drag_loot=1
drag_dialogue=1
drag_dialogueReview=1
drag_elevator=1
drag_calledShot=1
drag_moveItems=1
drag_saveLoad=1
drag_perks=1
drag_dialogBox=1
drag_preferences=1
; debug readouts at the top of the screen (mouse hex, tile, light, camera, bbox; combat turn)
debug_overlay=0
; fps counter
fps_overlay=1
; 1 = the spatial triggers' script names on the map (debug aid); 0 = off
show_spatials=0
; pixels from the screen edge at which the map scrolls (CE: the edge itself)
scroll_edge=10
; 1 = the screen centre never scrolls past the black border around the map (it reaches
; the middle of the screen at most), 0 = no such limit
scroll_limit=1
; ce = CE's scroll limits: the map's scroll-blocker ring and 480x400 px from the player;
; dh2 = the older rectangle guessed from the blockers' / floor's bounding box
scroll_bounds=ce
; 1 = with scroll_bounds=ce the view stays within 480x400 px of the player (CE), 0 = it goes
; as far as the blocker ring and the black border allow (console setScrollPlayerLimit)
scroll_player_limit=1
; 1 = a view behind a scroll-blocker wall from the player may cross blockers on its way back
; to the player (never away from them), 0 = CE: it stays behind the wall
scroll_return=1
; 1 = no one (player or NPC) walks past the black border around the map, 0 = no such limit
walk_limit=1
"""


def write_default_cfg(path="fallout2.cfg", overwrite=False):
    """Write DEFAULT_CFG to `path`. Returns True if the file was written."""
    if os.path.exists(path) and not overwrite:
        return False
    with open(path, "w", encoding="ascii", newline="\r\n") as f:
        f.write(DEFAULT_CFG)
    return True


def _section_entries(text):
    """{section: [(key, lines)]} of a cfg text, lowercase section and key names; `lines`
    are the key's line and the comment lines right above it. Top-level keys: section ''."""
    out = {"": []}
    section = ""
    comments = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("[") and s.endswith("]"):
            section = s[1:-1].strip().lower()
            out.setdefault(section, [])
            comments = []
        elif s.startswith(";") or s.startswith("#"):
            comments.append(line)
        elif "=" in s:
            out[section].append((s.split("=", 1)[0].strip().lower(), comments + [line]))
            comments = []
        else:
            comments = []
    return out


def add_missing_options(path="fallout2.cfg"):
    """Append the options of DEFAULT_CFG that the existing file at `path` lacks, each with
    its comment lines, at the end of its section (a missing section at the end of the file).
    The file's own lines and values are kept. Returns the added keys as 'section.key'."""
    with open(path, encoding="latin-1") as f:
        lines = f.read().splitlines()
    have = {sec: {k for k, _ in entries} for sec, entries in _section_entries("\n".join(lines)).items()}
    added = []
    for section, entries in _section_entries(DEFAULT_CFG).items():
        missing = [(k, block) for k, block in entries if k not in have.get(section, set())]
        if not missing:
            continue
        new_lines = [l for _, block in missing for l in block]
        added += [(section + "." if section else "") + k for k, _ in missing]
        if section not in have:
            lines += ["", "[%s]" % section] + new_lines
            continue
        # after the section's last non-blank line
        start = 0
        if section:
            start = next(i for i, l in enumerate(lines) if l.strip().lower() == "[%s]" % section) + 1
        end = next((i for i in range(start, len(lines)) if lines[i].strip().startswith("[")), len(lines))
        while end > start and not lines[end - 1].strip():
            end -= 1
        lines[end:end] = new_lines
    if added:
        with open(path, "w", encoding="latin-1", newline="\r\n") as f:
            f.write("\n".join(lines) + "\n")
    return added


DEFAULT_MODS_ORDER = r"""; mods_order.txt - DarkHarold2 mod load order (sfall's format, sfall LoadOrder.cpp)
;
; One mod per line, loaded top to bottom; a later line takes priority over an earlier one.
; ';' or '#' starts a comment - put one in front of a line to switch that mod off.
;
; Each line names a folder under mods/:
; - a mod the pipeline built from your install's mods (build_mods: mods/upu/ from the
;   Unofficial Patch's mods/upu.dat, with a manifest.json) - its files replace the game's;
; - a Lua script mod: mods/<name>/scripts/<script>.lua replaces data/scripts/<script>.lua.
; The pipeline adds the mods it builds at the end. fallout2.cfg [dh2] mods=a,b overrides
; this file. See wiki/upu_support.md.
"""


def write_default_mods_order(path=os.path.join("mods", "mods_order.txt"), overwrite=False):
    """Write DEFAULT_MODS_ORDER (no mods) to `path` unless it exists, as sfall creates
    <GameRoot>/mods/mods_order.txt. Returns True if the file was written."""
    if os.path.exists(path) and not overwrite:
        return False
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="ascii", newline="\r\n") as f:
        f.write(DEFAULT_MODS_ORDER)
    return True


if __name__ == "__main__":
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else "fallout2.cfg"
    if write_default_cfg(target):
        print("wrote " + target)
    else:
        added = add_missing_options(target)
        print("kept existing " + target + (", added " + ", ".join(added) if added else ""))
