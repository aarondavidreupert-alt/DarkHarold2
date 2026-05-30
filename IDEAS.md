# DarkHarold2 Ideas (Post-Vanilla)

## Commandos-Style Companion Control
Tab/hotkey cycles through party members. Camera follows selected unit.
Full player-level control while "possessing" them (move, use items, interact).
Other companions hold position or follow simple AI directive.
Fallout's hex grid, LOS, and AP system make this a natural fit.
Inspiration: Commandos (Pyro Studios, 1998).
Priority: Post-vanilla stretch goal.

## LLM-Promptable Modding Platform
With Lua/Fallout-script fully implemented, game logic becomes promptable.
Goal: describe a quest or NPC in plain language, LLM writes the script, it works.
Browser-based = zero install friction, share mods via URL.
This is the north star for the scripting rewrite.

## Multi-Elevation on Single Map (Research)
Tim Cain mentioned an early Fallout 1 prototype had rooftop/ground/lower elevation
on a single map with drop-down traversal — cut due to renderer/pathfinding complexity.
FO2 engine handles elevation as a map index (0/1/2), not a true Z-axis.
WebGL 2.0 could support this — flagged as "beyond faithful" if ever pursued.
