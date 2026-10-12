"""Independent median-substitution audit on the frozen, displayed NKPI scale.

This is model sensitivity, not additive SHAP or a causal treatment effect.
No fit, parameter, score transformation or cohort statistic is changed here.
"""
from __future__ import annotations

import math
from typing import Any
from .assessment import model


def _index(logit: float) -> float:
    if logit >= 0:
        return 100.0 / (1.0 + math.exp(-logit))
    exp = math.exp(logit)
    return 100.0 * exp / (1.0 + exp)


def ranked_impact_audit(result: dict[str, Any]) -> dict[str, Any] | None:
    """Verify every effect and attach units, source and actual model cohort size."""
    prediction = result.get('prediction')
    if prediction is None:
        return None
    artifact = model(result['case']['mode'])
    names = artifact['features']
    effects = {row['feature']: row for row in prediction['effects']}
    if len(effects) != len(names) or set(effects) != set(names):
        raise ValueError('Incomplete feature-impact audit.')
    terms = [
        (effects[name]['value'] - artifact['center'][i])
        / artifact['scale'][i] * artifact['coefficients'][i]
        for i, name in enumerate(names)
    ]
    logit = artifact['intercept'] + math.fsum(terms)
    score = _index(logit)
    if not math.isclose(prediction['nkpi'], score, rel_tol=1e-12, abs_tol=1e-10):
        raise ValueError('Score/impact snapshot mismatch.')
    rows = []
    units = {'A': 'mm', 'B': 'mm', 'C': 'µm', 'Kmax': 'D', 'BAD_D': '', 'ARTmax': ''}
    for i, name in enumerate(names):
        effect = effects[name]
        spec, stats = artifact['feature_spec'][name], artifact['feature_stats'][name]
        reference_term = (stats['median'] - artifact['center'][i]) / artifact['scale'][i] * artifact['coefficients'][i]
        counterfactual = _index(logit - terms[i] + reference_term)
        delta = score - counterfactual
        if not all(isinstance(effect[key], (float, int)) and math.isfinite(effect[key])
                   for key in ('value', 'reference', 'effect')):
            raise ValueError('Non-finite model explanation.')
        if not math.isclose(effect['reference'], stats['median'], rel_tol=1e-12, abs_tol=1e-12):
            raise ValueError('The explanation median does not match the frozen model cohort.')
        if not math.isclose(effect['effect'], delta, rel_tol=1e-12, abs_tol=1e-10):
            raise ValueError('The explanation effect does not match the model score.')
        unit = 'years' if spec['source'] in ('age', 'interval_years') else units.get(spec.get('key'), '')
        rows.append({
            'feature': name, 'label': artifact['feature_labels'][name], 'key': spec.get('key'),
            'source': spec['source'], 'direction': spec.get('direction', 1), 'unit': unit,
            'value': effect['value'], 'reference': stats['median'],
            'difference_from_median': effect['value'] - stats['median'],
            'effect_points': delta, 'nkpi_at_median': counterfactual,
            'outside_training_range': not stats['min'] <= effect['value'] <= stats['max'],
        })
    # Stable sort: ties use the model's declared feature order. Never rank rounded values.
    rows.sort(key=lambda row: abs(row['effect_points']), reverse=True)
    for rank, row in enumerate(rows, start=1):
        row['rank'] = rank
    return {
        'method': 'one_feature_to_stored_training_median',
        'unit': 'NKPI points on the displayed 0–100 scale',
        'additive': False, 'causal': False,
        'cohort': artifact['metadata']['cohort'],
        'rows': rows,
    }
