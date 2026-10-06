"""
Copyright 2015 darkf

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

# Parser/converter for Fallout 1 (partially) and 2 .MAP files to a JSON format

from __future__ import print_function
from io import BufferedReader
import sys, os, struct, json
from typing import Any, Dict

FO1_MODE = None # global
DATA_DIR = None # global
SCRIPT_TYPES = ["s_system", "s_spatial", "s_time", "s_item", "s_critter"]

mapScriptPIDs: list[Dict[int, Any]] = [{} for _ in range(5)]

def read16(f) -> int:
    return struct.unpack("!h", f.read(2))[0]

def readU16(f) -> int:
    return struct.unpack("!H", f.read(2))[0]

def read32(f) -> int:
    return struct.unpack("!l", f.read(4))[0]

def readU32(f) -> int:
    return struct.unpack("!L", f.read(4))[0]

def stripExt(path):
    return os.path.splitext(path)[0]

def pidType(pid):
    return (pid >> 24) & 0xff

def getNumLevels(elevationFlags):
    if elevationFlags & 8:
        if elevationFlags & 4:
            return 1
        return 2
    return 3

def fromTileNum(tileNum):
    return {"x": tileNum % 200, "y": tileNum // 200}

def blankTileMap():
    # 100x100 2D array
    return [[0]*100 for _ in range(100)]

def getProSubType(path):
    with open(os.path.join(DATA_DIR, path), "rb") as f:
        f.seek(0x20)
        return readU32(f)

def parseTiles(f, numLevels):
    # parse floor/roof tiles
    floorTiles = [blankTileMap() for _ in range(numLevels)]
    roofTiles = [blankTileMap() for _ in range(numLevels)]

    # read interspersed roof/floor tiles
    for level in range(numLevels):
        for i in range(10000):
            x = i % 100; y = i // 100

            # reversed on the x axis because Fallout maps are normally reversed
            roofTiles[level][y][99 - x] = readU16(f)
            floorTiles[level][y][99 - x] = readU16(f)

    return floorTiles, roofTiles

def parseMapScripts(f, scriptLst: list[bytes]):
    totalScriptCount = 0
    spatials = []

    for scriptType in range(5):
        scriptCount = read32(f)

        print("%d %s scripts" % (scriptCount, SCRIPT_TYPES[scriptType]))

        totalScriptCount += scriptCount

        if scriptCount > 0:
            loop = scriptCount
            if loop % 16:
                loop = scriptCount + (16 - scriptCount % 16)

            check = 0
            for i in range(loop):
                pid = readU32(f)
                pid_type = pidType(pid)

                # TODO: find out more about the format of these
                unk1 = readU32(f)

                # for spatials
                tileNum = None
                spatialRange = None

                if pid_type in (1, 2): # s_spatial/s_time
                    tileNum = readU32(f)
                if pid_type == 1: # s_spatial
                    spatialRange = readU32(f)

                unk2 = readU32(f)
                scriptID = readU32(f)
                unk3 = readU32(f)
                f.read(4 * 11) # unknown

                pidID = pid & 0xffff

                if i < scriptCount:
                    # we're in the range of valid scripts

                    if pid_type == 1: # spatial scripts
                        if spatialRange > 50:
                            # this is a hack because, presumably due to this entire
                            # procedure being undocumented hacks that need better
                            # reverse engineering, we get garbage that is not
                            # actually a valid script.
                            # filter them out here.

                            print("invalid spatial script range:", spatialRange, " i=", i)
                            print("script ID:", scriptID)
                        elif scriptID < 0 or scriptID >= len(scriptLst):
                            # Unused maps (newr1a/newr2a) carry spatial entries whose script
                            # index is past the end of scripts.lst; skip them like CE does
                            # when scriptGetScript() fails, instead of aborting the export.
                            print("spatial script ID out of range:", scriptID, " i=", i)
                        else:
                            #print "script id:", script.spatialScriptID, "or", (script.spatialScriptID & 0xffff)
                            scriptName = stripExt(scriptLst[scriptID].decode('ascii').split()[0])
                            spatials.append({"tileNum": tileNum & 0xffff,
                                             "elevation": ((tileNum >> 28) & 0xf) >> 1,
                                             "range": spatialRange,
                                             "scriptID": scriptID,
                                             "script": scriptName})
                            print("spatial:", spatials[-1])

                    if scriptID > 0 and scriptID < len(scriptLst):
                        scriptName = stripExt(scriptLst[scriptID]).split()[0]
                        mapScriptPIDs[scriptType][pidID] = scriptName

                if (i % 16) == 15:
                    check += readU32(f)
                    read32(f) # unknown

            if check != scriptCount:
                raise ValueError("script check failed (check=%d, scriptCount=%d)" % (check, scriptCount))

    return {"count": totalScriptCount, "spatials": spatials, "mapScriptPIDs": mapScriptPIDs}

# Critter animation IDs used by the FID → filename mapping (CE animation.h).
ANIM_WALK = 1
ANIM_DODGE_ANIM = 13
ANIM_THROW_ANIM = 18
ANIM_FALL_BACK = 20                 # FIRST_KNOCKDOWN_AND_DEATH_ANIM
ANIM_ELECTRIFY = 27
ANIM_BURNED_TO_NOTHING = 29
ANIM_ELECTRIFIED_TO_NOTHING = 30
ANIM_FIRE_DANCE = 33
ANIM_PRONE_TO_STANDING = 36
ANIM_BACK_TO_STANDING = 37
ANIM_TAKE_OUT = 38
ANIM_FIRE_CONTINUOUS = 47
ANIM_FALL_BACK_SF = 48              # FIRST_SF_DEATH_ANIM
ANIM_ELECTRIFY_SF = 55
ANIM_BURNED_TO_NOTHING_SF = 57
ANIM_ELECTRIFIED_TO_NOTHING_SF = 58
ANIM_CALLED_SHOT_PIC = 64
WEAPON_ANIMATION_KNIFE = 1
WEAPON_ANIMATION_SPEAR = 4
WEAPON_ANIMATION_COUNT = 11

# Animations that CE redirects to the critter's alias art (critters.lst 2nd field).
ALIASED_ANIMS = (ANIM_ELECTRIFY, ANIM_BURNED_TO_NOTHING, ANIM_ELECTRIFIED_TO_NOTHING,
                 ANIM_ELECTRIFY_SF, ANIM_BURNED_TO_NOTHING_SF, ANIM_ELECTRIFIED_TO_NOTHING_SF,
                 ANIM_FIRE_DANCE, ANIM_CALLED_SHOT_PIC)

def artGetCode(animation, weaponType):
    """Port of CE art.cc:544 _art_get_code(). Returns (weaponCode, animCode) or None."""
    if weaponType < 0 or weaponType >= WEAPON_ANIMATION_COUNT:
        return None
    if ANIM_TAKE_OUT <= animation <= ANIM_FIRE_CONTINUOUS:
        if weaponType == 0:
            return None
        return chr(ord('d') + weaponType - 1), chr(ord('c') + animation - ANIM_TAKE_OUT)
    if animation == ANIM_PRONE_TO_STANDING:
        return 'c', 'h'
    if animation == ANIM_BACK_TO_STANDING:
        return 'c', 'j'
    if animation == ANIM_CALLED_SHOT_PIC:
        return 'n', 'a'
    if animation >= ANIM_FALL_BACK_SF:
        return 'r', chr(ord('a') + animation - ANIM_FALL_BACK_SF)
    if animation >= ANIM_FALL_BACK:
        return 'b', chr(ord('a') + animation - ANIM_FALL_BACK)
    if animation == ANIM_THROW_ANIM:
        if weaponType == WEAPON_ANIMATION_KNIFE:
            return 'd', 'm'
        if weaponType == WEAPON_ANIMATION_SPEAR:
            return 'g', 'm'
        return 'a', 's'
    if animation == ANIM_DODGE_ANIM:
        if weaponType <= 0:
            return 'a', 'n'
        return chr(ord('d') + weaponType - 1), 'e'
    animCode = chr(ord('a') + animation)
    if animation <= ANIM_WALK and weaponType > 0:
        return chr(ord('d') + weaponType - 1), animCode
    return 'a', animCode

def getCritterArtPath(frmPID, critterLst: list[bytes]):
    """Port of CE art.cc:615 artBuildFilePath() for OBJ_TYPE_CRITTER, including
    the artAliasFid() (art.cc:904) redirect for electrify/burn/fire-dance/called-shot
    animations. Previously this raised "reindex" for those animations, which made
    whole maps (e.g. mbase34, klacanyn) fail to export."""
    rotation = (frmPID & 0x70000000) >> 28
    anim = (frmPID & 0x00ff0000) >> 16
    weaponType = (frmPID & 0x0000f000) >> 12
    idx = frmPID & 0x00000fff

    if anim in ALIASED_ANIMS:
        fields = critterLst[idx].decode('ascii').strip().split(",")
        if len(fields) > 1 and fields[1].strip():
            idx = int(fields[1])
        else:
            # CE falls back to the vault-dweller art (hmjmps) when no alias is given.
            names = [l.decode('ascii').split(",")[0].strip().lower() for l in critterLst]
            idx = names.index("hmjmps")

    code = artGetCode(anim, weaponType)
    if code is None:
        raise Exception("no art code for anim=%d weapon=%d" % (anim, weaponType))

    path = "art/critters/" + critterLst[idx].decode('ascii').split(",")[0].strip().lower()
    path += code[0] + code[1]
    path += ".frm" if not rotation else ".fr" + chr(rotation + 47)
    return path

def parseItemObj(f, frmPID, protoPID, itemsLst, itemsProtoLst):
    item = {"type": "item",
            "artPath": "art/items/" + (stripExt(itemsLst[frmPID & 0xffff]).decode('ascii'))
           }
    subtype = getProSubType("proto/items/" + itemsProtoLst[(protoPID & 0xffff) - 1].decode('ascii'))
    
    if subtype == 4: # ammo
        item["subtype"] = "ammo"
        item["ammoCount"] = readU32(f)
    elif subtype == 3: # weapon
        item["subtype"] = "weapon"
        # CE proto.cc:585 objectDataRead - weapon.ammoQuantity, weapon.ammoTypePid
        item["ammoQuantity"] = read32(f)
        item["ammoTypePid"] = read32(f)
    elif subtype == 1: # container
        item["subtype"] = "container"
    elif subtype == 0: # armor
        item["subtype"] = "armor"
    elif subtype == 2: # drug
        item["subtype"] = "drug"
    elif subtype == 5: # misc
        item["subtype"] = "misc"
        f.read(4) # unknown?
    elif subtype == 6: # key
        item["subtype"] = "key"
        f.read(4) # unknown?

    return item

def parseObject(f, lstFiles: dict[str, list[bytes]]):
    f.read(4) # unknown (separator)
    position = read32(f)
    f.read(4*4) # unknown

    frameNum = readU32(f)
    orientation = readU32(f)
    frmPID = readU32(f)
    flags = readU32(f)
    elevation = readU32(f)

    protoPID = readU32(f)
    objType = (protoPID >> 24) & 0xff

    f.read(4) # unknown
    lightRadius = readU32(f)
    lightIntensity = readU32(f)

    f.read(4) # unknown
    mapPID = readU32(f)
    scriptID = read32(f)
    numInventory = readU32(f)
    f.read(4*3) # unknown

    # extra (per-type) object info
    extra = {}
    art = None
    namedType = ""

    # TODO: we should have a lookupArt function instead of looking them up directly here

    if objType == 0: # item
        extra = parseItemObj(f, frmPID, protoPID, lstFiles["items"], lstFiles["proto_items"])
        namedType = "item"
        art = extra["artPath"]

        del extra["artPath"]
        del extra["type"]

    elif objType == 3: # wall
        namedType = "wall"
        art = "art/walls/" + stripExt(lstFiles["walls"][frmPID & 0xffff].decode('ascii'))

    elif objType == 1: # critter
        namedType = "critter"
        art = stripExt(getCritterArtPath(frmPID, lstFiles["critters"]))

        f.read(4*4)
        extra["AInum"] = read32(f)
        extra["groupID"] = readU32(f)
        f.read(4)
        extra["hp"] = readU32(f)
        f.read(4*2)

    elif objType == 2: # scenery
        namedType = "scenery"
        art = "art/scenery/" + stripExt(lstFiles["scenery"][frmPID & 0xffff].decode('ascii'))
        proto_scenery = lstFiles["proto_scenery"]
        subtype = getProSubType("proto/scenery/" + (proto_scenery[(protoPID & 0xffff) - 1]).decode('ascii'))

        """
        # TODO: why have this? this just goes into the real "extra" field anyway
        # may as well set the properties on extra (which should be renamed to item or something)
        _extra = {}
        extra["extra"] = _extra
        """

        if subtype == 0: # door
            extra["subtype"] = "door"
            f.read(4) # unknown?
        elif subtype == 2: # elevator
            extra["subtype"] = "elevator"
            extra["type"] = readU32(f)
            extra["level"] = readU32(f)
        elif subtype == 1: # stairs
            extra["subtype"] = "stairs"
            extra["destination"] = read32(f)
            extra["destinationMap"] = read32(f)
        elif subtype in (3, 4): # ladder up/down
            if not FO1_MODE: # FO2
                extra["unknown1"] = read32(f)
                extra["destination"] = read32(f)
            else: # FO1
                extra["destination"] = read32(f) # XXX / TODO: verify
        else: # generic scenery
            extra["subtype"] = "generic"

    elif objType == 5: # misc
        namedType = "misc"
        art = "art/misc/" + stripExt(lstFiles["misc"][frmPID & 0xffff].decode('ascii'))

        # exit grids
        if (protoPID & 0xffff) != 1 and (protoPID & 0xffff) != 12:
            extra["exitMapID"] = read32(f)
            extra["startingPosition"] = read32(f)
            extra["startingElevation"] = read32(f)
            extra["startingOrientation"] = readU32(f)

    inventory = []
    for _ in range(numInventory):
        amount = readU32(f)
        invenObj = parseObject(f, lstFiles)
        invenObj["amount"] = amount
        inventory.append(invenObj)

    obj =  {"type": namedType,
            "pid": protoPID,
            "pidID": protoPID & 0xffff,
            "frmPID": frmPID,
            "flags": flags,
            "position": fromTileNum(position),
            "orientation": orientation,
            "lightRadius": lightRadius,
            "lightIntensity": lightIntensity,
            "inventory": inventory
           }

    if art:
        obj["art"] = art.lower()

    if extra:
        obj["extra"] = extra

        if "subtype" in extra:
            obj["subtype"] = extra["subtype"]

    #if "extra" in extra:
    #    obj["extra"] = extra["extra"]

    #if "artPath" in extra:
    #    obj["art"] = extra["artPath"].lower()

    if scriptID != -1:
        scriptName = stripExt(lstFiles["scripts"][scriptID].decode('ascii').split()[0])
        obj["script"] = scriptName
    elif scriptID == -1 and mapPID != 0xFFFFFFFF:
        # try to use the script IDs mapped in parseMapScripts
        scriptType = (mapPID >> 24) & 0xff
        scriptPID = mapPID & 0xffff
        print("using map script for %s (script PID %d)" % (art, scriptPID))
        scriptName = mapScriptPIDs[scriptType][scriptPID].decode('ascii')
        print("(map script %d type %d = %s)" %  (scriptPID, scriptType, scriptName))
        obj["script"] = scriptName

    return obj

def parseLevelObjects(f, lstFiles: dict[str, list[bytes]]):
    numObjects = readU32(f)
    return [parseObject(f, lstFiles) for _ in range(numObjects)]

def parseMapObjects(f, numLevels, lstFiles: dict[str, list[bytes]]):
    numObjects = readU32(f)
    return [parseLevelObjects(f, lstFiles) for _ in range(numLevels)]

def parseMap(f: BufferedReader, lstFiles: dict[str, list[bytes]]):
    global FO1_MODE

    version = readU32(f)
    if version == 19:
        namedVersion = "FO1"
        FO1_MODE = True
    elif version == 20:
        namedVersion = "FO2"
        FO1_MODE = False
    else:
        raise ValueError("not a FO1 or FO2 map")

    mapName = f.read(16).decode('ascii')
    mapName = mapName[:mapName.index('\0')]
    playerPosition = read32(f)
    playerElevation = read32(f)
    playerOrientation = read32(f)
    numLocalVars = read32(f)
    mapScriptID = read32(f)
    elevationFlags = read32(f)
    numLevels = getNumLevels(elevationFlags)
    unk1 = read32(f)
    numGlobalVars = read32(f)
    mapID = read32(f)
    time = readU32(f)
    f.read(4*44) # unk2

    gvars = [read32(f) for _ in range(numGlobalVars)]
    lvars = [read32(f) for _ in range(numLocalVars)]

    floorTiles, roofTiles = parseTiles(f, numLevels)

    scripts = parseMapScripts(f, lstFiles["scripts"])
    objects = parseMapObjects(f, numLevels, lstFiles)

    print("version:", version, namedVersion)
    print("name: %r" % mapName)

    # parse levels
    levels = []

    def transformTile(idx):
        return stripExt(lstFiles["tiles"][idx].decode('ascii').rstrip()).lower()

    def transformTileMap(tileMap):
        return [[transformTile(idx) for idx in row] for row in tileMap]

    for level in range(numLevels):
        levels.append({"tiles": {"floor": transformTileMap(floorTiles[level]),
                                 "roof": transformTileMap(roofTiles[level])
                                },
                       "spatials":  [x for x in scripts["spatials"] if x["elevation"] == level],
                       "objects": objects[level]
                      })

    # return map
    return {"version": namedVersion,
            "mapID": mapID,
            "name": mapName,
            "levels": levels,
            "startPosition": fromTileNum(playerPosition),
            "startElevation": playerElevation,
            "startOrientation": playerOrientation
           }

def readLst(dataDir, path):
    with open(os.path.join(dataDir, path), "rb") as f:
        return [x.rstrip() for x in list(f)]

def getImageList(map):
    images = set()

    for levels in map["levels"]:
        for tilemap in levels["tiles"].values():
            for row in tilemap:
                for tile in row:
                    images.add("art/tiles/" + tile)

        # TODO: objects

    return list(images)

def exportMap(dataDir: str, mapFile: str, outFile: str, verbose=False):
    global DATA_DIR

    DATA_DIR = dataDir # TODO: make this not global

    lstFiles = {"tiles": readLst(DATA_DIR, "art/tiles/tiles.lst"),
                "scenery": readLst(DATA_DIR, "art/scenery/scenery.lst"),
                "proto_scenery": readLst(DATA_DIR, "proto/scenery/scenery.lst"),
                "items": readLst(DATA_DIR, "art/items/items.lst"),
                "proto_items": readLst(DATA_DIR, "proto/items/items.lst"),
                "misc": readLst(DATA_DIR, "art/misc/misc.lst"),
                "walls": readLst(DATA_DIR, "art/walls/walls.lst"),
                "critters": readLst(DATA_DIR, "art/critters/critters.lst"),
                "scripts": readLst(DATA_DIR, "scripts/scripts.lst")
               }

    with open(mapFile, "rb") as fin:
        # Parse before opening the output: a parse failure used to leave a
        # 0-byte .json behind, which the engine then failed to load.
        map = parseMap(fin, lstFiles)
        with open(outFile, "w") as fout:
            if verbose: print("writing %s..." % outFile)
            json.dump(map, fout)

            # write image list
            if verbose: print("writing image list...")
            with open(stripExt(outFile) + ".images.json", "w") as fimg:
                json.dump(getImageList(map), fimg)

            if verbose: print("done")

def main():
    global DATA_DIR

    if len(sys.argv) < 3:
        print("USAGE: %s DATA_DIR MAP_FILE [OUT_FILE]" % sys.argv[0])
        print("DATA_DIR should be the base directory where the .DATs are extracted")
        return

    DATA_DIR = sys.argv[1]
    MAP_FILE = sys.argv[2]
    MAP_NAME = os.path.basename(MAP_FILE).lower()
    OUT_FILE = os.path.join("maps", stripExt(MAP_NAME) + ".json") # default path
    if len(sys.argv) == 4:
        OUT_FILE = sys.argv[3]

    exportMap(DATA_DIR, MAP_FILE, OUT_FILE, verbose=True)

if __name__ == '__main__':
    main()