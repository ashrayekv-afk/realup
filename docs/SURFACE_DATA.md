> Version 5.0 also accepts `nkpi-corneal-maps-1` without z geometry. The measured-surface contract below remains separate from the explicitly estimated image-derived model. See [NUMERICAL_MAPS.md](NUMERICAL_MAPS.md).

# Numerical corneal surface contract · updated for 4.5

The default 3D view now opens a **reference eye** and receives source-map pixels from the original ZIP automatically. It does not need numerical data or a second upload. This document describes the measured geometry contract. Its optional numerical maps can also feed the new reference-eye Change view; see `MAP_COMPARISON.md`.

Numerical JSON is discovered inside that same ZIP by an exact study-prefix filename or the explicit `nkpi-surface-index-1` association documented in the README. A separate file chooser is not part of the normal UI. Unsupported native exports are not reverse-engineered.

## Geometry is a separate, data-gated feature

The calculator's six summary measurements, age, model index, screenshot colors, and optional landmark coordinates do **not** define a unique corneal surface. This application never uses them to produce a patient-specific shape. It also does not create an entire eye from a corneal map.

To render measured geometry, supply actual surface-height samples `z_mm` at known `x_mm, y_mm` coordinates. A declared device numerical export is accepted only after schema validation and explicit confirmation of the current case, eye, visit, units, and shared coordinate frame.

The app cannot authenticate a device file or automatically establish patient identity. “Measured” is the export's declared provenance plus the operator's check, not device-level certification. Do not relabel a synthetic fixture as measured.

## Supported file type

A UTF-8 JSON file no larger than 12 MB, using schema `nkpi-corneal-surface-1`.

Required top-level fields:

| Field | Contract |
|---|---|
| `schema` | `nkpi-corneal-surface-1` |
| `kind` | `measured` or `synthetic` |
| `source` | `device_numeric_export` for measured; `synthetic_fixture` for synthetic |
| `eye` | `OD` or `OS`, matching the selected calculator eye |
| `visit` | `first` or `latest`, matching the selected visit |
| `units` | Exactly `{"xy":"mm","z":"mm","elevation":"um","thickness":"um","curvature":"D"}` |
| `coordinate_system` | One shared origin and axis convention, described below |
| `x_mm`, `y_mm` | Strictly increasing finite coordinate arrays, each 3–201 samples, within ±12 mm |
| `anterior` and/or `posterior` | At least one actual `z_mm` grid, not an elevation residual grid |

Grid order is **`grid[y_row][x_column]`**. Every grid has `len(y_mm)` rows and `len(x_mm)` columns. JSON numbers must be finite. A missing sample is `null`, not zero, empty text, `NaN`, or a guessed value. Unknown top-level fields are rejected; do not include names, MRNs, dates, filenames, or free-text identifiers.

The coordinate object must declare:

```json
{
  "origin": "corneal_vertex",
  "x_positive": "temporal",
  "y_positive": "superior",
  "z_positive": "posterior"
}
```

These directions are **an example, not an assumed Pentacam convention**. Accepted alternatives are `nasal`, `inferior`, and `anterior`, respectively. Determine the correct convention from the actual numerical export. All surfaces must use the **same** origin and z reference. Anterior and posterior surfaces independently zeroed at their own apex cannot be overlaid without a verified coordinate transformation; this application does not invent one. The viewer does not automatically mirror coordinates just because an eye is OD or OS.

## Surface layers and overlays

Each supplied `anterior` or `posterior` object must include `z_mm` with actual heights in the declared shared frame. At least one complete measured 2 × 2 cell is required. Heights must lie within the software's ±30 mm parser bounds. Bounds reject gross unit/format errors; they do not establish clinical plausibility or device accuracy.

Optional, same-shaped numerical maps:

| Map | Required metadata | What the viewer does |
|---|---|---|
| `anterior.curvature_D` / `posterior.curvature_D` | `curvature_type`: `axial`, `tangential`, `mean`, or `device_reported` | Colors the supplied geometry with the supplied curvature map. No curvature is inferred from Kmax or radii. |
| `anterior.elevation_um` / `posterior.elevation_um` | `elevation_reference` with `type` and `fit_diameter_mm` | Colors geometry with supplied elevation residuals. Residuals are not treated as physical shape heights. |
| Top-level `thickness_um` | `thickness_definition`: `device_pachymetry` | Colors geometry with supplied thickness. Thickness is not computed from z separation or summary C. |

Elevation reference `type` may be `best_fit_sphere`, `best_fit_ellipsoid`, or `device_reference`; fitting diameter must be positive and at most 24 mm. No reference sphere or ellipsoid is reconstructed from this metadata. It documents the provided residual map only.

Parser ranges: thickness 1–2000 µm, elevation −3000 to +3000 µm, curvature −1000 to +1000 D. Signed posterior curvature is permitted. These are broad structural safeguards, not normal/abnormal thresholds.

Unsupported or missing layers and maps stay unavailable. The posterior surface is never fabricated from anterior geometry plus thickness. An elevation-only, thickness-only, curvature-only, or summary-only file cannot unlock patient geometry.

## Rendering and inspection

The browser uses a local Canvas renderer with orthographic projection. Mesh vertices are the supplied x/y/z samples. Each complete grid cell contributes two planar triangles. A cell touching a missing geometry or selected-overlay sample is not drawn. No gap filling, extrapolation, smoothing, or resampling is performed. Interior triangle faces are a piecewise-planar display between measured vertices, not additional device measurements.

All spatial axes use millimetres at equal scale; there is **no vertical exaggeration**. Drag to rotate, scroll or use buttons to zoom, and select Front / Back / Oblique / Profile. Axes and the coordinate convention are displayed.

Face colors use the mean of the three supplied corner values. The numerical readout reports an actual selected grid sample, not a color-digitized or interpolated point. Clicking chooses a projected numerical sample; the explicit row/column and surface controls provide unambiguous sample inspection. With both surfaces shown, transparency can blend colors, so select one surface for quantitative inspection.

The “thinnest sampled point” and “maximum sampled curvature” markers use available numerical samples only. They need not equal the device's global thinnest point or reported Kmax, especially with limited coverage or missing data. The measured geometry viewer does not adjudicate progression. The separate reference-eye Change view can subtract maps already registered outside this app, under the additional contract in `MAP_COMPARISON.md`.

## Clinical context and privacy

Select and verify the source case, eye and visit in step 3. The same-ZIP numerical file must explicitly match that source. Independently verify its units and shared coordinate frame against the device before clinical interpretation. Wrong laterality/visit blocks measured rendering. A changed calculator context, new upload, or reset clears old geometry and revokes its confirmation. Surface data travel between the extractor, app and viewer frames within the same browser. They are never included in the Streamlit calculation request, PDF or numeric result download.

The viewer uses no patient name or date to establish an automatic match. Operator confirmation is indispensable. Use deidentified numerical data in an approved environment.

## CSV conversion, when a true pointwise export is available

`tools/convert_surface_csv.py` accepts a deidentified, explicitly labelled rectilinear grid in long-form CSV. It does not parse proprietary Pentacam binaries, report JPEGs, or an arbitrary `summary.csv`.

Supported exact column names:

```text
x_mm,y_mm,z_anterior_mm,z_posterior_mm,thickness_um,curvature_anterior_D,curvature_posterior_D,elevation_anterior_um,elevation_posterior_um
```

Only x/y and at least one actual z column are mandatory. Omit absent optional columns. Anterior and posterior z columns must share a known origin. Duplicate coordinates, unexpected/identifier columns, nonfinite numbers, or insufficient grid support are rejected. Missing cells stay missing. There is no scattered-point fitting or unit guessing.

Example invocation for an anterior z-only export whose documented axes match the stated example:

```bash
python tools/convert_surface_csv.py input_numeric.csv output_surface.json \
  --eye OD --visit first --kind measured \
  --origin corneal_vertex --x-positive temporal --y-positive superior \
  --z-positive posterior --confirm-coordinate-frame
```

Change these conventions to the actual documented export; do not use them as device defaults. The command refuses to overwrite an existing output.

When corresponding columns exist, also supply:

```text
--anterior-curvature-type axial
--posterior-curvature-type device_reported
--anterior-reference-type best_fit_sphere --anterior-fit-diameter-mm 8
--posterior-reference-type best_fit_sphere --posterior-fit-diameter-mm 8
```

Again, these are syntax examples, not assumptions about a particular scan. Copy the map type and fitting diameter from the verified source. Use `python tools/convert_surface_csv.py --help` for all options.

## Synthetic example

`components/cornea/synthetic_demo.json` and software-test fixtures are a fixed mathematical fixture, not a patient's eye and not a function of the calculator inputs. They include an intentional missing-data hole to demonstrate that the viewer does not fill it. Synthetic declaration and notices remain visible. Do not convert this fixture into claimed measured evidence.
