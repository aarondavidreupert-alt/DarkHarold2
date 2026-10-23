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

# Decode a Fallout ACM as the engine plays it: MONO.
#
# CE ref: game_sound.cc:643 — only the background music gets
# soundSetChannels(sound, 3) (stereo); speech and sound effects are played as a
# single mono sample stream whatever the ACM header claims. Many speech ACMs
# carry channels=2 in the header (data/sound/speech/bosss/ssa2.acm: 706990
# samples, 2 ch, 22050 Hz; its .lip counts 1413980 bytes = 706990 mono 16-bit
# samples = 32 s). Decoding those as stereo halves the length and plays twice as
# fast. The decoder (acmDecoder.py, as CE's sound_decoder.cc) emits the samples in
# stream order, so the raw s16 output read back as one channel at the header's rate is
# exactly the stream CE plays.

import struct
import subprocess

import numpy as np

from acmDecoder import AcmError, decode_file, write_wav

ACM_MAGIC = 0x01032897


def acmHeader(path):
    """(samples, channels, rate) from the 14-byte ACM header, or None."""
    with open(path, "rb") as f:
        head = f.read(12)
    if len(head) < 12:
        return None
    magic, samples, channels, rate = struct.unpack("<IIHH", head)
    if magic & 0xFFFFFF != ACM_MAGIC & 0xFFFFFF:
        return None
    return samples, channels, rate


def wavDataChunk(path):
    """The raw bytes of a WAV file's data chunk."""
    with open(path, "rb") as f:
        b = f.read()
    i = 12
    while i + 8 <= len(b):
        cid = b[i:i + 4]
        size = struct.unpack("<I", b[i + 4:i + 8])[0]
        if cid == b"data":
            return b[i + 8:i + 8 + size]
        i += 8 + size + (size & 1)
    return None


def decodeAcmRaw(ffmpeg, src):
    """All decoded s16 samples of `src` in stream order (acmDecoder.py, a port of CE's
    sound_decoder.cc: complete, unlike ffmpeg's decoder, which drops the tail of some
    files with decode errors near EOF). `ffmpeg` is unused, kept for the callers."""
    try:
        return decode_file(src)[2].astype("<i2").tobytes() or None
    except AcmError as e:
        print("WARNING: %s: %s" % (src, e))
        return None


def convertAcmMono(ffmpeg, src, dst, outArgs):
    """Decode `src`, take the samples as one mono stream at the header rate and write
    `dst`: a .wav directly, anything else encoded by ffmpeg with `outArgs` (e.g.
    ["-c:a", "libmp3lame", "-b:a", "64k"]). Returns True on success."""
    header = acmHeader(src)
    rate = header[2] if header and header[2] > 0 else 22050
    raw = decodeAcmRaw(ffmpeg, src)
    if not raw:
        return False
    if dst.lower().endswith(".wav"):
        write_wav(dst, np.frombuffer(raw, "<i2"), rate, 1)
        return True
    if ffmpeg is None:
        return False
    encode = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                             "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", "pipe:0"] + outArgs + [dst],
                            input=raw)
    return encode.returncode == 0
