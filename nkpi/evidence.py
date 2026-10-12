"""Experimental observed-change evidence, never a clinical probability.

External same-day precision references are NOT locally calibrated interday error.
The descriptive evidence screen uses observed slopes, not the cohort prior.
The fitted joint prior only regularizes the separately labelled trend estimates.
"""
from __future__ import annotations
from functools import lru_cache
from pathlib import Path
import hashlib
import json
import math
from decimal import Decimal
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
VERSION = '1.0.0-observed-evidence'
KEYS = ('A', 'B', 'C', 'Kmax', 'BAD_D', 'ARTmax')
DIRECTION = np.array([-1., -1., -1., 1., 1., -1.])
SCALE = np.array([.106, .131, 14.2, .926, .810, 44.240])
BOUNDS = [(2.5,12.5),(2.5,12.5),(200,800),(20,100),(-5,60),(1,1000)]
DOMAINS = [('anterior','Anterior curvature',[0,3]),('posterior','Posterior curvature',[1]),('pachymetric','Pachymetric',[2,5])]
YEAR = 365.2425
ARTIFACT = ROOT / 'research/evidence_model.json'


def normalize_history(raw, eye, days):
    """Reject malformed history; no identifiers, dates, filenames or free text."""
    if raw is None: return []
    if not isinstance(raw, list) or len(raw)>40: raise ValueError('Additional history must contain at most 40 verified scans.')
    rows=[]
    for r in raw:
        if not isinstance(r,dict) or r.get('eye')!=eye or r.get('verified') is not True or r.get('quality')!='ok':
            raise ValueError('Additional scans require the same eye, verified values and acceptable quality.')
        d=r.get('day')
        if isinstance(d,bool) or not isinstance(d,(int,float)) or not math.isfinite(d) or int(d)!=d or days is None or not 0<=d<=days:
            raise ValueError('Additional scan day must fall inside the selected comparison.')
        values=r.get('values',{})
        if not isinstance(values,dict): raise ValueError('Additional scan has missing or invalid measurements.')
        for k,(low,high) in zip(KEYS,BOUNDS):
            v=values.get(k)
            if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or not low<=v<=high:
                raise ValueError('Additional scan has missing or invalid measurements.')
        rows.append(dict(eye=eye,day=int(d),values={k:float(values[k]) for k in KEYS},quality='ok',verified=True))
    # Stable sort and exact duplicate suppression prevent repeated exports gaining weight.
    unique={json.dumps(r,sort_keys=True,separators=(',',':')):r for r in rows}
    return sorted(unique.values(),key=lambda r:(r['day'],*(r['values'][k] for k in KEYS)))


def pair_limits(values):
    """Published COR references. Never confuse raw ARC/PRC with stage A/B."""
    limits=SCALE.copy()
    k=values['Kmax']
    # Gustafsson 2020, Table 1; retain Neuhann's pooled .926 D as a floor.
    limits[3]=max(limits[3], .32 if k<48.2 else 1.33 if k<53.9 else 1.62)
    return limits


def data_for(case):
    rows=[dict(day=0,values=case['first']),dict(day=case['interval_days'],values=case['latest'])]
    rows += case.get('history',[])
    unique={tuple([r['day']]+[r['values'][k] for k in KEYS]):r for r in rows}
    by_day={}
    for r in unique.values(): by_day.setdefault(r['day'],[]).append(r['values'])
    times=[]; points=[]; errors=[]; counts=[]
    for day,scans in sorted(by_day.items()):
        matrix=np.array([[s[k] for k in KEYS] for s in scans],float)
        # Robust visit center; no 1/sqrt(n) precision bonus for same-day repeats.
        point=np.median(matrix,axis=0)
        se=np.max([pair_limits(s)/(1.96*math.sqrt(2)) for s in scans],axis=0)
        if len(scans)>1: se=np.maximum(se,np.std(matrix,axis=0,ddof=1))
        times.append(day/YEAR);points.append(point);errors.append(se);counts.append(len(scans))
    return np.array(times),np.array(points),np.array(errors),counts


def weighted_slopes(times,points,errors):
    slopes=[];ses=[];lack_fit=[]
    for j in range(6):
        w=1/errors[:,j]**2; mean_t=np.average(times,weights=w); centered=times-mean_t
        denom=np.sum(w*centered**2)
        slope=np.sum(w*centered*points[:,j])/denom
        intercept=np.average(points[:,j],weights=w)-slope*mean_t
        residual=points[:,j]-(intercept+slope*times)
        inflation=max(1.,float(np.sum(w*residual**2)/(len(times)-2))) if len(times)>2 else 1.
        slopes.append(slope);ses.append(math.sqrt(inflation/denom));lack_fit.append(inflation)
    return np.array(slopes),np.array(ses),np.array(lack_fit)


def holm(pvalues, alpha=.05):
    order=np.argsort(pvalues); adjusted=np.zeros(len(pvalues));previous=0.
    for rank,index in enumerate(order):
        previous=max(previous,min(1.,(len(pvalues)-rank)*pvalues[index]));adjusted[index]=previous
    return adjusted,adjusted<alpha


def sf(z): return .5*math.erfc(z/math.sqrt(2))


def legacy_flags(first, latest):
    """Historical fixed rules, audit only; not the active evidence screen."""
    a={k:Decimal(str(first[k])) for k in KEYS}; b={k:Decimal(str(latest[k])) for k in KEYS}
    return [a['A']-b['A']>Decimal('.106') or b['Kmax']-a['Kmax']>1,
            a['B']-b['B']>Decimal('.085'),
            100*(a['C']-b['C'])>2*a['C'] or a['ARTmax']-b['ARTmax']>Decimal('44.24'),
            b['BAD_D']-a['BAD_D']>Decimal('.42')]


@lru_cache(maxsize=1)
def artifact():
    raw=ARTIFACT.read_bytes();expected=ARTIFACT.with_suffix('.sha256').read_text().strip()
    sha=hashlib.sha256(raw).hexdigest()
    if sha!=expected: raise ValueError('Observed-evidence model checksum mismatch.')
    data=json.loads(raw)
    if data['version']!=VERSION or data['keys']!=list(KEYS): raise ValueError('Observed-evidence model format mismatch.')
    v=np.array(data['slope_covariance']);mu=np.array(data['mean_slope'])
    if mu.shape!=(6,) or not np.isfinite(mu).all(): raise ValueError('Invalid trend mean.')
    if v.shape!=(6,6) or not np.isfinite(v).all() or not np.allclose(v,v.T) or np.linalg.eigvalsh(v).min()<=0: raise ValueError('Invalid trend covariance.')
    return data,sha


def configuration():
    data,sha=artifact()
    return dict(version=VERSION,sha256=sha,research_only=True,cohort=data['cohort'],method='External-reference observed evidence and joint empirical-Bayes trends',calibrated=False)


def analyze(assessment, fingerprint):
    model,sha=artifact();c=assessment['case']
    out=dict(version=VERSION,model_sha256=sha,input_sha256=fingerprint,eye=c['eye'],research_only=True,status='unavailable',reason='',calibrated=False)
    if c['mode']!='longitudinal':out['reason']='A second visit is needed to assess observed change.';return out
    if not c['verified'] or assessment['errors'] or any(q=='warning' for q in c['scan_quality'].values()):
        out['reason']='Verify comparable measurements and resolve scan-quality warnings.';return out
    if c['treatment']=='treated':out['reason']='This reference model does not cover post-treatment or across-treatment comparisons.';return out
    if not c['interval_days'] or not c['latest']:out['reason']='Two visits and their interval are required.';return out
    times,points,errors,counts=data_for(c)
    slopes,se,lack_fit=weighted_slopes(times,points,errors)
    z=slopes*DIRECTION/se
    # Use mean Z within a domain with maximum possible variance (rho=1).
    # This does not gain false precision from assuming correlated measures independent.
    domain_z=np.array([np.mean(z[indexes]) for _,_,indexes in DOMAINS])
    adjusted,flags=holm([sf(v) for v in domain_z])
    _,stress_flags=holm([sf(v/2) for v in domain_z])
    endpoint_delta=np.array([c['latest'][k]-c['first'][k] for k in KEYS])
    domains=[]
    for i,(key,name,indexes) in enumerate(DOMAINS):
        mixed=any(z[j]>.5 for j in indexes) and any(z[j]<-.5 for j in indexes)
        domains.append(dict(key=key,name=name,components=[KEYS[j] for j in indexes],z=float(domain_z[i]),adjusted_tail=float(adjusted[i]),signal=bool(flags[i]),mixed=mixed,stress_signal=bool(stress_flags[i])))
    count=int(sum(flags));mixed=any(d['mixed'] for d in domains)
    title='Concordant worsening signals' if count>=2 else 'One structural signal' if count==1 else 'Mixed measurement directions' if mixed else 'No clear worsening signal'
    notes=['Precision references include same-day studies; this is not locally calibrated interday progression evidence.']
    if any(q!='ok' for q in c['scan_quality'].values()):notes.append('Scan quality is unconfirmed for a selected visit.')
    if c['treatment']!='untreated':notes.append('Treatment history is unconfirmed; the reference assumes untreated scans.')
    if len(times)==2:notes.append('Two dates estimate a rate but cannot establish a persistent trend.')
    if np.any(lack_fit>4):notes.append('Measurements depart from a straight trend; trend precision has been reduced.')
    if count and not all(stress_flags[flags]):notes.append('At least one signal is sensitive to doubling the reference measurement error.')
    if np.min(points[:,3])<42.5 or np.max(points[:,3])>77.1 or np.min(points[:,2])<394.5:
        notes.append('Some measurements extend beyond a contributing precision study’s range; reference transfer is uncertain.')
    # A joint prior regularizes slopes, never the observed domain flags.
    mean=np.array(model['mean_slope']);cov=np.array(model['slope_covariance'])
    raw=slopes*DIRECTION/SCALE;variance=(se/SCALE)**2
    measurement_cov=np.diag(variance)
    gain=np.linalg.solve(cov+measurement_cov,cov).T
    posterior=mean+gain@(raw-mean)
    posterior_cov=cov-gain@cov
    use_prior=18<=c['age']<=50 and 90<=c['interval_days']<=5*YEAR
    bounds=model['measurement_bounds']
    use_prior=use_prior and all(bounds[k][0]<=v<=bounds[k][1] for p in points for k,v in zip(KEYS,p))
    if not use_prior:notes.append('Cohort-adjusted trends are omitted outside their fitting range; observed rates remain available.')
    rows=[]
    for j,k in enumerate(KEYS):
        rows.append(dict(key=k,first=c['first'][k],latest=c['latest'][k],change=float(endpoint_delta[j]),
            annual_rate=float(slopes[j]),annual_se=float(se[j]),reference_pair_limit=float(max(pair_limits(dict(zip(KEYS,p)))[j] for p in points)),
            z=float(z[j]),cohort_annual_rate=float(posterior[j]*SCALE[j]*DIRECTION[j]) if use_prior else None,
            cohort_annual_se=float(math.sqrt(max(0,posterior_cov[j,j]))*SCALE[j]) if use_prior else None))
    out.update(status='ready',reason='',interval_days=c['interval_days'],visits=len(times),scans=sum(counts),
        title=title,structural_count=count,domains=domains,composite=dict(z=float(z[4]),direction='worsening' if z[4]>0 else 'opposite' if z[4]<0 else 'unchanged',support=bool(z[4]>1.96)),
        rows=rows,notes=notes,cohort_adjusted=use_prior,cohort=model['cohort'],reference_profile='Published same-day precision; severity bands for Kmax; visit-scatter inflation; no repeat-count precision bonus',
        observations=[dict(day=int(round(t*YEAR)),values=dict(zip(KEYS,map(float,p))),scans=n) for t,p,n in zip(times,points,counts)],
        historical_rule_count=sum(legacy_flags(c['first'],c['latest'])))
    return out
