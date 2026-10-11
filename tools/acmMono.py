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
# fast. Both decoders (acm2wav, ffmpeg's interplay_acm) emit the samples in stream
# order, so the raw s16 output read back as one channel at the header's rate is
# exactly the stream CE plays.

import os
import struct
import subprocess
import tempfile

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
    """All decoded s16 samples of `src` in stream order. acm2wav.exe (project root)
    decodes every file completely but labels everything stereo, which doesn't matter
    for the raw stream; ffmpeg's decoder drops the tail of some files (decode errors
    near EOF), so it is the fallback."""
    acm2wav = os.path.abspath("acm2wav.exe")
    if os.path.exists(acm2wav):
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run([acm2wav, os.path.abspath(src)], cwd=tmp, stdout=subprocess.PIPE)
            out = os.path.join(tmp, os.path.splitext(os.path.basename(src))[0] + ".wav")
            if not os.path.exists(out):
                outs = [f for f in os.listdir(tmp) if f.lower().endswith(".wav")]
                out = os.path.join(tmp, outs[0]) if outs else None
            if out:
                data = wavDataChunk(out)
                if data:
                    return data
    if ffmpeg is None:
        return None
    decode = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-max_error_rate", "1.0", "-i", src,
                             "-f", "s16le", "-c:a", "pcm_s16le", "pipe:1"],
                            stdout=subprocess.PIPE)
    return decode.stdout or None


def convertAcmMono(ffmpeg, src, dst, outArgs):
    """Decode `src`, take the samples as one mono stream at the header rate and encode
    to `dst` with `outArgs` (e.g. ["-c:a", "pcm_s16le"]). Returns True on success."""
    header = acmHeader(src)
    rate = header[2] if header and header[2] > 0 else 22050
    raw = decodeAcmRaw(ffmpeg, src)
    if not raw:
        return False
    encode = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                             "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", "pipe:0"] + outArgs + [dst],
                            input=raw)
    return encode.returncode == 0
