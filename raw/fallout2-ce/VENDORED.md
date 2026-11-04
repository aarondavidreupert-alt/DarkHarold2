# Vendored fallout2-ce sources

`src/` of [fallout2-ce](https://github.com/alexbatalov/fallout2-ce) (LICENSE.md), the ground truth
DH2's code cites (CLAUDE.md "Ground-Truth References"). The unit tests read some of it directly
(`test/support/ce.mjs`: `skill.cc`, `skill_defs.h`, `scripts.h`).

Trimmed 2026-10-27 (cleanup_audit CA27): the platform ports (`os/`), `third_party/`, the CMake
build and upstream's CI were removed; they are in git history before that date and upstream.
