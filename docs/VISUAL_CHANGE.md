> Historical release notes. Current behavior is described in [NUMERICAL_MAPS.md](NUMERICAL_MAPS.md) and the root README.

# Visual Change — 4.8.1

## Behavior

The viewer keeps exactly seven buttons: Baseline, Latest, Change; Curvature, Elevation, Posterior elevation, Thickness. Both imported eyes use the same controls. The fixed reference-eye renderer is unchanged.

Change has two explicitly distinguished paths:

| Available data | Display |
|---|---|
| Both compatible numerical surface exports | Existing latest-minus-baseline numerical texture, signed units and color legend |
| Two matching supported report images | Alternating original baseline/latest textures, labeled VISUAL COMPARISON, without delta values or a delta legend |
| Missing visit/map, unverified sources, mismatched report layout/printed scale | Specific unavailable message; no other map or eye is substituted |

If two numerical exports are supplied but fail their comparison checks, the error remains visible. An invalid numerical comparison is not silently replaced with an image comparison.

The image path uses a fixed crop anchored to verified printed panel frames, shared by both visits. It does not fit each crop separately to the colored extent. This prevents variation in detected map bounds from independently zooming/recentering the two images. This is **report-layout alignment**, not registration of measured corneal surfaces.

The image path currently supports standard Topometric/KC-Staging and Belin-Ambrósio pages with the tested 1200×838 or 1200×902 proportions (including the manufacturer masthead), with uniform scaling. Other report layouts remain available under Baseline/Latest when identified, but cannot enter visual Change until their layouts/scales are supported.

The supported page proportions, printed panel-frame lines, header separator and printed color-scale image must match. Color-region sizes and neighboring map centroids are not used to align or reject the comparison. The selected map identity must belong to its verified panel. Legend comparison uses the original legend pixels including the printed labels. It allows only very small raster variation (mean maximum-channel difference ≤0.25/255; fraction over 10/255 ≤0.0005; at least 25% chromatic pixels). This is a conservative image compatibility check, not numeric OCR or calibration. Both supplied pairs had identical legend pixels.

Small colored summary boxes are excluded from Belin map-column and thickness identification. This fixes the real case where red result boxes were confused with a pachymetry candidate.

## Interaction and lifecycle

- Original visit textures alternate every two seconds, synchronized across both eyes.
- Clicking Change again switches the displayed visit and keeps comparison running. Baseline and Latest hold a fixed view. Holding the eye during rotation pauses switching.
- Reduced-motion preference disables automatic switching; repeated Change clicks switch the visit manually.
- Missing/disabled eyes do not inherit another eye's textures.
- Switching tabs/map type, invalidating verification, changing source generation, or resetting the session clears obsolete state and timers.
- Hidden documents do not advance the displayed phase.

## Interpretation limits

An image comparison cannot recover exact spatial measurements from a compressed color report. Printed numbers and contours remain original pixels. Independent fitted elevation reference surfaces can affect the appearance of the elevation maps; this view does not transform them into a common reference or assert physical elevation change. No progression classification, treatment recommendation, inferred raw surface, interpolation of hidden measurements, or new model input is generated.

The supplied scans include Align! and Data Gaps quality flags. The viewer directs the user to check source QS; a visually different report is not proof of biological progression. The existing source-review workflow remains necessary. No report quality flag is overridden by this feature.

An attempted automatic color-legend recovery from the supplied JPEG reports did not consistently recover all printed values. That experimental conversion is **not shipped**. A quantitatively validated image-derived difference map remains unfinished. The intended quantitative route is compatible original numerical grids, or a separately validated importer for device-generated serial difference reports.

## Data handling

Only already importer-associated source images are used. Processing remains local to the browser. No patient report pixels, image-derived measurements or patient names are added to model requests or distributed code. Importer, model files, scoring and the eye's fixed geometry are unchanged.
