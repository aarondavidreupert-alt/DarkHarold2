import glob, os, subprocess

from acmMono import convertAcmMono
from convertMovies import findFfmpeg

# Sound effects: decoded MONO via ffmpeg, as CE plays them (game_sound.cc — only
# the background music is stereo; see acmMono.py). acm2wav decoded every ACM as
# stereo, which made the SFX play at double speed.
def convertSfxDir(ffmpeg, inDir, outDir):
    os.makedirs(outDir, exist_ok=True)
    for path in glob.glob(os.path.join(inDir, "*.[Aa][Cc][Mm]")):
        basename = os.path.splitext(os.path.basename(path))[0]
        outpath = os.path.join(outDir, basename.lower() + ".wav")
        print(path)
        if not convertAcmMono(ffmpeg, path, outpath, ["-c:a", "pcm_s16le"]):
            print("WARNING: ffmpeg failed for %s" % path)

# Music keeps the header's (stereo) layout: acm2wav when present, else ffmpeg.
def convertMusicDir(ffmpeg, inDir, outDir):
    os.makedirs(outDir, exist_ok=True)
    useAcm2wav = os.path.exists("acm2wav.exe")
    for path in glob.glob(os.path.join(inDir, "*.[Aa][Cc][Mm]")):
        basename = os.path.splitext(os.path.basename(path))[0]
        result = basename.lower() + ".wav"
        outpath = os.path.join(outDir, result)
        print(path)
        if useAcm2wav:
            subprocess.call(["acm2wav", path], stdout=subprocess.PIPE)
            if not os.path.exists(result):
                print("result file (%s) not found!" % result)
            else:
                os.replace(result, outpath)
        elif ffmpeg:
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", path, "-c:a", "pcm_s16le", outpath])

def main():
	ffmpeg = findFfmpeg()
	if ffmpeg is None:
		print("need ffmpeg (PATH or ffmpeg.exe in the project root)")
		return
	if not os.path.exists("data/sound/sfx"):
		print("need SFX/")
		return

	convertSfxDir(ffmpeg, "data/sound/sfx", "audio/sfx")
	convertMusicDir(ffmpeg, "data/sound/music", "audio/music")

	print("done!")

if __name__ == '__main__': main()
