# Version 8.7 software verification

These checks verify software behavior. They do not establish clinical accuracy, repeatability or progression detection.

- Thirteen numerical test groups passed: physical/nonuniform cell areas, directional posterior curvature, thinning, unchanged scans, null masking, one-layer and no-common-data behavior, mismatched eyes/visits/units/grids/registration definitions, sign conventions, invalid inputs, synthetic/real separation, nearby/apart patterns, immutable inputs and explicit audit labeling.
- Sixteen deterministic synthetic baseline/longitudinal cases spanning both eyes, quality flags and scan intervals produced exactly the same numerical outputs as 8.6, apart from the interface version. Model artifacts, extractor files, schema and observed-evidence calculations are byte-identical.
- The existing bilateral discovery test passed (legacy/current/mixed formats, missing/partial inputs, separate-eye associations, cancellation and edits).
- Chromium exercised the real calculator component with the Python calculation service: scores, observed evidence, report messaging, synthetic-map exclusion from the patient path, numerical binding, invalidation after edits, and next-patient clearing. Zero JavaScript errors.
- The separate numerical-pair route was tested with the synthetic JSON, malformed replacement, map switching, map-cell inspection and adjustable cutoffs. Invalid replacement clears the prior result.
- Offline demo widths 1200, 760, 390 and 320 pixels passed horizontal overflow checks. Desktop/mobile screenshots were visually reviewed.
- Actual Streamlit 1.50 launch passed. The bilateral example calculated through the live server, the new regional dropdown rendered, and the footer showed 8.7.0-regional-change. No app exception appeared. Top spacing was corrected so Streamlit’s toolbar does not cover action buttons.
- The 99-file ZIP uses standard DEFLATE compression with short relative paths, no encryption, and no ZIP64 requirement. CRC testing, extraction and per-file hash comparison passed. No patient records or source report images are included.

Tests used synthetic numerical maps and mock report pixels. Anatomical registration and clinical performance were not tested on measured patient grids. Report-only JPEG exports cannot validate this engine. The old full-workflow OCR was preserved, not newly benchmarked on an entire clinic cohort.
