"""Exploratory domain-endpoint development, NOT a clinical forecasting release.

Run reconstruct_source.py first. Input rows remain private. Only aggregate
validation and model coefficients are suitable for the public code package.
The outcome uses follow-up measurements; predictors never use them.
"""
from pathlib import Path
from decimal import Decimal as D
import argparse, json, hashlib
import numpy as np
import pandas as pd
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.metrics import roc_auc_score, brier_score_loss, log_loss

KEYS = ['A', 'B', 'C', 'BAD_D', 'ARTmax', 'Kmax']
SEEDS = [2718, 3141, 1618]
CS = [.01, .1, 1., 10.]

def domains(row):
    a = {k: D(str(row['baseline_'+k])) for k in KEYS}
    b = {k: D(str(row['latest_'+k])) for k in KEYS}
    return [a['A']-b['A'] > D('.106') or b['Kmax']-a['Kmax'] > 1,
            a['B']-b['B'] > D('.085'),
            100*(a['C']-b['C']) > 2*a['C'] or a['ARTmax']-b['ARTmax'] > D('44.24'),
            b['BAD_D']-a['BAD_D'] > D('.42')]

def design(frame, kind):
    t = np.log(frame.interval_years.to_numpy())[:, None]
    if kind == 'interval_only': return t
    x = frame[['age_baseline']+['baseline_'+k for k in KEYS]].to_numpy()
    return np.column_stack([x,t])

def learner(c):
    return make_pipeline(StandardScaler(), LogisticRegression(C=c, max_iter=3000, solver='lbfgs'))

def select_fit(x,y,g,seed):
    folds=list(StratifiedGroupKFold(3,shuffle=True,random_state=seed).split(x,y,g))
    losses=[]
    for c in CS:
        p=np.zeros(len(y))
        for tr,va in folds:
            assert not set(g[tr]) & set(g[va])
            p[va]=learner(c).fit(x[tr],y[tr]).predict_proba(x[va])[:,1]
        losses.append(brier_score_loss(y,p))
    c=CS[int(np.argmin(losses))]
    return learner(c).fit(x,y),c

def metrics(y,p):
    p=np.clip(p,1e-6,1-1e-6)
    z=np.log(p/(1-p)).reshape(-1,1)
    # Calibration slope is a descriptive OOF diagnostic, never a post-hoc
    # correction applied to those same held-out predictions.
    cal=LogisticRegression(C=1e6,max_iter=3000).fit(z,y)
    return {'eyes':len(y),'events':int(sum(y)), 'auc':float(roc_auc_score(y,p)),
            'brier':float(brier_score_loss(y,p)), 'log_loss':float(log_loss(y,p)),
            'observed_fraction':float(np.mean(y)), 'mean_prediction':float(np.mean(p)),
            'calibration_intercept':float(cal.intercept_[0]),
            'calibration_slope':float(cal.coef_[0,0])}

def bootstrap(y,p,reference,groups):
    rng=np.random.default_rng(20260929);unique=np.unique(groups);index={g:np.where(groups==g)[0] for g in unique}
    auc=[];skill=[]
    for _ in range(1500):
        ix=np.concatenate([index[g] for g in rng.choice(unique,len(unique),replace=True)])
        if len(np.unique(y[ix]))<2:continue
        auc.append(roc_auc_score(y[ix],p[ix]))
        skill.append(brier_score_loss(y[ix],reference[ix])-brier_score_loss(y[ix],p[ix]))
    return {'auc_95_percentile':np.percentile(auc,[2.5,97.5]).tolist(),
            'brier_improvement_over_prevalence_95_percentile':np.percentile(skill,[2.5,97.5]).tolist(),
            'note':'Patient-cluster bootstrap of fixed averaged OOF predictions; does not refit or capture all model-development uncertainty.'}

def evaluate(frame, label, output, private):
    y=frame.event.to_numpy(dtype=int);g=frame.patient_id.to_numpy()
    predictions={k:[] for k in ['candidate','interval_only','prevalence']};selection=[]
    for seed in SEEDS:
        outer=list(StratifiedGroupKFold(5,shuffle=True,random_state=seed).split(frame,y,g))
        run={k:np.zeros(len(y)) for k in predictions}
        for fold,(tr,va) in enumerate(outer):
            assert not set(g[tr]) & set(g[va])
            run['prevalence'][va]=np.mean(y[tr])
            for kind in ['candidate','interval_only']:
                x=design(frame,kind)
                fitted,c=select_fit(x[tr],y[tr],g[tr],seed+fold)
                run[kind][va]=fitted.predict_proba(x[va])[:,1]
                selection.append({'seed':seed,'fold':fold,'kind':kind,'C':c,'test_eyes':len(va),'test_patients':len(np.unique(g[va]))})
        for kind in run: predictions[kind].append(run[kind])
    means={k:np.mean(v,axis=0) for k,v in predictions.items()}
    result={'eyes':len(frame),'patients':frame.patient_id.nunique(),'events':int(sum(y)),
            'domain_counts':frame.domain_count.value_counts().sort_index().to_dict(),
            'interval_days':{'min':float(frame.interval_years.min()*365.2425),'median':float(frame.interval_years.median()*365.2425),'max':float(frame.interval_years.max()*365.2425)},
            'metrics':{k:metrics(y,p) for k,p in means.items()},
            'each_repeat':{k:[metrics(y,p) for p in ps] for k,ps in predictions.items()},
            'bootstrap':bootstrap(y,means['candidate'],means['prevalence'],g),'selection':selection}
    near=frame.interval_years.between(4/12,8/12).to_numpy()
    if near.sum() and not near.all():result['near_six_months_held_out']={k:metrics(y[near],p[near]) for k,p in means.items()}
    final,c=select_fit(design(frame,'candidate'),y,g,2718)
    scaler=final.named_steps['standardscaler'];lr=final.named_steps['logisticregression']
    artifact={'version':'0.1.0-exploratory','status':'not_released_for_patient_forecasting',
              'target':'At least 2 of 4 fixed domains crossed at recorded follow-up relative to first scan',
              'predictor_reference':'first scan only; no observed slope predictors',
              'features':['age_baseline']+['baseline_'+k for k in KEYS]+['log_interval_years'],
              'scaler_mean':scaler.mean_.tolist(),'scaler_scale':scaler.scale_.tolist(),
              'coef':lr.coef_[0].tolist(),'intercept':float(lr.intercept_[0]),'C':c,
              'training_eyes':len(frame),'training_patients':int(frame.patient_id.nunique()),
              'external_validation':False,'population_risk_calibration':False,
              'third_visit_validation':False,'source_workbook_sha256':'60bd4895f669fa55bd4e7e37266c66a52497f250847869185dfa1424bfa882be'}
    (output/(label+'_candidate.json')).write_text(json.dumps(artifact,indent=2)+'\n')
    frame[['patient_id','eye','event']].assign(**{k:p for k,p in means.items()}).to_csv(private/(label+'_oof.csv'),index=False)
    return result

def run(source,output,private):
    output.mkdir(parents=True,exist_ok=True);private.mkdir(parents=True,exist_ok=True)
    raw=pd.read_csv(source)
    adult=raw[raw.age_baseline.between(18,50)].copy()
    frame=adult[adult.interval_years.between(90/365.2425,5)].copy()
    frame['domain_count']=[sum(domains(r)) for r in frame.to_dict('records')];frame['event']=frame.domain_count>=2
    near=frame[frame.interval_years.between(4/12,8/12)].copy()
    report={'protocol':'protocol.json','complete_pairs_before_age_interval':len(raw),
            'pairs_age_18_50_before_interval':len(adult),'excluded_under_90_days':int((adult.interval_years<90/365.2425).sum()),
            'excluded_over_5_years':int((adult.interval_years>5).sum()),
            'third_measurement_timepoints_in_workbook':0,
            'primary':evaluate(frame,'variable_interval',output,private),
            'direct_4_to_8_months':evaluate(near,'near_six_months',output,private)}
    report['clinical_release']=False
    report['reasons']=['No third scan to validate latest-plus-observed-trend forecasts.',
        'Only 43 eyes / 27 patients have complete eligible 4-8 month pairs; this is an approximate window, not exact six-month follow-up.',
        'Outcome-selected CXL/control cohort; clinical population absolute risk cannot be inferred from its sample proportion.',
        'Quality, treatment timing and source transcription still require a study-level audit; a numerical endpoint is not adjudicated clinical progression.']
    (output/'domain_outlook_validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:{n:v for n,v in report[k].items() if n in ['eyes','patients','events','metrics','bootstrap','near_six_months_held_out']} for k in ['primary','direct_4_to_8_months']},indent=2))



def build_baseline_demo(source, output, private):
    """v8.2 experimental all-adult baseline demo; not a clinical release.

    Recipe specified before this fit: same nested-grouped ridge procedure;
    broaden baseline age eligibility to 18-100; retain 90-day to 5-year visits;
    fixed requested horizon 12 months; audit 9-15-month endpoint subset without
    selecting the model or changing thresholds from that subset's performance.
    """
    output.parent.mkdir(parents=True,exist_ok=True);private.mkdir(parents=True,exist_ok=True)
    raw=pd.read_csv(source)
    required=['patient_id','eye','age_baseline','interval_years']+['baseline_'+k for k in KEYS]+['latest_'+k for k in KEYS]
    if raw[required].isna().any().any():raise ValueError('Demo training requires complete parsed pairs.')
    if raw[['patient_id','eye']].duplicated().any():raise ValueError('Duplicate eye pairs require source reconciliation.')
    frame=raw[raw.age_baseline.between(18,100)&raw.interval_years.between(90/365.2425,5)].copy()
    frame['domain_count']=[sum(domains(r)) for r in frame.to_dict('records')];frame['event']=frame.domain_count>=2
    tmp=private/'aggregate';tmp.mkdir(exist_ok=True)
    validation=evaluate(frame,'adult_baseline',tmp,private)
    fitted=json.loads((tmp/'adult_baseline_candidate.json').read_text())
    oof=pd.read_csv(private/'adult_baseline_oof.csv')
    # evaluate() preserves source frame order in its OOF export.
    assert oof.patient_id.astype(str).tolist()==frame.patient_id.astype(str).tolist()
    near=frame.interval_years.between(9/12,15/12).to_numpy()
    near_validation={'window_months':[9,15],'eyes':int(near.sum()),'patients':int(frame.loc[near,'patient_id'].nunique()),'events':int(frame.loc[near,'event'].sum()),
        'note':'Post-fit descriptive subset of held-out predictions at the actual observed intervals, not exact 12-month validation.'}
    if len(np.unique(frame.event.to_numpy()[near]))==2:
        near_validation['metrics']={k:metrics(frame.event.to_numpy()[near].astype(int),oof[k].to_numpy()[near]) for k in ['candidate','interval_only','prevalence']}
    names=fitted['features'];x=design(frame,'candidate')
    stats={name:{'min':float(x[:,i].min()),'max':float(x[:,i].max()),'median':float(np.median(x[:,i]))} for i,name in enumerate(names)}
    artifact={**fitted,'version':'0.2.0-baseline-research-demo','status':'experimental_demo_only','horizon_months':12,
        'source_paired_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'selection_rule':'Complete parsed adults age 18-100; interval 90 days to 5 years; no CXL-label-based relabelling.',
        'label':'Model-estimated numerical threshold crossing at a 12-month scan',
        'feature_stats':stats,'validation':validation,'near_twelve_months':near_validation,
        'calibrated_clinical_probability':False,'clinical_release':False,
        'domain_rules':[{'key':'anterior','label':'Anterior curvature','rule':'ARC decrease >0.106 mm OR Kmax increase >1 D'},
                        {'key':'posterior','label':'Posterior curvature','rule':'PRC decrease >0.085 mm'},
                        {'key':'pachymetric','label':'Pachymetric','rule':'Thinnest decrease >2% OR ARTmax decrease >44.24'},
                        {'key':'composite','label':'Composite deviation','rule':'BAD-D increase >0.42'}],
        'limitations':['Selected CXL/control cohort; sample response is not population-calibrated patient risk.',
                       'Numerical outcome is not independently adjudicated clinical progression.',
                       'Variable follow-up and incomplete treatment/quality audit; no exact first-crossing time.',
                       'Forecast assumes comparable untreated scans; no CXL treatment benefit is estimated.',
                       'Internal validation only; no external fixed-horizon validation.']}
    output.write_text(json.dumps(artifact,indent=2)+'\n')
    print(json.dumps({'artifact':str(output),'eyes':len(frame),'patients':frame.patient_id.nunique(),'events':int(frame.event.sum()),'selected_C':fitted['C'],'metrics':validation['metrics'],'near_12_months':near_validation},indent=2))



def build_nkpi_aware_demo(source, output, private):
    """Fixed-index reuse experiment and anchored score trajectory; research only.

    NKPI coefficients are held fixed, including within folds. They were learned
    using overlapping source records. Validation here is conditional on that
    reused transformation, NOT independent/end-to-end clinical validation.
    """
    from sklearn.linear_model import Ridge
    output.parent.mkdir(parents=True,exist_ok=True);private.mkdir(parents=True,exist_ok=True)
    root=Path(__file__).resolve().parents[1]
    old=json.loads((root/'research/baseline_forecast_demo.json').read_text())
    raw=pd.read_csv(source)
    required=['patient_id','eye','age_baseline','interval_years']+['baseline_'+k for k in KEYS]+['latest_'+k for k in KEYS]
    if raw[required].isna().any().any() or raw[['patient_id','eye']].duplicated().any():raise ValueError('Complete unique pairs required.')
    d=raw[raw.age_baseline.between(18,100)&raw.interval_years.between(90/365.2425,5)].copy().reset_index(drop=True)
    mpath=root/'models/release_model_baseline.json';m=json.loads(mpath.read_text())
    coeff=np.array(m['coefficients']);sc=np.array(m['scale']);center=np.array(m['center'])
    def expit(z):return 1/(1+np.exp(-np.clip(z,-700,700)))
    x=design(d,'candidate');t=d.interval_years.to_numpy();g=d.patient_id.to_numpy()
    z0=m['intercept']+np.sum((x[:,:7]-center)/sc*coeff,axis=1)
    nkpi=100*expit(z0)
    age_rate=float(coeff[0]/sc[0])
    later=d[['age_baseline']+['latest_'+k for k in KEYS]].to_numpy();later[:,0]+=t
    z1=m['intercept']+np.sum((later-center)/sc*coeff,axis=1)
    later_score=100*expit(z1);measurement_delta=z1-z0-age_rate*t
    augmented=np.column_stack([x[:,:7],nkpi,x[:,-1]])
    names=['age_baseline']+['baseline_'+k for k in KEYS]+['baseline_NKPI','log_interval_years']
    y=np.array([sum(domains(r))>=2 for r in d.to_dict('records')],int)
    predicted={k:[] for k in ['candidate','without_nkpi','prevalence']};selection=[]
    tx=np.column_stack([nkpi,d.age_baseline.to_numpy()]);alphas=[.1,1,10,100,1000]
    trajectory_runs=[];trajectory_selection=[]
    def fit_rate(ix,alpha):
        scaler=StandardScaler().fit(tx[ix]);v=np.column_stack([np.ones(len(ix)),scaler.transform(tx[ix])])*t[ix,None]
        fit=Ridge(alpha=alpha,fit_intercept=False).fit(v,measurement_delta[ix])
        return scaler,fit
    def forecast_rate(ix,model):
        scaler,fit=model;v=np.column_stack([np.ones(len(ix)),scaler.transform(tx[ix])])
        return fit.predict(v)
    def select_rate(ix,seed):
        folds=list(StratifiedGroupKFold(3,shuffle=True,random_state=seed).split(tx[ix],y[ix],g[ix]))
        loss=[]
        for alpha in alphas:
            pred=np.zeros(len(ix))
            for tr,va in folds:
                a,b=ix[tr],ix[va];assert not set(g[a])&set(g[b])
                rate=forecast_rate(b,fit_rate(a,alpha));pred[va]=100*expit(z0[b]+t[b]*(age_rate+rate))
            loss.append(np.mean((pred-later_score[ix])**2))
        a=alphas[int(np.argmin(loss))]
        return fit_rate(ix,a),a
    for seed in SEEDS:
        run={k:np.zeros(len(d)) for k in predicted};rscore=np.zeros(len(d))
        for fold,(tr,va) in enumerate(StratifiedGroupKFold(5,shuffle=True,random_state=seed).split(x,y,g)):
            assert not set(g[tr])&set(g[va]);run['prevalence'][va]=np.mean(y[tr])
            for kind,xx in [('candidate',augmented),('without_nkpi',x)]:
                fit,c=select_fit(xx[tr],y[tr],g[tr],seed+fold);run[kind][va]=fit.predict_proba(xx[va])[:,1]
                selection.append(dict(seed=seed,fold=fold,kind=kind,C=c))
            fit,a=select_rate(tr,seed+fold);rate=forecast_rate(va,fit)
            rscore[va]=100*expit(z0[va]+t[va]*(age_rate+rate))
            trajectory_selection.append(dict(seed=seed,fold=fold,alpha=a))
        for k in run:predicted[k].append(run[k])
        trajectory_runs.append(rscore)
    mean={k:np.mean(v,axis=0) for k,v in predicted.items()};near=d.interval_years.between(9/12,15/12).to_numpy()
    validation={'eyes':len(d),'patients':int(d.patient_id.nunique()),'events':int(sum(y)),
        'metrics':{k:metrics(y,p) for k,p in mean.items()},
        'each_repeat':{k:[metrics(y,p) for p in pp] for k,pp in predicted.items()},
        'selection':selection,'bootstrap':bootstrap(y,mean['candidate'],mean['prevalence'],g),
        'reuse_caveat':'Conditional internal assessment with previously fitted NKPI. Development records overlap; not leakage-free end-to-end or external validation.'}
    near_validation={'window_months':[9,15],'eyes':int(near.sum()),'patients':int(d.loc[near,'patient_id'].nunique()),'events':int(sum(y[near])),
        'metrics':{k:metrics(y[near],p[near]) for k,p in mean.items()},
        'note':'Descriptive held-out predictions at actual intervals; fixed-index reuse; not exact 12-month validation.'}
    final,c=select_fit(augmented,y,g,2718);scale=final.named_steps['standardscaler'];lr=final.named_steps['logisticregression']
    rate_model,alpha=select_rate(np.arange(len(d)),2718);rscale,rfit=rate_model
    preds={'trajectory':np.mean(trajectory_runs,axis=0),'persistence':nkpi,'age_only':100*expit(z0+age_rate*t)}
    def score_metrics(pred,mask):
        diff=pred[mask]-later_score[mask]
        return {'eyes':int(np.sum(mask)),'mae_nkpi':float(np.mean(abs(diff))),'rmse_nkpi':float(np.mean(diff**2)**.5),'mean_error_nkpi':float(np.mean(diff))}
    stats=lambda xx,nn:{n:{'min':float(xx[:,i].min()),'max':float(xx[:,i].max()),'median':float(np.median(xx[:,i]))}for i,n in enumerate(nn)}
    trajectory={'version':'1.0.0-anchored-nkpi','features':['baseline_NKPI','age_baseline'],
        'scaler_mean':rscale.mean_.tolist(),'scaler_scale':rscale.scale_.tolist(),'coef':rfit.coef_.tolist(),'alpha':alpha,
        'age_logit_per_year':age_rate,'months':[0,3,6,9,12],'feature_stats':stats(tx,['baseline_NKPI','age_baseline']),
        'target':'Measurement-driven change in frozen baseline NKPI logit; age effect added exactly from frozen score.',
        'validation':{k:score_metrics(p,np.ones(len(d),bool)) for k,p in preds.items()},
        'near_twelve_months':{k:score_metrics(p,near) for k,p in preds.items()},
        'each_repeat':[score_metrics(p,np.ones(len(d),bool))for p in trajectory_runs],
        'selection':trajectory_selection,'clinical_release':False,
        'assumption':'Constant conditional mean measurement drift over 12 months, no treatment. Quarter-year points are model interpolation, not observed scans.',
        'reuse_caveat':validation['reuse_caveat']}
    artifact={**old,'version':'0.3.0-nkpi-aware-demo','features':names,'scaler_mean':scale.mean_.tolist(),'scaler_scale':scale.scale_.tolist(),
        'coef':lr.coef_[0].tolist(),'intercept':float(lr.intercept_[0]),'C':c,'feature_stats':stats(augmented,names),
        'source_paired_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'nkpi_model_sha256':hashlib.sha256(mpath.read_bytes()).hexdigest(),
        'validation':validation,'near_twelve_months':near_validation,'trajectory':trajectory,
        'limitations':list(dict.fromkeys(old['limitations']+[validation['reuse_caveat'],'NKPI is derived from the same baseline variables; it adds no new measured information.']))}
    output.write_text(json.dumps(artifact,indent=2)+'\n');output.with_suffix('.sha256').write_text(hashlib.sha256(output.read_bytes()).hexdigest()+'\n')
    d[['patient_id','eye']].assign(event=y,**mean,trajectory=preds['trajectory'],later_nkpi=later_score).to_csv(private/'v83_oof.csv',index=False)
    print(json.dumps({'forecast':validation['metrics'],'near_12':near_validation['metrics'],'trajectory':trajectory['validation'],'near_12_trajectory':trajectory['near_twelve_months'],'C':c,'alpha':alpha},indent=2))

def score_basis_design(base, frame, excluded_patients):
    """Rebuild the NKPI ridge core with no labels from excluded patients."""
    cols=['age_baseline']+['baseline_'+k for k in KEYS]
    train=~base.patient_id.isin(excluded_patients)
    assert not set(base.loc[train,'patient_id']) & set(excluded_patients)
    fit=learner(.1).fit(base.loc[train,cols].to_numpy(),base.loc[train,'outcome'].to_numpy(int))
    z=fit.decision_function(frame[cols].to_numpy())
    return np.column_stack([frame[cols].to_numpy(),z,np.log(frame.interval_years.to_numpy())])


def build_selected_demo(source, baseline_source, output, private):
    """Nested patient-grouped comparison; fixed-horizon audit is the primary target.

    The NKPI ridge weights are refitted inside every training split. Its original
    positive affine calibration cancels when the logit is standardized in the
    forecast layer; no held-out CXL labels enter that layer's NKPI transform.
    Earlier development on this cohort still precludes external-validation claims.
    """
    from scipy.special import expit
    root=Path(__file__).resolve().parents[1]
    output.parent.mkdir(parents=True,exist_ok=True);private.mkdir(parents=True,exist_ok=True)
    old=json.loads((root/'research/baseline_forecast_demo.json').read_text())
    raw=pd.read_csv(source);base=pd.read_csv(baseline_source)
    d=raw[raw.age_baseline.between(18,100)&raw.interval_years.between(90/365.2425,5)].copy().reset_index(drop=True)
    columns=['age_baseline']+['baseline_'+k for k in KEYS]
    assert not d[['patient_id','eye']].duplicated().any()
    assert not base[['patient_id','eye']].duplicated().any()
    assert np.isfinite(d[columns+['interval_years']].to_numpy()).all()
    assert np.isfinite(base[columns].to_numpy()).all()
    y=np.array([sum(domains(r))>=2 for r in d.to_dict('records')],int)
    g=d.patient_id.to_numpy();x=d[columns].to_numpy();bx=base[columns].to_numpy();bg=base.patient_id.to_numpy();by=base.outcome.to_numpy(int)
    near=d.interval_years.between(.75,1.25).to_numpy();time=np.log(d.interval_years.to_numpy())
    mpath=root/'models/release_model_baseline.json';m=json.loads(mpath.read_text())
    frozen_z=m['intercept']+((x-np.array(m['center']))/np.array(m['scale'])*np.array(m['coefficients'])).sum(axis=1)
    nkpi=100*expit(frozen_z);fixed=np.column_stack([x,frozen_z,time])
    names=columns+['baseline_NKPI_logit','log_interval_years']
    masks={'nkpi_logit_time':[7,8],'nkpi_logit_age_time':[0,7,8],'raw_baseline_time':list(range(7))+[8],'direct_near12_nkpi_logit':[7]}
    kinds=list(masks);cs=[.01,.1,1.]
    configs=[(k,c) for k in kinds for c in cs]
    cache={};fit_audit=[]
    def matrix(excluded):
        key=tuple(sorted(excluded))
        if key not in cache:
            train=~np.isin(bg,key);assert not set(bg[train])&set(key)
            cache[key]=score_basis_design(base,d,key)
            fit_audit.append({'training_patients':int(len(np.unique(bg[train]))),'excluded_patients':len(key),'patient_overlap':0})
        return cache[key]
    def fit_predict(kind,c,xx,tr,va):
        ix=tr[near[tr]] if kind=='direct_near12_nkpi_logit' else tr
        cols=masks[kind]
        if len(np.unique(y[ix]))<2:return np.full(len(va),(y[ix].sum()+.5)/(len(ix)+1))
        return learner(c).fit(xx[ix][:,cols],y[ix]).predict_proba(xx[va][:,cols])[:,1]
    def choose(ix,excluded,seed):
        inner=list(StratifiedGroupKFold(3,shuffle=True,random_state=seed).split(x[ix],y[ix],g[ix]))
        pred={cfg:np.zeros(len(ix)) for cfg in configs}
        for tr0,va0 in inner:
            tr,va=ix[tr0],ix[va0];assert not set(g[tr])&set(g[va])
            xx=matrix(set(excluded)|set(g[va]))
            for cfg in configs:pred[cfg][va0]=fit_predict(*cfg,xx,tr,va)
        losses={cfg:float(np.mean((pred[cfg][near[ix]]-y[ix][near[ix]])**2)) for cfg in configs}
        def rank(cfg):return (len(masks[cfg[0]]),cfg[1],kinds.index(cfg[0]))
        best=min(losses.values());eligible=[cfg for cfg in configs if losses[cfg]<=best+.002]
        selected=min(eligible,key=rank)
        bykind={k:min([cfg for cfg in configs if cfg[0]==k],key=lambda cfg:(losses[cfg],cfg[1])) for k in kinds}
        return selected,bykind,[{'family':k,'C':c,'near12_brier':losses[(k,c)]} for k,c in configs]
    runs={k:[] for k in ['selected',*kinds,'prevalence','interval_only']};folds=[]
    for seed in SEEDS:
        pp={k:np.zeros(len(d)) for k in runs}
        for fold,(tr,va) in enumerate(StratifiedGroupKFold(5,shuffle=True,random_state=seed).split(x,y,g)):
            excluded=set(g[va]);assert not set(g[tr])&excluded
            chosen,bykind,losses=choose(tr,excluded,seed+fold)
            xx=matrix(excluded)
            for kind,cfg in bykind.items():pp[kind][va]=fit_predict(*cfg,xx,tr,va)
            pp['selected'][va]=fit_predict(*chosen,xx,tr,va)
            pp['prevalence'][va]=np.mean(y[tr][near[tr]])
            it=learner(.1).fit(time[tr,None],y[tr]);pp['interval_only'][va]=it.predict_proba(time[va,None])[:,1]
            folds.append({'seed':seed,'fold':fold,'selected_family':chosen[0],'C':chosen[1],
                'train_eyes':len(tr),'test_eyes':len(va),'near12_test_eyes':int(sum(near[va])),
                'patient_overlap':0,'inner_scores':losses})
        for k in runs:runs[k].append(pp[k])
        print('Completed grouped repeat',seed,flush=True)
    means={k:np.mean(v,axis=0) for k,v in runs.items()}
    metrics_primary={k:metrics(y[near],p[near]) for k,p in means.items()}
    metrics_all={k:metrics(y,p) for k,p in means.items()}
    final_cfg,_,final_losses=choose(np.arange(len(d)),set(),2718)
    kind,c=final_cfg;active=masks[kind];fit_ix=np.flatnonzero(near) if kind=='direct_near12_nkpi_logit' else np.arange(len(d))
    # Check exact recovery of the original score's ridge core before using its
    # public calibrated logit. Standardization makes the positive affine step irrelevant.
    reconstructed=learner(.1).fit(bx,by);cal=m['metadata']['selected_tuning']
    assert np.allclose(reconstructed[0].mean_,m['center'],rtol=0,atol=1e-12)
    assert np.allclose(reconstructed[1].coef_[0]*cal['calibration_slope'],m['coefficients'],rtol=0,atol=1e-12)
    assert abs(reconstructed[1].intercept_[0]*cal['calibration_slope']+cal['calibration_intercept']-m['intercept'])<1e-12
    final=learner(c).fit(fixed[fit_ix][:,active],y[fit_ix]);sc=final[0];lr=final[1]
    center=fixed[fit_ix].mean(axis=0);scale=fixed[fit_ix].std(axis=0);scale[scale==0]=1;co=np.zeros(9)
    center[active]=sc.mean_;scale[active]=sc.scale_;co[active]=lr.coef_[0]
    # Numerical identity against the uncalibrated full refit is an important
    # bridge between leakage-controlled evaluation and frozen-score inference.
    unc=matrix(set());unfit=learner(c).fit(unc[fit_ix][:,active],y[fit_ix])
    assert np.max(abs(unfit.predict_proba(unc[:,active])[:,1]-final.predict_proba(fixed[:,active])[:,1]))<1e-8
    def band_table(mask):
        out=[]
        for lo,hi,label in [(0,50,'Below 50'),(50,65,'50 to below 65'),(65,101,'65 and above')]:
            ix=mask&(nkpi>=lo)&(nkpi<hi);n=int(sum(ix));events=int(sum(y[ix]));out.append({'label':label,'lower':lo,'upper_exclusive':hi,'eyes':n,'patients':int(d.loc[ix,'patient_id'].nunique()),'events':events,'observed_fraction':events/n if n else None,'median_months':float(np.median(d.interval_years.to_numpy()[ix])*12) if n else None})
        return out
    ci=bootstrap(y[near],means['selected'][near],means['prevalence'][near],g[near])
    validation={'eyes':len(d),'patients':int(d.patient_id.nunique()),'events':int(sum(y)),
       'primary_window_months':[9,15],'primary_metrics':metrics_primary,'metrics':{'candidate':metrics_all['selected'],'prevalence':metrics_all['prevalence']},
       'all_family_variable_interval_metrics':metrics_all,
       'each_repeat_primary':{k:[metrics(y[near],v[near]) for v in vv]for k,vv in runs.items()},
       'nested_selection':folds,'final_selection':{'family':kind,'C':c,'inner_scores':final_losses},
       'bootstrap':ci,'nkpi_refit_audit':{'fits':len(fit_audit),'all_patient_overlap_zero':True,'minimum_training_patients':min(v['training_patients']for v in fit_audit)},
       'reuse_caveat':'All fitted NKPI ridge weights, forecast scalers, model-family and penalty selection refitted without held-out patients. The positive affine frozen NKPI calibration cancels for standardized logits. This cohort was used in earlier development; no independent external or prospective validation.'}
    near_result={'window_months':[9,15],'eyes':int(sum(near)),'patients':int(d.loc[near,'patient_id'].nunique()),'events':int(sum(y[near])),
       'metrics':metrics_primary,'note':'Primary nested evaluation on observed 9–15 month scans, not exact 12-month events or independent external validation.'}
    audit={'all_intervals':band_table(np.ones(len(d),bool)),'near_twelve_months':band_table(near),
       'basis':'Frozen baseline NKPI on development records; descriptive frequencies, not held-out calibration or patient probabilities.',
       'clinic_validation':{'reported_detection_rate':.98,'reported_cutoff':65,'provenance':'User-reported clinic result; case-level outcomes and denominator not available to this fit.','used_for_training':False},
       'date_audit':{'usable_complete_pairs':len(raw),'eligible_forecast_pairs':len(d),'additional_visit_timepoints':0,'first_event_dates_available':False,'temporal_external_validation_available':False,
          'excluded_under_90_days':int(sum(raw.age_baseline.between(18,100)&(raw.interval_years<90/365.2425))),
          'excluded_over_five_years':int(sum(raw.age_baseline.between(18,100)&(raw.interval_years>5)))}}
    # Smooth diagnostic mapping plus quintiles are descriptive OOF checks only.
    p=means['selected'][near];yy=y[near];order=np.argsort(p)
    bins=[{'eyes':len(ix),'events':int(sum(yy[ix])),'mean_prediction':float(np.mean(p[ix])),'observed_fraction':float(np.mean(yy[ix]))} for ix in np.array_split(order,5)]
    diagnostic=LogisticRegression(C=1e6,max_iter=3000).fit(np.log(p/(1-p))[:,None],yy)
    grid=np.linspace(max(.001,float(p.min())),min(.999,float(p.max())),21)
    calibration={'bins':bins,'smooth_logistic_diagnostic':[{'predicted':float(v),'observed_fit':float(q)}for v,q in zip(grid,diagnostic.predict_proba(np.log(grid/(1-grid))[:,None])[:,1])],
       'note':'Descriptive held-out diagnostic, not a correction applied to the displayed forecast; small sample.'}
    limitations=[v for v in old['limitations'] if 'overlap' not in v.lower()]
    artifact={**old,'version':'0.4.0-selected-nkpi-demo','model_family':kind,'active_features':[names[i]for i in active],
       'features':names,'scaler_mean':center.tolist(),'scaler_scale':scale.tolist(),'coef':co.tolist(),'intercept':float(lr.intercept_[0]),'C':c,
       'training_eyes':len(fit_ix),'training_patients':int(len(np.unique(g[fit_ix]))),'training_events':int(sum(y[fit_ix])),
       'feature_stats':{n:{'min':float(fixed[fit_ix,i].min()),'max':float(fixed[fit_ix,i].max()),'median':float(np.median(fixed[fit_ix,i]))}for i,n in enumerate(names)},
       'source_baseline_sha256':hashlib.sha256(baseline_source.read_bytes()).hexdigest(),'source_paired_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
       'nkpi_model_sha256':hashlib.sha256(mpath.read_bytes()).hexdigest(),'validation':validation,'near_twelve_months':near_result,
       'score_band_audit':audit,'calibration_diagnostic':calibration,'legacy_v83':{'metrics':old.get('legacy_v83',{}).get('metrics',old['validation']['metrics']),
          'note':'Historical v8.3 conditional assessment with reused fixed NKPI; not directly comparable with the refitted nested procedure.'},
       'limitations':list(dict.fromkeys(limitations+[validation['reuse_caveat'],'Only one eligible development eye has baseline NKPI >=65; high-score extrapolation is poorly supported.','No manual probability floors or clinic-detection-rate substitution.']))}
    output.write_text(json.dumps(artifact,indent=2)+'\n');output.with_suffix('.sha256').write_text(hashlib.sha256(output.read_bytes()).hexdigest()+'\n')
    d[['patient_id','eye']].assign(event=y,near12=near,nkpi=nkpi,**means).to_csv(private/'v84_oof.csv',index=False)
    (private/'nkpi_refit_audit.json').write_text(json.dumps(fit_audit,indent=2))
    print(json.dumps({'selected':artifact['active_features'],'family':kind,'C':c,'primary':metrics_primary,'all_intervals':metrics_all,'bands':audit,'bootstrap':ci},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--paired',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--private-out',type=Path,required=True);p.add_argument('--baseline',type=Path);p.add_argument('--select-forecast',action='store_true');p.add_argument('--baseline-demo',action='store_true');p.add_argument('--nkpi-aware',action='store_true');a=p.parse_args()
    if a.select_forecast:
        if a.baseline is None:p.error('--baseline is required for --select-forecast')
        build_selected_demo(a.paired,a.baseline,a.out/'baseline_forecast_demo.json',a.private_out)
    elif a.nkpi_aware:build_nkpi_aware_demo(a.paired,a.out/'baseline_forecast_demo.json',a.private_out)
    elif a.baseline_demo:build_baseline_demo(a.paired,a.out/'baseline_forecast_demo.json',a.private_out)
    else:run(a.paired,a.out,a.private_out)
