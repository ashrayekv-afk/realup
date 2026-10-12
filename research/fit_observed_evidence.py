"""Fit selected-cohort joint slopes with external heteroscedastic scan error.
No CXL labels enter fitting; this is not progression/outcome calibration.
"""
import sys,json,hashlib
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from nkpi.evidence import KEYS,DIRECTION,SCALE,YEAR,VERSION,pair_limits


def fit(d,t,noise,w,max_iter=12000):
    w=w/w.sum();s=d/t[:,None];mu=np.sum(w[:,None]*s,axis=0)
    v=np.einsum('n,ni,nj->ij',w,s-mu,s-mu)+.01*np.eye(6);previous=-np.inf
    for iteration in range(max_iter):
        innovation=t[:,None,None]**2*v+noise;inv=np.linalg.inv(innovation)
        gain=t[:,None,None]*np.einsum('ij,njk->nik',v,inv)
        residual=d-t[:,None]*mu
        m=mu+np.einsum('nij,nj->ni',gain,residual)
        post=v-t[:,None,None]*np.einsum('nij,jk->nik',gain,v)
        mu_new=np.sum(w[:,None]*m,axis=0)
        v_new=np.einsum('n,nij->ij',w,post)+np.einsum('n,ni,nj->ij',w,m-mu_new,m-mu_new)
        eig,vec=np.linalg.eigh((v_new+v_new.T)/2);v_new=(vec*np.maximum(eig,1e-6))@vec.T
        ll=float(-.5*np.sum(w*(np.linalg.slogdet(innovation)[1]+np.einsum('ni,nij,nj->n',residual,inv,residual))))
        if ll<previous-1e-6:raise ValueError('EM likelihood decreased')
        mu,v=mu_new,v_new
        if iteration>5 and abs(ll-previous)<1e-6:return mu,v,dict(converged=True,iterations=iteration+1,weighted_log_likelihood_without_constant=ll)
        previous=ll
    raise ValueError('Joint trend fit did not converge')


def run(source,output):
    f=pd.read_csv(source);f=f[f.age_baseline.between(18,50)&f.interval_years.between(90/YEAR,5)].copy()
    first=f[['baseline_'+k for k in KEYS]].to_numpy();latest=f[['latest_'+k for k in KEYS]].to_numpy()
    d=(latest-first)*DIRECTION/SCALE
    noise=[]
    for a,b in zip(first,latest):
        va=(pair_limits(dict(zip(KEYS,a)))/(1.96*np.sqrt(2))/SCALE)**2
        vb=(pair_limits(dict(zip(KEYS,b)))/(1.96*np.sqrt(2))/SCALE)**2
        noise.append(np.diag(va+vb))
    weights=1/f.groupby('patient_id').patient_id.transform('count').to_numpy()
    mu,cov,diagnostic=fit(d,f.interval_years.to_numpy(),np.array(noise),weights)
    result=dict(version=VERSION,keys=list(KEYS),cohort=dict(eyes=len(f),patients=int(f.patient_id.nunique())),
        private_input_sha256=hashlib.sha256(Path(source).read_bytes()).hexdigest(),
        mean_slope=mu.tolist(),slope_covariance=cov.tolist(),fit=diagnostic,
        measurement_bounds={k:[float(f[['baseline_'+k,'latest_'+k]].min().min()),float(f[['baseline_'+k,'latest_'+k]].max().max())] for k in KEYS},
        selection='Age 18–50, complete eligible pairs, 90 days to five years. Inverse patient-eye weighting. CXL labels not used.',
        limitations='External precision transfer, independent measurement-error working model, selected retrospective cohort, two dates per eye, no third-visit forecasting validation. Prior is used for trend regularization only.',
        references=[dict(doi='10.1038/s41598-020-76020-6',table=1,pair_COR={'A':.106,'B':.131,'C':11.266,'Kmax':.926,'BAD_D':.810,'ARTmax':44.240}),
                    dict(doi='10.1371/journal.pone.0228992',table=1,Kmax_bands=[['<48.2',.32],['48.2–53.9',1.33],['>=53.9',1.62]],C_COR=14.2)],
        calibration='Not calibrated or clinically validated. Clinical labels and sensitivity/specificity have not been estimated.')
    p=Path(output);p.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n');p.with_suffix('.sha256').write_text(hashlib.sha256(p.read_bytes()).hexdigest()+'\n')
    print(json.dumps(dict(cohort=result['cohort'],fit=diagnostic)))
if __name__=='__main__':run(sys.argv[1],sys.argv[2])
