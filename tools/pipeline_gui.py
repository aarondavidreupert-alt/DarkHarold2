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

import glob
import os
import queue
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
    ("elevator_table", "Parse elevator table (from fallout2.exe)", True),
    ("extract_dats", "Extract DAT archives (master.dat / critter.dat)", True),
    ("export_images", "Export images (FRM -> PNG)", True),
    ("export_pros", "Export prototypes (PRO -> JSON)", True),
    ("export_maps", "Export maps (MAP -> JSON)", True),
    ("convert_lsts", "Convert LST files (-> lut/lst/*.json)", True),
    ("convert_endgame", "Convert endgame slide data", True),
    ("export_audio", "Convert audio (ACM -> WAV, needs acm2wav.exe)", False),
]

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
    found = []
    for pattern in DELETE_ORIGINALS_GLOBS:
        found.extend(glob.glob(os.path.join(PROJECT_ROOT, pattern), recursive=True))
    return found


class PipelineGUI:
    def __init__(self, root):
        self.root = root
        root.title("DarkHarold2 Asset Pipeline")
        root.geometry("760x620")

        self.proc = None
        self.out_queue = queue.Queue()

        pad = {"padx": 8, "pady": 4}

        # --- Install dir picker ---
        dir_frame = ttk.Frame(root)
        dir_frame.pack(fill="x", **pad)
        ttk.Label(dir_frame, text="Fallout 2 install directory:").pack(side="left")
        self.install_dir_var = tk.StringVar()
        ttk.Entry(dir_frame, textvariable=self.install_dir_var).pack(side="left", fill="x", expand=True, padx=6)
        ttk.Button(dir_frame, text="Browse...", command=self.browse_dir).pack(side="left")

        # --- Stage checkboxes ---
        stages_frame = ttk.LabelFrame(root, text="Pipeline stages")
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
        options_frame = ttk.LabelFrame(root, text="Options")
        options_frame.pack(fill="x", **pad)

        self.overwrite_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            options_frame,
            text="Overwrite already-generated output files (unchecked = skip a stage whose output already exists)",
            variable=self.overwrite_var,
        ).pack(anchor="w", padx=8, pady=(4, 2))

        self.delete_originals_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            options_frame,
            text="Delete original source files after conversion (FRM/PRO/MAP/ACM under data/ — not needed for a real install)",
            variable=self.delete_originals_var,
        ).pack(anchor="w", padx=8, pady=(2, 4))

        # --- Run controls ---
        run_frame = ttk.Frame(root)
        run_frame.pack(fill="x", **pad)
        self.run_button = ttk.Button(run_frame, text="Run", command=self.on_run)
        self.run_button.pack(side="left")
        self.status_var = tk.StringVar(value="Idle")
        ttk.Label(run_frame, textvariable=self.status_var).pack(side="left", padx=10)

        # --- Log output ---
        log_frame = ttk.LabelFrame(root, text="Output")
        log_frame.pack(fill="both", expand=True, **pad)
        self.log_text = scrolledtext.ScrolledText(log_frame, wrap="word", state="disabled")
        self.log_text.pack(fill="both", expand=True)

        root.protocol("WM_DELETE_WINDOW", self.on_close)

    def set_all_stages(self, value):
        for var in self.stage_vars.values():
            var.set(value)

    def browse_dir(self):
        path = filedialog.askdirectory(title="Select Fallout 2 install directory")
        if path:
            self.install_dir_var.set(path)

    def log(self, text):
        self.log_text.configure(state="normal")
        self.log_text.insert("end", text)
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

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

        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.configure(state="disabled")
        self.log("$ " + " ".join(cmd) + "\n\n")

        self.run_button.configure(state="disabled")
        self.status_var.set("Running...")

        self.proc = subprocess.Popen(
            cmd,
            cwd=PROJECT_ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
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
                    self.log(payload)
                elif kind == "done":
                    self.log(f"\n--- Process exited with code {payload} ---\n")
                    self.status_var.set("Done" if payload == 0 else f"Failed (exit {payload})")
                    self.run_button.configure(state="normal")
                    self.proc = None
                    return
        except queue.Empty:
            pass
        if self.proc is not None:
            self.root.after(100, self._poll_queue)

    def on_close(self):
        if self.proc is not None and self.proc.poll() is None:
            if not messagebox.askyesno("Pipeline running", "A pipeline run is still in progress. Quit anyway?"):
                return
            try:
                self.proc.terminate()
            except OSError:
                pass
        self.root.destroy()


def main():
    root = tk.Tk()
    PipelineGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
