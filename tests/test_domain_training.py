"""Consequential model-boundary checks; no private data needed."""
import importlib.util, json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('training',ROOT/'research/train_domain_outlook.py')
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)

base={'A':7.57,'B':6.16,'C':500,'Kmax':45,'BAD_D':2,'ARTmax':200}
def row():return {**{'baseline_'+k:v for k,v in base.items()},**{'latest_'+k:v for k,v in base.items()}}
for key,at,over,domain in [('A',7.464,7.463,0),('B',6.075,6.074,1),('C',490,489.999,2),('Kmax',46,46.001,0),('BAD_D',2.42,2.421,3),('ARTmax',155.76,155.759,2)]:
    r=row();r['latest_'+key]=at;assert sum(t.domains(r))==0,key
    r['latest_'+key]=over;assert t.domains(r)[domain] and sum(t.domains(r))==1,key
r=row();r.update(latest_A=7.4,latest_Kmax=48,latest_C=480,latest_ARTmax=100);assert sum(t.domains(r))==2

# Outcome and later data cannot influence the predictor design.
frame=pd.DataFrame([{**row(),'age_baseline':24,'interval_years':.5,'patient_id':1,'event':0,'outcome':0}])
expected=t.design(frame,'candidate').copy()
for key in t.KEYS:frame['latest_'+key]=-999
frame['event']=1;frame['outcome']=1
assert np.array_equal(expected,t.design(frame,'candidate'))
assert expected.shape==(1,8)

# Verify grouping semantics with two eyes/patient and the stored protocol.
g=np.repeat(np.arange(30),2);y=np.repeat(np.arange(30)%2,2);x=np.zeros((60,8))
for tr,va in StratifiedGroupKFold(5,shuffle=True,random_state=2718).split(x,y,g):
    assert not set(g[tr]) & set(g[va])

report=json.loads((ROOT/'research/domain_training/domain_outlook_validation.json').read_text())
assert report['complete_pairs_before_age_interval']==262
assert report['pairs_age_18_50_before_interval']==195
assert report['excluded_under_90_days']+report['excluded_over_5_years']==195-179
assert report['primary']['eyes']==179 and report['primary']['patients']==101
assert report['primary']['events']==51
assert report['direct_4_to_8_months']['eyes']==43 and report['direct_4_to_8_months']['events']==13
assert report['clinical_release'] is False
for name in ['variable_interval','near_six_months']:
    model=json.loads((ROOT/f'research/domain_training/{name}_candidate.json').read_text())
    assert model['status']=='not_released_for_patient_forecasting'
    assert len(model['coef'])==len(model['scaler_mean'])==len(model['scaler_scale'])==8
    assert np.isfinite(model['coef']).all() and np.all(np.array(model['scaler_scale'])>0)
    assert not any('latest' in f or 'change' in f or 'outcome' in f for f in model['features'])
# Old six-month artifacts remain inactive; the versioned adult demo is separate.
for file in ['nkpi/service.py','nkpi/assessment.py','components/app.js','components/schema.js']:
    text=(ROOT/file).read_text();assert 'domain_training' not in text and 'train_domain_outlook' not in text
print('PASS: exact endpoint boundaries, no follow-up predictor leakage, patient grouping, cohort accounting and unreleased research artifacts.')

# Working demo retains honest research status and aggregate validation metadata.
demo=json.loads((ROOT/'research/baseline_forecast_demo.json').read_text())
assert demo['training_eyes']==232 and demo['training_patients']==130
assert demo['validation']['events']==59 and demo['near_twelve_months']['eyes']==45
assert demo['horizon_months']==12 and demo['clinical_release'] is False
assert demo['population_risk_calibration'] is False
assert demo['status']=='experimental_demo_only'
assert demo['features']==model['features'][:-1]+['baseline_NKPI_logit','log_interval_years']
assert demo['trajectory']['months']==[0,3,6,9,12]
assert 'refitted' in demo['validation']['reuse_caveat']
assert demo['trajectory']['age_fixed'] is True
assert demo['trajectory']['validation']['near_twelve_months']['joint']['eyes']==45
lo,hi=demo['trajectory']['validation']['normalized_mae_improvement_95_percentile'];assert lo<0<hi
assert all(f['patient_overlap']==0 for f in demo['trajectory']['selection'])
assert demo['validation']['metrics']['candidate']['auc']<.65
print('PASS: adult baseline demo counts, numeric endpoint, bounded performance claims and separate clinical-release status.')

assert demo['model_family']=='nkpi_logit_time'
assert demo['active_features']==['baseline_NKPI_logit','log_interval_years']
assert demo['validation']['nkpi_refit_audit']['all_patient_overlap_zero']
assert demo['validation']['nkpi_refit_audit']['fits']>=60
assert all(f['patient_overlap']==0 for f in demo['validation']['nested_selection'])
assert set(demo['near_twelve_months']['metrics'])=={'selected','nkpi_logit_time','nkpi_logit_age_time','raw_baseline_time','direct_near12_nkpi_logit','prevalence','interval_only'}
assert demo['score_band_audit']['all_intervals'][2]['eyes']==1
assert demo['score_band_audit']['near_twelve_months'][1]['eyes']==5
assert demo['score_band_audit']['clinic_validation']['used_for_training'] is False
assert demo['score_band_audit']['date_audit']['first_event_dates_available'] is False
print('PASS nested family selection, timing audit, held-out score refits, small high-score strata and exclusion of reported clinic accuracy from training.')

# Strong leakage check: modifying every held-out phenotype label and its training
# record features cannot change the score transform fitted for that fold.
rng=np.random.default_rng(84);n=60
synthetic=pd.DataFrame(rng.normal(size=(n,7)),columns=['age_baseline']+['baseline_'+k for k in t.KEYS])
synthetic['patient_id']=np.repeat(np.arange(30),2);synthetic['outcome']=np.repeat(np.arange(30)%2,2);synthetic['interval_years']=1.
excluded=[0,1,2,3];original=t.score_basis_design(synthetic,synthetic,excluded)
changed=synthetic.copy();mask=changed.patient_id.isin(excluded)
changed.loc[mask,'outcome']=1-changed.loc[mask,'outcome']
changed.loc[mask,['age_baseline']+['baseline_'+k for k in t.KEYS]]=9999
assert np.max(abs(original-t.score_basis_design(changed,synthetic,excluded)))<1e-12
print('PASS adversarial held-out-label/feature perturbation leaves training NKPI transform unchanged.')
