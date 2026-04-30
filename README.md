# DarkHarold2

A post-nuclear RPG remake

This is a modern reimplementation of the engine of the video game [Fallout 2](http://en.wikipedia.org/wiki/Fallout_2), as well as a personal research project into the feasibility of doing such.

The project is based on [darkfo](https://github.com/darkf/darkfo) codebase, but is modernized for Python 3, potentially
with more improvements and bug fixes coming in the future.

It is written primarily in TypeScript and Python, and targets recent browsers with WebGL 2.0 support.

## Status

DarkHarold2 is not a complete remake at this time. Estimated overall completion: **~50%**.
The core technical foundation (rendering, combat math, scripting VM, map loading, dialogue runtime) is
solid. What remains is mostly connecting gameplay systems end-to-end rather than solving hard research problems.

If you're looking for documentation on how Fallout 2 works, documentation on certain file formats, or
tools to work with them, this project will be useful to you as well.

<img src="screenshot.png" width="640" height="480">

---

### ✅ Substantially implemented (~70–90%)

- **Map loading & rendering** — tile maps, multi-elevation, WebGL 2.0 renderer, lightmap, real-time lighting
- **Walking & running** — pathfinding, door interaction, exit grids (map-to-map and worldmap transitions)
- **Combat core** — hit chance formula, ammo system (X/Y/DR/AC modifiers), burst fire (3-cone spread), called shots (8 body regions), critical hits (6 levels), critical failures (weapon-type-specific), armor DR/DT per damage type, crippled limbs, knockdown/knockout, fire DoT, ranged miss scatter, partial cover, AI weapon switching and ammo reloading, most combat perks (Slayer, Sniper, Sharpshooter, Bonus HtH Attacks, Bonus Rate of Fire, etc.)
- **Talking to NPCs** — `start_gdialog` / `giq_option` / reply callback chain, floating text messages
- **Bartering** — item exchange UI, value calculation with Barter skill modifier
- **Inventory UI** — drag-and-drop, equip slots (armor, two weapon slots), weight display, reload, stacking
- **Skill math** — all 18 skills enumerated, FO2 cost curve, tag skill doubling, trait/perk/difficulty modifiers
- **Scripting VM** — INT file parser, ~100+ opcodes dispatched, transpiler/disassembler
- **Worldmap travel** — 28×30 grid, per-tile encounter tables, time passage, area transitions
- **Random encounters** — encounter group generation, placement on encounter map
- **Audio engine** — music looping, weapon/action sound mapping, ambient SFX from map data
- **Pip-Boy** — clock display, alarm, STATUS tab, QUESTS/ARCHIVES tab, AUTOMAP tab with per-location map view, zoom/pan, IndexedDB persistence (~90% complete)
- **Character screen** — full SPECIAL/skill view, stat display, trait/perk lists

---

### 🔶 Partially implemented (~30–69%)

- **Active skill use** — First Aid, Doctor, Sneak, Lockpick, Steal, Traps, Science, Repair (8 of 9 active skills; Gambling and Outdoorsman have no interactive handler). 3-use/day limit and XP awards in place. Known gaps: Healer perk not applied, Expanded Lockpick set not modelled, no electronic lockpick distinction, no facing check on Steal.
- **Level-up flow** — XP thresholds, skill point calculation (5 + 2×INT, +2 if Educated), HP per level (END/2 + 2, +4 if Lifegiver), perk every 3 levels (every 4 if Skilled). `pendingPerkPick` flag is set but **no perk selection UI exists** — picked perks never get applied.
- **Perks** — ~15 perks wired into combat and skill calculations; no rank tracking; no prerequisite checks; no selection screen.
- **Traits** — 2 of 16 traits (Gifted, Good Natured) affect skill calculations; no trait selection at character creation; no 2-trait slot limit enforced.
- **Dialogue** — runtime is functional; `giq_option`, `gsay_reply`, float messages work. `end_dialogue` is a stub in scripting. Some `gsay_message` UI integration is incomplete.
- **Character creation** — SPECIAL point-buy, tag skill selection present. Trait selection and name/age/sex entry incomplete.
- **Worldmap** — functional but rough: area entrances are misplaced on area screens, no difficulty adjustment on encounter rate, encounter items/equipping not implemented.
- **Lighting** — works but has minor inaccuracies and is slow outside the WebGL backend.
- **Time & date system** — `gametime.ts` implements ticks, day/night ambient light, script bridges for `game_time` and `game_time_hour`. `get_month` and `get_day` opcodes are hardcoded to return 1 and 0 respectively.
- **Save / load** — IndexedDB-backed; saves/restores position, orientation, inventory, and current map. **Critical gap:** player stats, skills, perks, traits, level/XP, karma, conditions, and GVARs are not fully serialized (`// TODO: Properly (de)serialize the player!` at saveload.ts:158). No save slot screenshots. Consider experimental.
- **Quest system** — `questData.ts` covers all major Fallout 2 quests with GVAR-based state tracking; Pip-Boy ARCHIVES tab surfaces them. No completion rewards or XP awards wired through the engine. Quest descriptions are inlined in TS rather than loaded from `quests.msg`.
- **Animations** — FRM sprite rendering works; some animations are off, particularly related to combat.

---

### ❌ Not implemented or near-absent (<30%)

- **Karma & reputation** — stat fields are defined in `skills.ts`; `get_pc_stat` for karma/reputation falls through to a stub in scripting; no increment/decrement logic, no karma title computation, no town or faction reputation tracking.
- **Party / NPC followers** — `party.ts` is a 61-line shell: add/remove/enumerate only. No CHA-based party size cap, no follow/formation logic, no companion inventory access, no companion level-up, no dismissal dialogue.
- **Poison, radiation, addictions, withdrawal** — stats are defined; scripting intrinsics (`get_poison`, `radiation_dec`, `poison`) are stubs. No per-tick decay or damage loop exists anywhere in the engine.
- **Drug & chem system** — no effect timers, stat modification, or addiction rolls.
- **NPC schedules / day-night behaviour** — not implemented.
- **Perk selection UI** — `pendingPerkPick` flag is set on level-up but no screen exists to pick a perk.
- **Endgame slides / game over screen** — not implemented.
- **Subtitles / speech file playback** — audio engine has no speech hooks; no subtitle overlay.
- **DAM_DROP** (weapon drop on critical failure), unarmed hit modes (Haymaker, etc.) — not implemented in combat.
- **AI faction/team targeting** — AI selects the nearest critter regardless of team; `teamNum` is marked TODO in `object.ts`.

---

### Known scripting gaps (scripting.ts)

`~61` script intrinsics are currently stubs (log-and-return with no effect), including:
`critter_mod_skill`, `critter_injure`, `critter_is_fleeing`, `wield_obj_critter`, `critter_heal`,
`poison`, `radiation_dec`, `play_sfx`, `play_gmovie`, `mark_area_known`, `gfade_out/in`,
`reg_anim_func/animate`, `obj_art_fid`, `proto_data`, `gdialog_set_barter_mod`, and others.
`METARULE_CURRENT_TOWN`, area-known flags, and drug-influence checks are also unimplemented.

---

## Roadmap — next priorities

The goal is a playable end-to-end run. These four pieces, in order, move the needle most:

**1. Save/Load serialization** (`saveload.ts`)
Player position and inventory are saved, but stats, skills, perks, level/XP, karma, and GVARs are not
(`// TODO: Properly (de)serialize the player!` at saveload.ts:158). Without this, every session starts
from scratch and nothing is testable long-term. The `SaveGame` interface and IndexedDB plumbing already
exist — it's a matter of wiring `StatSet`/`SkillSet`/`player` into them.

**2. Scripting stub coverage** (`scripting.ts`)
~61 script intrinsics are currently no-ops that silently log and return. This means quest scripts fail
invisibly — items don't spawn, animations don't play, characters don't react. Priority targets:
`critter_heal`, `critter_injure`, `play_sfx`, `mark_area_known`, `gfade_out/gfade_in`, `play_gmovie`.
Even rough implementations of these would unlock large chunks of scripted content.

**3. Perk selection UI** (`ui_character.ts`, `player.ts`)
The level-up math is done, `pendingPerkPick` is already set on level-up, and perks are listed in the
character screen. This just needs a selection screen wired to that flag. Low effort relative to the
visible impact on every playthrough.

**4. Karma & reputation** (`scripting.ts`, `globalState.ts`)
The stats are defined and `get_pc_stat` has stubs for karma/reputation, but nothing ever increments or
reads them. Adding basic increment/decrement logic and connecting it to dialogue condition checks would
make a large number of scripted NPC interactions start working correctly, since most FO2 scripts branch
on karma or town rep.

---

Things deliberately left for later: party/companion system, poison/radiation/addiction loops, NPC
schedules, endgame slides. These are real gaps but not on the critical path to a believable first
playthrough.

---

## Installation

To use this, you'll need a few things:

-   A copy of Fallout 2 (already installed). You can buy one on [GOG](https://www.gog.com/en/game/fallout_2), download
    the standalone installer, and unpack on any platform supported by
    [innoextract](https://github.com/dscharrer/innoextract), or run the installer `.exe` if you're on Windows.

The rest of the dependencies can be installed all at once if you're on macOS and using [Homebrew](https://brew.sh).
Just run this command in the directory of your repository clone:

```
brew bundle
```

Otherwise you can install the dependencies manually:

-   Python 3.9 or later, earlier minor versions of Python 3 may work, but are not tested. Python 2 is not supported.

-   [Pipenv](https://github.com/pypa/pipenv) for Python dependency management.

-   The TypeScript compiler, installed via `npm install` (you'll need [node.js](https://nodejs.org/en/)).

Once you've got all that, you can start trying it out.

Open a command prompt inside the DarkHarold2 directory, and then run:

```
pipenv install
pipenv shell
python setup.py path/to/Fallout2/installation/directory
```

This will take a few minutes, it's unpacking the game archives and converting relevant game data into a format DarkHarold2 can use.

You'll need an HTTP server to run (despite being all static content) due to the way browsers sandbox requests.
If you're comfortable with setting up nginx, lighttpd, or Apache, go for that. If not, a simple way is to use Python:

-   Python 3: `python -m http.server`

Then run `npx tsc` after you've run `npm install` to compile the source code.

Browse to `http://localhost/play.html?artemple` (or whatever port you're using). If all went well, it should begin the game. If not, check the JavaScript console for errors.

Alternatively, Firefox can load directly from `file://` by opening `play.html` file.

Review `src/config.ts` for engine options. Be sure to re-compile if you change them.

OPTIONAL: If you want sound, run `python convertAudio.py`. You'll need the `acm2wav` tool (you can get it from No Mutants Allowed).

## FAQ

**Note**: This section has been copied from `README.md` of DarkFO, the answers don't represent opinions of the current maintainer
of DarkHarold2 and are only given to explain the status quo. The technical direction of DarkHarold2 may change in the future.

-   **Q:** Why TypeScript? Why a browser?

    A: Everyone has a browser: it's a portable platform for running code with more features than people expect.
    There are other projects that use native code already... and are already seeing segfaults. :)

    The project started out in JavaScript and was ported to TypeScript as it was continuing to grow. TypeScript strikes
    an excellent balance between useful and safe.

-   **Q:** But why Python?

    A: Python is actually quite fast when written well, despite many peoples' expectations. It is very elegant and allows me to write
    backend code like file parsers and exporters with tiny code, very few troubles, and that I know is portable and safe.

-   **Q:** Why do I need `acm2wav` for sound?

    A: Because it hasn't been ported to Python yet. If you're willing to contribute, give it a shot: the original Pascal source code is available online.

    Additionally, FFmpeg might be able to transcode ACM audio, so give that a shot. (See [darkf/darkfo#30](https://github.com/darkf/darkfo/issues/30))

-   **Q:** Why convert all assets up front, why not load them directly?

    A: Because it would require more processing time to load them each time they're needed rather than having them already in a sane, modern format.

    By converting, for example, FRMs (a proprietary Interplay format) to PNGs (a ubiquitous, open modern format) we allow normal browsers or image viewers to open them, as well as edit them -- a huge win for modders. Other games or tools could take advantage of the new formats as well.

-   **Q:** Why do this at all?

    A: Why not? It's a fun project, and I love Fallout. Fallout 1 and 2 do not run particularly well on modern machines, even with engine hacks. They're also hard to mod -- I'd like to change that.

## License

DarkHarold2 is licensed under the terms of the Apache 2 license. See `LICENSE.txt` for the full license text.

## Contributing

Contributions are welcome!

Testing is more than welcome: if you have issues running DarkHarold2, or if you find bugs, glitches, or other inaccuracies, please don't hesitate to file an issue on GitHub and/or contact the developers!

To contribute code, simply submit a pull request with your changes. Take care to write sensible commit messages, and if you want to change major parts of the code, please discuss it with other developers first (see the Contact section below).
I apologize in advance for any injury sustained while reading the code. :)

Thanks!

## Contact

If you have an issue, please file it in the GitHub issue tracker.
