> Deployment-only packaging note: this document is retained from the original release. Preview images, development tests and raw evidence logs referenced here are in the original full archive, not this 58-file upload. Runtime app files are unchanged.

# Report import repair: cause, behavior and boundaries

## What was actually observed

The screenshot displays: "no JPG, JPEG, or PNG Pentacam report images were found in the ZIP." The preceding code used a filename-extension filter and did not recursively decode nested ZIPs or convert PDF/DICOM/TIFF report containers. This is a failure before reading the six numerical model inputs; it does not prove they are absent on the source reports.

Only screenshots of the failing upload were available. The exact ZIP was not found among accessible source archives. Its internal format, compression and report layout are therefore **not established**. A historical 26-JPEG sample archive was used for backwards-compatibility checks, not as a substitute for the actual failing case.

## New byte-to-report path

`Selected file → bounded archive/signature reader → browser report decoding → scoped standard source groups OR explicit operator page association → existing measurement extraction/source review → existing model snapshot audit`

Report-image outputs also use the existing original-map and 3D texture route. DICOM/PDF pages are report pictures, not numerical corneal surface grids. They never unlock measured geometry by themselves.

JPEG/JFIF, PNG, BMP and WebP are identified from their bytes. Signature detection handles empty/misleading file extensions. ZIPs are scanned recursively with cumulative expanded-size, entry-count, depth, decoded-page and image-dimension limits. Mac metadata files are skipped. Ambiguous normalized paths or source collisions fail rather than silently overwrite.

PDF pages use PDF.js in a browser worker with dynamic code evaluation disabled. TIFF pages use the optional pinned UTIF decoder. Those libraries require network access in this package; decoder-loading failures produce precise diagnostics. Successful rendering with those third-party libraries was not tested in the build environment.

The local DICOM adapter supports a restricted subset of Part 10 report objects: explicit/implicit little-endian unsigned 8-bit RGB or MONOCHROME1/2, JPEG Baseline encapsulated frames with unambiguous boundaries, and encapsulated PDF delegated to PDF.js. It does not guess a missing transfer syntax, rescale higher-bit-depth/OCT images, decode JPEG 2000/JPEG-LS/RLE, or infer eye identity. Unsupported forms are counted and explained rather than discarded under a generic no-JPG error.

## Unfamiliar page layouts

Pages are shown without pretending that page order proves eye or examination identity. The operator chooses the Topometric/KC-Staging and Belin/Ambrósio report for each eye/study and confirms their identity. An optional progression page and extra same-study maps can be selected. A page cannot be assigned to two different source studies. A combined source page requires manual entry, not inappropriate automatic cropping.

Once linked, the existing extractor runs. If its dependency or extraction fails, the pages are retained and all six measurements start blank. The operator must enter and verify each measurement against the source before the existing Calculate button becomes available. No model defaults, median imputation, copied opposite-eye values or generated measurements are used.

Old results are invalidated immediately on starting either import route. Cancelling, changing files or clearing the patient rejects pending association work. Report identifiers, DICOM attributes, original filenames, page images and local file-type diagnostics never enter the numerical model payload.

## Technical references consulted

Primary-source documentation for the implementation boundaries:

```text
JSZip API and limitations:
https://stuk.github.io/jszip/documentation/api_jszip/load_async.html
https://stuk.github.io/jszip/documentation/limitations.html
PDF.js browser rendering examples:
https://mozilla.github.io/pdf.js/examples/
UTIF decoder interface:
https://github.com/photopea/UTIF.js
DICOM native/encapsulated pixel encoding:
https://dicom.nema.org/medical/Dicom/2024c/output/chtml/part05/sect_8.2.html
DICOM encapsulated document attributes:
https://dicom.nema.org/medical/dicom/2023d/output/chtml/part03/sect_C.24.2.html
```

These references describe formats/APIs. They do not establish compatibility with the screenshot archive or clinical accuracy of extraction or geometry.
