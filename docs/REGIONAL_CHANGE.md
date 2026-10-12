# Regional corneal change — 8.7.0

This supplement describes the **location, extent and relationship of observed map changes**. It does not classify progression, predict a future NKPI, estimate corneal strength, or change NKPI. No spatial model was trained on the 426-eye inventory.

## Current case, demo and separate import

**Current case** displays original report pages explicitly associated by the existing extractor with the selected eye and visit. They are browser-local blob URLs. The original report's legends and printed values remain authoritative. Images are not registered, subtracted or converted to numerical data. Side-by-side pages are a visual reference only.

When the existing same-ZIP numerical mechanism supplies matching measured map files, the engine can analyze them. Both selected visits, verified scalar calculation, matching eye and visit roles, and a matching imported input snapshot are required. Edited inputs or changed source associations invalidate that numerical binding; reimport to restore it. Anatomical registration remains the responsibility of the numerical export/conversion workflow.

**Explore demo** generates synthetic maps in the browser. It does not read patient measurements. OD has small simulated changes; OS has larger simulated changes. Nearby and separated modes retain the same analytical peak amplitudes while moving their centers. Sampling and the aperture can slightly change numerical area. Synthetic maps cannot enter the automatic patient path.

**Numerical pair** accepts a separate research JSON. It is explicitly not linked to the calculator case. The file's eye controls its display. Loading it does not set NKPI inputs, claim patient identity, establish scan quality, or prove registration. Invalid replacements clear the previous imported pair.

## Supported numerical pair

The example `SYNTHETIC_REGIONAL_PAIR.json` is executable and explicitly synthetic. It must not be relabeled as patient data. The top-level shape is:

```json
{
  "schema": "nkpi-regional-pair-1",
  "interval_days": 180,
  "first": {"...": "documented first-visit map object"},
  "latest": {"...": "documented latest-visit map object"}
}
```

Each map object follows the existing `nkpi-corneal-maps-1` contract in `SURFACE_DATA.md` and `components/cornea/surface_schema.js`. For actual measured data:

- `kind`: `measured`; `source`: `device_numeric_export`.
- `eye`: `OD` or `OS`; `visit`: `first` or `latest`.
- Units: `{ "xy":"mm", "z":"mm", "elevation":"um", "thickness":"um", "curvature":"D" }`.
- `coordinate_system`: origin `corneal_vertex`; explicit x/y/z positive directions.
- `x_mm`, `y_mm`: strictly increasing arrays of 3–201 coordinates. Grids are rows of y, columns of x. Both visits must have exactly the same axes and coordinate conventions.
- `anterior.curvature_D` and/or `posterior.curvature_D`: numerical arrays with `curvature_type` set to matching `axial`, `tangential` or `mean` definitions. `device_reported` without a specified definition is not accepted for comparison.
- `thickness_um`: numerical array with `thickness_definition`: `device_pachymetry`.
- Missing samples: JSON `null`. They are not imputed.
- Both objects must contain the same `comparison` object: `alignment` = `verified_common_grid`, and nonidentifying `registration_id` and `map_definition_id` keys. These declarations attest work done upstream; this app cannot verify their truth.

At least one matching analyzable layer is required. Posterior curvature must use a single nonzero sign convention across both scans. Anterior curvature must be positive. Mixed measured/synthetic sources, mismatched units, grids, definitions, eye or visit roles are rejected. Unknown fields are rejected; names, MRNs, dates and arbitrary free-text identifiers are unnecessary.

Elevation arrays are not analyzed by this version. Independently fitted elevation references can create misleading differences; converting elevation into a compatible curvature map is outside this module. A scalar ARC/PRC or Kmax must not be copied across a map grid.

## Automatic same-ZIP association

The existing extractor accepts a root `nkpi-surface-index.json` with schema `nkpi-surface-index-1` and entries linking an actual report archive path to its map JSON:

```json
{
  "schema":"nkpi-surface-index-1",
  "entries":[
    {"report":"example-report.jpg", "surface":"example-maps.json"}
  ]
}
```

The report path must correspond to the selected study and the map must match its eye/visit. One unambiguous numerical file per study is required. The regional UI uses the existing importer association and additionally binds that pair to the imported scalar snapshot. A correct path or checksum does not itself prove patient identity or anatomical registration. Native proprietary device files are not automatically converted. A verified converter must first create the documented objects from actual device numerical exports.

## Computation

1. Use full rectangular cells with all four corners inside the central 6-mm aperture. Keep cells on the original supplied grid; no interpolation, image registration or resampling is performed.
2. For each layer and visit, average the four corners of a cell. If any corner is missing at either visit, that layer's cell is unavailable.
3. Directional change is `latest − first` for positive anterior curvature, `abs(latest) − abs(first)` for consistently signed posterior curvature, and `first − latest` for thickness. Positive values represent the specified direction of change; they are not diagnoses.
4. Highlight changes **at or above** the selected display cutoff. Defaults are 1 D anterior, 0.25 D posterior and 10 µm thinning. These are illustrative engineering settings and have no claimed repeatability calibration or clinical validity.
5. Cell area is `(x[i+1] − x[i]) × (y[j+1] − y[j])`. Report planar projected mm², not true curved surface area.
6. Report total highlighted area, area-weighted mean directional change within it, and the area/area-weighted center of the largest edge-connected patch. Four-neighbor connectivity is used. Small regions are not automatically removed or called artifacts.
7. Shared area is the sum of cells crossing cutoffs in at least two available layers, restricted to cells having data in **every** available layer. With one layer or no common cells, shared area is unavailable, not zero. Layers without comparable cells likewise have unavailable regional area. This is a descriptive intersection, not independent corroboration or a calibrated score.

The side labels reflect the displayed eye and declared axis directions. Cell inspection reports four-corner means, not a measured value exactly at the cell center. Actual scan interval is displayed; differences and cutoffs are not extrapolated to another interval.

## What remains unvalidated

The current engine does not include scan-noise estimation, severity-specific spatial repeatability, multiple-location significance testing, treatment effects, contact-lens effects, or persistence across three visits. Adjacent grid samples and layers are correlated. Overlap is not proof of progression, and a lack of overlap is not proof of stability. Anterior curvature, posterior curvature and thinning can be spatially offset.

Quality flags on the main score still apply. A successful numerical parse is not a quality certificate. Baseline-only scans cannot establish observed change. Report images alone cannot supply quantitative spatial results.

The next research gate is a registered numerical-map cohort with repeat acquisitions and independently adjudicated longitudinal outcomes. Compare added regional features with NKPI plus Pentacam ABCD using patient-grouped evaluation. Demonstrate better detection or fewer false alarms before interpreting area/overlap clinically. Keep a repeatability-calibrated analysis distinct from these adjustable display cutoffs.

## Primary literature

- REDCAKE Study Group (2021). Regional versus single-point parameters: https://pubmed.ncbi.nlm.nih.gov/34050086/
- Long-Term Zonal Average Analysis of Corneal Tomography in Keratoconus Eyes: https://pubmed.ncbi.nlm.nih.gov/35389929/
- Steinwender et al. (2022). Differences between cone-localization methods: https://pubmed.ncbi.nlm.nih.gov/36203753/
- Zheng et al. (2017). Alignment and repeatability of elevation maps: https://pubmed.ncbi.nlm.nih.gov/29234085/
- Detection of Corneal Ectasia Using OCT Maps of Pachymetry and Posterior Surface Mean Curvature (2022): https://pubmed.ncbi.nlm.nih.gov/35946999/

These publications support investigating regional patterns. They do not validate this software's defaults, shared area, or clinical performance.
