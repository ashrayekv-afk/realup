> Historical forecast documentation: the 12-month forecast display was retired in version 8.7. Internal audit dependencies remain. See docs/REGIONAL_CHANGE.md for the active new supplement.

# Research artifacts — interface 8.6

`baseline_forecast_demo.json` and its checksum contain the **new topographic trajectory** (`trajectory.version = 2.0.0-topography`) and the historical audit-only numerical-domain probability model. Only the trajectory was refitted. See `../docs/BASELINE_OUTLOOK.md` for exact formulas, assumptions, results, sample counts and limitations.

`train_topography.py` reproduces the constrained multi-output fit, nested patient-grouped assessment, comparator fits, aggregate metrics and private out-of-fold audit. It accepts an authorized private paired table and updates the active artifact in an isolated research copy. Training requires numpy, pandas, scipy and scikit-learn; the deployed app does not run training or add a new service dependency.

`evidence_model.json` and its checksum are unchanged and are used only for separately labelled cohort-adjusted observed rates. Primary reference-evidence flags do not use this fitted prior. `fit_observed_evidence.py` reproduces that prior.

`train_domain_outlook.py`, `domain_training/`, `protocol.json` and `trajectory_feasibility.json` retain historical six-month/domain-probability experiments and prior trajectory recipes. They are not the new topographic model evaluation. The old hardcoded-path `evaluate_trajectory.py` script is retired; its aggregate report is retained.

No clinic case-level follow-up dataset was added. The user-reported observations supply only an explicit NKPI/activity direction assumption. No patient rows, report images, credentials, or private out-of-fold records belong in the public package.
