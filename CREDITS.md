# Credits

DarkHarold2 stands on the work of many people. This file names them by project. Project names, authors
and contributor handles are as their own repositories and readmes give them; the larger contributor lists
are on the linked pages.

## The game

- **Fallout 2** — Black Isle Studios / Interplay Entertainment (1998); now owned by Bethesda Softworks.
  DarkHarold2 ships none of the game's data: the asset pipeline reads the user's own installation.

## The engine this project is based on

- **DarkFO** — darkf, with contributions from Stratege, MaxDesiatov and hhirsch
  (<https://github.com/darkf/darkfo>, Apache License 2.0). DarkHarold2 is a fork of it.

## Ground-truth references

- **fallout2-ce** — Alexander Batalov (alexbatalov) and contributors, among them JanSimek, roginvs,
  k3tamina, wipe2238, sonilyan, phobos2077 (<https://github.com/alexbatalov/fallout2-ce>). The
  authoritative reimplementation every DH2 system is checked against (`raw/fallout2-ce/`).
- **jsFO** — ajxs and contributors (<https://github.com/ajxs/jsFO>). Browser-side patterns.

## Script sources and fixes

- **Black Isle's Fallout 2 script sources** (Interplay), from the Fallout wiki's script library
  (<https://fallout.fandom.com/wiki/Category:Fallout_2_script_files>). Read locally (`ssl/`, not
  committed) for variable and constant names in the decompiled Lua.
- **Unofficial Fallout 2 Patch (UP)** — killap (<http://killap.net/>). Its 1.02.31 script sources
  (`data/scripts_src/`, local) name variables the Black Isle sources lack, and its fixes show what some
  buggy scripts meant (known_bugs L7).
- **Fallout 2 Unofficial Patch, updated (UPU)** — BGforge (<https://github.com/BGforgeNet/Fallout2_Unofficial_Patch>),
  based on killap's UP; its largest contributors are burner1024, MrHouse404, NovaRain,
  dzmitry-rudnouski, tygyh and egornovivan. Analysed for support (`wiki/upu_support.md`); a local copy
  is kept in `third_party/` (not committed).
- **sfall** — Timeslip and many other contributors, now maintained by the sfall team: NovaRain,
  phobos2077, FakelsHub, vlad-saritasa, Vennor, burner1024, wipe2238 and others
  (<https://github.com/sfall-team/sfall>). The engine extension UPU builds on; its opcodes and
  `mods_order.txt` rules are the reference for DH2's mod support.
- **UPU's companion mods**, linked from its readme: High quality music, Hero Appearance, Party Orders,
  NPC armor, FO2tweaks, Cassidy talking head (BGforge), and Inventory Filter (rotators,
  <https://github.com/rotators/InventoryFilter>).

## Libraries in `lib/`

- **wasmoon** — Gabriel Francisco (MIT License): Lua 5.4 in WebAssembly, runs the decompiled scripts.
- **PathFinding.js** — qiao and contributors, including Gerard Meier and aniero
  (<https://github.com/qiao/PathFinding.js>).

## Adding to this file

When DarkHarold2 uses, reads or follows another person's work — a mod, a source tree, a library, a
fix — add it here with the project's own name for its authors and a link.
