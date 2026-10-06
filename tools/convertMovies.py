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

# Converts Fallout 2's Interplay .MVE movies (data/art/cuts/*.mve) into
# browser-playable WebM (VP9 + Opus) under art/cuts/, plus a small JSON with the
# MVE timer rate the engine needs to place .SVE subtitles and .CFG fade effects
# (both are keyed by MVE frame number — CE movie.cc movieRenderSubtitles uses
# MVE_rmFrameCounts, which counts timer frames, not decoded images; e.g.
# artimer1.mve decodes to only 2 images but its subtitles run to frame 170).
#
# Requires ffmpeg (with libvpx-vp9/libopus) on PATH or ffmpeg.exe in the project
# root — the same convention as acm2wav.exe for audio.

import json
import os
import shutil
import struct
import subprocess
import sys

MVE_SIGNATURE = b"Interplay MVE File\x1a\x00"


def mveInfo(path):
    """Scan an MVE's chunk/opcode stream. Returns (frame_duration_us, frames,
    width, height) — timer from opcode 0x02 (create timer: u32 rate, u16
    subdivision), frames = count of opcode 0x07 (send buffer to display)."""
    with open(path, "rb") as f:
        data = f.read()
    if not data.startswith(MVE_SIGNATURE):
        raise ValueError("not an Interplay MVE file: %s" % path)
    pos = len(MVE_SIGNATURE) + 6
    frame_us = None
    frames = 0
    width = height = 0
    while pos + 4 <= len(data):
        chunk_size, _chunk_type = struct.unpack_from("<HH", data, pos)
        pos += 4
        end = pos + chunk_size
        while pos + 4 <= end:
            op_size, op_type, _op_version = struct.unpack_from("<HBB", data, pos)
            pos += 4
            body = data[pos:pos + op_size]
            if op_type == 0x00:  # end of stream
                return frame_us, frames, width, height
            if op_type == 0x02 and len(body) >= 6:
                rate, subdivision = struct.unpack_from("<IH", body, 0)
                frame_us = rate * subdivision
            elif op_type == 0x05 and len(body) >= 4:  # init video buffers (in 8x8 blocks)
                w, h = struct.unpack_from("<HH", body, 0)
                width, height = w * 8, h * 8
            elif op_type == 0x07:
                frames += 1
            pos += op_size
        pos = end
    return frame_us, frames, width, height


def findFfmpeg():
    if os.path.exists("ffmpeg.exe"):
        return os.path.abspath("ffmpeg.exe")
    return shutil.which("ffmpeg")


def convertAll(srcDir=os.path.join("data", "art", "cuts"), outDir=os.path.join("art", "cuts"), overwrite=True, verbose=True):
    ffmpeg = findFfmpeg()
    if ffmpeg is None:
        print("WARNING: ffmpeg not found (PATH or project root) - skipping movie conversion")
        return False
    if not os.path.isdir(srcDir):
        print("WARNING: %s not found - run DAT extraction first" % srcDir)
        return False
    os.makedirs(outDir, exist_ok=True)

    for name in sorted(os.listdir(srcDir)):
        if not name.lower().endswith(".mve"):
            continue
        base = os.path.splitext(name)[0].lower()
        src = os.path.join(srcDir, name)
        outVideo = os.path.join(outDir, base + ".webm")
        outInfo = os.path.join(outDir, base + ".json")

        frame_us, frames, width, height = mveInfo(src)
        fps = 1e6 / frame_us if frame_us else 15.0
        with open(outInfo, "w") as fp:
            json.dump({"fps": fps, "frames": frames, "width": width, "height": height}, fp)

        if not overwrite and os.path.exists(outVideo):
            continue
        if verbose:
            print("Converting %s (%dx%d, %d frames @ %.3f fps)..." % (name, width, height, frames, fps))
        cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", src,
               "-c:v", "libvpx-vp9", "-row-mt", "1", "-deadline", "good", "-cpu-used", "5",
               "-crf", "33", "-b:v", "0", "-pix_fmt", "yuv420p",
               "-c:a", "libopus", "-b:a", "96k", outVideo]
        result = subprocess.run(cmd)
        if result.returncode != 0:
            print("WARNING: ffmpeg failed for %s" % name)
    return True


if __name__ == "__main__":
    convertAll(*(sys.argv[1:3]))
