import glob, os, subprocess, shutil

FFMPEG = shutil.which("ffmpeg") or "ffmpeg.exe"

def convertDir(inDir, outDir):
    os.makedirs(outDir, exist_ok=True)
    for path in glob.glob(os.path.join(inDir, "*.[Aa][Cc][Mm]")):
        basename = os.path.splitext(os.path.basename(path))[0]
        result = basename.lower() + ".wav"
        outpath = os.path.join(outDir, result)

        print(path)

        subprocess.call(["acm2wav", path], stdout=subprocess.PIPE)

        if not os.path.exists(result):
            print("result file (%s) not found!" % result)
        else:
            # Fix sample rate to 22050 Hz using ffmpeg (if available)
            if FFMPEG and os.path.exists(FFMPEG) or shutil.which("ffmpeg"):
                tmp = result + ".tmp.wav"
                ret = subprocess.call(
                    [FFMPEG, "-y", "-i", result, "-ar", "22050", tmp],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                )
                if ret == 0:
                    os.replace(tmp, result)
                else:
                    print("ffmpeg failed for %s, keeping original" % result)
            else:
                print("ffmpeg not found, skipping sample rate fix for %s" % result)

            if not os.path.exists(outpath):
                os.rename(result, outpath)

            # Verify sample rate
            ret2 = subprocess.run(
                [FFMPEG, "-i", outpath],
                stderr=subprocess.PIPE, stdout=subprocess.DEVNULL
            )
            info = ret2.stderr.decode()
            hz = [l for l in info.splitlines() if "Hz" in l]
            print("  →", hz[0].strip() if hz else "unknown sample rate")

def main():
	if not os.path.exists("acm2wav.exe"):
		print("need acm2wav.exe")
		return
	if not os.path.exists("data/sound/sfx"):
		print("need SFX/")
		return

	if not os.path.exists("audio"):
		os.mkdir("audio")

	if not os.path.exists("audio/sfx"):
		os.mkdir("audio/sfx")

	if not os.path.exists("audio/music"):
		os.mkdir("audio/music")

	convertDir("data/sound/sfx", "audiotest/sfx")
	convertDir("data/sound/music", "audiotest/music")

	print("done!")

if __name__ == '__main__': main()