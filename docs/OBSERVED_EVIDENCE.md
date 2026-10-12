# Observed evidence — method 1.0 / interface 8.0

## What the screen answers

“How large and consistent are the observed changes compared with these external measurement-precision references?” It does not answer the probability of future progression or whether CXL is indicated. The observed evidence rule is independent of NKPI and the cohort slope prior.

## Reference values

Published coefficients of repeatability (COR, approximately 95% of same-day pair differences):

| Raw measure | Pair reference used | Basis |
|---|---:|---|
| ARC | 0.106 mm | Neuhann Table 1 |
| PRC | 0.131 mm | Neuhann Table 1 |
| Minimum thickness | 14.2 µm | Larger of 11.266 and 14.2 from the two studies |
| Kmax <48.2 D | 0.926 D | Pooled floor; severity estimate 0.32 |
| Kmax 48.2–<53.9 D | 1.33 D | Gustafsson severity band |
| Kmax ≥53.9 D | 1.62 D | Gustafsson severity band |
| ARTmax | 44.240 | Neuhann Table 1 |
| Final BAD-D | 0.810 | Neuhann Table 1; not the Dt component |

Sources: [Neuhann et al. 2020](https://doi.org/10.1038/s41598-020-76020-6), [Gustafsson et al. 2020](https://doi.org/10.1371/journal.pone.0228992).

The pooled floor and choice of the larger thickness value are conservative engineering choices, not a published combined algorithm. The historical SOURCE PRC and BAD-D thresholds are different quantities and are not reused as scan-error estimates. Only Kmax has a severity adjustment. No undocumented severity equation is invented for the other fields.

## Calculation

For each scan and variable, working single-scan SD = COR / (1.96 × √2). Unique same-day scans are grouped: their median is the visit value. Visit error is the larger of the external single-scan reference and the measured within-day sample SD. There is no automatic 1/√n repeat-count bonus.

Fit a separate weighted straight line to each measurement against actual elapsed years (365.2425 days/year), with weight 1/visit-SD². The slope standard error is 1/√Σw(t−weighted-mean-t)². With more than two dates, multiply its variance by max(1, weighted residual sum of squares/(dates−2)). This reduces confidence when the straight-trend approximation fits poorly.

Signed evidence Z = worsening-direction × observed slope / slope-SE. Decreasing ARC, PRC, thickness and ARTmax are worsening-positive; increasing Kmax and BAD-D are worsening-positive.

Group Z values are mean(Z_ARC, Z_Kmax), Z_PRC, and mean(Z_thickness, Z_ARTmax). A worst-case correlation bound treats the averaged Z's variance as no less conservative than assuming perfect positive within-group correlation. No independence gain is claimed for two related measures. One-sided Gaussian tails are then adjusted with Holm across the three structural groups at nominal 0.05. This calibration depends on the error model; the nominal level is not an established clinical false-positive rate.

BAD-D is supporting only (Z >1.96), never another independent vote. A mixed-direction flag appears when one within-group component exceeds +0.5 and another is below −0.5; this display rule is descriptive.

For two scans, changing only the interval changes slope and slope-SE proportionally. The evidence Z and structural count remain the same. This is deliberate: a longer interval makes a given difference slower, not automatically more convincing. Short-interval rates remain noisier in units/year. Rates are descriptions, not future extrapolations.

## Cohort-adjusted rates

An empirical-Bayes multivariate random-slope distribution was refitted to 179 eligible complete pairs / 101 patients, ages 18–50, intervals 90 days–5 years. Patients contribute equal total fitting weight across their eyes. Measured deltas are modeled as elapsed time × latent slope plus external heteroscedastic measurement noise. EM estimates the mean and positive-definite covariance. The cohort covariance captures correlated slope patterns; cross-variable measurement error is still a working diagonal approximation.

Posterior shrinkage provides a separately labelled **Adjusted rate** in the audit. It never changes the primary evidence flags. Rates are omitted outside the fitting age/interval/measurement range. The selected retrospective cohort is not a representative untreated natural-history sample; treatment/outcome calibration and future-scan validation have not been established. CXL-group labels are not used in this fitting.

## Import and snapshot integrity

Selected first/latest values retain existing verification. Optional extra scans require resolved six-variable extraction, same eye, acceptable source quality, a valid date inside the selected comparison and no manual-edit ambiguity. Source dates, patient names, filenames and images do not enter the numeric history payload; only relative integer days and measurements do. Changing selected values or the interval clears extra history until reimport.

Duplicate day/value exports are suppressed. Repeated dates are grouped. History is limited to 40 additional scans and is bound into the input fingerprint. The frontend independently checks input values, rates/Z relationships, domain mappings, counts and artifact identity before display. Both eye histories are isolated. PDFs retain the original NKPI report; the audited JSON contains the new supplement.

## Limits and next validation

The evidence screen transfers same-day device studies to longitudinal comparisons. Interday variability, device/software differences, contact lenses, ocular surface effects and within-eye temporal correlations are not estimated. Two visits cannot identify individual measurement noise or persistent biological progression. Out-of-reference measurements are flagged. Known treatment or scan-quality warnings withhold this supplement; unknown quality/treatment remains explicitly unknown in reliability details.

The doubled-error sensitivity check is only a stress test. It does not bound every source of uncertainty. Neither the evidence rule nor the cohort adjustment has demonstrated clinical sensitivity, specificity, calibration or six-month predictive accuracy. Engineering verification is not clinical validation.

The next study needs representative repeated scans, adjudicated progression, treatment timing and later visits. Split and validate by patient, assess severity/device strata, and compare with simpler observed-change methods before clinical claims. Do not tune thresholds to force agreement with NKPI.
