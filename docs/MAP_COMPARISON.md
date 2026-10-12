> Current release: 4.8.1 adds a report-only **visual** Change mode. See [VISUAL_CHANGE.md](VISUAL_CHANGE.md). The numerical-data requirements below still apply to calculated difference maps.

> This document records the map-component release and its verification. The
> combined release also contains the automatic DICOM importer; see
> the archived COMBINED_RELEASE notes in `../CHANGELOG.md` for the current merge checks.

# Map selection and visit comparison · 4.5.0

## Thickness fix

The former shortcut called `loadPage`, which immediately applied circle 0
(anterior elevation on a Belin report). Only afterward did it look for the
requested map role. If the detector missed any of the seven expected circles,
role naming failed and the first elevation map remained visible under Thickness.

This version selects the requested role inside the guarded image-loading path.
It never applies the first crop as a substitute for a requested map. Supported
Belin regions are matched independently by position after multiple layout
anchors agree, so a missing unrelated circle or different detection order no
longer removes the thickness label. The thickness target is the upper-right
pachymetry circle, separate from anterior and posterior elevation. This is still
a supported-layout proposal, not OCR verification of the printed title.

When the layout cannot be identified, the map is cleared and an explanation is
shown. The original report and manual circle selection remain available. No
unknown circle is called thickness merely because its colors look plausible.
Pending requests are invalidated on newer selections, source changes and reset.

## The new controls

- **Baseline / Latest:** original report pixels on the same existing reference
  eye. The map choice is retained when switching visits. Each original report's
  printed scale remains authoritative; these image scales are not rescaled.
- **Change:** latest minus baseline at each shared numerical coordinate. It
  keeps the same reference-eye geometry and uses a symmetric color range with
  green at zero, warm colors above zero and cool colors below zero.
- **Map choices:** anterior curvature (D), anterior elevation (µm), posterior
  elevation (µm), thickness/pachymetry (µm).
- **Sample row/column:** actual baseline value, latest value and signed change
  at that one coordinate. A local curvature change is not a change in global
  Kmax, and local thickness change is not the difference between two minima.

The eye is an illustration. Numerical differences color it; they do not change
its geometry. Negative thickness change means a lower supplied thickness at
that coordinate. Colors alone do not label progression, significance or treatment.
Review pins stay attached to their source report/crop and do not transfer into
Change. The existing separate measured-cornea mode remains available.

## Data required for Change

A report image, scalar C/thinnest thickness, Kmax or BAD-D is insufficient.
Neither JPEG colors nor text labels are digitized into a numerical map.
Image-only visits remain usable for Baseline / Latest and linked report views.

Both visits must carry an explicitly associated `nkpi-corneal-surface-1` JSON
inside the same imported source archive(s), using the existing naming/index
route below. The selected sources must be distinct, for the same eye, with
`visit: first` and `visit: latest`, and both must be verified in step 3.
The numerical schema is documented in `SURFACE_DATA.md`; its existing measured
geometry requirement is retained. This is not a proprietary Pentacam decoder.

For explicit associations, the ZIP root may contain `nkpi-surface-index.json`:

```json
{
  "schema": "nkpi-surface-index-1",
  "entries": [
    {"report": "baseline-report.png", "surface": "baseline.surface.json"},
    {"report": "latest-report.png", "surface": "latest.surface.json"}
  ]
}
```

These are placeholder filenames; use the actual report paths in that ZIP.
The importer must associate each report with the selected study. Files are
never assigned to visits solely by neighboring archive order.

Each numerical file can now include this optional top-level object:

```json
"comparison": {
  "alignment": "verified_common_grid",
  "registration_id": "deidentified-pair-grid-key",
  "map_definition_id": "verified-device-map-definition-key"
}
```

The object must match exactly between visits. The keys must be 1–80 characters
from letters, digits, underscore, dot or hyphen, without patient identifiers.
They are declarations by the verified exporter/converter, not proof supplied by
this app. Assign a common registration key only after actual registration to one
coordinate frame. Assign a common definition key only for equivalent map types,
units, device/processing conventions and definitions across the compared maps.
Simply adding equal strings does not make incompatible scans comparable.

`x_mm`, `y_mm`, coordinate conventions and map dimensions must also match exactly.
No interpolation onto a new grid, reflection, translation or registration is
performed. Different curvature types and missing map fields block comparison.
Both files must have the same measured/synthetic declaration. Synthetic input is
visibly labelled and cannot be mixed with patient input.

### Additional elevation requirement

Each compared surface's `elevation_reference` must include an optional
`reference_id` identifying the **actual same fixed reference** used to produce
both residual maps:

```json
"elevation_reference": {
  "type": "best_fit_sphere",
  "fit_diameter_mm": 8,
  "reference_id": "verified-common-anterior-reference"
}
```

This is syntax only, not a device default. The common reference key, type and
fitting diameter must all match. Using two independently fitted spheres of the
same type/diameter is insufficient. Anterior and posterior references have their
own keys. Existing numerical files without these optional keys still load as
before; unavailable comparison metadata blocks only Change.

### Converter options

For genuinely registered numerical CSV grids, the existing converter additionally
accepts:

```text
--comparison-registration-id VERIFIED_PAIR_KEY
--comparison-map-definition-id VERIFIED_DEFINITION_KEY
--confirm-visit-registration
--anterior-reference-id VERIFIED_COMMON_ANTERIOR_REFERENCE
--posterior-reference-id VERIFIED_COMMON_POSTERIOR_REFERENCE
```

The last two flags are needed only for supplied elevation maps you intend to
compare. Supply the original coordinate, map-type and fitting-diameter flags
as documented in `SURFACE_DATA.md`. The converter does not establish registration
or calculate residuals against a new common reference.

## Rendering and missing data

Subtraction uses only finite numerical samples present at the same coordinate in
both maps. Missing values stay null. At least one full overlapping 2 × 2 cell is
required. Texture shading uses bilinear interpolation within complete cells;
it does not bridge missing cells or extrapolate beyond supplied coordinates.
Printed map labels and the row/column readout use actual supplied samples.
The reference cap shows the circular part of the coordinate extent, with
positive x toward screen right and positive y upward; the declared anatomical
axis directions are printed beneath the legend. There is no automatic eye mirror.

The legend is symmetric about zero and covers the largest absolute difference
for the selected pair/map (at least 1 µm or 0.1 D for an all-zero map). It is a
visual scale, not a normality threshold. It may differ for a different pair/map.
Camera angle and opacity can change perceived colors but never numerical values.

## Verification scope

- 33 automated map-routing/comparison checks in `tests/test_map_changes.js`:
  independent thickness/elevation identity; missing, extra and reordered
  circles; ambiguity; signed values/units; null masks; nonmutation; matching eye,
  visit, axes, registration, map definitions and elevation reference requirements.
- Existing surface-contract and reference-map unit suites rerun against this
  version: 22 + 10 checks.
- 12 viewer scenarios in `tests/test_viewer_integration.cjs`, using production
  scripts in a **mock DOM/message harness with native Canvas pixels** and the
  actual software reference-eye renderer. Distinct synthetic report colors
  verify that the texture itself changes to pachymetry. Checks include visit
  switching, numerical Change, source-confirmation revocation, stale requests,
  missing maps, image-only limitations and patient reset.
- Converter integration: emitted metadata passes the JavaScript schema; missing
  registration confirmation rejects output.
- Syntax checked: 8 Python and 26 JavaScript files. All 35 local HTML resource
  references resolve.
  Frozen model files, scoring, ranked audit, report importer and reference-eye
  renderer compared byte-for-byte with the 4.4.0 lean source archive.
- Package manifest, ZIP CRC and extraction round trip checked.

The native Canvas harness is not a browser. Live Streamlit deployment, WebGL,
real report OCR, and accuracy against paired device numerical exports were not
validated in this environment. No patient report archive was provided for this
map fix; software fixtures are explicitly synthetic. The inherited import
limitations remain documented separately. This is software verification, not
clinical validation or evidence of progression.
