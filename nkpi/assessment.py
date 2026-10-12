"""Checked bilateral inference. No patient storage or executable model files."""
from functools import lru_cache
from pathlib import Path
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parents[1]
FEATURES = [
    dict(key='A', label='A · ARC', name='Anterior radius', unit='mm', decimals=2, low=2.5, high=12.5),
    dict(key='B', label='B · PRC', name='Posterior radius', unit='mm', decimals=2, low=2.5, high=12.5),
    dict(key='C', label='C · Thinnest', name='Minimum pachymetry', unit='µm', decimals=0, low=200, high=800),
    dict(key='Kmax', label='Kmax', name='Maximum keratometry', unit='D', decimals=1, low=20, high=100),
    dict(key='BAD_D', label='BAD-D', name='Belin–Ambrósio deviation', unit='', decimals=2, low=-5, high=60),
    dict(key='ARTmax', label='ARTmax', name='Relational thickness', unit='', decimals=1, low=1, high=1000),
]

@lru_cache(maxsize=1)
def registry():
    return json.loads((ROOT / 'models/release.json').read_text())

@lru_cache(maxsize=2)
def model(mode):
    entry = registry()['models'][mode]
    if Path(entry['file']).name != entry['file']:
        raise RuntimeError('Invalid model path')
    raw = (ROOT / 'models' / entry['file']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != entry['sha256']:
        raise RuntimeError('Bundled model checksum mismatch')
    result = json.loads(raw)
    n = len(result['features'])
    if result['format'] != 'standardized_logistic_v1' or any(len(result[k]) != n for k in ('center','scale','coefficients')):
        raise RuntimeError('Unsupported model format')
    if any(not math.isfinite(x) or x <= 0 for x in result['scale']):
        raise RuntimeError('Invalid model scale')
    return result


def number(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, OverflowError):
        return None


def infer(case):
    m = model(case['mode'])
    x = []
    for name in m['features']:
        spec = m['feature_spec'][name]
        source, key = spec['source'], spec.get('key')
        if source == 'age':
            value = case['age']
        elif source == 'interval_years':
            value = case['interval_days'] / spec.get('days_per_year', 365.2425)
        elif source in ('first','latest'):
            value = case[source][key]
        elif source == 'change':
            value = case['latest'][key] - case['first'][key]
        else:
            raise RuntimeError('Unsupported feature source')
        x.append(value * spec.get('direction', 1))
    terms = [(v-c)/s*b for v,c,s,b in zip(x,m['center'],m['scale'],m['coefficients'])]
    logit = m['intercept'] + math.fsum(terms)
    def index(z):
        return 100 / (1 + math.exp(-z)) if z >= 0 else 100 * math.exp(z) / (1 + math.exp(z))
    score = index(logit)
    effects, ranges = [], []
    for i, name in enumerate(m['features']):
        ref = m['feature_stats'][name]
        ref_term = (ref['median'] - m['center'][i]) / m['scale'][i] * m['coefficients'][i]
        effects.append(dict(feature=name, key=m['feature_spec'][name].get('key'),
                            label=m['feature_labels'][name], value=x[i], reference=ref['median'],
                            effect=score-index(logit-terms[i]+ref_term), log_odds_term=terms[i]))
        if x[i] < ref['min'] or x[i] > ref['max']:
            ranges.append(m['feature_labels'][name])
    effects.sort(key=lambda e: abs(e['effect']), reverse=True)
    return dict(nkpi=score, effects=effects, outside_range=ranges)


def assess_eye(raw):
    if not isinstance(raw, dict) or raw.get('eye') not in ('OD','OS'):
        raise ValueError('Each assessment must identify OD or OS.')
    eye = raw['eye']
    errors, holds, warnings = [], [], []
    mode = raw.get('mode')
    if mode not in ('baseline','longitudinal'):
        errors.append('Select one visit or two visits.')
    case = dict(eye=eye, mode=mode, age=number(raw.get('age')), first={}, latest=None, interval_days=None)
    if case['age'] is None or not 18 <= case['age'] <= 100:
        errors.append('Enter age at the first scan, between 18 and 100 years.')
    paired = mode == 'longitudinal'
    for visit in (('first','latest') if paired else ('first',)):
        values = raw.get(visit) if isinstance(raw.get(visit), dict) else {}
        case[visit] = {}
        for f in FEATURES:
            val = number(values.get(f['key']))
            case[visit][f['key']] = val
            if val is None or not f['low'] <= val <= f['high']:
                errors.append(f"{visit.title()} {f['label']}: enter {f['low']:g}–{f['high']:g} {f['unit']}.")
    if paired:
        days = number(raw.get('interval_days'))
        if days is None or not 1 <= days <= 36525 or days != int(days):
            errors.append('Enter the verified interval in whole days (1–36525).')
        else:
            case['interval_days'] = int(days)
            warnings.append('This two-visit research model uses 50% of the original scan-interval coefficient. This amendment has not been recalibrated or clinically revalidated.')
            if days < 90:
                warnings.append('Short interval: change may be sensitive to measurement variability.')
    quality = raw.get('scan_quality') if isinstance(raw.get('scan_quality'), dict) else {}
    case['scan_quality'] = {v: quality.get(v) if quality.get(v) in ('ok','warning','unknown') else 'unknown' for v in (('first','latest') if paired else ('first',))}
    # v4.1: missing optional history/quality does not block a verified research
    # calculation. Never fabricate "ok" or "untreated" when these are skipped.
    # v8.3: quality warnings are advisory for numerical research scoring.
    # Keep the reported quality; do not silently convert it to acceptable.
    for visit, q in case['scan_quality'].items():
        if q == 'warning':
            warnings.append(f"{visit.title()} scan: quality/alignment warning. Score calculated from verified values; measurement reliability is uncertain. Repeat a comparable quality scan before clinical interpretation.")
    if any(q == 'unknown' for q in case['scan_quality'].values()):
        warnings.append('Scan quality not assessed by this calculator. Skipping this field does not confirm that the scan is acceptable.')
    case['verified'] = raw.get('verified') is True
    if not case['verified']:
        holds.append('Verify the eye, values and visit order against the source.')
    case['treatment'] = raw.get('treatment') if raw.get('treatment') in ('untreated','treated','unknown') else 'unknown'
    if case['treatment'] == 'treated':
        holds.append('Prior CXL is outside this model’s intended use.')
    elif case['treatment'] == 'unknown':
        warnings.append('Treatment history not entered. This research index assumes the model is applied to an eligible, untreated eye; eligibility has not been established.')
    context = raw.get('context') if isinstance(raw.get('context'), dict) else {}
    case['context'] = {k: context.get(k) is True for k in ('lenses','rubbing','vision')}
    case['demo'] = raw.get('demo') is True
    # Optional display metadata is strictly numeric and never part of inference.
    loc = raw.get('landmarks') if isinstance(raw.get('landmarks'), dict) else {}
    case['landmarks'] = None
    coords = {k:number(loc.get(k)) for k in ('thin_x','thin_y','kmax_x','kmax_y')}
    if any(v is not None for v in coords.values()):
        if all(v is not None and abs(v) <= 6 for v in coords.values()) and loc.get('verified') is True:
            case['landmarks'] = coords
        else:
            warnings.append('Landmarks omitted: verify all four coordinates (−6 to +6 mm) against the latest report.')
    from .evidence import normalize_history
    case['history'] = []
    try:
        case['history'] = normalize_history(raw.get('history', []), eye, case['interval_days']) if paired else []
    except ValueError as exc:
        errors.append(str(exc))
    measurements = []
    for f in FEATURES:
        first = case['first'].get(f['key'])
        latest = case['latest'].get(f['key']) if paired else None
        measurements.append({**f, 'first':first, 'latest':latest,
                             'change': latest-first if latest is not None and first is not None else None})
    prediction = None
    if not errors and not holds:
        prediction = infer(case)
        if prediction['outside_range']:
            warnings.append('Outside the observed training range: '+', '.join(prediction['outside_range'])+'. Interpret cautiously.')
    return dict(eye=eye, status='ready' if prediction else 'held', case=case,
                prediction=prediction, errors=errors, holds=holds, warnings=warnings,
                measurements=measurements, model=registry()['models'].get(mode))


def assess_both(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get('eyes'), list) or not 1 <= len(payload['eyes']) <= 2:
        raise ValueError('Provide one or two eye assessments.')
    eyes = payload['eyes']
    if any(not isinstance(e, dict) for e in eyes) or len({e.get('eye') for e in eyes}) != len(eyes):
        raise ValueError('Provide each eye only once.')
    return {'eyes': {e['eye']:assess_eye(e) for e in eyes}, 'version':registry()['version']}


def public_config():
    # Verify both artifacts at startup; never substitute an unverified model.
    for mode in ('baseline','longitudinal'):
        model(mode)
    return {'version':registry()['version'], 'features':FEATURES, 'models':registry()['models'],
            'references':{mode:model(mode)['feature_stats'] for mode in ('baseline','longitudinal')}}
