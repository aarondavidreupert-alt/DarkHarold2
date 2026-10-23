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

# Interplay ACM decoder, a port of CE's sound_decoder.cc (soundDecoderInit,
# ReadBands, ReadBand_Fmt*, untransform_all, soundDecoderDecode).
#
# Replaces acm2wav.exe and ffmpeg's interplay_acm decoder in the pipeline. ffmpeg
# stops with "Decoding error" / "Too large b" near the end of many SFX and drops
# their last block (up to ~0.1 s); CE never fails there because its bit reader
# (soundDecoderReadNextChunk) feeds zero bytes once the file runs out. This
# decoder does the same, so every file decodes to its header's sample count.
#
# Returns the raw sample stream in decode order. For mono/speech/SFX that is the
# stream CE plays (see acmMono.py); for music it is interleaved L/R.

import struct

import numpy as np

# init_pack_tables
_PACK3_3 = [0] * 32
_PACK5_3 = [0] * 128
_PACK11_2 = [0] * 128
for _i in range(3):
    for _j in range(3):
        for _m in range(3):
            _PACK3_3[_i + _j * 3 + _m * 9] = _i + _j * 4 + _m * 16
for _i in range(5):
    for _j in range(5):
        for _m in range(5):
            _PACK5_3[_i + _j * 5 + _m * 25] = _i + _j * 8 + _m * 64
for _i in range(11):
    for _j in range(11):
        _PACK11_2[_i + _j * 11] = _i + _j * 16

_SCALE_OFS = 32768  # _AudioDecoder_scale0 sits in the middle of a 64K-short table


class AcmError(Exception):
    pass


class _Reader:
    """The LSB-first bit stream of soundDecoderRequireBits / DropBits, zero past EOF
    (soundDecoderReadNextChunk memsets the buffer when the read returns 0)."""

    def __init__(self, data, pad):
        self.data = bytes(data) + bytes(pad + 8)
        self.pos = 0  # bit position

    def peek(self, n):
        p = self.pos
        i = p >> 3
        return (int.from_bytes(self.data[i:i + 4], "little") >> (p & 7)) & ((1 << n) - 1)

    def take(self, n):
        v = self.peek(n)
        self.pos += n
        return v


def _juggle(m, wrap):
    """juggle() of untransform_subband0 / untransform_subband over one level: rows of
    `m` in pairs, each output depending only on the old values of the previous pair
    (wrap = the pair before the first). Returns the new wrap (last old pair)."""
    even = m[0::2].copy()
    odd = m[1::2].copy()
    prev_even = np.concatenate((wrap[0][None, :], even[:-1]))
    prev_odd = np.concatenate((wrap[1][None, :], odd[:-1]))
    m[0::2] = 2 * prev_odd + prev_even + even
    m[1::2] = 2 * even - prev_odd - odd
    return [even[-1].copy(), odd[-1].copy()]


def decode(data):
    """Decode ACM bytes. Returns (channels, rate, samples) with samples an int16 numpy
    array of the header's sample count, in stream order."""
    if len(data) < 14:
        raise AcmError("file too short")
    magic, file_cnt, channels, rate = struct.unpack_from("<IIHH", data, 0)
    if magic & 0xFFFFFF != 0x032897 or (magic >> 24) != 1:
        raise AcmError("not an ACM file")
    word = struct.unpack_from("<H", data, 12)[0]
    levels = word & 0x0F
    rows = word >> 4  # samples_per_subband
    cols = 1 << levels  # subbands
    total = rows * cols
    if total == 0:
        return channels, rate, np.zeros(file_cnt, np.int16)

    blocks = (file_cnt + total - 1) // total
    # Worst case per block: 20 header bits, 5 per band, 16 per sample.
    worst = (blocks * (20 + cols * 5 + total * 16) + 7) // 8
    rd = _Reader(data, max(0, worst - len(data)))
    rd.pos = 14 * 8

    step = max(1, 2048 // cols - 2)  # block_samples_per_subband
    scale = np.zeros(65536, np.int16)
    samples = np.zeros((rows, cols), np.int32)
    # prev_samples: level 0 keeps its wrap pair as shorts (untransform_subband0),
    # the deeper levels as ints (untransform_subband).
    wraps = []
    sub_len = cols // 2
    while sub_len >= 1 and levels:
        wraps.append([np.zeros(sub_len, np.int32), np.zeros(sub_len, np.int32)])
        sub_len //= 2

    out = []
    remaining = file_cnt
    while remaining > 0:
        ok = _read_bands(rd, samples, rows, cols, levels, scale)
        if ok and levels:
            _untransform_all(samples, rows, cols, step, wraps)
        n = min(total, remaining)
        flat = samples.reshape(-1)[:n]
        out.append(((flat >> levels) & 0xFFFF).astype(np.uint16).view(np.int16))
        remaining -= n
    return channels, rate, np.concatenate(out)


def _read_bands(rd, samples, rows, cols, levels, scale):
    """ReadBands: the block's scale table, then one coded column per subband.
    False when a band reader returns 0 (ReadBand_Fail, ReadBand_Fmt31)."""
    pwr = rd.take(4)
    val = rd.take(16)
    n = 1 << pwr
    # Written through an unsigned short*, read through short*: values wrap at 16 bits.
    ks = np.arange(n, dtype=np.int64)
    scale[_SCALE_OFS:_SCALE_OFS + n] = (ks * val).astype(np.uint16).view(np.int16)
    scale[_SCALE_OFS - n:_SCALE_OFS] = (-(ks[::-1] + 1) * val).astype(np.uint16).view(np.int16)

    for col in range(cols):
        fmt = rd.take(5)
        if fmt == 0:
            samples[:, col] = 0
        elif 3 <= fmt <= 16:
            _fmt_fixed(rd, samples, col, rows, fmt, scale)
        elif fmt == 31:
            _fmt31(rd, samples, rows, cols, levels)
            return False
        elif fmt in _VARIABLE:
            samples[:, col] = _VARIABLE[fmt](rd, rows, scale)
        else:
            return False
    return True


def _fmt_fixed(rd, samples, col, rows, bits, scale):
    """ReadBand_Fmt3_16: `bits`-wide codes, base = scale0 - 2^(bits-1)."""
    pos = rd.pos + np.arange(rows, dtype=np.int64) * bits
    idx = pos >> 3
    buf = np.frombuffer(rd.data, np.uint8)
    word = (buf[idx].astype(np.uint32) | (buf[idx + 1].astype(np.uint32) << 8)
            | (buf[idx + 2].astype(np.uint32) << 16))
    code = (word >> (pos & 7).astype(np.uint32)) & ((1 << bits) - 1)
    samples[:, col] = scale[_SCALE_OFS - (1 << (bits - 1)) + code.astype(np.int64)]
    rd.pos += rows * bits


def _fmt31(rd, samples, rows, cols, levels):
    """ReadBand_Fmt31 (Russian localisations): raw 16-bit samples, already transformed."""
    flat = samples.reshape(-1)
    for i in range(rows * cols):
        v = rd.take(16)
        flat[i] = ((v ^ 0x8000) - 0x8000) << levels


def _s(scale, k):
    return int(scale[_SCALE_OFS + k])


def _fmt17(rd, rows, s):
    out = []
    p1, m1 = _s(s, 1), _s(s, -1)
    while len(out) < rows:
        v = rd.peek(3)
        if not v & 1:
            rd.pos += 1
            out.extend((0, 0))
        elif not v & 2:
            rd.pos += 2
            out.append(0)
        else:
            rd.pos += 3
            out.append(p1 if v & 4 else m1)
    return out[:rows]


def _fmt18(rd, rows, s):
    out = []
    p1, m1 = _s(s, 1), _s(s, -1)
    while len(out) < rows:
        v = rd.peek(2)
        if not v & 1:
            rd.pos += 1
            out.append(0)
        else:
            rd.pos += 2
            out.append(p1 if v & 2 else m1)
    return out


def _fmt19(rd, rows, s):
    out = []
    t = [_s(s, k - 1) for k in range(4)]
    while len(out) < rows:
        v = _PACK3_3[rd.take(5)]
        out.extend((t[v & 3], t[(v >> 2) & 3], t[v >> 4]))
    return out[:rows]


def _fmt20(rd, rows, s):
    out = []
    t = {k: _s(s, k) for k in (-2, -1, 1, 2)}
    while len(out) < rows:
        v = rd.peek(4)
        if not v & 1:
            rd.pos += 1
            out.extend((0, 0))
        elif not v & 2:
            rd.pos += 2
            out.append(0)
        else:
            rd.pos += 4
            if v & 8:
                out.append(t[2] if v & 4 else t[1])
            else:
                out.append(t[-1] if v & 4 else t[-2])
    return out[:rows]


def _fmt21(rd, rows, s):
    out = []
    t = {k: _s(s, k) for k in (-2, -1, 1, 2)}
    while len(out) < rows:
        v = rd.peek(3)
        if not v & 1:
            rd.pos += 1
            out.append(0)
        else:
            rd.pos += 3
            if v & 4:
                out.append(t[2] if v & 2 else t[1])
            else:
                out.append(t[-1] if v & 2 else t[-2])
    return out


def _fmt22(rd, rows, s):
    out = []
    t = [_s(s, k - 2) for k in range(8)]
    while len(out) < rows:
        v = _PACK5_3[rd.take(7)]
        out.extend((t[v & 7], t[(v >> 3) & 7], t[v >> 6]))
    return out[:rows]


def _fmt23(rd, rows, s):
    out = []
    t = {k: _s(s, k) for k in (-3, -2, -1, 1, 2, 3)}
    while len(out) < rows:
        v = rd.peek(5)
        if not v & 1:
            rd.pos += 1
            out.extend((0, 0))
        elif not v & 2:
            rd.pos += 2
            out.append(0)
        elif not v & 4:
            rd.pos += 4
            out.append(t[1] if v & 8 else t[-1])
        else:
            rd.pos += 5
            k = (v >> 3) & 3
            out.append(t[(k + 3 if k >= 2 else k) - 3])
    return out[:rows]


def _fmt24(rd, rows, s):
    out = []
    t = {k: _s(s, k) for k in (-3, -2, -1, 1, 2, 3)}
    while len(out) < rows:
        v = rd.peek(4)
        if not v & 1:
            rd.pos += 1
            out.append(0)
        elif not v & 2:
            rd.pos += 3
            out.append(t[1] if v & 4 else t[-1])
        else:
            rd.pos += 4
            k = (v >> 2) & 3
            out.append(t[(k + 3 if k >= 2 else k) - 3])
    return out


def _fmt26(rd, rows, s):
    out = []
    t = {k: _s(s, k) for k in range(-4, 5)}
    while len(out) < rows:
        v = rd.peek(5)
        if not v & 1:
            rd.pos += 1
            out.extend((0, 0))
        elif not v & 2:
            rd.pos += 2
            out.append(0)
        else:
            rd.pos += 5
            k = (v >> 2) & 7
            out.append(t[(k + 1 if k >= 4 else k) - 4])
    return out[:rows]


def _fmt27(rd, rows, s):
    out = []
    t = {k: _s(s, k) for k in range(-4, 5)}
    while len(out) < rows:
        v = rd.peek(4)
        if not v & 1:
            rd.pos += 1
            out.append(0)
        else:
            rd.pos += 4
            k = (v >> 1) & 7
            out.append(t[(k + 1 if k >= 4 else k) - 4])
    return out


def _fmt29(rd, rows, s):
    out = []
    t = [_s(s, k - 5) for k in range(16)]
    while len(out) < rows:
        v = _PACK11_2[rd.take(7)]
        out.extend((t[v & 0x0F], t[v >> 4]))
    return out[:rows]


_VARIABLE = {17: _fmt17, 18: _fmt18, 19: _fmt19, 20: _fmt20, 21: _fmt21, 22: _fmt22,
             23: _fmt23, 24: _fmt24, 26: _fmt26, 27: _fmt27, 29: _fmt29}


def _untransform_all(samples, rows, cols, step, wraps):
    """untransform_all: per chunk of `step` rows, subband0 (+1 on the first column of
    each half-row), then the deeper subbands, each halving sub_len."""
    flat = samples.reshape(-1)
    row = 0
    while row < rows:
        n = min(step, rows - row)
        region = flat[row * cols:(row + n) * cols]
        sub_len = cols // 2
        sub_count = n * 2
        m = region.reshape(sub_count, sub_len)
        w = wraps[0]
        new = _juggle(m, w)
        # untransform_subband0 stores its wrap pair as shorts.
        wraps[0] = [x.astype(np.int16).astype(np.int32) for x in new]
        m[:, 0] += 1
        level = 1
        while sub_len > 1:
            sub_len //= 2
            sub_count *= 2
            m = region.reshape(sub_count, sub_len)
            wraps[level] = _juggle(m, wraps[level])
            level += 1
        row += n


def decode_file(path):
    with open(path, "rb") as f:
        return decode(f.read())


def write_wav(path, samples, rate, channels=1):
    """16-bit PCM WAV of `samples` (int16, interleaved when channels > 1)."""
    pcm = samples.astype("<i2").tobytes()
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE")
        f.write(b"fmt " + struct.pack("<IHHIIHH", 16, 1, channels, rate,
                                      rate * channels * 2, channels * 2, 16))
        f.write(b"data" + struct.pack("<I", len(pcm)) + pcm)
