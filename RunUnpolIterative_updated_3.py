# -*- coding: utf-8 -*-
"""
Vergleich: Klassische Auswertung (s-polarisiert) vs. Iterative Korrektur (unpolarisiert)

Klassisch:  DataLoaderUVVIS2 -> CSV mit R_00/T_00 (s-pol) bei mehreren Winkeln
Unpol:      DataLoaderUVVIS_MultiSample -> Excel mit R/T (unpol) bei einem Winkel (IOF-Daten)

Iterationsschema (Reupert 2025+):
    k=0: R01_unpol -> Method 1 -> n(0), kappa(0)
    k>=1: Fresnel -> R01_p(k) -> R01s_korr = 2*R01_unpol - R01_p(k) -> Method 1 -> n(k), kappa(k)
    Konvergenz: |n(k) - n(k-1)| < eps_n
"""

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.backends.backend_pdf
import os

from DataLoaderUVVIS2 import load_UVVIS_data
from DataLoaderUVVIS_MultiSample import load_UVVIS_multisample_excel
from AuswertungUV_VIS import (
    IndexFromUV_VIS_plus_minus,
    Calc_R01_SP,
    CalcK,
    CalcEpsK,
    CalcRefIndx,
    FusedSilicaLit,
)

# ====
# PARAMETER – hier anpassen
# ====

# Klassische Daten (s-polarisiert, CSV)
CSV_FILE        = 'FusedSilica3clean.csv'   # <-- anpassen
CSV_ANGLE_DEG   = 6.0                    # Winkel der CSV-Messung (falls nur einer)
CSV_WIDTH_MM    = 0.69                    # Probendicke [mm]

# IOF-Daten (unpolarisiert, Excel)
EXCEL_FILE      = 'VN6_FSa.xlsx'            # <-- anpassen
EXCEL_SAMPLE    = 'FS1'                    # Sample-Name im Excel
EXCEL_ANGLE_DEG = 6.0                    # Messwinkel [°]
EXCEL_WIDTH_MM  = 0.69                    # Probendicke [mm]

# Iterationsparameter
MAX_ITER   = 10
EPS_N      = 1e-5
EPS_K      = 1e-7

# Gauss-Glättung der R01-Messdaten (in Wellenlängen-Punkten, 0 = aus)
SIGMA_R01  = 3   # Standardabweichung des Gauss-Filters (Datenpunkte)

# Literatur (Sellmeier Fused Silica, Malitson 1965)
def lit_FusedSilica(wl_nm):
    L = wl_nm * 1e-3  # nm -> µm
    return np.sqrt(0.6961663*L**2/(L**2 - 0.0684043**2) +
                   0.4079426*L**2/(L**2 - 0.1162414**2) +
                   0.8974794*L**2/(L**2 - 9.896161**2) + 1)

# ====
# HILFSFUNKTIONEN
# ====

nm = 1.0
mm = 1e6 * nm   # 1 mm in nm

def nichelatti(R, T):
    """Nichelatti-Formel: R01 aus gemessenem R und T (normiert auf 1)."""
    val = 2 + T**2 - (1 - R)**2
    R01 = (val - np.sqrt(np.maximum(val**2 - 4*(2 - R)*R, 0))) / (2*(2 - R))
    return R01


def method1_from_R01s(R01s, R, T, wl_nm, angle_deg, width_nm):
    """
    Method 1 (Nichelatti + Reupert 2025):
    Aus R01s -> ik -> rkz -> eps -> n, kappa
    Entspricht IndexFromUV_VIS_plus_minus mit PixedPoynting=True,
    aber mit vorgegebenem R01s statt neu berechnetem.
    """
    One = R + T + np.clip(1 - R - T, 0, None)
    Rn = R / One
    Tn = T / One
    Absn = np.clip(1 - Rn - Tn, 0, None)

    # Poynting-Korrektur (wie in IndexFromUV_VIS_plus_minus)
    T_10 = (R01s * Tn**2 - R01s*(Rn - R01s)**2) / ((1 - R01s) * (Rn - R01s))
    M_10 = 1 - T_10 - R01s

    A1 = (Rn - R01s) / ((1 - M_10) * (R01s * Tn))
    A1 = np.atleast_1d(A1).copy()
    A1[A1 <= 0] = np.nan
    ik = -np.log(A1) / (2 * width_nm)

    k0 = 2 * np.pi / wl_nm
    angle_rad = np.deg2rad(angle_deg)
    k0z = k0 * np.cos(angle_rad)

    rkz = (k0z*(1 + R01s)/(1 - R01s) +
           np.sqrt(np.maximum(k0z**2 * ((1 + R01s)/(1 - R01s))**2 - (k0z**2 + ik**2), 0)))

    reps, ieps = CalcEpsK(rkz, ik, k0, angle_rad)
    n, kappa = CalcRefIndx(reps, ieps)
    return n.flatten(), kappa.flatten(), reps.flatten(), ieps.flatten()


def iterative_unpol(R_unpol, T_unpol, wl_nm, angle_deg, width_nm,
                    max_iter=MAX_ITER, eps_n=EPS_N, eps_k=EPS_K,
                    sigma_r01=SIGMA_R01, verbose=True):
    """
    Iteratives Korrekturschema für unpolarisiertes Licht.

    Returns:
        n_iter, kappa_iter  : konvergierte optische Konstanten
        n_history           : Liste von n-Arrays pro Iteration (inkl. k=0)
        n_iter0             : 0. Näherung (ohne Korrektur)
        R01_unpol           : R01 aus Nichelatti (ggf. geglättet)
        R01_unpol_raw       : R01 aus Nichelatti (ungeglättet)
    """
    from scipy.ndimage import gaussian_filter1d

    One = R_unpol + T_unpol + np.clip(1 - R_unpol - T_unpol, 0, None)
    Rn = R_unpol / One
    Tn = T_unpol / One

    # k=0: R01_unpol aus Nichelatti, optional Gauss-geglättet
    R01_unpol_raw = nichelatti(Rn, Tn)
    if sigma_r01 > 0:
        R01_unpol = gaussian_filter1d(R01_unpol_raw, sigma=sigma_r01)
        if verbose:
            print(f"  Gauss-Glättung R01: sigma = {sigma_r01} Punkte")
    else:
        R01_unpol = R01_unpol_raw.copy()
    n_k, kappa_k, reps_k, ieps_k = method1_from_R01s(R01_unpol, R_unpol, T_unpol,
                    wl_nm, angle_deg, width_nm)
    n_history = [n_k.copy()]
    n_iter0 = n_k.copy()
    kappa_iter0 = kappa_k.copy()

    angle_rad = np.deg2rad(angle_deg)

    for k in range(1, max_iter + 1):
        # Fresnel: R01_s und R01_p aus aktuellem n, kappa
        R01s_fresnel, R01p_fresnel = Calc_R01_SP(wl_nm, reps_k, ieps_k, angle_rad)

        # Korrektur: R01s_korr = 2*R01_unpol - R01_p
        R01s_korr = 2 * R01_unpol - R01p_fresnel
        R01s_korr = np.clip(R01s_korr, 1e-6, 1 - 1e-6)  # physikalisch begrenzen

        # Method 1 mit korrigiertem R01s
        n_new, kappa_new, reps_new, ieps_new = method1_from_R01s(
            R01s_korr, R_unpol, T_unpol, wl_nm, angle_deg, width_nm)

        n_history.append(n_new.copy())

        # Konvergenzcheck (nanmax um NaN-Bereiche zu ignorieren)
        delta_n = np.nanmax(np.abs(n_new - n_k))
        delta_k = np.nanmax(np.abs(kappa_new - kappa_k))

        if verbose:
            print(f"  Iteration {k}: max|Δn| = {delta_n:.2e},  max|Δκ| = {delta_k:.2e}")

        n_k, kappa_k, reps_k, ieps_k = n_new, kappa_new, reps_new, ieps_new

        if delta_n < eps_n and delta_k < eps_k:
            if verbose:
                print(f"  Konvergiert nach {k} Iterationen.")
            break
    else:
        if verbose:
            print(f"  Warnung: Keine Konvergenz nach {max_iter} Iterationen.")

    return n_k, kappa_k, n_history, n_iter0, kappa_iter0, R01_unpol, R01_unpol_raw


# ====
# 1) KLASSISCHE AUSWERTUNG (s-polarisiert, CSV)
# ====

print("=" * 60)
print("1) Klassische Auswertung (s-polarisiert, CSV)")
print("=" * 60)

classic_ok = False
if os.path.exists(CSV_FILE):
    data_csv = load_UVVIS_data(CSV_FILE)
    wl_csv = data_csv['wavelength'].flatten()   # (n_wl,)
    angles_deg_csv = data_csv['angles_deg']

    # Wähle den Winkel der am nächsten an CSV_ANGLE_DEG liegt
    idx_angle = np.argmin(np.abs(angles_deg_csv - CSV_ANGLE_DEG))
    angle_used = angles_deg_csv[idx_angle]
    print(f"  Verwende Winkel {angle_used}° (Index {idx_angle})")

    R_s = data_csv['R_00'][idx_angle]   # s-pol Reflexion
    T_s = data_csv['T_00'][idx_angle]   # s-pol Transmission
    width_nm_csv = CSV_WIDTH_MM * mm

    reps_c, ieps_c, n_classic, kappa_classic, alpha_c, R01_c, A01_c, M10_c = \
        IndexFromUV_VIS_plus_minus(R_s, T_s, np.clip(1 - R_s - T_s, 0, None),
                    wl_csv, angle_used, width_nm_csv,
                    sol='plus', PixedPoynting=True)
    classic_ok = True
    print(f"  n (Median): {np.nanmedian(n_classic):.4f}")
else:
    print(f"  ⚠️  CSV-Datei '{CSV_FILE}' nicht gefunden – klassische Auswertung übersprungen.")
    wl_csv = None

# ====
# 2) ITERATIVE AUSWERTUNG (unpolarisiert, Excel/IOF)
# ====

print()
print("=" * 60)
print("2) Iterative Auswertung (unpolarisiert, Excel)")
print("=" * 60)

unpol_ok = False
if os.path.exists(EXCEL_FILE):
    data_excel = load_UVVIS_multisample_excel(EXCEL_FILE, angle_deg=EXCEL_ANGLE_DEG)

    if EXCEL_SAMPLE in data_excel:
        d = data_excel[EXCEL_SAMPLE]
        wl_ex  = d['wavelength'].flatten()
        R_ex   = d['R'].flatten()
        T_ex   = d['T'].flatten()
        width_nm_ex = EXCEL_WIDTH_MM * mm

        print(f"  Sample: {EXCEL_SAMPLE}, Winkel: {EXCEL_ANGLE_DEG}°")
        n_iter, kappa_iter, n_history, n_iter0, kappa_iter0, R01_unpol = \
            iterative_unpol(R_ex, T_ex, wl_ex, EXCEL_ANGLE_DEG, width_nm_ex, verbose=True)
        unpol_ok = True
        print(f"  n (Median, konvergiert): {np.nanmedian(n_iter):.4f}")
    else:
        print(f"  ⚠️  Sample '{EXCEL_SAMPLE}' nicht in Excel-Datei gefunden.")
        print(f"      Verfügbare Samples: {list(data_excel.keys())}")
else:
    print(f"  ⚠️  Excel-Datei '{EXCEL_FILE}' nicht gefunden – iterative Auswertung übersprungen.")
    wl_ex = None

# ====
# 3) VERGLEICH
# ====

print()
print("=" * 60)
print("3) Vergleich")
print("=" * 60)

fig, axes = plt.subplots(2, 3, figsize=(18, 10))
fig.suptitle('Vergleich: s-polarisiert (klassisch) vs. unpolarisiert (iterativ)', fontsize=13)

ax_n    = axes[0, 0]
ax_k    = axes[1, 0]
ax_R01  = axes[0, 1]
ax_conv = axes[1, 1]
ax_diff = axes[0, 2]
ax_diff2 = axes[1, 2]

# Literatur
wl_lit = np.linspace(200, 2500, 1000)
n_lit  = lit_FusedSilica(wl_lit)
ax_n.plot(wl_lit, n_lit, 'k--', lw=1.5, label='Literatur (Malitson 1965)', zorder=5)

# Klassisch
if classic_ok:
    ax_n.plot(wl_csv, n_classic,     color='steelblue', lw=1.5, label=f'Klassisch s-pol ({angle_used}°)')
    ax_k.plot(wl_csv, kappa_classic, color='steelblue', lw=1.5, label=f'Klassisch s-pol ({angle_used}°)')
    ax_R01.plot(wl_csv, R01_c,       color='steelblue', lw=1.5, label=f'$R_{{01}}$ klassisch')

# Iterativ
if unpol_ok:
    # 0. Näherung
    ax_n.plot(wl_ex, n_iter0,    color='tomato', lw=1.0, ls='--', alpha=0.7,
              label=f'Unpol k=0 ({EXCEL_ANGLE_DEG}°)')
    # Konvergiert
    ax_n.plot(wl_ex, n_iter,     color='tomato', lw=1.8, label=f'Unpol konvergiert ({EXCEL_ANGLE_DEG}°)')
    ax_k.plot(wl_ex, kappa_iter, color='tomato', lw=1.8, label=f'Unpol konvergiert ({EXCEL_ANGLE_DEG}°)')
    ax_k.plot(wl_ex, kappa_iter0,color='tomato', lw=1.0, ls='--', alpha=0.7,
              label=f'Unpol k=0 ({EXCEL_ANGLE_DEG}°)')
    ax_R01.plot(wl_ex, R01_unpol, color='tomato', lw=1.5, label=r'$R_{01}^{\mathrm{unpol}}$ gemessen')

    # R01_s und R01_p berechnet aus konvergiertem n, kappa (Fresnel)
    from AuswertungUV_VIS import CalcEpsN
    reps_iter, ieps_iter = CalcEpsN(n_iter, kappa_iter)
    angle_rad_ex = np.deg2rad(EXCEL_ANGLE_DEG)
    R01s_calc, R01p_calc = Calc_R01_SP(wl_ex, reps_iter, ieps_iter, angle_rad_ex)
    ax_R01.plot(wl_ex, R01s_calc, color='steelblue', lw=1.2, ls='-',
                label=r'$R_{01}^{s}$ berechnet (Fresnel)')
    ax_R01.plot(wl_ex, R01p_calc, color='seagreen',  lw=1.2, ls='-',
                label=r'$R_{01}^{p}$ berechnet (Fresnel)')

    # Konvergenzplot: |n(k) - n(k-1)| über Wellenlänge für jede Iteration (keine Legende für Iterationen)
    cmap = plt.cm.viridis(np.linspace(0.1, 0.9, max(len(n_history) - 1, 1)))
    for i in range(1, len(n_history)):
        delta = np.abs(n_history[i] - n_history[i-1])
        ax_conv.semilogy(wl_ex, delta, color=cmap[i-1], lw=1.0, alpha=0.8)
    ax_conv.axhline(EPS_N, color='k', ls=':', lw=1.5, label=f'$\\epsilon_n = {EPS_N}$')

    # Differenzplot: n_lit - n_iter0 und n_lit - n_iter (Literatur auf gemessene wl interpoliert)
    from scipy.interpolate import interp1d as _interp1d
    n_lit_on_ex = _interp1d(wl_lit, n_lit, bounds_error=False, fill_value=np.nan)(wl_ex)
    diff_iter0 = n_lit_on_ex - n_iter0
    diff_iter  = n_lit_on_ex - n_iter
    ax_diff.plot(wl_ex, diff_iter0, color='tomato', lw=1.2, ls='--', alpha=0.8,
                 label=r'$n_\mathrm{lit} - n^{(0)}$')
    ax_diff.plot(wl_ex, diff_iter,  color='tomato', lw=1.8,
                 label=r'$n_\mathrm{lit} - n^\mathrm{iter}$')
    if classic_ok:
        n_lit_on_csv = _interp1d(wl_lit, n_lit, bounds_error=False, fill_value=np.nan)(wl_csv)
        diff_classic = n_lit_on_csv - n_classic
        ax_diff.plot(wl_csv, diff_classic, color='steelblue', lw=1.5,
                     label=r'$n_\mathrm{lit} - n^\mathrm{klass}$')
    ax_diff.axhline(0, color='k', ls='-', lw=0.8, alpha=0.4)

    # ax_diff2: κ-Differenz oder n-Differenz klassisch vs. iteriert
    ax_diff2.plot(wl_ex, diff_iter0, color='tomato', lw=1.2, ls='--', alpha=0.8,
                  label=r'$n_\mathrm{lit} - n^{(0)}$')
    ax_diff2.plot(wl_ex, diff_iter,  color='tomato', lw=1.8,
                  label=r'$n_\mathrm{lit} - n^\mathrm{iter}$')
    if classic_ok:
        ax_diff2.plot(wl_csv, diff_classic, color='steelblue', lw=1.5,
                      label=r'$n_\mathrm{lit} - n^\mathrm{klass}$')
    ax_diff2.axhline(0, color='k', ls='-', lw=0.8, alpha=0.4)
    ax_diff2.set_yscale('symlog', linthresh=1e-4)

# Differenz n (wenn beide vorhanden und gleiche Wellenlänge)
if classic_ok and unpol_ok:
    from scipy.interpolate import interp1d
    try:
        n_classic_interp = interp1d(wl_csv, n_classic, bounds_error=False, fill_value=np.nan)
        delta_n = n_iter - n_classic_interp(wl_ex)
        ax_n.fill_between(wl_ex, n_iter - np.abs(delta_n), n_iter + np.abs(delta_n),
                    alpha=0.15, color='tomato', label='Differenz |Δn|')
        print(f"  Mittlere Abweichung |Δn|: {np.nanmean(np.abs(delta_n)):.2e}")
        print(f"  Max. Abweichung    |Δn|: {np.nanmax(np.abs(delta_n)):.2e}")
    except Exception as e:
        print(f"  Interpolation für Differenz fehlgeschlagen: {e}")

# Achsenbeschriftungen
ax_n.set_xlabel('Wellenlänge [nm]')
ax_n.set_ylabel('Brechungsindex $n$')
ax_n.set_title('Brechungsindex $n$')
ax_n.legend(fontsize=8)
ax_n.grid(True, alpha=0.3)

ax_k.set_xlabel('Wellenlänge [nm]')
ax_k.set_ylabel(r'Extinktionskoeffizient $\kappa$')
ax_k.set_title(r'Extinktionskoeffizient $\kappa$')
ax_k.set_yscale('log')
ax_k.legend(fontsize=8)
ax_k.grid(True, alpha=0.3)

ax_R01.set_xlabel('Wellenlänge [nm]')
ax_R01.set_ylabel(r'$R_{01}$')
ax_R01.set_title(r'Grenzflächenreflexion $R_{01}$')
ax_R01.legend(fontsize=8)
ax_R01.grid(True, alpha=0.3)

ax_conv.set_xlabel('Wellenlänge [nm]')
ax_conv.set_ylabel(r'$|n^{(k)} - n^{(k-1)}|$')
ax_conv.set_title('Konvergenz der Iteration')
ax_conv.legend(fontsize=8)   # nur eps_n-Linie hat Label
ax_conv.grid(True, alpha=0.3)

ax_diff.set_xlabel('Wellenlänge [nm]')
ax_diff.set_ylabel(r'$n_\mathrm{lit} - n$')
ax_diff.set_title(r'Abweichung von Literatur (linear)')
ax_diff.legend(fontsize=8)
ax_diff.grid(True, alpha=0.3)

ax_diff2.set_xlabel('Wellenlänge [nm]')
ax_diff2.set_ylabel(r'$n_\mathrm{lit} - n$')
ax_diff2.set_title(r'Abweichung von Literatur (symlog)')
ax_diff2.legend(fontsize=8)
ax_diff2.grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig('Vergleich_Unpol_Klassisch.pdf', bbox_inches='tight')
plt.show()
print("\nPlot gespeichert: Vergleich_Unpol_Klassisch.pdf")

# ====
# 4) ERGEBNISSE SPEICHERN
# ====

import pandas as pd

rows = []
if unpol_ok:
    df_unpol = pd.DataFrame({
        'Wavelength_nm': wl_ex,
        'n_iter0':       n_iter0,
        'n_converged':   n_iter,
        'kappa_iter0':   kappa_iter0,
        'kappa_converged': kappa_iter,
        'R01_unpol':     R01_unpol,
    })
    with pd.ExcelWriter('Ergebnisse_Unpol_Iterativ.xlsx', engine='openpyxl') as writer:
        df_unpol.to_excel(writer, sheet_name='Iterativ_Unpol', index=False)
        if classic_ok:
            df_classic = pd.DataFrame({
                'Wavelength_nm': wl_csv,
                'n_classic':     n_classic,
                'kappa_classic': kappa_classic,
                'R01_classic':   R01_c,
            })
            df_classic.to_excel(writer, sheet_name='Klassisch_sPol', index=False)
    print("Ergebnisse gespeichert: Ergebnisse_Unpol_Iterativ.xlsx")

print("\nFertig!")