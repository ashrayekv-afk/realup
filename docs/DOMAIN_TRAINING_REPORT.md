> Historical candidate analysis (v7.7–v8.1). Versions 8.2–8.3 add a separately fitted all-adult research demo and NKPI trajectory. See [BASELINE_OUTLOOK.md](BASELINE_OUTLOOK.md) for the active model, validation and limits. The inactive candidates documented below remain unchanged.

# Six-month domain prediction: training and evaluation

**Result: candidates were trained, but patient forecasts were not released.**

The broader candidate showed weak discrimination (AUROC 0.574). Its probability
error was very close to that of the training-fold average. The near-six-month-only
candidate performed worse than that simple comparator. The data also do not
contain a third measurement set to test a prediction made after two visits.

## Source and cohort accounting

Source: user-provided `Data Extraction- KCN Project_8748(2).xlsx`, SHA-256
`60bd4895f669fa55bd4e7e37266c66a52497f250847869185dfa1424bfa882be`.
The workbook has Controls and CXL sheets with first and final measurement sets.
It does not supply a structured third measurement set, exact first-crossing times,
or a prospective population sampling denominator.

| Stage | Eyes | Patients |
|---|---:|---:|
| Historically described inventory | 426 | 234 |
| At least one numeric tomography value in the workbook | 425 | 234 |
| Existing parser's complete dated eligible pairs | 262 | 148 |
| Paired baseline age 18–50, before interval restriction | 195 | 110 |
| Primary development: age 18–50, interval 90 days–5 years | 179 | 101 |
| Direct 4–8-month subset | 43 | 27 |
| Narrower 5–7-month subset, counted only | 22 | 14 |

The original 426 count is not a count of complete forecasting examples. No
measurements were fabricated for the extra inventory slot or missing fields.
The reused conservative parser requires first-scan dates, DOB-derived age, six
in-range values at both visits, positive chronology and no recorded exclusion.
It excludes a known post-CXL later scan and explicit quality/diagnosis problems.
It does not establish that all remaining treatment dates, source transcription,
contact-lens washout or scan-quality metadata are correct. A study-level source
audit remains necessary. Earlier analyses using other eligibility definitions
can have different denominators.

Among the 195 age-eligible pairs, 11 had intervals below 90 days and 5 exceeded
five years. These interval limits were fixed before fitting to avoid pooling
very short repeat measurements and very long historical intervals around a
six-month target. They are development choices, not clinical follow-up rules.
The 4–8-month window is an approximate endpoint window and does not establish
the exact outcome at six calendar months.

## Outcome and predictors

The target is a **numerical ≥2-of-4 domain crossing at the later examination**
relative to the first examination. It is not the CXL-group label, a treatment
recommendation, or independently adjudicated clinical progression.

| Domain | Fixed strict crossing rule |
|---|---|
| Anterior | ARC decrease >0.106 mm OR Kmax increase >1 D |
| Posterior | PRC decrease >0.085 mm |
| Pachymetric | Thinnest decrease >2% of baseline OR ARTmax decrease >44.24 |
| Composite | BAD-D increase >0.42 |

Each domain contributes one point at most. The source for these unchanged rules
is SOURCE P0175 resubmission pages 3–4. Exact decimal comparisons are used, so
equality does not cross. These correlated domains are not assumed independent.
The model predicts their joint ≥2-domain endpoint directly; it does not multiply
four independent probabilities.

The primary cohort had 51 positive endpoints and 128 negative numerical
endpoints. Domain counts 0/1/2/3/4 and every test repeat are retained in the
aggregate JSON. Untreated eyes with worsening are not discarded or relabelled
to agree with the original CXL/control groups. Comparisons shorter than the
SOURCE protocol's six-month minimum contribute only exploratory numerical
labels, not SOURCE clinical classifications.

Predictors are first-scan age and A, B, C, BAD-D, ARTmax, Kmax plus log elapsed
years. Later values, changes, domain counts, NKPI and treatment-group membership
are excluded from the predictors. The elapsed interval represents the horizon
being evaluated; it does not add domain points. No artificial age protection,
age discount or annualized threshold scaling is imposed.

This supports an exploratory first-scan-to-later-scan question. It does **not**
test using the last two measurements and their slope to predict a third visit.
Reusing the second scan both as a predictor and as the target would leak the
answer into training. Treating a positive endpoint after several years as an
event at six months would invent its timing.

## Development and validation

The protocol was written before fitting and is included in `research/protocol.json`.
L2 logistic regression was selected for this small dataset. The penalty was
tuned from C = 0.01, 0.1, 1 and 10 by three-fold inner patient-grouped Brier loss.
Five outer patient-grouped folds produced held-out predictions. The complete
process was repeated with seeds 2718, 3141 and 1618. Both eyes of a patient always
stay in one fold. Scaling is fit within each training fold. The final artifacts
are refit on their full eligible cohorts after evaluation; training-set fit is
not reported as predictive performance.

Comparators use the training-fold endpoint prevalence or elapsed interval only.
There is no oversampling, class weighting, synthetic patient generation or
threshold adjustment. Calibration intercept/slope are descriptive held-out
diagnostics; no correction was fit and evaluated on those same predictions.
Metrics below use averaged out-of-fold probabilities. Every repeat is reported
in `research/domain_training/domain_outlook_validation.json`.

| Evaluation | Eyes / positive endpoints | AUROC | Brier error | Prevalence-comparator Brier |
|---|---:|---:|---:|---:|
| Broad candidate at each recorded interval | 179 / 51 | 0.574 | 0.2022 | 0.2038 |
| Broad candidate, held-out 4–8-month subset | 43 / 13 | 0.572 | 0.2097 | 0.2111 |
| Candidate trained only on 4–8-month pairs | 43 / 13 | 0.428 | 0.2204 | 0.2120 |

Lower Brier error is better. The broad candidate's improvement over the
prevalence comparator was only 0.00158, with a patient-cluster bootstrap 95%
interval of **−0.00484 to +0.00727**. Its AUROC interval was **0.468–0.673**.
The direct 4–8-month candidate's AUROC interval was **0.209–0.643**. These intervals
bootstrap the fixed averaged out-of-fold predictions across patients (1,500
resamples); they do not refit the entire development process or capture all its
uncertainty. They are not individual prediction intervals.

The broad candidate's descriptive calibration intercept/slope were 0.026/1.031
in this selected sample. This does not establish calibration in clinic. The
CXL/control sampling design and different follow-up patterns can distort
absolute risks and transport to another population. Slopes for near-constant
comparators are unstable and should not be interpreted as useful calibration.
No clinical net-benefit claim or decision threshold is supported by these tests.

## What is shipped

- Two actual fitted coefficient/scaler artifacts with target and release status.
- Reproducible source reconstruction and training code, fixed protocol and all
  aggregate results. No raw, pseudonymous or out-of-fold patient rows.
- The requested bilateral outlook cards followed by full domain details.
- An explicit **Training completed · Forecast withheld** state in the calculator.
  No candidate probability is computed for, displayed to or exported with a
  patient assessment. The website does not import the research models.

Extraction, existing NKPI artifacts, scoring, exact domain logic and numeric
exports are unchanged. The interface does not say that a model has never been
trained; it reports the actual testing outcome. The layout preview shows the
production withheld state with clearly labelled synthetic measurements.

## Data needed for the requested forecast

For a model using two visits and their preceding trend, collect a third
comparable scan around six months after the second, with exact examination
dates, all six values, acquisition-quality information and dated corneal
treatments. Define the prediction time, reference scan, outcome window and
handling of treatment before model development. Patients without an observed
future outcome must not silently become stable controls.

Use a representative longitudinal cohort or documented sampling information
for absolute-risk calibration. Keep a patient-separated validation cohort and
evaluate both discrimination and calibration at the intended horizon. Determine
the sample needed from the endpoint frequency and planned model complexity;
426 inventory eyes alone do not establish adequate forecasting sample size.

Method reporting reference: Collins et al., TRIPOD+AI, BMJ 2024;385:e078378 and
[expanded checklist](https://www.tripod-statement.org/wp-content/uploads/2024/04/TRIPODAI-Supplement.pdf),
particularly outcome/horizon, predictor timing, patient-level data separation,
missingness and performance reporting. This report is an exploratory development
record, not a claim of clinical or external validation.
