# Automatic decoded-report import — 4.5.0-auto-dicom

Decoded DICOM/PDF/TIFF/extensionless report pages are scanned automatically for the printed report title and eye. Recognized Topometric/KC-Staging and Belin/Ambrósio pages are paired and passed to the same measurement extraction pipeline used by standard Continuum JPEG exports.

Manual page matching remains only as a safety fallback when an unambiguous required pair cannot be identified. No model, feature, calibration, NKPI transformation, ranked-impact calculation, or 3D geometry rule was changed.
