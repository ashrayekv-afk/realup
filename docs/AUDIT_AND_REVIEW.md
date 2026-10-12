> Historical release notes. Current behavior is described in [NUMERICAL_MAPS.md](NUMERICAL_MAPS.md) and the root README.

> Deployment-only packaging note: this document is retained from the original release. Preview images, development tests and raw evidence logs referenced here are in the original full archive, not this 58-file upload. Runtime app files are unchanged.

# Audit-panel repair and source-linked review markers

## Reproduced behavior

In the preceding 4.2.0 component, the audit details element opened after a click (`open = true`) but returned to `open = false` after a duplicate parent `streamlit:render` message. The old listener unconditionally called `renderResults()`, which replaced `result-columns.innerHTML` even when the result was unchanged.

That is a reproduced failure path, not proof of the precise sequence in the user's deployed browser. Evidence: `test_evidence/prior_audit_collapse.json`.

## Repair

Unchanged result snapshots do not rebuild result DOM. Disclosure choices are kept per eye in memory and reset when that eye's inputs are invalidated. Native pointer and keyboard disclosure activation are preserved, and opening a panel notifies the container of its new height. The ranked table opens by default. Raw scan inputs and technical mapping remain separate expandable sections.

The new regression verifies that duplicate render events preserve both `open` state and the same DOM object; it also tests collapsed state, keyboard operation, iframe height and preservation of the unchanged fellow-eye panel after an edit.

## What the numbers mean

The original prediction function is untouched. A new independent audit recomputes its logistic output, verifies every stored training median and one-feature median-substitution effect, then builds a ranked table. A wrong median, effect or score causes a failure rather than a plausible-looking explanation.

Effects are measured on the actual displayed NKPI 0–100 scale. They are **not** calibrated clinical-risk differences, coefficients, standardized values, causal effects, or additive SHAP attributions. The same current result can have different median-substitution impacts for correlated features. In the two-visit model, later values and encoded changes are separate features: this sensitivity calculation does not claim that an isolated substitution represents a physically possible clinical intervention.

The 7/14 rows cover every actual model feature. No statistics or effects are invented for additional printed report fields outside these frozen models. The baseline and longitudinal training cohorts are explicitly labelled (301 and 262 eyes respectively), not described as a new 426-eye calculation.

## Source-linked review annotations

Pins are created by the operator on the selected image crop and copied into the corresponding reference-eye texture. The anatomical model remains fixed. The original report is retained unchanged; a separate canvas adds the original-report overlay. The marker list uses only predefined review labels, not free-text patient identifiers.

Every marker store key includes the session, laterality, visit, source-study ID, exact report image reference and crop coordinates. The marker location is a normalized position in that source image, not a corneal coordinate or a validated landmark. No annotation is propagated between maps or visits. A maximum of 12 pins per map and 32 in-session map records bounds memory. Reset removes all notes. There is no server storage.

A blank marker list does not mean a normal examination. A marked point does not automatically identify Kmax, minimum thickness, an elevated posterior point, a treatment target or an area destined to progress. No annotation influences model scoring.

## Useful next numerical features — not implemented here

A future numeric-only landmark module could locate the minimum supplied thickness, the maximum curvature of a specifically named map, and local elevation extrema relative to the declared reference. Locations would need x/y coordinates, units, valid masks and coverage checks; the highest value in a truncated export is not automatically the device's reported global maximum.

A future serial-change module should require the same eye, compatible map types/units, registration, common coverage, and compatible reference surfaces/scales. Original heat-map colors must not be treated as comparable numeric differences. A changed elevation reference can change an elevation map without representing the same biological change.

Neither feature is represented by the manual pins in this release. Summary model features such as age, BAD-D and ARTmax do not supply a spatial contribution map.

## Technical references consulted

- Streamlit documentation: https://docs.streamlit.io/develop/concepts/custom-components/components-v1/create
- OCULUS Pentacam HR map/reference descriptions: https://www.oculus.de/en/products/pentacam-hr/
- OCULUS Pentacam FAQ (power-map types and BFS/EBFS): https://www.oculus.de/en/products/pentacam/

These references support interpretation constraints and component design; they do not validate this prototype or its numeric outputs.
