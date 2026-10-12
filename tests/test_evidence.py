"""Numerical/contract tests. These are engineering checks, not clinical validation."""
import copy, hashlib, json, math, sys
from pathlib import Path
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from nkpi import evidence as E
from nkpi.service import calculate, configuration


def case():
    return dict(eye='OD',mode='longitudinal',age=24,interval_days=180,verified=True,
                treatment='untreated',scan_quality={'first':'ok','latest':'ok'},
                first=dict(A=7.2,B=5.8,C=480,Kmax=52,BAD_D=4,ARTmax=230),
                latest=dict(A=7.2,B=5.8,C=480,Kmax=52,BAD_D=4,ARTmax=230))


def result(c): return calculate({'eyes':[c]},include_pdf=False)['eyes'][c['eye']]
def signal(c): return result(c)['evidence']
def scan(c,day,values):return dict(eye=c['eye'],day=day,values=values,quality='ok',verified=True)


class EvidenceTests(unittest.TestCase):
    def test_constant(self):
        p=signal(case());self.assertEqual(p['structural_count'],0)
        for r in p['rows']:self.assertAlmostEqual(r['annual_rate'],0,places=10)
        self.assertFalse(p['calibrated']);self.assertNotIn('probability',p)

    def test_pair_formula_and_time(self):
        c=case();c['latest']['B']-=.2;p=signal(c);r=p['rows'][1]
        self.assertAlmostEqual(r['z'],.2/(.131/1.96))
        self.assertAlmostEqual(r['annual_rate'],-.2*E.YEAR/180)
        for days in (30,80,365,1200):
            q=signal(dict(c,interval_days=days));self.assertEqual(q['structural_count'],p['structural_count'])
            self.assertAlmostEqual(q['rows'][1]['z'],r['z'])
            self.assertAlmostEqual(q['rows'][1]['annual_rate']*days,r['annual_rate']*180)

    def test_severity_and_reference_identity(self):
        for k,expected in [(45,.926),(48.2,1.33),(53.9,1.62),(70,1.62)]:
            self.assertEqual(E.pair_limits(dict(Kmax=k))[3],expected)
        self.assertEqual(E.SCALE[1],.131);self.assertEqual(E.SCALE[4],.810)
        self.assertEqual(E.SCALE[2],14.2)

    def test_strong_opposite_and_bad_d(self):
        c=case();c['latest'].update(A=7.7,B=6.1,C=520,Kmax=48,ARTmax=350,BAD_D=8)
        p=signal(c);self.assertEqual(p['structural_count'],0);self.assertTrue(p['composite']['support'])
        c['latest'].update(A=6.8,B=5.4,C=445,Kmax=55,ARTmax=140)
        self.assertEqual(signal(c)['structural_count'],3)

    def test_holm(self):
        adj,flags=E.holm([.01,.04,.2]);np.testing.assert_allclose(adj,[.03,.08,.2])
        self.assertEqual(flags.tolist(),[True,False,False])

    def test_known_multivisit_slope(self):
        c=case();a=np.array([c['first'][k] for k in E.KEYS]);rate=np.array([-.2,-.2,-20,2,.8,-35])
        c['latest']=dict(zip(E.KEYS,a+rate*180/E.YEAR))
        c['history']=[scan(c,d,dict(zip(E.KEYS,a+rate*d/E.YEAR))) for d in (23,89,131)]
        p=signal(c);np.testing.assert_allclose([r['annual_rate'] for r in p['rows']],rate,atol=1e-10)
        self.assertEqual(p['visits'],5);self.assertEqual(p['scans'],5)

    def test_duplicate_and_repeat_scatter(self):
        c=case();c['latest']['B']=5.6;p=signal(c)
        c['history']=[scan(c,0,c['first'])]*4+[scan(c,180,c['latest'])]*4
        q=signal(c)
        self.assertEqual({k:v for k,v in q.items() if k!='input_sha256'},
                         {k:v for k,v in p.items() if k!='input_sha256'})
        c['history']=[scan(c,0,dict(c['first'],B=6.1)),scan(c,0,dict(c['first'],B=5.5))]
        q=signal(c);self.assertEqual(q['visits'],2);self.assertEqual(q['scans'],4)
        self.assertGreater(q['rows'][1]['annual_se'],p['rows'][1]['annual_se'])

    def test_irregularity_reduces_precision(self):
        c=case();c['latest']['B']=5.6
        c['history']=[scan(c,90,dict(c['first'],B=5.7))];p=signal(c)
        c['history'][0]['values']['B']=6.5;q=signal(c)
        self.assertGreater(q['rows'][1]['annual_se'],p['rows'][1]['annual_se'])
        self.assertTrue(any('depart' in n for n in q['notes']))

    def test_eligibility(self):
        for change in [dict(verified=False),dict(treatment='treated'),dict(mode='baseline'),dict(interval_days=0),dict(scan_quality={'first':'warning','latest':'ok'})]:
            p=signal(dict(case(),**change));self.assertEqual(p['status'],'unavailable');self.assertNotIn('structural_count',p)
        p=signal(dict(case(),treatment='unknown'));self.assertTrue(any('unconfirmed' in n for n in p['notes']))

    def test_history_validation_and_privacy(self):
        c=case();s=scan(c,90,c['first']);s.update(name='DO NOT RETAIN',timestamp='2020-01-01')
        norm=E.normalize_history([s,s],'OD',180);self.assertEqual(len(norm),1)
        self.assertNotIn('DO NOT RETAIN',json.dumps(norm));self.assertNotIn('timestamp',norm[0])
        for change in [dict(eye='OS'),dict(day=-1),dict(day=181),dict(day=.5),dict(verified=False),dict(quality='unknown'),dict(values={})]:
            with self.assertRaises(ValueError):E.normalize_history([dict(s,**change)],'OD',180)
        with self.assertRaises(ValueError):E.normalize_history([s]*41,'OD',180)

    def test_history_does_not_change_nkpi(self):
        c=case();r=result(c);c['history']=[scan(c,90,dict(c['first'],Kmax=54))];s=result(c)
        self.assertEqual(r['prediction'],s['prediction']);self.assertNotEqual(r['input_sha256'],s['input_sha256'])
        self.assertEqual(s['evidence']['input_sha256'],s['input_sha256'])

    def test_cohort_prior_not_observed_vote(self):
        c=case();p=signal(c);self.assertTrue(p['cohort_adjusted'])
        q=signal(dict(c,age=80));self.assertFalse(q['cohort_adjusted'])
        self.assertEqual(p['domains'],q['domains'])
        self.assertTrue(all(r['cohort_annual_rate'] is None for r in q['rows']))

    def test_legacy_exact_boundaries(self):
        c=case();c['latest']=dict(c['first'],A=7.094,B=5.715,C=470.4,Kmax=53,BAD_D=4.42,ARTmax=185.76)
        self.assertEqual(E.legacy_flags(c['first'],c['latest']),[False]*4)

    def test_artifact(self):
        data,sha=E.artifact();self.assertEqual(sha,configuration()['evidence']['sha256'])
        self.assertEqual(data['cohort'],dict(eyes=179,patients=101));self.assertTrue(data['fit']['converged'])
        self.assertTrue(np.linalg.eigvalsh(data['slope_covariance']).min()>0)

    def test_fit_recovers_synthetic_population(self):
        from research.fit_observed_evidence import fit
        rng=np.random.default_rng(71);n=1500;t=rng.uniform(.3,3,n);mu=np.arange(6)*.1
        covariance=.3*np.eye(6)+.08*np.ones((6,6));noise=np.tile(.04*np.eye(6),(n,1,1))
        slopes=rng.multivariate_normal(mu,covariance,n)
        d=t[:,None]*slopes+rng.normal(0,.2,(n,6))
        m,v,info=fit(d,t,noise,np.ones(n))
        self.assertTrue(info['converged']);np.testing.assert_allclose(m,mu,atol=.06)
        np.testing.assert_allclose(v,covariance,atol=.06)


if __name__=='__main__':unittest.main(verbosity=2)
