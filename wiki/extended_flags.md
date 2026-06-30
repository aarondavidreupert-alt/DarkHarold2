# Wall/Scenery `extendedFlags` Orientation Semantics

Reference doc for the proto-level `extendedFlags` ("flags_ext") field on walls and
scenery, and the two CE systems that branch on its upper bits: egg/occlusion
transparency and light blocking. Written to settle a set of suspected bit-mask
bugs in DH2's `isCEOccludingWall()`.

Ground truth: `raw/fallout2-ce/src/object.cc`, `proto_types.h`, `proto.cc`, `obj_types.h`, `tile.cc`  
DH2 implementation: `src/render/webglDraw.ts` (`isCEOccludingWall()`, `isEggObject()`), `src/geometry/hexScreen.ts` (`hexIsInFrontOf`/`hexIsToRightOf`), `tools/proto.py` (`readWall()`, `readScenery()`)

Cross-references: `wiki/rendering.md` §"Egg Transparency Effect" (shader/asset side of the same feature), `wiki/known_bugs.md` RD16, `wiki/proto_system.md` §4.4–4.5

Audited as of `egg` branch commit `683199f` ("more egg"), 2026-06-30.

---

## 1. What `extendedFlags` Is

Every `Proto` in CE is a C union (`proto_types.h:443-462`) whose first 8 fields
(`pid, messageId, fid, lightDistance, lightIntensity, flags, extendedFlags, sid`)
are laid out identically across `item`, `critter`, `scenery`, `wall`, and `misc`
members — only `tile` differs (it omits `lightDistance`/`lightIntensity`, so its
`extendedFlags` sits at a different byte offset). `extendedFlags` (source comment:
`// flags_ext`) is therefore the 7th `int32` in the proto record for walls and
scenery alike, immediately following the `flags` field and immediately preceding
`sid`.

This union aliasing is exploited directly in CE: `_obj_render_object()`
(`object.cc:4955`) reads `proto->critter.extendedFlags` even when the object's
real type is scenery or wall (`type == 2 || type == 3`), relying on the fact that
`critter.extendedFlags` and `wall.extendedFlags`/`scenery.extendedFlags` are the
same memory location. This is correct C, not a typo.

On disk, `protoRead()` (`proto.cc:1699-1717`) reads `lightDistance`,
`lightIntensity`, then `extendedFlags` as consecutive `int32`s for both
`OBJ_TYPE_SCENERY` and `OBJ_TYPE_WALL`. DH2's `tools/proto.py` mirrors this:
`readScenery()` and `readWall()` (`tools/proto.py:60-97`) both read
`extendedFlags` as the first `int32` after the common header (which `readPRO()`
already consumed), and both store it under `obj["extra"]["extendedFlags"]`
(`readPRO()`, `tools/proto.py:286-288`). DH2 code reads it back via
`obj.pro?.extra?.extendedFlags`. **Confirmed: the byte offset and JSON field name
match for both proto types** (Investigation Task 4 — refuted, no bug).

Default values baked in by `proto.cc`: scenery `extendedFlags = 0x2000`
(`proto.cc:952`), wall `extendedFlags = 0x2000` (`proto.cc:1007`) — i.e. most
walls/scenery carry only the low "no orientation" bit unless an editor
explicitly set one of the four upper bits described below.

## 2. The Four Orientation Bits

All four bits live in the *upper* byte-and-a-half of `extendedFlags` (bits
27–31). CE tests them with a cascaded `if/else if` — exactly one case applies
per object, in this priority order:

| Bit | Mask | Used standalone in egg/render? | Geometric role (inferred from `_obj_adjust_light`'s rotation table, `object.cc:4556-4581`) |
|---|---|---|---|
| 27 | `0x8000000`  | yes (grouped with bit 31 in egg code, with bit 30 in light code — see §5) | E-W wall run / south-facing segment |
| 28 | `0x10000000` | yes, alone | NE-SW diagonal wall (light/sight passes along the NE-SW axis) |
| 29 | `0x20000000` | yes, alone | corner wall, mostly blocks the southward direction |
| 30 | `0x40000000` | **only** in the light-blocking switch, never in egg code | grouped with bit 27 for light purposes; CE's egg code does not consult it |
| 31 | `0x80000000` | yes (grouped with bit 27 in egg code only) | same family as bit 27 for occlusion purposes (decompiler-era "TODO: Probably wrong") |
| — | `0x2000`     | no (this is the *default*, no upper bit set) | plain interior NE-SW panel wall |

(Bit numbers are 0-indexed from the LSB; `0x80000000` is bit 31, the sign bit of
a 32-bit signed `int` — this is fine for bitwise `&` in both C and JS.)

## 3. Egg Transparency Logic

Two CE functions implement (almost) the same 4-way branch on `extendedFlags`,
for two different purposes:

### 3a. `_obj_intersects_with()` (`object.cc:2891-2979`) — hit-testing

Used by `_obj_create_intersect_list()` (mouse-over / "what's under the cursor")
to decide whether a wall/scenery pixel should also report an intersection with
the invisible `gEgg` object underneath it:

```c
int extendedFlags = proto->scenery.extendedFlags;
if ((extendedFlags & 0x8000000) != 0 || (extendedFlags & 0x80000000) != 0) {
    v20 = tileIsInFrontOf(object->tile, gDude->tile);
} else if ((extendedFlags & 0x10000000) != 0) {
    v20 = tileIsInFrontOf(object->tile, gDude->tile) || tileIsToRightOf(gDude->tile, object->tile);
} else if ((extendedFlags & 0x20000000) != 0) {
    v20 = tileIsInFrontOf(object->tile, gDude->tile) && tileIsToRightOf(gDude->tile, object->tile);
} else {
    v20 = tileIsToRightOf(gDude->tile, object->tile);
}
```
(`object.cc:2950-2961`)

This function has **no `OBJECT_WALL_TRANS_END` check anywhere** — confirmed by
direct read, every line from 2932-2967.

### 3b. `_obj_render_object()` (`object.cc:4881`, relevant branch at `4949-4980`) — the actual rendering/alpha decision

This is the function that decides whether to draw the egg-blended transparent
wall during the normal render pass. It is structurally the **same 4-way
branch**, reading `proto->critter.extendedFlags` (union-aliased, see §1), but
two of the four cases add an `OBJECT_WALL_TRANS_END` override that
`_obj_intersects_with()` does not have:

```c
int extendedFlags = proto->critter.extendedFlags;
if ((extendedFlags & 0x8000000) != 0 || (extendedFlags & 0x80000000) != 0) {
    v17 = tileIsInFrontOf(object->tile, gDude->tile);
    if (v17 && tileIsToRightOf(object->tile, gDude->tile) && (object->flags & OBJECT_WALL_TRANS_END) != 0) {
        v17 = false;
    }
} else if ((extendedFlags & 0x10000000) != 0) {
    v17 = tileIsInFrontOf(object->tile, gDude->tile) || tileIsToRightOf(gDude->tile, object->tile);
} else if ((extendedFlags & 0x20000000) != 0) {
    v17 = tileIsInFrontOf(object->tile, gDude->tile) && tileIsToRightOf(gDude->tile, object->tile);
} else {
    v17 = tileIsToRightOf(gDude->tile, object->tile);
    if (v17 && tileIsInFrontOf(gDude->tile, object->tile) && (object->flags & OBJECT_WALL_TRANS_END) != 0) {
        v17 = false;
    }
}
```
(`object.cc:4955-4980`)

**This is the function DH2's `isCEOccludingWall()` actually implements** — it is
a per-frame rendering decision ("should this wall be alpha-blended right now"),
not a hit-test. `_obj_intersects_with()` is a separate, related system used for
cursor picking and is not what DH2's egg shader logic should be compared
against (see §6, Investigation Task 3).

### Isometric geometry of `tileIsInFrontOf`/`tileIsToRightOf`

Both are half-plane line tests in *screen* space, not distance checks
(`tile.cc:854-889`):

```c
bool tileIsInFrontOf(tile1, tile2) {  // dx, dy = screen(tile2) - screen(tile1)
    return dx <= dy * -4.0;
}
bool tileIsToRightOf(tile1, tile2) {  // dx, dy = screen(tile2) - screen(tile1)
    return dx <= dy * 1.3333333333333335;  // 4/3, with a deliberate 1-ULP nudge — see tile.cc:884-887
}
```

The boundary of each test is a fixed diagonal through `tile1` at slope -4 or
4/3 in screen pixels — these are exactly the two hex-grid diagonals (NW-SE and
NE-SW) as seen by the fixed isometric camera. Composing them with OR/AND
produces a wedge or the complementary wedge; using only one produces a single
half-plane. None of the four cases is a radial/circular test, and no
combination of them can produce one — this is why the egg effect is inherently
"camera-facing-only," not a symmetric bubble. DH2's `hexIsInFrontOf`/
`hexIsToRightOf` (`src/geometry/hexScreen.ts:53-69`) reproduce the same slopes
and the same `(a, b)` → `screen(b) - screen(a)` argument convention as CE.

## 4. Light Blocking Logic

`_obj_adjust_light()` (`object.cc:3963`, relevant switch at `4550-4587`) walks
the light-blocking object list around a light source and, for each wall
encountered, branches on `proto->wall.extendedFlags` to decide which camera
**rotations** the wall blocks light from:

```c
if ((proto->wall.extendedFlags & 0x8000000) != 0 || (proto->wall.extendedFlags & 0x40000000) != 0) {
    // blocks unless rotation == W, NW, (NE && index>=8), or (SW && index<=15)
} else if ((proto->wall.extendedFlags & 0x10000000) != 0) {
    // blocks unless rotation == NE or NW
} else if ((proto->wall.extendedFlags & 0x20000000) != 0) {
    // blocks unless rotation in {NE,E,W,NW} or (SW && index<=15)
} else {
    // blocks unless rotation in {NE,E} or (NW && index<=7)
}
```
(`object.cc:4556-4581`)

This switch shares 3 of its 4 bits with the egg logic (`0x8000000`,
`0x10000000`, `0x20000000`) but pairs `0x8000000` with **`0x40000000`** (bit 30),
not `0x80000000` (bit 31) the way the egg/render functions do.

## 5. Investigation Task 2 — Is `0x40000`/bit 30 a Decompiler Artifact?

The premise as posed ("`0x80000` appears twice in `_obj_intersects_with`") does
not match the actual source: the two masks at `object.cc:2951` are
`0x8000000` (bit 27) and `0x80000000` (bit 31) — two genuinely different bits,
not a duplicated literal. There is no typo at that call site.

Separately: **`0x40000000` (bit 30) is never referenced by either egg function**
(`_obj_intersects_with` or `_obj_render_object`). It appears *exclusively* in
`_obj_adjust_light`'s light-blocking switch, where it is grouped with
`0x8000000`. So, per the literal CE source:

- Egg/occlusion semantically uses bits 27 + 31 together, and 28, 29 separately.
- Light-blocking semantically uses bits 27 + 30 together, and 28, 29 separately
  (identically to egg for those two).

These are two related but distinct pairings (31 for occlusion, 30 for light),
both plausibly meaning "the same wall-orientation family" under two different
encodings, or one of the two grew from a genuine CE bug carried forward from
the original 1998 binary (the disassembly comment at `object.cc:4957`/`2954`
literally says `// TODO: Probably wrong`, an annotation added by the CE
decompilation project itself, not DH2). **We cannot resolve from source alone
whether 27+31 or 27+30 is the "intended" design** — both are attested,
verbatim, in two different shipped CE functions. What we can say with
certainty: bit 30 has no role in `_obj_intersects_with`/`_obj_render_object` as
literally written, so substituting it for bit 31 in those functions is a
deviation from CE's actual (if possibly buggy) behavior, not a restoration of
"more correct" behavior — see §6 for how this plays out in DH2.

## 6. Cross-Reference Table

| Bit / mask | `_obj_intersects_with` (hit-test) | `_obj_render_object` (egg render) | `_obj_adjust_light` (light block) |
|---|---|---|---|
| 27 `0x8000000`  | grouped with 31, `fOD` only | grouped with 31, `fOD` + WALL_TRANS_END override | grouped with **30**, rotation table A |
| 28 `0x10000000` | `fOD \|\| rDO` | `fOD \|\| rDO` (identical) | rotation table B |
| 29 `0x20000000` | `fOD && rDO` | `fOD && rDO` (identical) | rotation table C |
| 30 `0x40000000` | not referenced | not referenced | grouped with 27, rotation table A |
| 31 `0x80000000` | grouped with 27, `fOD` only | grouped with 27, `fOD` + WALL_TRANS_END override | not referenced |
| default (e.g. `0x2000`) | `rDO` only | `rDO` + WALL_TRANS_END override | rotation table D |

`fOD` = `tileIsInFrontOf(object, dude)`, `rDO` = `tileIsToRightOf(dude, object)` — CE's exact argument order, which matters because neither predicate is symmetric under argument swap.

## 7. `OBJECT_WALL_TRANS_END`

`obj_types.h:81`: `OBJECT_WALL_TRANS_END = 0x10000000`. This is an **object
instance flag** (`object->flags`, set at spawn time in
`objectCreateWithFidPid()` from `proto->flags & 0x10000000`, `object.cc:967-969`
— note: `proto->flags`, the *base* flags field, not `proto->extendedFlags`).

It numerically collides with orientation bit 28 (`extendedFlags & 0x10000000`,
§2) but the two are unrelated bitfields on unrelated proto members
(`proto->flags` vs `proto->extendedFlags`) — the shared hex value is
coincidence, not a shared meaning. Worth calling out explicitly so a future
reader doesn't conflate "wall is in the NE-SW-diagonal orientation class" with
"wall is a trans-end wall" just because both are spelled `0x10000000`.

`OBJECT_WALL_TRANS_END` is consumed only inside `_obj_render_object()`'s bit
27/31 branch and default branch (§3b) — never inside `_obj_intersects_with()`
(§3a). DH2's `isCEOccludingWall()` checks it in the analogous two branches,
which is correct **because DH2's function corresponds to
`_obj_render_object()`**, not `_obj_intersects_with()` (Investigation Task 3 —
the suspected "CE has no such check" framing was comparing DH2 against the
wrong CE function; against the right one, the check is present, correctly
valued, and correctly placed).

## 8. DH2 Status

### Confirmed correct (no bug)

- **Proto field path / byte offset** (Task 4): `obj.pro?.extra?.extendedFlags`
  reads the same union-aliased offset CE uses for both walls and scenery;
  `tools/proto.py`'s `readWall()`/`readScenery()` extract it at the right byte
  position and serialize it under the same JSON key for both types. No
  deviation.
- **`OBJECT_WALL_TRANS_END` value and placement** (Task 3): `0x10000000` is
  correct (`obj_types.h:81`), and DH2 places the check in the same two branches
  CE's render function does. The check is *not* present in CE's hit-test
  function, but DH2's `isCEOccludingWall()` was never meant to mirror the
  hit-test function — severity: **non-issue**, the suspected bug was a
  misidentified ground-truth function, not a DH2 defect.
- **Bit values for the default 4-way branch** (Task 1, as posed): the
  suspected CE values `0x80000`/`0x10000`/`0x20000`/`0x40000` do not appear
  anywhere in CE's egg or light-blocking logic. They *are* real CE constants
  (`OBJECT_TRANS_ENERGY/WALL/GLASS/STEAM`, `obj_types.h:74-77`), but belong to
  a completely different system: per-instance translucency *tinting*, set from
  `proto->flags` (not `extendedFlags`) in `objectCreateWithFidPid()`
  (`object.cc:943-957`). DH2's actual masks (`0x8000000`, `0x10000000`,
  `0x20000000`, plus historically `0x80000000`) match CE's real
  `extendedFlags` orientation bits. **The suspected mismatch is refuted** —
  DH2 was never silently no-op'd or actively wrong on this account; the
  premise conflated two unrelated CE bitfields that happen to reuse familiar
  small hex literals.
- **Argument order / naming** (Task 5): `frontObjDude = hexIsInFrontOf(obj, player)`,
  `rightObjDude = hexIsToRightOf(obj, player)`, `rightDudeObj = hexIsToRightOf(player, obj)`,
  `frontDudeObj = hexIsInFrontOf(player, obj)` — all four checked individually
  against every CE call site in `_obj_render_object()`'s four branches; none
  are transposed. DH2's `Subject+Object` word order in each variable name
  (`frontObjDude` = front test with args `(obj, dude)`) does consistently
  encode the real argument order, it's just an implicit convention rather than
  CE's explicit `(a, b)` parameter names. Recommend the wiki (this note) serve
  as the documentation of that convention; renaming to something like
  `frontOfObjFromDude`/`frontOfDudeFromObj` would be more self-documenting but
  is a pure readability change with no behavioral upside — not worth a patch
  on its own.

### Confirmed deviation — flagged, not yet fixed

- **Bit 30 substituted for bit 31 in the occlusion branch (Task 2), severity:
  actively diverges from literal CE source.** As of `egg` branch commit
  `683199f`, `isCEOccludingWall()` (`src/render/webglDraw.ts:244`) tests
  `extendedFlags & 0x40000000` instead of CE's literal `0x80000000` in the
  egg-render function, and additionally splits what CE treats as one branch
  (bits 27+31, both running `fOD` + override) into two separate branches with
  *different* logic — bit 30 keeps the original `fOD`-based test, while bit 27
  is now given a hand-derived `player.y < obj.y` integer comparison instead of
  `fOD`. This was an intentional, empirically-motivated change (commit history
  "egg fix" → "more egg" → "egg qalmost" → "return of the error" → "more egg",
  no commit messages explaining the reasoning beyond inline code comments)
  reasoning from `_obj_adjust_light`'s bit-30 pairing (§4) and CE's own
  "TODO: Probably wrong" annotation, on the theory that the literal
  `0x8000000 | 0x80000000` grouping in the render function is itself a bug.
  Per §5, this is *plausible* but **not verifiable from source alone** — CE's
  shipped binary unambiguously uses bit 31, not bit 30, in the egg/render path.
  **As written, real proto data that sets bit 31 without bit 27 will fall
  through to the wrong branch in DH2** (bits 28/29/default) since bit 31 is no
  longer tested anywhere in `isCEOccludingWall()`. Whether this is a no-op or
  an active bug depends on whether any actual wall/scenery proto in the game
  data sets bit 31 (`0x80000000`) without also setting bit 27 — **not
  determined in this audit**, since no extracted `proto/pro.json` is present in
  this checkout to sample (the asset pipeline output is gitignored game data,
  not checked in). `wiki/rendering.md`'s 2026-06-26 entry sampled two real
  walls with `extendedFlags = 0x20000000` and `0x8000000` respectively —
  neither exercises bit 30 vs bit 31, so it doesn't settle the question either.
  This is a regression from the state `wiki/known_bugs.md` RD16 most recently
  marked "fixed" (2026-06-26, which still matched literal CE) — that entry and
  `wiki/rendering.md` were **not updated** for the bit-30/custom-branch change
  that followed it, so the wiki currently documents a state the code has since
  diverged from. Fix status: **not fixed, not reverted — flagged only**, per
  task instructions to investigate and document without changing behavior.
  **Update**: `isCEOccludingWall()` itself is left untouched, but a new sibling
  function `isCEOccludingWallLiteral()` (`src/render/webglDraw.ts`, exported via
  the `webglrenderer.ts` barrel) now reproduces the literal CE port exactly as
  it existed at commit `bcd96ca` (single `0x8000000 | 0x80000000` branch, plain
  `fOD`, no `extFlags===0x2000` special case). It's wired up as a third egg
  mode, `setEggMode('ce-literal')`, using the same `egg.png` mask rendering
  path as `'egg'` mode so the two are visually A/B-comparable in-browser.
  `eggDebug()` now logs both predicates side by side per object (`egg=… ceLiteral=…`,
  flagged `(DIFF)` on disagreement) — this is the practical tool for resolving
  the bit-30/31 question above once real proto data is loaded.
  **Update 2**: a fourth egg mode, `setEggMode('bbox')`, adds a DH2-original
  alternative that sidesteps the `extendedFlags` bit question entirely —
  `isBBoxOccludingWall()` (`src/render/webglDraw.ts`, also exported via the
  barrel) tests actual screen-space sprite-rect overlap (via the existing
  `Renderer.objectRenderInfo()`) gated by the same `hexIsInFrontOf` draw-order
  depth check `Obj.ts`'s `objectZCompare()` uses for real z-sorting, instead of
  branching on the proto's orientation flags at all. It's not a CE port — CE
  never did this — so it isn't "more correct" relative to CE, just a different,
  geometrically-grounded heuristic that's immune to the bit-30/31 ambiguity
  above by construction. `eggDebug()` now logs all three predicates per object
  (`egg=… ceLiteral=… bbox=…`), flagging `(DIFF)` whenever any of the three
  disagree.

## 9. Gaps / TODOs

- Determine whether any real Fallout 2 wall/scenery proto sets bit 31
  (`0x80000000`) without bit 27 (`0x8000000`), and separately whether any sets
  bit 30 (`0x40000000`) at all — this requires an actual extracted
  `proto/pro.json` (or `data/proto/walls/*.pro`/`scenery/*.pro`), which is not
  present in this checkout. Until sampled, the severity of the bit-30/31
  substitution (§8) cannot be downgraded from "confirmed deviation, unknown
  real-world impact" to either "silent no-op" or "actively wrong."
  `debugEgg()`'s existing `wallExtendedFlagsSample` field (added during RD16)
  could be extended to specifically report bit-30 and bit-31 incidence.
  `tools/proto.py`'s `extra.extendedFlags` is already extracted, so a one-off
  scan would be a `pipenv run python` script over a real `data/proto/` tree
  with the user's Fallout 2 install, not a code change.
- `_obj_adjust_light`'s rotation tables (§4) are summarized but not exhaustively
  mapped to DH2's own rotation enum / coordinate convention — if DH2 ever
  implements directional light blocking (currently it does not appear to; out
  of scope for this audit), that mapping needs its own pass.
- `wiki/known_bugs.md` RD16 and `wiki/rendering.md`'s egg section describe the
  pre-bit-30-substitution state as final/fixed. Per task instructions this
  document does not edit those files, but a follow-up sprint that resolves the
  bit-30/31 question (previous bullet) should update RD16's status and append
  an `<!-- audited: YYYY-MM-DD -->` note per `CLAUDE.md`'s maintenance rule.
- `wiki/proto_system.md` PS4 still describes wall/misc `extra` fields as
  unparsed; `tools/proto.py` has had a working `readWall()` since the
  2026-06-18 RD16 sprint (`wiki/known_bugs.md` RD16 entry). That section is
  stale and out of scope here, but is adjacent enough to flag.
