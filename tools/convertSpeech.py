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

# Converts talking-head speech (data/sound/speech/<head>/*.acm) to MP3 under
# audio/speech/<head>/ for the engine's lip-synced dialogue (CE lips.cc
# _lips_make_speech loads SOUND\SPEECH\<head>\<name>.ACM). MP3 instead of WAV
# keeps the ~4,400 s of speech around 35 MB instead of ~385 MB. The .lip files
# stay in data/sound/speech/ and are read by the engine directly.
#
# Requires ffmpeg (its interplay_acm decoder) on PATH or ffmpeg.exe in the
# project root.

import os
import subprocess

from convertMovies import findFfmpeg


def convertAll(srcDir=os.path.join("data", "sound", "speech"), outDir=os.path.join("audio", "speech"), overwrite=True, verbose=True):
    ffmpeg = findFfmpeg()
    if ffmpeg is None:
        print("WARNING: ffmpeg not found (PATH or project root) - skipping speech conversion")
        return False
    if not os.path.isdir(srcDir):
        print("WARNING: %s not found - run DAT extraction first" % srcDir)
        return False

    count = 0
    for head in sorted(os.listdir(srcDir)):
        headDir = os.path.join(srcDir, head)
        if not os.path.isdir(headDir):
            continue
        outHead = os.path.join(outDir, head.lower())
        os.makedirs(outHead, exist_ok=True)
        for name in sorted(os.listdir(headDir)):
            if not name.lower().endswith(".acm"):
                continue
            out = os.path.join(outHead, os.path.splitext(name)[0].lower() + ".mp3")
            if not overwrite and os.path.exists(out):
                continue
            result = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                                     "-i", os.path.join(headDir, name), "-c:a", "libmp3lame", "-b:a", "64k", out])
            if result.returncode != 0:
                print("WARNING: ffmpeg failed for %s" % os.path.join(headDir, name))
            count += 1
        if verbose:
            print("speech: %s done" % head)
    if verbose:
        print("converted %d speech files" % count)
    return True


if __name__ == "__main__":
    convertAll()
