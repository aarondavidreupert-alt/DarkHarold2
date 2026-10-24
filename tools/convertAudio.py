import glob, os

import progress

from acmDecoder import AcmError, decode_file, write_wav
from acmMono import convertAcmMono

# ACM -> WAV with tools/acmDecoder.py (a port of CE's sound_decoder.cc); no ffmpeg or
# acm2wav.exe needed. ffmpeg's interplay_acm decoder drops the last block of some
# files (decode errors near EOF); CE's decoder reads zeros past EOF and doesn't.

# Sound effects: decoded MONO, as CE plays them (game_sound.cc — only the
# background music is stereo; see acmMono.py). acm2wav decoded every ACM as
# stereo, which made the SFX play at double speed.
def convertSfxDir(inDir, outDir):
    os.makedirs(outDir, exist_ok=True)
    paths = glob.glob(os.path.join(inDir, "*.[Aa][Cc][Mm]"))
    for i, path in enumerate(paths):
        basename = os.path.splitext(os.path.basename(path))[0]
        outpath = os.path.join(outDir, basename.lower() + ".wav")
        print(path)
        progress.step(i, len(paths), "sfx/" + basename)
        if not convertAcmMono(None, path, outpath, []):
            print("WARNING: could not decode %s" % path)

# Music keeps the header's (stereo) layout: the decoded stream is interleaved L/R.
def convertMusicDir(inDir, outDir):
    os.makedirs(outDir, exist_ok=True)
    paths = glob.glob(os.path.join(inDir, "*.[Aa][Cc][Mm]"))
    for i, path in enumerate(paths):
        basename = os.path.splitext(os.path.basename(path))[0]
        outpath = os.path.join(outDir, basename.lower() + ".wav")
        print(path)
        progress.step(i, len(paths), "music/" + basename)
        try:
            channels, rate, samples = decode_file(path)
        except AcmError as e:
            print("WARNING: could not decode %s: %s" % (path, e))
            continue
        write_wav(outpath, samples, rate, max(1, channels))

def main():
	if not os.path.exists("data/sound/sfx"):
		print("need SFX/")
		return

	convertSfxDir("data/sound/sfx", "audio/sfx")
	convertMusicDir("data/sound/music", "audio/music")

	print("done!")

if __name__ == '__main__': main()
