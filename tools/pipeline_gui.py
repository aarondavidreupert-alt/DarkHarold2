"""
Copyright 2026

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

# Graphical front-end for tools/setup.py — the DarkHarold2 asset extraction
# pipeline. Lets you pick a Fallout 2 install directory, choose which
# pipeline stages to run, whether to overwrite already-generated output, and
# whether to delete the raw source files (FRM/PRO/MAP/ACM) once converted —
# they're not needed for a real install, just for re-running the pipeline.
#
# This script only needs the standard library (tkinter) to launch — it
# shells out to `tools/setup.py` as a subprocess using the same Python
# interpreter, rather than importing it directly, so a missing numpy/Pillow
# or a setup_check() failure (which calls sys.exit()) only ends the child
# process and never crashes the GUI itself.
#
# The output panel keeps every line and shows them through a filter: errors
# and warnings only, stage summaries (per-file progress hidden), or
# everything. "Copy shown" / "Save log..." hand over just what is shown.
#
# Two progress bars: the whole run (stage i of n) and the running stage
# (file i of n, or a moving bar while it cannot count). setup.py and its
# converters print "@@stage" / "@@step" lines for them when DH2_PROGRESS=1
# (tools/progress.py); they never reach the log.
#
# Cancel stops the run (setup.py and its children) and offers to remove the
# files the run wrote under the output folders.

import glob
import os
import queue
import re
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, ttk

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETUP_PY = os.path.join(PROJECT_ROOT, "tools", "setup.py")

# Stage id -> (checkbox label, default checked?). Order matches the
# pipeline's actual execution order in tools/setup.py's STAGES dict.
STAGES = [
    ("crit_table", "Parse critical hit table (from fallout2.exe)", True),
    ("extract_dats", "Extract DAT archives (master.dat / critter.dat)", True),
    ("export_images", "Export images (FRM -> PNG)", True),
    ("stitch_worldmap", "Stitch the world map (art/worldmap.png)", True),
    ("export_fonts", "Export fonts (AAF/FON -> PNG atlas)", True),
    ("export_pros", "Export prototypes (PRO -> JSON)", True),
    ("export_maps", "Export maps (MAP -> JSON)", True),
    ("convert_lsts", "Convert LST files (-> lut/lst/*.json)", True),
    ("convert_endgame", "Convert endgame slide data", True),
    ("convert_gam", "Convert global/map variables (GAM -> JSON)", True),
    ("decompile_scripts", "Decompile scripts to Lua (INT -> LUA)", True),
    ("write_config", "Write default fallout2.cfg (keeps an existing one)", True),
    ("build_mods", "Build mod folders from the install's mods (mods/mods_order.txt -> mods/<name>/)", True),
    ("export_audio", "Convert audio (ACM -> WAV)", True),
    ("export_movies", "Convert movies (MVE -> WebM, needs ffmpeg)", True),
    ("export_speech", "Convert talking-head speech (ACM -> MP3, needs ffmpeg)", True),
]
STAGE_LABELS = {stage_id: label for stage_id, label, _ in STAGES}
STAGE_LABELS["delete_originals"] = "Delete original source files"

# Mirrors tools/setup.py's DELETE_ORIGINALS_GLOBS — kept duplicated rather
# than imported so this GUI never needs numpy/Pillow just to launch and
# preview a delete count.
DELETE_ORIGINALS_GLOBS = [
    "data/art/**/*.frm",
    "data/art/**/*.fr[0-9]",
    "data/proto/**/*.pro",
    "data/maps/*.map",
    "data/sound/**/*.acm",
    "data/sound/**/*.ACM",
]


def count_originals():
    # *.acm and *.ACM match the same files on Windows: dedupe (as setup.py).
    found = {}
    for pattern in DELETE_ORIGINALS_GLOBS:
        for path in glob.glob(os.path.join(PROJECT_ROOT, pattern), recursive=True):
            found.setdefault(os.path.normcase(os.path.abspath(path)), path)
    return list(found.values())


# --- Cancel + clean-up ---
# Where the pipeline writes its output (tools/setup.py stages). A cancelled run
# offers to remove what it wrote there, found by comparing against a snapshot
# taken just before the run; git-tracked files are never removed.
OUTPUT_ROOTS = ["data", "art", "proto", "maps", "lut", "audio", "mods"]
OUTPUT_ROOT_FILES = ["fallout2.cfg", "worldmap.png"]


def snapshot_outputs():
    """{relative path: mtime_ns} of every file under the output roots."""
    snap = {}

    def walk(path):
        try:
            with os.scandir(path) as it:
                for entry in it:
                    if entry.is_dir(follow_symlinks=False):
                        walk(entry.path)
                    elif entry.is_file(follow_symlinks=False):
                        try:
                            snap[os.path.relpath(entry.path, PROJECT_ROOT)] = entry.stat().st_mtime_ns
                        except OSError:
                            pass
        except OSError:
            pass

    for root in OUTPUT_ROOTS:
        walk(os.path.join(PROJECT_ROOT, root))
    for name in OUTPUT_ROOT_FILES:
        path = os.path.join(PROJECT_ROOT, name)
        if os.path.isfile(path):
            snap[name] = os.stat(path).st_mtime_ns
    return snap


def tracked_files():
    """Git-tracked paths (normcased, relative), or None without git."""
    try:
        out = subprocess.run(["git", "ls-files", "-z"], cwd=PROJECT_ROOT, capture_output=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return {os.path.normcase(os.path.normpath(p)) for p in out.stdout.decode("utf-8", "replace").split("\0") if p}


def written_since(before):
    """(new, overwritten) files under the output roots relative to `before`,
    git-tracked files left out."""
    after = snapshot_outputs()
    tracked = tracked_files() or set()
    new, changed = [], []
    for rel, mtime in after.items():
        if os.path.normcase(os.path.normpath(rel)) in tracked:
            continue
        if rel not in before:
            new.append(rel)
        elif before[rel] != mtime:
            changed.append(rel)
    return new, changed


def remove_files(rels):
    """Delete the files, then the directories that became empty. Returns (removed, failed)."""
    removed, failed = 0, 0
    dirs = set()
    for rel in rels:
        path = os.path.join(PROJECT_ROOT, rel)
        try:
            os.remove(path)
            removed += 1
            dirs.add(os.path.dirname(path))
        except OSError:
            failed += 1
    roots = {os.path.normcase(os.path.join(PROJECT_ROOT, r)) for r in OUTPUT_ROOTS} | {os.path.normcase(PROJECT_ROOT)}
    for d in sorted(dirs, key=len, reverse=True):
        while os.path.normcase(d) not in roots and d.startswith(PROJECT_ROOT):
            try:
                os.rmdir(d)  # only succeeds when empty
            except OSError:
                break
            d = os.path.dirname(d)
    return removed, failed


def kill_tree(proc):
    """Stop setup.py and everything it started (image-export worker pool, ffmpeg)."""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        import signal
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except OSError:
            proc.terminate()


# --- Log filtering ---
# Each output line gets a level; the panel shows lines up to the chosen one.
LEVEL_ERROR, LEVEL_INFO, LEVEL_DETAIL = 0, 1, 2
VERBOSITY = [
    ("Errors & warnings only", LEVEL_ERROR),
    ("Normal (stage summaries)", LEVEL_INFO),
    ("Verbose (every file)", LEVEL_DETAIL),
]

_ERROR_RE = re.compile(r"\b(error|warning|failed|failure|exception|traceback|not found|out of range|"
                       r"invalid|could not|cannot|missing)\b", re.IGNORECASE)
# Per-file progress lines of the converters (tools/setup.py and friends).
_DETAIL_RE = re.compile(
    r"^(\[\d+/\d+\] |"                         # [12/12220] art/...
    r"data[/\\]sound[/\\]|"                     # ACM being converted
    r"spatial: |-?\d+ s_\w+ scripts|"           # map script listing
    r"version: |name: '|"                       # map header
    r"using map script |\(map script |"
    r"Converting map |Converting \S+\.mve |"
    r"speech: \S+ done|"
    r"  \S+: -?\d+ map vars -> |"
    r"scanning directories|processing \d+|"
    r"Parsing global vars from|  Found \d+ global|  Wrote )")
# Hex addresses / ids that make otherwise identical lines differ (ffmpeg's
# "[interplayacm @ 000001c2b8b38600]").
_HEX_RE = re.compile(r"\b(0x)?[0-9a-fA-F]{8,}\b")


class LineClassifier:
    """Levels for a stream of lines. A Python traceback (header, indented lines,
    the exception line) is an error as a whole."""

    def __init__(self):
        self.in_traceback = False

    def level(self, line):
        text = line.rstrip("\r\n")
        # anywhere in the line: stderr and stdout lines interleave unflushed
        # ("...out of range: 67108947Traceback (most recent call last):")
        if "Traceback (most recent call last)" in text:
            self.in_traceback = True
            return LEVEL_ERROR
        if self.in_traceback:
            if text.strip() and not text[:1].isspace():
                self.in_traceback = False  # the exception line ends it
            return LEVEL_ERROR
        if _ERROR_RE.search(text):
            return LEVEL_ERROR
        if _DETAIL_RE.match(text):
            return LEVEL_DETAIL
        return LEVEL_INFO


class PipelineGUI:
    def __init__(self, root):
        self.root = root
        root.title("DarkHarold2 Asset Pipeline")
        root.geometry("1280x720")

        self.proc = None
        self.out_queue = queue.Queue()
        self.lines = []  # (level, text) of the whole run
        self.classifier = LineClassifier()
        self.last_shown = None  # (normalised text, repeat count) for collapsing
        self.before = {}  # snapshot_outputs() taken when the run started
        self.cancelled = False

        pad = {"padx": 8, "pady": 4}

        # two columns: the settings and Run on the left, progress and output on the right
        left = ttk.Frame(root)
        left.pack(side="left", fill="y", padx=(4, 0), pady=4)
        right = ttk.Frame(root)
        right.pack(side="left", fill="both", expand=True, padx=(0, 4), pady=4)

        # --- Install dir picker ---
        dir_frame = ttk.Frame(left)
        dir_frame.pack(fill="x", **pad)
        ttk.Label(dir_frame, text="Fallout 2 install directory:").pack(side="left")
        self.install_dir_var = tk.StringVar()
        ttk.Entry(dir_frame, textvariable=self.install_dir_var).pack(side="left", fill="x", expand=True, padx=6)
        ttk.Button(dir_frame, text="Browse...", command=self.browse_dir).pack(side="left")

        # --- Stage checkboxes ---
        stages_frame = ttk.LabelFrame(left, text="Pipeline stages")
        stages_frame.pack(fill="x", **pad)
        self.stage_vars = {}
        for stage_id, label, default in STAGES:
            var = tk.BooleanVar(value=default)
            self.stage_vars[stage_id] = var
            ttk.Checkbutton(stages_frame, text=label, variable=var).pack(anchor="w", padx=8)

        select_frame = ttk.Frame(stages_frame)
        select_frame.pack(anchor="w", padx=8, pady=(2, 6))
        ttk.Button(select_frame, text="Select All", command=lambda: self.set_all_stages(True)).pack(side="left", padx=(0, 6))
        ttk.Button(select_frame, text="Select None", command=lambda: self.set_all_stages(False)).pack(side="left")

        # --- Options ---
        options_frame = ttk.LabelFrame(left, text="Options")
        options_frame.pack(fill="x", **pad)

        self.overwrite_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            options_frame,
            text="Overwrite already-generated output files\n(unchecked = skip a stage whose output already exists)",
            variable=self.overwrite_var,
        ).pack(anchor="w", padx=8, pady=(4, 2))

        self.delete_originals_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            options_frame,
            text="Delete original source files after conversion\n(FRM/PRO/MAP/ACM under data/ — not needed for a real install)",
            variable=self.delete_originals_var,
        ).pack(anchor="w", padx=8, pady=(2, 4))

        self.no_mods_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            options_frame,
            text="Vanilla game: build no mod folders from the install's mods\n(mods/mods_order.txt, e.g. the Unofficial Patch)",
            variable=self.no_mods_var,
        ).pack(anchor="w", padx=8, pady=(2, 4))

        # --- Run controls ---
        run_frame = ttk.Frame(left)
        run_frame.pack(fill="x", **pad)
        self.run_button = ttk.Button(run_frame, text="Run", command=self.on_run)
        self.run_button.pack(side="left")
        self.cancel_button = ttk.Button(run_frame, text="Cancel", command=self.on_cancel, state="disabled")
        self.cancel_button.pack(side="left", padx=(6, 0))
        self.status_var = tk.StringVar(value="Idle")
        ttk.Label(run_frame, textvariable=self.status_var).pack(side="left", padx=10)

        # --- Progress ---
        progress_frame = ttk.LabelFrame(right, text="Progress")
        progress_frame.pack(fill="x", **pad)
        progress_frame.columnconfigure(1, weight=1)
        ttk.Label(progress_frame, text="Overall:").grid(row=0, column=0, sticky="w", padx=(8, 4), pady=(4, 0))
        self.overall_bar = ttk.Progressbar(progress_frame, mode="determinate", maximum=1000)
        self.overall_bar.grid(row=0, column=1, sticky="ew", padx=(0, 8), pady=(4, 0))
        self.overall_var = tk.StringVar(value="")
        ttk.Label(progress_frame, textvariable=self.overall_var).grid(row=1, column=1, sticky="w", pady=(0, 4))
        ttk.Label(progress_frame, text="Current:").grid(row=2, column=0, sticky="w", padx=(8, 4))
        self.current_bar = ttk.Progressbar(progress_frame, mode="determinate", maximum=1000)
        self.current_bar.grid(row=2, column=1, sticky="ew", padx=(0, 8))
        self.current_var = tk.StringVar(value="")
        # fixed width: a long file name must not resize the window
        ttk.Label(progress_frame, textvariable=self.current_var, width=60).grid(row=3, column=1, sticky="w", pady=(0, 6))
        self.stage_index = 0  # @@stage i of n: the running stage (1-based), 0 = none yet
        self.stage_count = 0
        self.stage_name = ""
        self.current_busy = False

        # --- Log output ---
        log_frame = ttk.LabelFrame(right, text="Output")
        log_frame.pack(fill="both", expand=True, **pad)
        filter_frame = ttk.Frame(log_frame)
        filter_frame.pack(fill="x", pady=(2, 4))
        ttk.Label(filter_frame, text="Show:").pack(side="left", padx=(4, 4))
        self.verbosity_var = tk.StringVar(value=VERBOSITY[1][0])
        combo = ttk.Combobox(filter_frame, textvariable=self.verbosity_var, state="readonly",
                             values=[name for name, _ in VERBOSITY], width=26)
        combo.pack(side="left")
        combo.bind("<<ComboboxSelected>>", lambda e: self.rerender())
        self.collapse_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(filter_frame, text="Collapse repeated lines", variable=self.collapse_var,
                        command=self.rerender).pack(side="left", padx=8)
        ttk.Button(filter_frame, text="Save log...", command=self.save_log).pack(side="right", padx=4)
        ttk.Button(filter_frame, text="Copy shown", command=self.copy_shown).pack(side="right")
        self.counts_var = tk.StringVar(value="")
        ttk.Label(filter_frame, textvariable=self.counts_var).pack(side="right", padx=8)
        self.log_text = scrolledtext.ScrolledText(log_frame, wrap="word", state="disabled")
        self.log_text.tag_configure("error", foreground="#c00000")
        self.log_text.pack(fill="both", expand=True)

        root.protocol("WM_DELETE_WINDOW", self.on_close)

    def set_busy(self, busy):
        """Current bar: a moving bar while the stage cannot count, else a filled share."""
        if busy == self.current_busy:
            return
        self.current_busy = busy
        if busy:
            self.current_bar.configure(mode="indeterminate")
            self.current_bar.start(15)
        else:
            self.current_bar.stop()
            self.current_bar.configure(mode="determinate")

    def reset_progress(self):
        self.stage_index, self.stage_count, self.stage_name = 0, 0, ""
        self.set_busy(False)
        self.overall_bar["value"] = 0
        self.current_bar["value"] = 0
        self.overall_var.set("")
        self.current_var.set("")

    def on_progress(self, line):
        """An @@stage / @@step line from tools/progress.py."""
        parts = line.rstrip("\n").split(" ", 3)
        try:
            a, b = int(parts[1]), int(parts[2])
        except (IndexError, ValueError):
            return
        text = parts[3] if len(parts) > 3 else ""
        if parts[0] == "@@stage":
            self.stage_index, self.stage_count = a, b
            self.stage_name = STAGE_LABELS.get(text, text)
            self.overall_bar["value"] = 1000 * (a - 1) / max(b, 1)
            self.overall_var.set("Stage %d of %d: %s" % (a, b, self.stage_name))
            self.set_busy(True)
            self.current_var.set("")
        elif parts[0] == "@@step":
            if b <= 0:
                self.set_busy(True)
                self.current_var.set(text)
                return
            self.set_busy(False)
            frac = min((a + 1) / b, 1.0)  # item a (0-based) under way
            self.current_bar["value"] = 1000 * frac
            self.current_var.set("%d / %d   %s" % (min(a + 1, b), b, text))
            if self.stage_count:
                self.overall_bar["value"] = 1000 * (self.stage_index - 1 + frac) / self.stage_count

    def finish_progress(self, ok):
        self.set_busy(False)
        if ok:
            self.overall_bar["value"] = 1000
            self.current_bar["value"] = 1000
            self.overall_var.set("Finished %d stage%s" % (self.stage_count, "" if self.stage_count == 1 else "s"))
            self.current_var.set("")

    def set_all_stages(self, value):
        for var in self.stage_vars.values():
            var.set(value)

    def browse_dir(self):
        path = filedialog.askdirectory(title="Select Fallout 2 install directory")
        if path:
            self.install_dir_var.set(path)

    def max_level(self):
        return dict(VERBOSITY).get(self.verbosity_var.get(), LEVEL_INFO)

    def log(self, text, level=LEVEL_INFO):
        """Record one line of output and show it if the filter lets it through."""
        self.lines.append((level, text))
        self.log_text.configure(state="normal")
        self._show(level, text)
        self.log_text.see("end")
        self.log_text.configure(state="disabled")
        self._update_counts()

    def _show(self, level, text):
        if level > self.max_level():
            return
        tag = ("error",) if level == LEVEL_ERROR else ()
        if self.collapse_var.get():
            key = _HEX_RE.sub("#", text.strip())
            if self.last_shown and self.last_shown[0] == key:
                count = self.last_shown[1] + 1
                self.last_shown = (key, count)
                if count > 2:  # replace the previous "(repeated ...)" note
                    self.log_text.delete("end-2l linestart", "end-1c")
                self.log_text.insert("end", "    (repeated %d more time%s)\n"
                                     % (count - 1, "" if count == 2 else "s"), tag)
                return
            self.last_shown = (key, 1)
        if not text.endswith("\n"):
            text += "\n"
        self.log_text.insert("end", text, tag)

    def rerender(self):
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.last_shown = None
        for level, text in self.lines:
            self._show(level, text)
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _update_counts(self):
        errors = sum(1 for level, _ in self.lines if level == LEVEL_ERROR)
        self.counts_var.set("%d error/warning line%s" % (errors, "" if errors == 1 else "s"))

    def shown_text(self):
        return self.log_text.get("1.0", "end-1c")

    def copy_shown(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.shown_text())
        self.status_var.set("Copied the shown output to the clipboard")

    def save_log(self):
        path = filedialog.asksaveasfilename(title="Save log", defaultextension=".txt",
                                            initialfile="pipeline-log.txt",
                                            filetypes=[("Text", "*.txt"), ("All files", "*.*")])
        if not path:
            return
        if messagebox.askyesno("Save log", "Save only the lines shown with the current filter?\n\n"
                                           "No = save the whole log."):
            text = self.shown_text()
        else:
            text = "".join(t if t.endswith("\n") else t + "\n" for _, t in self.lines)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        self.status_var.set("Saved " + path)

    def on_run(self):
        if self.proc is not None:
            messagebox.showinfo("Already running", "A pipeline run is already in progress.")
            return

        install_dir = self.install_dir_var.get().strip()
        if not install_dir:
            messagebox.showerror("Missing install directory", "Please choose your Fallout 2 install directory first.")
            return

        selected = [stage_id for stage_id, var in self.stage_vars.items() if var.get()]
        if not selected:
            messagebox.showerror("No stages selected", "Select at least one pipeline stage to run.")
            return

        if self.delete_originals_var.get():
            originals = count_originals()
            if originals:
                ok = messagebox.askyesno(
                    "Confirm delete originals",
                    f"This will permanently delete {len(originals)} raw source file(s) "
                    "(FRM/PRO/MAP/ACM under data/) once they've been converted.\n\n"
                    "These are only needed for re-running the pipeline, not for a real "
                    "install. This cannot be undone — continue?",
                )
                if not ok:
                    return
            else:
                self.log("No original source files found to delete (nothing to do for that option).\n")

        cmd = [
            sys.executable,
            SETUP_PY,
            install_dir,
            "--stages", ",".join(selected),
            "--overwrite" if self.overwrite_var.get() else "--skip-existing",
        ]
        if self.delete_originals_var.get():
            cmd += ["--delete-originals", "--yes"]
        if self.no_mods_var.get():
            cmd += ["--no-mods"]

        self.lines = []
        self.classifier = LineClassifier()
        self.rerender()
        self.log("$ " + " ".join(cmd) + "\n")

        self.run_button.configure(state="disabled")
        self.status_var.set("Noting existing files...")
        self.root.update_idletasks()
        self.before = snapshot_outputs()
        self.cancelled = False
        self.status_var.set("Running...")
        self.reset_progress()
        self.overall_var.set("Starting...")
        self.set_busy(True)

        # progress lines for the bars; unbuffered so the log keeps up with the run
        env = dict(os.environ, DH2_PROGRESS="1", PYTHONUNBUFFERED="1")
        self.proc = subprocess.Popen(
            cmd,
            cwd=PROJECT_ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            start_new_session=(os.name != "nt"),  # own process group for kill_tree
        )
        self.cancel_button.configure(state="normal")
        threading.Thread(target=self._reader_thread, daemon=True).start()
        self.root.after(100, self._poll_queue)

    def _reader_thread(self):
        proc = self.proc
        try:
            for line in proc.stdout:
                self.out_queue.put(("line", line))
        finally:
            proc.wait()
            self.out_queue.put(("done", proc.returncode))

    def _poll_queue(self):
        try:
            while True:
                kind, payload = self.out_queue.get_nowait()
                if kind == "line":
                    if payload.startswith("@@"):
                        self.on_progress(payload)
                    else:
                        self.log(payload, self.classifier.level(payload))
                elif kind == "done":
                    self.proc = None
                    self.cancel_button.configure(state="disabled")
                    self.finish_progress(payload == 0 and not self.cancelled)
                    if self.cancelled:
                        self.log("--- Cancelled ---\n", LEVEL_ERROR)
                        self.status_var.set("Cancelled")
                        self.offer_cleanup()
                    else:
                        self.log(f"--- Process exited with code {payload} ---\n",
                                 LEVEL_INFO if payload == 0 else LEVEL_ERROR)
                        self.status_var.set("Done" if payload == 0 else f"Failed (exit {payload})")
                    self.run_button.configure(state="normal")
                    return
        except queue.Empty:
            pass
        if self.proc is not None:
            self.root.after(100, self._poll_queue)

    def on_cancel(self):
        if self.proc is None or self.proc.poll() is not None:
            return
        if not messagebox.askyesno("Cancel run", "Stop the running pipeline now?"):
            return
        self.cancelled = True
        self.cancel_button.configure(state="disabled")
        self.status_var.set("Cancelling...")
        kill_tree(self.proc)

    def offer_cleanup(self):
        """After a cancel: offer to remove what the run wrote (see written_since)."""
        self.status_var.set("Looking for files this run wrote...")
        self.root.update_idletasks()
        new, changed = written_since(self.before)
        self.status_var.set("Cancelled")
        if not new and not changed:
            self.log("The run wrote no files.\n")
            return

        dlg = tk.Toplevel(self.root)
        dlg.title("Remove what the run wrote?")
        dlg.transient(self.root)
        dlg.grab_set()
        dirs = sorted({rel.replace("\\", "/").split("/")[0] for rel in new + changed})
        text = (f"The cancelled run created {len(new)} new file(s) and overwrote {len(changed)} "
                f"existing one(s) (in {', '.join(dirs)}).\n\n"
                "Remove new files only: keeps output from earlier runs.\n"
                "Remove all written files: also removes the files it overwrote "
                "(their earlier version is gone already).\n\n"
                "Git-tracked files are never removed. Source files deleted by "
                "\"Delete original source files\" can't be restored: re-run the DAT extraction.")
        ttk.Label(dlg, text=text, wraplength=460, justify="left").pack(padx=12, pady=12)
        buttons = ttk.Frame(dlg)
        buttons.pack(pady=(0, 12))

        def do(rels):
            dlg.destroy()
            if not rels:
                self.log("Kept the files the run wrote.\n")
                return
            self.status_var.set("Removing files...")
            self.root.update_idletasks()
            removed, failed = remove_files(rels)
            self.log(f"Removed {removed} file(s) the cancelled run wrote"
                     + (f", {failed} could not be removed" if failed else "") + ".\n",
                     LEVEL_ERROR if failed else LEVEL_INFO)
            self.status_var.set("Cancelled; removed %d file(s)" % removed)

        ttk.Button(buttons, text="Remove new files only", command=lambda: do(new)).pack(side="left", padx=4)
        ttk.Button(buttons, text="Remove all written files", command=lambda: do(new + changed)).pack(side="left", padx=4)
        ttk.Button(buttons, text="Keep everything", command=lambda: do([])).pack(side="left", padx=4)
        dlg.protocol("WM_DELETE_WINDOW", lambda: do([]))

    def on_close(self):
        if self.proc is not None and self.proc.poll() is None:
            if not messagebox.askyesno("Pipeline running", "A pipeline run is still in progress. Quit anyway?"):
                return
            kill_tree(self.proc)
        self.root.destroy()


def main():
    root = tk.Tk()
    PipelineGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
