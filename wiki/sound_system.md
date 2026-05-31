# Sound System

Documents the Fallout 2 sound system: ACM audio format, SFX naming conventions, ambient sound, music, and DH2's Web Audio API implementation.

**Ground-truth source:** `raw/fallout2-ce/src/sound_decoder.cc`, `sound_effects_list.cc`, `game_sound.cc`, `game_sound.h`, `audio_file.cc`, `interpreter_extra.cc`
**DH2 implementation:** `src/audio.ts`, `src/soundMap.ts`, `src/scripting.ts`, `src/vm_bridge.ts`, `src/data.ts`, `src/map.ts`

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

### Ambient SFX — `gameSoundBuildAmbientSoundEffectName`

CE source: `game_sound.cc:1354`

```
Format: A{name:6}1   (8 chars)
```

Example: base name `"windhw"` → `"AWINDHW1"`.

### Interface SFX — `gameSoundBuildInterfaceName`

CE source: `game_sound.cc:1370`

```
Format: N{name:6}1   (8 chars)
```

Note: `sfx_build_item_name` (opcode 0x8140) calls `gameSoundBuildInterfaceName` internally — same format, different opcode.

### Scenery SFX — `sfxBuildSceneryName`

CE source: `game_sound.h:75` — `sfxBuildSceneryName(actionType, action, name)`.
Format details not reversed fully; passes through to scenery-specific naming logic.

### Open/Close SFX — `sfxBuildOpenName`

CE source: `game_sound.h:76` — `sfxBuildOpenName(obj, action)`.
Used for door open/close sounds; derives name from object proto.

---

## 4. SFX Playback Pipeline (CE)

CE source: `game_sound.cc` — `soundPlayFile`, `soundEffectLoad`, `soundEffectLoadWithVolume`, `soundEffectPlay`, `soundEffectCallback`.

```
Script calls play_sfx(name)
  → soundPlayFile(name)                      [game_sound.cc:1527]
      → soundEffectLoad(name, nullptr)
          → soundEffectsCacheFileOpen(...)   [sound_effects_cache.cc]
          → soundDecoderInit(...)            [sound_decoder.cc]
      → soundPlay(sound)
          → soundEffectPlay(sound)           [sound.cc]
              → soundEffectCallback on finish (frees Sound*)
```

- All SFX share a single global SFX volume: `gSoundEffectsVolume` (0–`VOLUME_MAX`=32768).
- Master volume: `gMasterVolume`. Music volume: `gMusicVolume`.
- SFX are decoded on-demand from the cache; the cache manages compressed ACM data in memory.
- `soundPlayFile("ib1p1xx1")` / `"toggle"` etc. are the hardcoded UI sounds (inventory barter, etc.).

---

## 5. Ambient Sound (CE)

CE source: `game_sound.cc:2098` — `ambientSoundEffectEventProcess`.

Ambient sound uses the timed event queue (`EVENT_TYPE_GSOUND_SFX_EVENT`):

1. On map enter, `ambientSoundEffectEventProcess(nullptr, nullptr)` is called to prime the queue.
2. Each invocation:
   - Clears existing `GSOUND_SFX_EVENT` events.
   - Picks the next ambient SFX index via `wmSfxRollNextIdx()` (weighted random from worldmap area's SFX list).
   - Schedules the next event with delay `10 × randomBetween(15, 20)` ticks (= 150–200 game ticks).
   - If ambient index ≥ 0 and not in combat: resolves SFX name via `wmSfxIdxName(idx, &fileName)` and calls `soundPlayFile(fileName)`.
   - Enforces a 5000ms real-time cooldown (`_lastTime_1`) to prevent rapid-fire ambient plays.
3. Ambient SFX are suppressed during combat (`isInCombat()` check).

SFX names used here follow the `A{name:6}1` ambient naming convention.

---

## 6. Background Music (CE)

CE source: `game_sound.cc` — `backgroundSoundPlay`, `gBackgroundSound`, `gMusicVolume`.

- One `Sound*` at a time (`gBackgroundSound`).
- Music paths configured in `fallout2.cfg`: `GAME_CONFIG_MUSIC_PATH1_KEY`, `GAME_CONFIG_MUSIC_PATH2_KEY`.
- Music filenames are stored per worldmap area via `wmSetMapMusic(mapIndex, name)` (called from the `set_map_music` scripting opcode, 0x80E2).
- On area transition the engine calls `backgroundSoundPlay()` which resolves the stored name, allocates `gBackgroundSound`, and starts looping playback.
- Volume: `soundSetVolume(gBackgroundSound, (int)(gMusicVolume * 0.94))` — the 0.94 factor reduces music during movies.
- `gMusicVolume` is persisted in `settings.sound.music_volume`.

---

## 7. DH2 Web Audio Implementation

DH2 replaces the entire CE audio stack with Web Audio API + `HTMLAudioElement`. Source: `src/audio.ts`.

### Architecture

```
                  SFX (AudioContext)
┌──────────────────────────────────────────┐
│  fetch → decodeAudioData → AudioBuffer   │
│         source → sfxGainNode             │
│                      ↓                   │
│               masterGainNode             │
│                      ↓                   │
│              AudioContext.destination    │
└──────────────────────────────────────────┘

                Music (HTMLAudioElement)
┌──────────────────────────────────────────┐
│  new Audio('audio/music/*.wav')          │
│  .loop = true                            │
│  .volume = musicVolume × masterVolume    │
└──────────────────────────────────────────┘
```

Music uses `HTMLAudioElement` because streaming and `.loop` are trivial there. SFX uses `AudioContext` + `decodeAudioData` because CE `.wav` files are 22050 Hz — `HTMLAudioElement` plays them at device rate (~44100/48000 Hz) without resampling, causing them to sound ~2× too fast.

### Volume System

Three channels, each 0–100 (UI) normalised to 0.0–1.0 internally:

| Channel | GainNode | Description |
|---------|----------|-------------|
| `master` | `masterGainNode` | Global multiplier; also updates `musicAudio.volume` |
| `sfx` | `sfxGainNode` | SFX-only multiplier |
| `music` | (HTMLAudioElement) | Sets `musicAudio.volume = musicVolume × masterVolume` |

`setVolume(channel, 0–100)` in `HTMLAudioEngine` — `src/audio.ts:223`.

### SFX Loading and Caching

`loadSfx(name)` in `src/audio.ts`:
- Returns cached `AudioBuffer` from `sfxCache` immediately if present.
- Returns `null` immediately if `sfxMissing` (negative cache) contains the name — avoids 404 console spam for repeated missing files (e.g., every burst shot for a weapon with no burst wav).
- Otherwise: `fetch('audio/sfx/' + name + '.wav')` → `ctx.decodeAudioData` → store in `sfxCache`.
- Deduplicates in-flight fetches via `sfxPending` map.

`playSfx(sfx: string)` is fire-and-forget (Promise chain, errors logged).

### Music Loading

`playMusic(music: string)` in `src/audio.ts:150`:
- Creates `new Audio('audio/music/' + music + '.wav')` with `.loop = true`.
- Volume = `musicVolume × masterVolume`.

Music is started on every map load by `src/map.ts:playMapMusic()`, which reads `curMapInfo.music` — a string parsed from `maps/mapinfo.ini` via `src/data.ts`. Music is **not** driven by the `set_map_music` scripting opcode (which is unwired, see §8).

### Ambient SFX

`MapInfo.ambientSfx: [string, number][]` — weighted list of `[stemName, weight]` pairs, parsed from `ambient_sfx = name:weight,name:weight,...` in `maps/mapinfo.ini` (`src/data.ts:257`).

`rollNextSfx()` in `src/audio.ts` picks a weighted random stem. `tick()` plays it once and schedules the next for 15–20 seconds later. DH2 uses wall-clock milliseconds (`performance.now()`), not game ticks like CE.

**Gap vs CE:** DH2 does not suppress ambient SFX during combat.

### Weapon SFX

`playWeaponSfx(soundId, type, material)` in `src/audio.ts`:
- Gets filename from `getWeaponSounds(soundId, material)` in `src/soundMap.ts`.
- **Burst fallback:** if `attack_burst` file is missing (common — many weapons ship without a burst wav), falls back to `attack`.
- **Material-neutral impact fallback:** if the material-specific `wh${id}1${mat}xx1` stem is absent from `sfxLookup`, falls back to `wh${id}1xxx1`.

`src/soundMap.ts:WEAPON_SOUND_IDS` maps weapon sound ID bytes (from proto) to single-char codes used in filenames.

---

## 8. Scripting Opcodes

### CE → DH2 Status

| Opcode | CE name | CE source | Args | DH2 status |
|--------|---------|-----------|------|------------|
| `0x80A3` | `play_sfx` | `interpreter_extra.cc:490` | `name: str` | Wired `vm_bridge.ts:173`, implemented `scripting.ts:1798` |
| `0x80A5` | `sfx_build_open_name` | `interpreter_extra.cc:4401` | `obj, action: int` → `str` | **Not wired** |
| `0x80E2` | `set_map_music` | `interpreter_extra.cc:2064` | `mapIndex: int, name: str` | **Not wired** |
| `0x813B` | `reg_anim_play_sfx` | `interpreter_extra.cc:4253` | `obj, name: str, delay: int` | **Not wired** |
| `0x813D` | `sfx_build_char_name` | `interpreter_extra.cc:4323` | `obj, anim, extra: int` → `str` | **Not wired** |
| `0x813E` | `sfx_build_ambient_name` | `interpreter_extra.cc:4341` | `name: str` → `str` | **Not wired** |
| `0x813F` | `sfx_build_interface_name` | `interpreter_extra.cc:4352` | `name: str` → `str` | **Not wired** |
| `0x8140` | `sfx_build_item_name` | `interpreter_extra.cc:4363` | `name: str` → `str` | **Not wired** |
| `0x8141` | `sfx_build_weapon_name` | `interpreter_extra.cc:4374` | `type, weapon, hitMode, target` → `str` | **Not wired** |
| `0x8142` | `sfx_build_scenery_name` | `interpreter_extra.cc:4388` | `actionType, action, name: str` → `str` | **Not wired** |

### `play_sfx` (0x80A3) — Implemented

CE: `soundPlayFile(name)` → loads ACM, plays once.
DH2: `globalState.audioEngine.playSfx(sfx.toLowerCase())` — fetch + decode + AudioBuffer play.

```typescript
// src/scripting.ts:1798
play_sfx(sfx: string) {
    if (!globalState.audioEngine) return
    globalState.audioEngine.playSfx(sfx.toLowerCase())
}
```

### `set_map_music` (0x80E2) — Not wired

CE: `wmSetMapMusic(mapIndex, string)` — stores music name for a worldmap area index; the name is played by the engine on area entry.

DH2 equivalent: `map.ts:playMapMusic()` reads `mapInfo.music` from the INI (data-driven), ignoring any script-driven overrides entirely.

Scripts that call `set_map_music` at runtime will silently no-op in DH2 (opcode not in `vm_bridge.ts`).

### `sfx_build_*` (0x813D–0x8142, 0x80A5) — Not wired

These name-builder opcodes return a formatted SFX filename string to the script stack. Scripts use the returned name with `play_sfx`. Since none are wired, any script that tries to build and play a contextual SFX (critter footsteps, door opens, weapon hits) will fail silently.

DH2 instead triggers weapon SFX through the engine's `playWeaponSfx` call in `src/combat.ts` (engine-driven, not script-driven).

---

## 9. Asset Paths

| Content | CE path | DH2 path |
|---------|---------|----------|
| SFX files | `data/sound/sfx/*.ACM` | `audio/sfx/*.wav` |
| Music files | `data/sound/music/*.ACM` | `audio/music/*.wav` |
| Speech files | `data/sound/speech/*.ACM` | Not implemented |
| SFX catalogue | `data/sound/sfx/SNDLIST.LST` | `lut/lst/sound_sfx_sndlist.json` |

DH2 ships pre-converted `.wav` files extracted from the ACM pipeline. The ACM decoder itself is not present in DH2; all decoding happens offline in the asset pipeline (`setup.py`).

---

## 10. Known Gaps (DH2 vs CE)

1. **`sfx_build_char_name` (0x813D) not wired** — critter footstep / animation SFX from scripts never play.
2. **`sfx_build_weapon_name` (0x8141) not wired** — scripts that build weapon SFX names manually will silently fail.
3. **`sfx_build_ambient_name` / `sfx_build_interface_name` / `sfx_build_item_name` / `sfx_build_scenery_name` / `sfx_build_open_name` not wired** — ambient and scenery SFX triggered from scripts silently no-op.
4. **`reg_anim_play_sfx` (0x813B) not wired** — scheduled animation-sync SFX from scripts silently no-op.
5. **`set_map_music` (0x80E2) not wired** — script-driven music changes at runtime are silently ignored; DH2 only plays music from map INI data.
6. **Ambient SFX not suppressed during combat** — CE calls `isInCombat()` and skips the ambient play; DH2 `tick()` does not check combat state.
7. **Ambient timing mismatch** — CE schedules ambient SFX with random 150–200 game ticks (queue event); DH2 uses wall-clock 15–20 seconds (`performance.now()`). Ticks ≠ seconds in CE (10 ticks/second means CE plays ambient every 15–20 seconds too, so this gap is minor).
8. **Speech audio absent** — CE has a full speech system (`gSpeechVolume`, `speechPlay`, speech files per dialogue line). DH2 has no speech playback.
9. **SFX volume not script-accessible** — CE has no scripting opcode for volume control (volume is a player preference), and DH2 matches this. Volume is set via the DH2 Preferences UI only.
10. **`reg_anim_play_sfx` not wired** — animation-queued SFX (e.g., weapon take-out sounds timed to anim frames) are not triggered from scripts. Engine-side weapon SFX in combat are covered by `playWeaponSfx`, but scripted `reg_anim_play_sfx` calls are a gap.
