# NKPI bilateral calculator — 8.7.0

**Regional corneal change · Map review** replaces the 12-month forecast display. It is a clickable dropdown beneath **Observed change & evidence**. The NKPI calculation, bilateral extraction, existing quality-advisory policy, input audit and observed-evidence calculation are unchanged.

## Install / update

1. Download `NKPI_v870_Extract.zip` and use Windows **Extract All**.
2. Upload the extracted files and folders to your GitHub app repository, replacing matching files. Preserve the folders; do not upload the ZIP itself as app code.
3. Keep Streamlit's main file set to **kcn_dual_calculator_app.py**. Reboot the app and refresh the page.
4. Confirm the footer says **8.7.0-regional-change**. Open **Regional corneal change · Map review**.

The package contains fewer than 100 files for GitHub browser upload. Delete obsolete files listed in UPDATE_INSTRUCTIONS.md if they remain in an existing repository. No API key or additional dependency is needed for the new section.

Local run: `pip install -r requirements.txt`, then `streamlit run kcn_dual_calculator_app.py`.

## Use the new section

- **Current case:** switch OD / OS and compare the original earlier/later report images. Imported scalar values are available below. Properly linked numerical grids activate descriptive regional analysis automatically after calculation.
- **Explore demo:** a complete interactive simulated example. Compare nearby and separated changes, switch map layers, select a map cell, and adjust the display cutoffs. It never changes the patient's NKPI or measurements.
- **Numerical pair:** an independent browser-local research import in our documented JSON format. This is explicitly separate from the current NKPI case. Download an example directly in the interface.

To try the section without Streamlit, open **docs/REGIONAL_CHANGE_PREVIEW.html** after extracting the entire ZIP. All required scripts and styles are local.

## What the new numerical engine measures

Anterior curvature increase, posterior curvature magnitude increase, and thinning; highlighted planar area; mean directional change within that area; largest connected region and its location; shared area in two or more available layers. Complete common-grid cells inside the central 6-mm aperture are used. Missing samples remain missing.

**These are descriptive measurements, not validated progression findings.** The map cutoffs are adjustable illustration settings, not clinical significance thresholds. Registration is supplied by the numerical conversion workflow, not calculated or independently verified by this app. The engine does not reconstruct measurements from report colors or six scalar inputs.

The report-only Pentacam ZIPs inspected during development contain JPEG pages. They support the source-image comparison but cannot produce a genuine numerical regional result. The new section provides an immediate working demo and an actual numerical analysis route for supported exports; it does not imply that the 426-eye cohort trained a spatial model.

The 12-month outlook is removed from the visible interface. Historical research calculations remain in the internal numeric audit for compatibility. See **docs/REGIONAL_CHANGE.md** for the import contract, formulas, literature and limitations. No private patient images or patient rows are bundled.
