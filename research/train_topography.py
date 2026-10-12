"""v8.6 constrained tomography scenario. Private input records are never packaged.

Evidence informs directions, not synthetic patient outcomes or percentage floors.
All observed signed differences, including improvement, remain training targets.
Validation is conditional on the already frozen, overlapping-cohort NKPI model.
"""
from pathlib import Path
import argparse, hashlib, json
import numpy as np
import pandas as pd
from scipy.optimize import least_squares
from scipy.special import expit
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.linear_model import Ridge

KEYS = ['A','B','C','BAD_D','ARTmax','Kmax']
DIRECTIONS = np.array([-1.,-1.,-1.,1.,-1.,1.])
FEATURES = ['constant','nkpi_fraction','nkpi_fraction_squared','nkpi_times_youth','nkpi_times_steepness','nkpi_times_thinness']
ALPHAS = [.1,1.,10.]
SEEDS = [2718,3141,1618]

def basis(score, age, raw):
    n=np.asarray(score)/100
    youth=np.clip((100-np.asarray(age))/82,0,1)
    steep=np.clip((raw[:,5]-40)/40,0,1.5)
    thin=np.clip((550-raw[:,2])/250,0,1.5)
    return np.column_stack([np.ones(len(n)),n,n*n,n*youth,n*steep,n*thin])

def scales(raw):
    return np.column_stack([np.full(len(raw),.106),np.full(len(raw),.085),.02*raw[:,2],np.full(len(raw),.42),np.full(len(raw),44.24),np.ones(len(raw))])

def fit_joint(x,y,t,g,alpha):
    # Patient weights prevent bilateral patients counting twice; time weighting
    # limits leverage of long pairs. These are design weights, not estimated noise.
    counts={v:sum(g==v) for v in np.unique(g)}
    w=np.array([1/counts[v] for v in g])/(1+t*t)
    design=x*t[:,None]
    nfeat=x.shape[1]
    def residual(theta):
        pred=(design@theta[:nfeat])[:,None]*theta[nfeat:][None,:]
        return np.r_[((pred-y)*np.sqrt(w[:,None])).ravel(),np.sqrt(alpha)*theta]
    init=np.r_[np.full(nfeat,.1),np.full(6,.3)]
    fit=least_squares(residual,init,bounds=(0,np.inf),loss='soft_l1',f_scale=1.,max_nfev=300,ftol=1e-8,xtol=1e-8,gtol=1e-8)
    if not fit.success: raise RuntimeError(fit.message)
    # Fixed scale removes rank-one identifiability ambiguity in exported factors.
    a=fit.x[:nfeat];q=fit.x[nfeat:];norm=np.linalg.norm(q)
    return dict(activity=(a*norm).tolist(),pattern=(q/norm).tolist(),alpha=alpha)

def predict_joint(fit,x,t):
    return ((x@np.array(fit['activity']))*t)[:,None]*np.array(fit['pattern'])[None,:]

def fit_free(x,y,t,g,alpha):
    counts={v:sum(g==v) for v in np.unique(g)}
    w=np.array([1/counts[v] for v in g])/(1+t*t)
    return Ridge(alpha=alpha,fit_intercept=False).fit(x*t[:,None],y,sample_weight=w)

def run(source,root,private):
    private.mkdir(parents=True,exist_ok=True)
    raw=pd.read_csv(source)
    d=raw[raw.age_baseline.between(18,100)&raw.interval_years.between(90/365.2425,5)].copy().reset_index(drop=True)
    if d[['patient_id','eye']].duplicated().any():raise ValueError('Duplicate eye pairs.')
    v0=d[['baseline_'+k for k in KEYS]].to_numpy(float);v1=d[['latest_'+k for k in KEYS]].to_numpy(float)
    if not np.isfinite(np.c_[v0,v1]).all():raise ValueError('Nonfinite paired measurements.')
    m=json.loads((root/'models/release_model_baseline.json').read_text())
    beta=np.array(m['coefficients'])/np.array(m['scale'])
    z0=m['intercept']+np.sum((np.c_[d.age_baseline,v0]-np.array(m['center']))*beta,axis=1)
    nkpi=100*expit(z0);actual_nkpi=100*expit(z0+np.sum((v1-v0)*beta[1:],axis=1))
    scale=scales(v0);y=(v1-v0)*DIRECTIONS/scale;t=d.interval_years.to_numpy();g=d.patient_id.to_numpy()
    x=basis(nkpi,d.age_baseline.to_numpy(),v0);near=(t>=.75)&(t<=1.25)
    labels=d.outcome.to_numpy(int)
    selections=[];runs={k:[] for k in ['joint','free','unchanged']}
    def select(ix,seed,family):
        losses={a:[] for a in ALPHAS}
        for tr0,va0 in StratifiedGroupKFold(3,shuffle=True,random_state=seed).split(x[ix],labels[ix],g[ix]):
            tr,va=ix[tr0],ix[va0];assert not set(g[tr])&set(g[va])
            mask=near[va]
            for a in ALPHAS:
                fit=fit_joint(x[tr],y[tr],t[tr],g[tr],a) if family=='joint' else fit_free(x[tr],y[tr],t[tr],g[tr],a)
                pred=predict_joint(fit,x[va],t[va]) if family=='joint' else fit.predict(x[va]*t[va,None])
                losses[a].extend(abs(pred[mask]-y[va][mask]).ravel().tolist())
        mean={a:float(np.mean(v)) for a,v in losses.items()}
        # In a tie prefer stronger regularization.
        return min(ALPHAS,key=lambda a:(round(mean[a],8),-a)),mean
    for seed in SEEDS:
        pred={k:np.zeros_like(y) for k in runs}
        for fold,(tr,va) in enumerate(StratifiedGroupKFold(5,shuffle=True,random_state=seed).split(x,labels,g)):
            assert not set(g[tr])&set(g[va])
            record={'seed':seed,'fold':fold,'patient_overlap':0,'test_eyes':len(va)}
            for family in ['joint','free']:
                alpha,losses=select(tr,seed+fold,family)
                fit=fit_joint(x[tr],y[tr],t[tr],g[tr],alpha) if family=='joint' else fit_free(x[tr],y[tr],t[tr],g[tr],alpha)
                pred[family][va]=predict_joint(fit,x[va],t[va]) if family=='joint' else fit.predict(x[va]*t[va,None])
                record[family]={'alpha':alpha,'inner_normalized_mae':losses}
            selections.append(record)
        for k in runs:runs[k].append(pred[k])
        print('Completed topography grouped repeat',seed,flush=True)
    predictions={k:np.mean(v,axis=0) for k,v in runs.items()}
    def metrics(pred,mask):
        error=(pred-y)*scale;forecast_nkpi=100*expit(z0+np.sum(pred*scale*DIRECTIONS*beta[1:],axis=1))
        e=forecast_nkpi[mask]-actual_nkpi[mask]
        return {'eyes':int(sum(mask)),'patients':int(len(np.unique(g[mask]))),
                'normalized_mae':float(np.mean(abs(pred[mask]-y[mask]))),
                'mae_by_variable':{k:float(np.mean(abs(error[mask,j]))) for j,k in enumerate(KEYS)},
                'rmse_by_variable':{k:float(np.mean(error[mask,j]**2)**.5) for j,k in enumerate(KEYS)},
                'rmse_nkpi':float(np.mean(e**2)**.5),'mae_nkpi':float(np.mean(abs(e)))}
    report={name:{k:metrics(v,mask) for k,v in predictions.items()} for name,mask in [('near_twelve_months',near),('all_intervals',np.ones(len(d),bool))]}
    # Paired patient-cluster uncertainty for error differences, fixed OOF fits.
    rng=np.random.default_rng(860);groups=np.unique(g[near]);indices={v:np.where((g==v)&near)[0] for v in groups}
    skill=[]
    for _ in range(1000):
        ix=np.concatenate([indices[v] for v in rng.choice(groups,len(groups),replace=True)])
        skill.append(float(np.mean(abs(y[ix]))-np.mean(abs(predictions['joint'][ix]-y[ix]))))
    report['normalized_mae_improvement_95_percentile']=np.percentile(skill,[2.5,97.5]).tolist()
    alpha,losses=select(np.arange(len(d)),2718,'joint');final=fit_joint(x,y,t,g,alpha)
    support=[]
    for lo,hi in [(0,20),(20,50),(50,65),(65,101)]:
        mask=(nkpi>=lo)&(nkpi<hi)
        support.append({'lower':lo,'upper_exclusive':hi,'eyes':int(sum(mask)),'near_year_eyes':int(sum(mask&near))})
    # Actual prediction error covariance is descriptive; not a same-day noise estimate.
    cov=np.cov((y-predictions['joint']).T).tolist()
    artifact={'version':'2.0.0-topography','features':FEATURES,'keys':KEYS,'directions':DIRECTIONS.tolist(),
              **final,'months':[0,3,6,9,12],'age_fixed':True,'clinical_release':False,
              'training_eyes':len(d),'training_patients':int(d.patient_id.nunique()),'support':support,
              'feature_ranges':{'age':[float(d.age_baseline.min()),float(d.age_baseline.max())],**{k:[float(v0[:,j].min()),float(v0[:,j].max())] for j,k in enumerate(KEYS)},'nkpi':[float(nkpi.min()),float(nkpi.max())]},
              'target':'Six signed tomography changes; constrained central untreated scenario; frozen baseline NKPI rescored with age held constant',
              'normalization':{'A':.106,'B':.085,'C':'0.02 * baseline_C','BAD_D':.42,'ARTmax':44.24,'Kmax':1.},
              'validation':report,'selection':selections,'final_inner_losses':losses,'residual_covariance_normalized':cov,
              'source_paired_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
              'assumptions':['Nonnegative structural worsening drift is imposed on the central scenario; it is not a finding that all untreated eyes worsen.',
                 'Nonnegative NKPI/activity association is an explicit clinic-informed research constraint, not a validated threshold at 20, 50 or 65.',
                 'Younger age and steeper Kmax cannot reduce activity at fixed other predictor summaries; thinner cornea is a candidate severity interaction, not an established causal rule.',
                 'One shared activity factor couples all six rates; no individual measurement trajectory is known from one scan.',
                 'Current age is held constant for future NKPI calculations. No room-to-100 term enters the biological forecast.',
                 'Actual negative changes remain in fitting and validation. No fabricated clinic cases or externally borrowed outcome labels.',
                 'Paired source is intended pretreatment but timing and quality require audit; no CXL treatment effect is estimated.'],
              'evidence':[{'url':'https://pubmed.ncbi.nlm.nih.gov/33785509/','use':'Age and baseline steepness directions only; hazard ratios are not applied as individual rates.'},
                 {'url':'https://pubmed.ncbi.nlm.nih.gov/30858022/','use':'External aggregate context for age/Kmax directions; pooled mean and meta-regression not transplanted to this cohort.'},
                 {'url':'https://pubmed.ncbi.nlm.nih.gov/24393351/','use':'Progressive untreated eyes may worsen and CXL changes trajectory; no treatment-effect simulation from this study.'}],
              'clinic_evidence':{'case_level_records_available':False,'quantitative_calibration':False,'use':'Direction constraint only. User reports high NKPI in clinically progressing eyes scheduled for CXL.'},
              'reuse_caveat':'Conditional repeated nested patient-grouped assessment. The frozen NKPI input/target was developed on overlapping records. Not fully independent end-to-end, external or prospective validation.'}
    path=root/'research/baseline_forecast_demo.json';old=json.loads(path.read_text());old['trajectory']=artifact;old['version']='0.5.0-topographic-demo'
    path.write_text(json.dumps(old,indent=2)+'\n');path.with_suffix('.sha256').write_text(hashlib.sha256(path.read_bytes()).hexdigest()+'\n')
    pd.DataFrame(np.c_[g,nkpi,t,y,predictions['joint'],predictions['free']]).to_csv(private/'oof_private.csv',index=False)
    (private/'training_results.json').write_text(json.dumps({'model':final,'metrics':report,'support':support},indent=2))
    print(json.dumps({'model':final,'metrics':report,'support':support},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--paired',type=Path,required=True);p.add_argument('--root',type=Path,required=True);p.add_argument('--private-out',type=Path,required=True);a=p.parse_args();run(a.paired,a.root,a.private_out)
