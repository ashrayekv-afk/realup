# Numerical curvature/thickness maps — 5.0

## Sources and provenance

There are two separate routes:

- **Registered numerical exports:** supplied grids, units, coordinate conventions,
  map meanings and matching registration keys. The existing surface schema is
  retained. `nkpi-corneal-maps-1` additionally permits curvature/thickness grids
  without z coordinates. Optional z coordinates can still be supplied. The same
  units object and explicit ZIP association are required. Map-only data never
  become measured geometry merely by passing validation.
- **Calibrated report images:** explicitly estimated values from matching printed
  legends. There is no OCR inference of missing legend numbers and no patient
  fixture embedded in the app. `calibration_profiles.js` contains only generic
  printed legends and zoom labels, with their transcribed numeric scale.

The report route is calibrated for the tested 1200×838 report body, optionally
preceded by a 64-pixel manufacturer masthead. Both the actual printed panel frame
and the legend/zoom raster must match. Other renders/resolutions/compressions may
fail the deliberately strict calibration check even if their titles are familiar.
An additional verified calibration is needed before numerical use of such images.

## Image decoding

Topometric front axial/sagittal curvature is printed as radius in millimetres.
The viewer uses `337.5 / radius_mm` to display keratometric dioptres (index 1.3375).
It does not confuse radius with D or substitute tangential/total refractive power.
The Belin pachymetry legend is in µm. Sixty-one fine-scale palette entries are
anchored to the sixteen printed major values; JPEG color recovery is approximate.

The calibrated display is 9 mm in diameter. Fixed printed map centers and scale
place samples on an 81×81 grid over the central 8 mm. A 7×7 source-pixel patch
rejects insufficient saturation, poor palette matches and heterogeneous stroke
pixels. White text blocks, black contours, colored meridians, missing coverage and
unmatched colors can therefore produce missing samples. Their underlying values
are not recovered by reading the printed annotations.

The stored map keeps these samples null. Rendering uses bilinear interpolation
only where all four cell samples exist; otherwise the nearest actual grid sample
is displayed if it exists. A missing nearest sample remains transparent/hatched.
This display interpolation creates no additional measurements. Point readouts
always select stored grid samples.

## Difference maps

`delta = latest - baseline` at matching coordinates. Image-derived comparisons
use a verified shared printed coordinate layout, **not anatomical registration**.
No feature registration is performed on the heat pattern: aligning the cone could
hide actual changes. Identical input maps produce zero on every retained point.
Only overlap of valid decoded samples enters the difference. Unsupported scales,
map definitions, missing visits and unverified sources cannot produce a result.
Native maps still require the declared verified registration/map-definition keys.
Native/image-derived sources are never mixed in one difference map.

The change legend is symmetric about zero and shared by OD and OS. Blue is negative,
white is zero decoded difference and red is positive. For thickness, negative
means thinner; for keratometric power, positive means steeper. Zero does not establish
biological stability. Decoding uncertainty and scan/alignment error are not a
clinical confidence interval. In these color scales, especially thickness, small
reported changes can be smaller than the color decoding resolution.

## Geometry

Geometry and numeric map availability are independent.

1. Actual supplied anterior coordinates take priority. Supplied posterior
   coordinates, if available in the shared reference frame, are used directly.
   They are placed on an illustrative globe without changing their relative
   coordinates. Patient identity/provenance is operator-verified, not authenticated
   by this application.
2. With compatible axial curvature and thickness grids, an **estimated** cap can
   be built. Only for this model, a local median field with at least eight nearby
   samples smooths/bridges small annotation gaps (up to about 0.5 mm on the report
   grid). These values are never written back into the numerical maps or changes.
3. Along each meridian, axial radius R and radial position r define the approximate
   slope `r / sqrt(R²-r²)`. Midpoint integration builds a vertex-referenced sag
   surface. Its central supported diameter is at most 7.6 mm. Invalid slopes or
   unsupported paths do not produce vertices. This meridional construction and its
   boundary conditions are assumptions; irregular corneal curvature does not
   uniquely specify a measured 3D surface.
4. For estimated geometry only, thickness supplies a depth-axis offset for a
   modeled back surface. This is not proof of measured posterior coordinates or
   equivalence to the device's pachymetric distance convention. It is identified
   as an approximate reconstruction. Selecting another overlay does not rebuild
   a contradictory geometry for the same visit.
5. The surrounding globe and shaded outer rim are illustrations. There is no
   vertical exaggeration. Change uses the latest geometry with the difference
   overlay; it does not claim an anatomical displacement map. Thickness exposes
   the model's cross-section automatically.

Baseline/Latest 3D models retain original source colors and labels, including
radius in **mm** on original curvature maps. The separate decoded curvature
heatmap/readout is in **D**. The surface stamp identifies the original map unit.
Change overlays contain calculated signed differences in D or µm.

## Scientific context and limits

OCULUS describes sagittal curvature and the keratometric refractive index in
its [2024 interpretation guide, section 4.1.2](https://www.pentacam.com/fileadmin/user_upload/pentacam.de/downloads/interpretations-leitfaden/Pentacam_Interpretation_Guide_Ophth_EN_0624.pdf).
This reference explains the map definition; it does not validate our image
reconstruction, registration, uncertainty or 3D approximation.

The supplied baseline/follow-up report pairs were used for integration testing.
No paired raw device arrays or device-generated longitudinal difference maps were
available for a numerical accuracy comparison. This release is not clinically
validated for progression assessment or treatment decisions. It adds no model
features, changes no NKPI prediction, and sends no derived map arrays to Python.
