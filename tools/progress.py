# Progress lines for the pipeline GUI's progress bars (tools/pipeline_gui.py).
# Silent unless the environment has DH2_PROGRESS=1, which the GUI sets, so the
# command-line output of tools/setup.py stays as it was. One line each:
#
#   @@stage <i> <n> <name>          stage i of n (1-based) starts
#   @@step <index> <total> <label>  the running stage works on item index (0-based)
#                                   of total; total 0 = it cannot count

import os
import sys
import time

ENABLED = os.environ.get("DH2_PROGRESS") == "1"
INTERVAL = 0.1  # seconds between two @@step lines (the last one always goes out)

_last = 0.0


def _emit(line):
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def stage(index, count, name):
    global _last
    if ENABLED:
        _last = 0.0
        _emit("@@stage %d %d %s" % (index, count, name))


def step(index, total, label=""):
    """Working on item index (0-based) of total; label names it. Rate-limited,
    except for the last item, so a bar never stops short of its end."""
    global _last
    if not ENABLED:
        return
    now = time.monotonic()
    if index < total - 1 and now - _last < INTERVAL:
        return
    _last = now
    _emit("@@step %d %d %s" % (index, total, " ".join(str(label).split())))


def busy(label=""):
    """The stage is working on something it cannot count."""
    global _last
    if ENABLED:
        _last = 0.0
        _emit("@@step 0 0 %s" % " ".join(str(label).split()))
