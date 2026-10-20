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
# plus DarkHarold2's [dh2] section (read by src/ui_options/fallout2Cfg.ts).
# CE writes the file itself on exit (gameConfigSave); a browser can't, so the
# pipeline creates it once. An existing file is never overwritten - it may hold
# the user's own settings.

import os

DEFAULT_CFG = r"""; fallout2.cfg - DarkHarold2
;
; Default values of CE game_config.cc gameConfigInit. DarkHarold2 reads this file at
; startup (src/ui_options/fallout2Cfg.ts). A browser can't write it back, so changes
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
; walk/run movement: ce (CE _object_move), dh2 (old DarkFO chunks), smooth (ce + frame blend)
walk_model=ce
; sprite offset across animation changes: ce (CE obj->x/y), dh2 (old anchor pinning)
anim_offset_model=ce
; game scripts: lua = the decompiled data/scripts/*.lua (tools/int2lua.py; a script
; without one runs its .int), vm = the .int bytecode
script_backend=lua
; Lua mods in load order, e.g. mods=a,b (mods/<name>/scripts/*.lua; a later one wins)
mods=
"""


def write_default_cfg(path="fallout2.cfg", overwrite=False):
    """Write DEFAULT_CFG to `path`. Returns True if the file was written."""
    if os.path.exists(path) and not overwrite:
        return False
    with open(path, "w", encoding="ascii", newline="\r\n") as f:
        f.write(DEFAULT_CFG)
    return True


if __name__ == "__main__":
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else "fallout2.cfg"
    print(("wrote " if write_default_cfg(target) else "kept existing ") + target)
