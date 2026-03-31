import glob, os, subprocess

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
        elif not os.path.exists(outpath):
            os.rename(result, outpath)

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

	convertDir("data/sound/sfx", "audio/sfx")
	convertDir("data/sound/music", "audio/music")

	print("done!")

if __name__ == '__main__': main()