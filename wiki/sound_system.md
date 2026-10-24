# Sound System

Documents the Fallout 2 sound system: ACM audio format, SFX naming conventions, ambient sound, music, and DH2's Web Audio API implementation.

**Ground-truth source:** `raw/fallout2-ce/src/sound_decoder.cc`, `sound_effects_list.cc`, `game_sound.cc`, `game_sound.h`, `audio_file.cc`, `audio.cc`, `audio_engine.cc`, `interpreter_extra.cc`
**DH2 implementation:** `src/audio.ts`, `src/soundMap.ts`, `src/scripting.ts`, `src/vm_bridge.ts`, `src/data.ts`, `src/map/GameMap.ts`

---

## 1. ACM Audio Format

Fallout 2 ships all SFX and music as `.ACM` files — Interplay's proprietary compressed audio format. A secondary uncompressed `.SND` format also exists but is rarely used in practice.

CE decoder: `raw/fallout2-ce/src/sound_decoder.cc` — `soundDecoderInit`, `soundDecoderDecode`, `soundDecoderFree`.

### File Header

Parsed bit-by-bit via a bit-accumulator (`hold`/`bits` fields in `SoundDecoder`):

| Field | Size | Value |
|-------|------|-------|
| Magic number | 24 bits | `0x32897` (LE) — must match exactly |
| Version | 8 bits | `1` — must equal 1 |
| `file_cnt` | 32 bits | Total sample count (low 16 then high 16) |
| `channels` | 16 bits | 1 = mono, 2 = stereo |
| `rate` | 16 bits | Sample rate in Hz (typically 22050) |
| `levels` | 4 bits | Subband tree depth |
| `samples_per_subband` | 12 bits | Samples per leaf subband |

Derived values (computed in `soundDecoderInit`):
```
subbands                = 1 << levels
total_samples           = samples_per_subband × subbands
block_samples_per_subband = max(1, 2048/subbands − 2)
block_total_samples     = block_samples_per_subband × subbands
```

### Codec: Subband DPCM

ACM uses a hierarchical subband DPCM codec. Each block of `block_total_samples` is decoded with `ReadBands()`:

- A 32-entry dispatch table `_ReadBand_tbl[32]` selects one of 15 format handlers (`ReadBand_Fmt0`, `ReadBand_Fmt3_16`, `ReadBand_Fmt17`–`ReadBand_Fmt27`, `ReadBand_Fmt29`, `ReadBand_Fmt31`; formats 1-2, 25, 28, 30 are `ReadBand_Fail`).
- After reading, `untransform_all()` applies inverse subband transforms: `untransform_subband0` for the root band, `untransform_subband` for inner bands.
- Output: 16-bit signed PCM (little-endian), interleaved if stereo.

The input bit stream is read in 512-byte chunks (`SOUND_DECODER_IN_BUFFER_SIZE = 512`), via a caller-supplied `SoundDecoderReadProc` callback. This lets the same decoder work from file handles, memory buffers, or the SFX cache.

### SoundDecoder Struct

```c
// sound_decoder.h
typedef struct SoundDecoder {
    SoundDecoderReadProc* readProc;  // caller-supplied read callback
    void* data;                       // opaque handle passed to readProc
    unsigned char* bufferIn;          // 512-byte input chunk
    int remainingInSize;              // bytes left in current chunk
    int hold;                         // bit accumulator
    int bits;                         // valid bits in accumulator
    int levels;                       // subband tree depth
    int subbands;                     // = 1 << levels
    int samples_per_subband;
    int total_samples;                // = samples_per_subband × subbands
    int block_samples_per_subband;
    int block_total_samples;
    int channels;
    int rate;
    int file_cnt;                     // total sample count from header
    // ... prev_samples, samples, samp_ptr, samp_cnt
} SoundDecoder;
```

### AudioFile Wrapper

`raw/fallout2-ce/src/audio_file.cc` — `AudioFile` wraps either an ACM `SoundDecoder` or a raw `FILE*`:

```c
#define AUDIO_FILE_COMPRESSED 0x02
```

`audioFileOpen` tries the `queryCompressedFunc` hook (returns non-null if `.ACM` exists), then falls back to raw `.SND`. `audioFileRead` dispatches to `soundDecoderDecode` or `fread` accordingly.

---

## 2. SFX List (SNDLIST.LST)

CE loads its SFX catalogue from `SNDLIST.LST` at game startup.

CE source: `raw/fallout2-ce/src/sound_effects_list.cc` — `soundEffectsListInit`.

### Format

Text file, one entry per line after a count header:
```
<name>   <dataSize>   <fileSize>   <tag>
```

- `name` — stem (no extension), max 8 chars
- `dataSize` — decoded PCM byte count = `2 × sampleCount` (16-bit samples)
- `fileSize` — on-disk compressed byte count
- `tag` — integer handle = `2 × index + 2` (index is 0-based entry position)

Entries are sorted alphabetically and binary-searched for lookup. If `SNDLIST.LST` is absent, CE falls back to enumerating `*.ACM`/`*.SND` files from the SFX directory.

`soundDecoderInit` is called on each entry during list build to measure `sampleCount`; the decoder is freed immediately after — no audio data is cached at list-load time.

### DH2 Equivalent

DH2 ships a pre-baked JSON version: `lut/lst/sound_sfx_sndlist.json` (a dict keyed by uppercase stem). Used in `src/audio.ts` (`playSfxByName`, `playWeaponSfx`) to validate stems before attempting fetch, avoiding console spam on missing files.

---

## 3. SFX Naming Conventions

All SFX filenames are 8 chars (+ null), uppercase in the catalogue, lowercase on disk. CE builds names via helper functions in `raw/fallout2-ce/src/game_sound.cc`.

### Weapon SFX — `sfxBuildWeaponName`

CE source: `game_sound.cc:1374`

```
Format: W{type}{code}{variant}{material}XX1
```

| Position | Meaning | Values |
|----------|---------|--------|
| `W` | Fixed prefix | — |
| `type` | Effect type | `A`=attack, `H`=hit/impact, `R`=reload, `O`=out-of-ammo, `F`=ammo-flying |
| `code` | Weapon sound ID | Single char from proto `weapon_sound_id` byte; see `soundMap.ts:WEAPON_SOUND_IDS` |
| `variant` | Fire mode | `1`=primary or ready/empty, `2`=burst |
| `material` | Target surface | `F`=flesh, `M`=metal/glass/plastic, `W`=wood, `S`=stone/dirt/cement, `X`=no-material |
| `XX` | Literal padding | Always `XX` |
| `1` | Literal suffix | Always `1` |

Material selection logic: only applies to `HIT` effect type and only when target is a valid object. For explosive/plasma/EMP damage types and non-critter targets without a matching material type, materialCode = `'X'`.

**Examples** (weapon code `'f'` for Minigun):
- Attack primary: `WAF1FXXX1` → `waf1fxx1` (wait, that's 9 chars -- let me recount)

Corrected count: `W` + type(1) + code(1) + variant(1) + material(1) + `X`(1) + `X`(1) + `1`(1) = 8 chars total.

Attack with no-material: `WAf1XXX1` → hmm. Let me spell out: W, A, f, 1, X, X, X, 1 = `WAF1XXX1` (8 chars). CE format string: `"W%c%c%1d%cXX%1d"` = W + type + code + variant + material + X + X + 1 — that's 8 chars. When material = `'X'`: result is `W{type}{code}{variant}XXX1`.

DH2 naming (from `src/soundMap.ts`) mirrors CE exactly:

| CE effect | DH2 key | Formula |
|-----------|---------|---------|
| `ATTACK` primary | `attack` | `wa${id}1xxx1` |
| `ATTACK` primary alt | `attack_alt` | `wa${id}1xxx2` |
| `ATTACK` burst | `attack_burst` | `wa${id}2xxx1` |
| `HIT` | `impact` | `wh${id}1${mat}xx1` |
| `READY`/`RELOAD` | `reload` | `wr${id}1xxx1` |
| `OUT_OF_AMMO` | `empty` | `wo${id}1xxx1` |

All lowercase on disk; CE uppercases via `compat_strupr`.

### Critter/Character SFX — `sfxBuildCharName`

CE source: `game_sound.cc:1318`

```
Format: {fid_name}{v8}{v9}   (8 chars total)
```

- `fid_name` — 6-char base filename from `artCopyFileName(FID_TYPE(fid), fid & 0xFFF, ...)`
- `v8`, `v9` — two animation code letters from `_art_get_code(anim, weaponAnimCode, &v8, &v9)`

Special overrides:
- `ANIM_FALL_FRONT` / `ANIM_FALL_BACK` + `CHARACTER_SOUND_EFFECT_PASS_OUT` → `v8 = 'Y'`
- `ANIM_FALL_FRONT` / `ANIM_FALL_BACK` + `CHARACTER_SOUND_EFFECT_DIE` → `v8 = 'Z'`
- `ANIM_THROW_PUNCH` / `ANIM_KICK_LEG` + `CHARACTER_SOUND_EFFECT_CONTACT` → `v8 = 'Z'`

`CHARACTER_SOUND_EFFECT` enum values: `UNUSED`, `KNOCKDOWN`, `PASS_OUT`, `DIE`, `CONTACT`.

### Ambient SFX

`MapInfo.ambientSfx` is maps.txt `ambient_sfx = name:chance, …`. `HTMLAudioEngine.tick()` (game ticks) is CE `ambientSoundEffectEventProcess`: every `10 × random(15, 20)` game ticks the sfx rolled last time plays — not in combat, and not within 5 s of real time of the previous one — and the next is rolled (`rollNextSfx` = `wmSfxRollNextIdx`: a roll past the last chance gives none).

### Weapon SFX

`playWeaponSfx(soundId, type, material)` in `src/audio.ts`:
- Gets filename from `getWeaponSounds(soundId, material)` in `src/soundMap.ts`.
- **Burst fallback:** if `attack_burst` file is missing (common — many weapons ship without a burst wav), falls back to `attack`.
- **Material-neutral impact fallback:** if the material-specific `wh${id}1${mat}xx1` stem is absent from `sfxLookup`, falls back to `wh${id}1xxx1`.

`src/soundMap.ts:WEAPON_SOUND_IDS` maps weapon sound ID bytes (from proto) to single-char codes used in filenames.

---

## 8. Scripting Opcodes

### CE → DH2 Status

All sound opcodes are wired (see `scripting_reference.md` §4): `play_sfx` (0x80A3), `sfx_build_open_name` (0x80A5), `set_map_music` (0x80E2), `reg_anim_play_sfx` (0x813B, only inside a reg_anim batch as CE `_check_registry`), `sfx_build_char_name` / `ambient` / `interface` / `item` / `weapon` / `scenery` (0x813D–0x8142) — the name builders port CE `sfxBuild*` / `gameSoundBuild*` (`src/scripting.ts`, `src/sfxNames.ts`).

---

## 9. Asset Paths

| Content | CE path | DH2 path |
|---------|---------|----------|
| SFX files | `data/sound/sfx/*.ACM` | `audio/sfx/*.wav` |
| Music files | `data/sound/music/*.ACM` | `audio/music/*.wav` |
| Speech files | `data/sound/speech/<head>/*.ACM` | `audio/speech/<head>/*.mp3` (+ `.lip` lip-sync, `src/talkingHead.ts`) |
| SFX catalogue | `data/sound/sfx/SNDLIST.LST` | `lut/lst/sound_sfx_sndlist.json` |

DH2 ships pre-converted `.wav` files extracted from the ACM pipeline. The ACM decoder itself is not present in DH2; all decoding happens offline in the asset pipeline (`tools/setup.py`).

---

## 10. Known Gaps (DH2 vs CE)

| Area | CE | DH2 |
|---|---|---|
| Decoding | ACM decoded at runtime | Pre-converted to WAV / MP3 by the pipeline (browser-safe; same sound) |

Music outside maps (2026-10-24, known_bugs PA23): the world map plays `23world` (`20car` in the car, CE `wmInterfaceInit`), the main menu `07desert` (CE `main.cc`), and a map without a `music=` entry keeps CE's `wind2` (`mapLoad`).

Everything else in this doc is implemented (opcodes, map / script music, ambient timing and combat silence, speech with lip-sync, volumes from fallout2.cfg / Preferences). <!-- audited: 2026-10-18 -->
