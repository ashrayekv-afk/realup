> Historical forecast documentation: the 12-month forecast display was retired in version 8.7. Internal audit dependencies remain. See docs/REGIONAL_CHANGE.md for the active new supplement.

# Baseline topographic outlook — v8.6

## Intended meaning

The display answers: **under a constrained, untreated research scenario fitted to our paired observations, how would the frozen baseline NKPI change if the modeled corneal measurements occurred?** It does not diagnose progression, estimate a patient's probability of progression, predict CXL benefit, or establish stability from a small line slope.

One baseline scan does not reveal that eye's actual velocity. This model estimates a shared cohort pattern conditional on the available baseline information. It deliberately uses conservative complexity because only 232 eligible eye pairs / 130 patients support development. The historical 426-eye inventory is not the number of complete eligible forecast pairs.

## Evidence layers and assumptions

| Input | Used for | Not used for |
|---|---|---|
| Actual paired dataset | Fit signed changes and evaluate held-out patient groups | Filling missing future observations |
| Published natural history | Younger-age and steeper-baseline directional constraints | Copying pooled means, hazard ratios or percentages into a patient forecast |
| User's clinic observations | Nondecreasing NKPI/shared-activity research constraint | Treating a reported 98% detection rate or imminent CXL scheduling as prospective 12-month outcomes |
| Modeling judgment | Nonnegative central structural drift, shared factor and thinness interaction | Claiming every untreated eye progresses |

References: [Ferdi et al., natural-history meta-analysis](https://pubmed.ncbi.nlm.nih.gov/30858022/), [Save Sight untreated registry](https://pubmed.ncbi.nlm.nih.gov/33785509/), [Wittig-Silva et al., randomized CXL trial](https://pubmed.ncbi.nlm.nih.gov/24393351/). Age and Kmax associations motivate direction, not individual rate calibration. Treatment effects from the trial are not imported. The thinness interaction is a candidate assumption, not a demonstrated causal effect.

These are imposed constraints that must be tested, not discoveries from this dataset. The constrained model does not allow its central raw-measurement rates to point toward improvement. **Observed negative changes were retained in training and evaluation.** They were not relabelled, set to zero or excluded to make curves rise.

## Exact deployed calculation

Let `N` be the current frozen single-visit NKPI (0–100), `n=N/100`, `a` the baseline age, `K` baseline Kmax and `C` baseline thinnest pachymetry.

```
youth = clip((100-a)/82, 0, 1)
steep = clip((K-40)/40, 0, 1.5)
thin  = clip((550-C)/250, 0, 1.5)
x = [1, n, n*n, n*youth, n*steep, n*thin]
activity = x dot fitted_activity_coefficients
rate[j] = activity * fitted_pattern[j] * scale[j] * direction[j]
measurement[j, month] = baseline[j] + rate[j] * month/12
projected_NKPI[month] = frozen_baseline_NKPI(baseline_age, projected_measurements)
```

Feature order: A, B, C, BAD-D, ARTmax, Kmax. Scales are `[0.106, 0.085, 0.02*baseline_C, 0.42, 44.24, 1]`, directions `[-1,-1,-1,+1,-1,+1]`. These scales normalize the learning problem; they are not new validated progression thresholds.

The factor coefficients are nonnegative. Their exact values and checksums are in `research/baseline_forecast_demo.json` under `trajectory`. A single learned pattern couples all six rates (rank-one multi-output model). Baseline values still differ between eyes, but the relative normalized rates share this pattern. This limits individualized phenotype variation.

At fixed other predictor summaries, activity cannot decrease as NKPI increases, as baseline age decreases, as Kmax increases, or as thickness decreases. Current NKPI itself depends on age and all six measurements; these partial constraints are not causal effects or a guarantee of ordering every different patient's score change. There is no step at NKPI 20/50/65, probability floor, room-to-100 multiplier, or forced positive NKPI increment. Low scores produce smaller central structural activity, not a quantified chance of stability.

Age is held at its baseline value for every future NKPI rescore. Quarterly points are calculated on the assumed constant annual raw-measurement rate, not separately observed or independently fitted. Future measurements are clipped to the existing calculator input bounds and clipping is reported. Development-range extrapolation and sparse score-band support are flagged.

Because the frozen NKPI classifier has opposing coefficients for correlated measurements, some modeled structural changes can lower its score contribution. No postprocessing replaces a small or negative net score change with an invented upward value. Score change and biological progression remain different quantities.

## Why the two drivers add up correctly

All 64 combinations of current/projected values for the six variables are rescored at fixed age. Exact six-variable Shapley contributions average each variable's effect over every possible ordering. All six contributions sum to the final NKPI minus current NKPI. The two largest absolute contributions appear on the main card; other measurements can offset them. This explains the calculation, not causal physiology.

## Development and evaluation

Complete paired adults aged 18–100 and scan intervals 90 days to five years were included: 232 eyes / 130 patients from 262 complete pairs. Treatment timing and scan quality were not fully audited. The paired source is intended pretreatment; this is not a verified untreated natural-history cohort. CXL/control ascertainment may bias the sample.

Targets are the actual signed six-variable changes. Fit uses bounded nonnegative nonlinear least squares with soft-L1 loss. Pair weight is `1 / number_of_eligible_eyes_for_patient / (1+interval_years^2)`, a design choice rather than an estimated measurement-noise model. L2 penalties `[0.1,1,10]` are chosen in three patient-grouped inner folds using mean normalized absolute error on available 9–15-month observations. The outer evaluation uses five patient-grouped folds repeated at seeds 2718, 3141 and 1618; test predictions are averaged across repeats. Both eyes stay together. Final selected penalty is 1.

Comparators use unchanged raw measurements and unrestricted multi-output ridge with matched features/time weighting and internal penalty selection. The older direct-index trajectory is retired; it was not evaluated as an additional held-out comparator in this release. Prior v8.5 headline metrics used age-advanced targets and must not be used to claim a v8.6 improvement on the fixed-age target.

The frozen NKPI transform was developed on overlapping records. Although new trajectory fitting/tuning groups patients correctly, the NKPI input and target are reused. This is conditional internal assessment, not fully independent end-to-end, external or prospective validation.

## Near-year results: 45 eyes / 25 patients

| Metric | Constrained joint model | Unrestricted ridge | Unchanged measurements |
|---|---:|---:|---:|
| Mean normalized absolute measurement error | 1.4059 | 1.4046 | 1.4222 |
| Fixed-age NKPI RMSE, points | 3.9195 | 3.9019 | 3.9315 |
| Fixed-age NKPI MAE, points | 1.9172 | 1.8835 | 1.9635 |
| Kmax MAE, D | 2.1006 | See artifact | 2.0667 |

The paired patient-cluster bootstrap interval for normalized-MAE improvement over unchanged measurements was **−0.0483 to +0.0719** (95th-percentile interval, 1,000 resamples of fixed out-of-fold predictions). It includes no improvement. It does not include uncertainty from repeating model selection or development of the original NKPI. No individual prediction intervals or clinical probabilities are inferred from these errors.

Across all variable intervals, joint NKPI RMSE was 3.4377 versus 3.3958 for unchanged measurements; normalized MAE 1.2043 versus 1.1877. Performance is not uniformly better. These results do not establish meaningful forecast accuracy improvement. No joint-model out-of-fold prediction required calculator-bound clipping at observed follow-up times.

| Baseline NKPI | Eligible training eyes | Eyes near one year |
|---|---:|---:|
| <20 | 106 | 21 |
| 20–<50 | 112 | 18 |
| 50–<65 | 13 | 5 |
| ≥65 | 1 | 1 |

These are support counts, not event rates. High-NKPI forecasts are especially uncertain; no 75% or 80% progression rate follows from a high score. Clinician expectations motivate the experimental direction constraint but do not replace outcome validation.

## Reproduction

Runtime dependencies remain unchanged. Offline training needs numpy, pandas, scipy and scikit-learn plus the authorized private paired table. No private rows are shipped.

```
python research/train_topography.py --paired /private/private_paired.csv --root . --private-out /private/new_topographic_audit
```

This overwrites the active trajectory artifact and checksum. Run in an isolated research copy. Required input columns are `patient_id`, `eye`, `age_baseline`, `interval_years`, `outcome`, and `baseline_` / `latest_` for the six keys. `outcome` is used to stratify patient-grouped splits, not as a forecast predictor. The trainer checks duplicate eye pairs and finite measurements.

The prefit protocol specified unchanged measurements, unrestricted ridge and the former direct-index trend as planned comparisons. The actual evaluation implemented the first two; the third was restricted to mechanistic review because its former target advanced age. This deviation is recorded rather than implying an unevaluated comparison passed.

Original NKPI model weights, extraction and observed-evidence calculations remain unchanged. The old numerical-domain probability model is retained in audit output for backward compatibility and is not this new forecast. Its coefficients and validation should not be confused with `trajectory` version 2.0.0-topography.
