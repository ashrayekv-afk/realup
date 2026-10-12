"""Experimental baseline forecast plus separate frozen-NKPI sensitivity.

Published pair-repeatability limits set *hypothetical perturbation sizes* only.
The envelope is a deterministic box stress test, never a confidence interval.
"""
from __future__ import annotations
import copy
import hashlib
import json
import math
from functools import lru_cache
from pathlib import Path
from .assessment import FEATURES, infer, model
from .evidence import KEYS, pair_limits

VERSION = '1.5.0-topographic-outlook'
FORECAST_STATUS = 'experimental_ready'


# Separate fitted research model. Never substitute the NKPI class response.
FORECAST_PATH = Path(__file__).resolve().parents[1] / 'research/baseline_forecast_demo.json'


@lru_cache(maxsize=1)
def forecast_artifact():
    raw = FORECAST_PATH.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    if sha != FORECAST_PATH.with_suffix('.sha256').read_text().strip():
        raise ValueError('Baseline forecast artifact checksum mismatch.')
    a = json.loads(raw)
    expected = ['age_baseline','baseline_A','baseline_B','baseline_C','baseline_BAD_D','baseline_ARTmax','baseline_Kmax','baseline_NKPI_logit','log_interval_years']
    if (a['version'] != '0.5.0-topographic-demo' or a['features'] != expected or
        a['horizon_months'] != 12 or a['status'] != 'experimental_demo_only' or
        a['clinical_release'] is not False or a['population_risk_calibration'] is not False):
        raise ValueError('Unsupported baseline forecast model.')
    if any(len(a[k]) != 9 or not all(math.isfinite(v) for v in a[k]) for k in ['coef','scaler_mean','scaler_scale']):
        raise ValueError('Invalid baseline forecast coefficients.')
    if min(a['scaler_scale']) <= 0 or not math.isfinite(a['intercept']):
        raise ValueError('Invalid baseline forecast scaler.')
    for key in expected:
        s=a['feature_stats'][key]
        if not all(math.isfinite(s[k]) for k in ['min','max','median']) or not s['min']<=s['median']<=s['max']:
            raise ValueError('Invalid baseline forecast development bounds.')
    if a['nkpi_model_sha256'] != hashlib.sha256((FORECAST_PATH.parents[1]/'models/release_model_baseline.json').read_bytes()).hexdigest():
        raise ValueError('Forecast requires the matching frozen NKPI model.')
    t=a['trajectory']
    if t['version']!='2.0.0-topography' or t['keys']!=['A','B','C','BAD_D','ARTmax','Kmax'] or t['months']!=[0,3,6,9,12] or t['clinical_release'] is not False or t['age_fixed'] is not True:
        raise ValueError('Unsupported NKPI trajectory.')
    for key in ['activity','pattern']:
        if len(t[key])!=6 or not all(math.isfinite(v) and v>=0 for v in t[key]):raise ValueError('Invalid topographic model.')
    if t['directions']!=[-1,-1,-1,1,-1,1]:raise ValueError('Invalid topographic directions.')
    return a,sha


def forecast_configuration():
    a,sha = forecast_artifact()
    keys=['version','features','scaler_mean','scaler_scale','coef','intercept','feature_stats','horizon_months','training_eyes','training_patients','target','domain_rules','nkpi_model_sha256','trajectory','model_family','active_features','score_band_audit']
    result={k:a[k] for k in keys}
    result.update(sha256=sha,clinical_release=False,population_risk_calibration=False,
                  validation=a['validation']['primary_metrics']['selected'],
                  prevalence_validation=a['validation']['primary_metrics']['prevalence'],
                  family_validation=a['validation']['primary_metrics'][a['model_family']],
                  reuse_caveat=a['validation']['reuse_caveat'],
                  near_twelve_months=a['near_twelve_months'],bootstrap=a['validation']['bootstrap'])
    return result


def baseline_logit(case):
    m=model('baseline')
    values=[case['age'],*[case['first'][k] for k in ['A','B','C','BAD_D','ARTmax','Kmax']]]
    return m['intercept']+math.fsum((v-u)/s*b for v,u,s,b in zip(values,m['center'],m['scale'],m['coefficients']))


def forecast_values(case):
    return [case['age'],*[case['first'][k] for k in ['A','B','C','BAD_D','ARTmax','Kmax']],baseline_logit(case),0.0]


def support_band(score, artifact):
    return next(b for b in artifact['score_band_audit']['all_intervals'] if b['lower']<=score<b['upper_exclusive'])


def forecast_probability(values, artifact=None):
    a=artifact if artifact is not None else forecast_artifact()[0]
    z=a['intercept']+math.fsum((x-mean)/scale*b for x,mean,scale,b in zip(values,a['scaler_mean'],a['scaler_scale'],a['coef']))
    return 1/(1+math.exp(-z)) if z>=0 else math.exp(z)/(1+math.exp(z))


def forecast(case, input_sha256):
    a,sha=forecast_artifact();x=forecast_values(case);p=forecast_probability(x,a)
    effects=[]
    for i,name in enumerate(a['features'][:7]):
        median=a['feature_stats'][name]['median'];changed=copy.deepcopy(case)
        if i==0:changed['age']=median
        else:changed['first'][name.removeprefix('baseline_')]=median
        other=forecast_values(changed)
        q=forecast_probability(other,a)
        effects.append(dict(feature=name,key='age' if i==0 else name.removeprefix('baseline_'),
                            value=x[i],reference=median,probability_at_reference=q,effect_pp=100*(p-q)))
    effects.sort(key=lambda e:abs(e['effect_pp']),reverse=True)
    outside=[name for i,name in enumerate(a['features'][:-1]) if not a['feature_stats'][name]['min']<=x[i]<=a['feature_stats'][name]['max']]
    return dict(status=FORECAST_STATUS,version=a['version'],eye=case['eye'],input_sha256=input_sha256,
                model_sha256=sha,horizon_months=12,probability=p,clinical_release=False,
                population_risk_calibration=False,endpoint='at_least_two_of_four_numerical_domains',
                predictor_reference='selected_baseline_scan',feature_values=dict(zip(a['features'],x)),
                effects=effects,outside_training_ranges=outside,extrapolated=bool(outside),
                assumption_treatment=case['treatment'],assumption_scan_quality=case['scan_quality']['first'],
                nkpi_input=infer({**case,'mode':'baseline'})['nkpi'],
                support_band=copy.deepcopy(support_band(infer({**case,'mode':'baseline'})['nkpi'],a)),effects_method='underlying_input_with_NKPI_recomputed',
                trajectory=trajectory(case,input_sha256,a,sha))


def topographic_basis(current, age, first):
    n=current/100
    clip=lambda x,hi: max(0,min(hi,x))
    return [1,n,n*n,n*clip((100-age)/82,1),n*clip((first['Kmax']-40)/40,1.5),n*clip((550-first['C'])/250,1.5)]


def trajectory(case, input_sha256, artifact=None, sha=None):
    a,sha=forecast_artifact() if artifact is None else (artifact,sha)
    t=a['trajectory'];current=infer({**case,'mode':'baseline'})['nkpi'];first=case['first']
    x=topographic_basis(current,case['age'],first)
    activity=math.fsum(v*b for v,b in zip(x,t['activity']))
    scales=[.106,.085,.02*first['C'],.42,44.24,1]
    rates={k:activity*q*s*d for k,q,s,d in zip(t['keys'],t['pattern'],scales,t['directions'])}
    bounds={f['key']:(f['low'],f['high']) for f in FEATURES}
    points=[]
    for h in t['months']:
        unbounded={k:first[k]+rates[k]*h/12 for k in t['keys']}
        values={k:max(bounds[k][0],min(bounds[k][1],v)) for k,v in unbounded.items()}
        score=infer({**case,'mode':'baseline','first':values})['nkpi']
        points.append(dict(month=h,nkpi=score,age=case['age'],age_only_nkpi=current,
                           measurements=values,clipped=values!=unbounded,kind='current' if h==0 else 'projected'))
    # Exact six-variable Shapley decomposition of the projected score change.
    # All 64 fixed-age rescoring combinations, no arbitrary one-variable ordering.
    keys=t['keys'];end=points[-1]['measurements'];subset={}
    for mask in range(64):
        values={k:end[k] if mask&(1<<i) else first[k] for i,k in enumerate(keys)}
        subset[mask]=infer({**case,'mode':'baseline','first':values})['nkpi']
    drivers=[]
    for i,k in enumerate(keys):
        effect=math.fsum((subset[mask|(1<<i)]-subset[mask])/(6*math.comb(5,mask.bit_count())) for mask in range(64) if not mask&(1<<i))
        f=next(f for f in FEATURES if f['key']==k)
        drivers.append(dict(key=k,label=f['label'],unit=f['unit'],baseline=first[k],projected=end[k],
                            measurement_change=end[k]-first[k],effect_points=effect))
    drivers.sort(key=lambda v:abs(v['effect_points']),reverse=True)
    outside=[k for k in ['age',*keys] if not t['feature_ranges'][k][0]<= (case['age'] if k=='age' else first[k]) <=t['feature_ranges'][k][1]]
    if not t['feature_ranges']['nkpi'][0]<=current<=t['feature_ranges']['nkpi'][1]:outside.append('NKPI')
    support=next(v for v in t['support'] if v['lower']<=current<v['upper_exclusive'])
    return dict(version=t['version'],eye=case['eye'],input_sha256=input_sha256,model_sha256=sha,
                score_model_sha256=a['nkpi_model_sha256'],clinical_release=False,reference='selected_baseline_scan',
                current_nkpi=current,age_fixed=case['age'],age_logit_per_year=0.,basis=x,activity=activity,rates=rates,
                points=points,change_at_12_months=points[-1]['nkpi']-current,drivers=drivers,top_drivers=drivers[:2],
                effects_method='exact_six_variable_shapley_at_fixed_age',support=support,outside_training_ranges=outside,
                clipped=any(p['clipped'] for p in points),
                scan_quality=case['scan_quality']['first'],treatment=case['treatment'])


def configuration():
    m = model('baseline')
    return dict(version=VERSION, research_only=True, calibrated=False,
                forecast_status=FORECAST_STATUS, horizon_months=12, forecast=forecast_configuration(),
                method='reference_pair_limit_box',
                reference_pair_limits=dict(zip(KEYS, map(float, pair_limits({'Kmax':40})))),
                kmax_bands=[dict(minimum=48.2,limit=1.33),dict(minimum=53.9,limit=1.62)],
                features=m['features'], feature_spec=m['feature_spec'],
                center=m['center'], scale=m['scale'], coefficients=m['coefficients'],
                intercept=m['intercept'])


def analyze(assessment, input_sha256):
    case = assessment['case']
    result = dict(version=VERSION, eye=case['eye'], input_sha256=input_sha256,
                  model_sha256=assessment['model_sha256'], research_only=True,
                  calibrated=False, status='unavailable', reason='Awaiting an eligible single-visit calculation.',
                  forecast=dict(status='unavailable', horizon_months=12, probability=None))
    if case['mode'] != 'baseline':
        result['reason'] = 'This eye uses two visits. Its observed evidence is in the next section.'
        return result
    if not assessment['prediction'] or assessment['status'] != 'ready':
        result['reason'] = 'Resolve this eye’s held inputs above before calculating the baseline outlook.'
        return result
    original = assessment['prediction']['nkpi']
    limits = dict(zip(KEYS, map(float, pair_limits(case['first']))))
    m = model('baseline')
    down, up = copy.deepcopy(case), copy.deepcopy(case)
    rows = []
    for f in FEATURES:
        key = f['key']; value = case['first'][key]; delta = limits[key]
        lo, hi = max(f['low'],value-delta), min(f['high'],value+delta)
        minus, plus = copy.deepcopy(case), copy.deepcopy(case)
        minus['first'][key], plus['first'][key] = lo, hi
        score_lo, score_hi = infer(minus)['nkpi'], infer(plus)['nkpi']
        index = m['features'].index('baseline_'+key)
        positive = m['coefficients'][index] * m['feature_spec']['baseline_'+key].get('direction',1) >= 0
        down['first'][key], up['first'][key] = (lo,hi) if positive else (hi,lo)
        rows.append(dict(key=key,value=value,reference_pair_limit=delta,input_low=lo,input_high=hi,
                         clipped=(lo != value-delta or hi != value+delta),
                         score_at_low=score_lo,score_at_high=score_hi,
                         score_low=min(score_lo,score_hi),score_high=max(score_lo,score_hi),
                         maximum_shift=max(abs(score_lo-original),abs(score_hi-original))))
    rows.sort(key=lambda x:x['maximum_shift'],reverse=True)
    low, high = infer(down)['nkpi'], infer(up)['nkpi']
    result.update(status='ready',reason=None,forecast=forecast(case,input_sha256),current_nkpi=original,score_low=low,score_high=high,
                  rows=rows, largest_sensitivity=rows[0]['key'], age_fixed=case['age'],
                  within_training_ranges=not assessment['prediction']['outside_range'],
                  outside_training_ranges=assessment['prediction']['outside_range'],
                  top_contributors=copy.deepcopy(assessment['prediction']['effects'][:3]),
                  scan_quality=case['scan_quality']['first'], treatment=case['treatment'],
                  clipped=any(r['clipped'] for r in rows))
    return result
