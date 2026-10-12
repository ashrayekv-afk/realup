# Update to NKPI 8.7.0

1. Extract **NKPI_v870_Extract.zip** with Windows **Extract All**.
2. Upload the contents into the GitHub repository used by your Streamlit app. Replace existing files and keep the nested folders.
3. Main file remains **kcn_dual_calculator_app.py**. Requirements are unchanged.
4. Reboot the Streamlit app; refresh the browser. Confirm **8.7.0-regional-change** in the footer.
5. Open **Regional corneal change · Map review** beneath the observed-evidence dropdown. Select **Explore demo** to try the full interactive numerical example immediately.

The new dropdown is visible even before a calculation. The old 12-month forecast dropdown is removed. NKPI models, scoring, extraction, and observed evidence are preserved.

For a clean repository, delete these retired files (they are no longer referenced):
- components/baseline_outlook.js
- components/report_gallery.js
- tests/test_baseline_outlook.cjs
- docs/BASELINE_OUTLOOK_PREVIEW.html
- docs/SCORE_BAND_PREVIEW.html
- docs/OBSERVED_EVIDENCE_PREVIEW.html

Do not delete the Python baseline_outlook module or research artifacts; they remain dependencies of the historical numeric audit.

The offline demo is **docs/REGIONAL_CHANGE_PREVIEW.html**; open it from the extracted folder, not from inside the ZIP. A synthetic pair is included in **docs/SYNTHETIC_REGIONAL_PAIR.json**. Real numerical maps require the documented export/conversion contract. The app does not claim direct support for every proprietary Pentacam export format.
