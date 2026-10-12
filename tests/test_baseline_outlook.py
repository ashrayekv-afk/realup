"""Deterministic stress-test checks; these are not clinical validation."""
import copy
import itertools
import json
import math
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from nkpi.service import calculate,configuration
from nkpi.assessment import infer, model, FEATURES


def example(eye='OD'):
    return dict(eye=eye,mode='baseline',age=24,verified=True,treatment='untreated',
                scan_quality={'first':'ok'},first=dict(A=7.2,B=5.8,C=480,Kmax=52,BAD_D=4,ARTmax=230))


def result(c):
    return calculate({'eyes':[c]},include_pdf=False)['eyes'][c['eye']]


class BaselineTests(unittest.TestCase):
    def test_one_at_a_time_matches_independent_logit(self):
        r=result(example());p=r['baseline_outlook'];m=model('baseline')
        self.assertEqual(p['status'],'ready');self.assertEqual(p['current_nkpi'],r['prediction']['nkpi'])
        self.assertEqual(p['input_sha256'],r['input_sha256']);self.assertEqual(p['model_sha256'],r['model_sha256'])
        z=math.log(p['current_nkpi']/(100-p['current_nkpi']))
        for row in p['rows']:
            i=m['features'].index('baseline_'+row['key'])
            for side in ('low','high'):
                changed=z+(row['input_'+side]-row['value'])*m['coefficients'][i]/m['scale'][i]
                self.assertAlmostEqual(row['score_at_'+side],100/(1+math.exp(-changed)),places=11)
        self.assertEqual(p['top_contributors'],r['prediction']['effects'][:3])

    def test_envelope_equals_all_64_corners(self):
        for c in (example(),dict(example(),age=72)):
            p=result(c)['baseline_outlook'];scores=[]
            for sides in itertools.product(('input_low','input_high'),repeat=6):
                other=copy.deepcopy(c)
                for row,side in zip(p['rows'],sides):other['first'][row['key']]=row[side]
                scores.append(infer(other)['nkpi'])
            self.assertEqual(p['score_low'],min(scores));self.assertEqual(p['score_high'],max(scores))
            self.assertLessEqual(p['score_low'],p['current_nkpi']);self.assertGreaterEqual(p['score_high'],p['current_nkpi'])

    def test_bilateral_isolation(self):
        od,os=example(),example('OS');os['first']['ARTmax']=50
        both=calculate({'eyes':[od,os]},include_pdf=False)['eyes']
        self.assertEqual(both['OD'],result(od));self.assertEqual(both['OS'],result(os))
        self.assertNotEqual(both['OD']['baseline_outlook']['current_nkpi'],both['OS']['baseline_outlook']['current_nkpi'])

    def test_held_and_longitudinal_do_not_produce_baseline_numbers(self):
        cases=[]
        for field,value in [('verified',False),('treatment','treated'),('age',12)]:
            c=example();c[field]=value;cases.append(c)
        c=example();c['first']['A']=None;cases.append(c)
        c=example();c.update(mode='longitudinal',latest=copy.deepcopy(c['first']),interval_days=180);cases.append(c)
        for c in cases:
            p=result(c)['baseline_outlook'];self.assertEqual(p['status'],'unavailable')
            self.assertNotIn('current_nkpi',p);self.assertNotIn('rows',p);self.assertIsNone(p['forecast']['probability'])

    def test_unknown_context_not_mislabelled(self):
        c=example();c.update(treatment='unknown',scan_quality={'first':'unknown'})
        p=result(c)['baseline_outlook'];self.assertEqual(p['scan_quality'],'unknown');self.assertEqual(p['treatment'],'unknown')

    def test_clipping_respects_calculator_bounds(self):
        for extremum in ['low','high']:
            c=example();c['first']={f['key']:f[extremum] for f in FEATURES};p=result(c)['baseline_outlook']
            self.assertTrue(p['clipped'])
            for row in p['rows']:
                f=next(f for f in FEATURES if f['key']==row['key'])
                self.assertGreaterEqual(row['input_low'],f['low']);self.assertLessEqual(row['input_high'],f['high'])

    def test_kmax_reference_bands(self):
        for k,expected in [(48.199,.926),(48.2,1.33),(53.899,1.33),(53.9,1.62)]:
            c=example();c['first']['Kmax']=k
            row=next(v for v in result(c)['baseline_outlook']['rows'] if v['key']=='Kmax')
            self.assertEqual(row['reference_pair_limit'],expected)

    def test_snapshot_changes_when_inputs_change(self):
        c=example();a=result(c);c['first']['C']-=1;b=result(c)
        self.assertNotEqual(a['baseline_outlook']['input_sha256'],b['baseline_outlook']['input_sha256'])
        self.assertNotEqual(a['baseline_outlook']['current_nkpi'],b['baseline_outlook']['current_nkpi'])

    def test_forecast_uses_baseline_only_no_age_projection_or_unapproved_data(self):
        c=example();c.update(patient_name='PRIVATE_SENTINEL',outcome=1,interval_days=3650,latest={f['key']:0 for f in FEATURES})
        r=result(c);p=r['baseline_outlook']
        self.assertEqual(p['age_fixed'],24);self.assertEqual(p,result(example())['baseline_outlook'])
        self.assertEqual(p['forecast']['status'],'experimental_ready')
        self.assertEqual(p['forecast']['horizon_months'],12)
        self.assertGreater(p['forecast']['probability'],0)
        self.assertFalse(p['forecast']['clinical_release'])
        self.assertEqual(p['forecast']['feature_values']['log_interval_years'],0)
        self.assertNotIn('PRIVATE_SENTINEL',json.dumps(r));self.assertNotIn('probability',p)
        self.assertFalse(configuration()['baseline_outlook']['calibrated'])

    def test_zero_coefficient_never_changes_score(self):
        # Separately checks sorting at a zero effect rather than requiring any frozen coefficient to be zero.
        from unittest.mock import patch
        m=copy.deepcopy(model('baseline'));m['coefficients'][m['features'].index('baseline_C')]=0
        with patch('nkpi.assessment.model',return_value=m),patch('nkpi.baseline_outlook.model',return_value=m):
            from nkpi.assessment import assess_eye
            from nkpi.baseline_outlook import analyze
            from nkpi.service import fingerprint
            r=assess_eye(example());r['model_sha256']=r['model']['sha256']
            p=analyze(r,fingerprint(r['case']));row=next(v for v in p['rows'] if v['key']=='C')
            self.assertEqual(row['maximum_shift'],0)


class ForecastTests(unittest.TestCase):
    def test_known_trained_fixture_and_separate_score(self):
        c=example();c['first']=dict(A=7.2,B=5.8,C=500,Kmax=47.2,BAD_D=2.4,ARTmax=310)
        r=result(c);f=r['baseline_outlook']['forecast']
        self.assertAlmostEqual(f['probability'],0.28925746594930485,places=12)
        self.assertNotAlmostEqual(100*f['probability'],r['prediction']['nkpi'],places=1)
        self.assertEqual(f['input_sha256'],r['input_sha256']);self.assertEqual(f['eye'],'OD')
        self.assertFalse(f['population_risk_calibration'])

    def test_independent_linear_predictor_and_feature_responses(self):
        from nkpi.baseline_outlook import forecast_artifact
        a,_=forecast_artifact();c=example();f=result(c)['baseline_outlook']['forecast']
        x=[f['feature_values'][k] for k in a['features']]
        z=a['intercept']+sum((v-u)/s*b for v,u,s,b in zip(x,a['scaler_mean'],a['scaler_scale'],a['coef']))
        self.assertAlmostEqual(f['probability'],1/(1+math.exp(-z)),places=13)
        for i,key in enumerate(['age','A','B','C','BAD_D','ARTmax','Kmax']):
            other=copy.deepcopy(c)
            if key=='age':other[key]+=1
            else:other['first'][key]+=0.1
            g=result(other)['baseline_outlook']['forecast'];self.assertNotEqual(g['probability'],f['probability'])
            delta=(1 if key=='age' else 0.1)*a['coef'][i]/a['scaler_scale'][i]+(math.log(g['nkpi_input']/(100-g['nkpi_input']))-math.log(f['nkpi_input']/(100-f['nkpi_input'])))*a['coef'][7]/a['scaler_scale'][7]
            self.assertAlmostEqual(math.log(g['probability']/(1-g['probability']))-z,delta,places=11)

    def test_extrapolation_is_flagged_not_silently_clipped(self):
        c=example();c['age']=95
        f=result(c)['baseline_outlook']['forecast'];self.assertTrue(f['extrapolated']);self.assertIn('age_baseline',f['outside_training_ranges'])
        self.assertEqual(f['feature_values']['age_baseline'],95)
        self.assertTrue(0<f['probability']<1)

    def test_forecast_effects_are_own_model_not_nkpi(self):
        from nkpi.baseline_outlook import forecast_probability,forecast_artifact
        a,_=forecast_artifact();f=result(example())['baseline_outlook']['forecast']
        self.assertEqual(len(f['effects']),7)
        for e in f['effects']:
            c=example()
            if e['key']=='age':c['age']=e['reference']
            else:c['first'][e['key']]=e['reference']
            from nkpi.baseline_outlook import forecast_values
            q=forecast_probability(forecast_values(c))
            self.assertAlmostEqual(e['effect_pp'],100*(f['probability']-q),places=12)

    def test_forecast_checksum_rejects_corruption(self):
        import tempfile
        from unittest.mock import patch
        from nkpi import baseline_outlook as b
        original=b.FORECAST_PATH
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'bad.json';p.write_bytes(original.read_bytes()+b' ');p.with_suffix('.sha256').write_text(original.with_suffix('.sha256').read_text())
            b.forecast_artifact.cache_clear()
            try:
                with patch.object(b,'FORECAST_PATH',p):
                    with self.assertRaises(ValueError):b.forecast_artifact()
            finally:b.forecast_artifact.cache_clear()
        self.assertEqual(b.forecast_artifact()[0]['training_eyes'],232)


class QualityTrajectoryTests(unittest.TestCase):
    def test_quality_is_advisory_for_valid_verified_scores(self):
        for mode in ['baseline','longitudinal']:
            c=example();c['mode']=mode
            if mode=='longitudinal':c.update(latest=copy.deepcopy(c['first']),interval_days=180)
            acceptable=result(c);c['scan_quality']={'first':'warning','latest':'warning'};flagged=result(c)
            self.assertEqual(flagged['status'],'ready');self.assertEqual(flagged['prediction'],acceptable['prediction'])
            self.assertTrue(any('quality/alignment warning' in w for w in flagged['warnings']))
            self.assertEqual(flagged['case']['scan_quality']['first'],'warning')
            if mode=='baseline':
                self.assertEqual(flagged['baseline_outlook']['forecast']['probability'],acceptable['baseline_outlook']['forecast']['probability'])
                self.assertEqual(flagged['baseline_outlook']['forecast']['trajectory']['scan_quality'],'warning')
            else:self.assertEqual(flagged['evidence']['status'],'unavailable')
            for mutation in [('verified',False),('treatment','treated')]:
                other=copy.deepcopy(c);other[mutation[0]]=mutation[1];self.assertEqual(result(other)['status'],'held')
            c['first']['A']=None;self.assertEqual(result(c)['status'],'held')

    def test_trajectory_anchor_time_age_and_independent_arithmetic(self):
        r=result(example());t=r['baseline_outlook']['forecast']['trajectory'];m=model('baseline')
        self.assertEqual(t['current_nkpi'],r['prediction']['nkpi']);self.assertEqual(t['points'][0]['nkpi'],r['prediction']['nkpi'])
        self.assertEqual([p['month'] for p in t['points']],[0,3,6,9,12])
        for p in t['points']:
            h=p['month']/12
            c=example()
            for f in FEATURES:
                k=f['key'];c['first'][k]=max(f['low'],min(f['high'],c['first'][k]+t['rates'][k]*h))
            self.assertEqual(p['measurements'],c['first'])
            self.assertAlmostEqual(p['nkpi'],infer(c)['nkpi'],places=10)
            self.assertEqual(p['age_only_nkpi'],t['current_nkpi'])
            self.assertEqual(p['age'],24);self.assertTrue(0<=p['nkpi']<=100)
        self.assertEqual(t['change_at_12_months'],t['points'][-1]['nkpi']-t['current_nkpi'])
        self.assertFalse(t['clinical_release'])

    def test_trajectory_uses_nkpi_and_resets_with_values(self):
        c=example();a=result(c)['baseline_outlook']['forecast'];c['first']['Kmax']+=3;b=result(c)['baseline_outlook']['forecast']
        self.assertNotEqual(a['nkpi_input'],b['nkpi_input']);self.assertNotEqual(a['trajectory']['points'][-1]['nkpi'],b['trajectory']['points'][-1]['nkpi'])
        self.assertNotEqual(a['trajectory']['input_sha256'],b['trajectory']['input_sha256'])
        self.assertEqual(a['nkpi_input'],a['trajectory']['current_nkpi'])

    def test_screenshot_regression_both_scores_exist(self):
        cases=[]
        for eye,v,q in [('OD',[5.83,4.6,423,64.7,12.18,155],'warning'),('OS',[4.57,2.96,315,86,31.92,27],'unknown')]:
            cases.append(dict(eye=eye,mode='baseline',age=25,verified=True,treatment='unknown',scan_quality={'first':q},first=dict(zip(['A','B','C','Kmax','BAD_D','ARTmax'],v))))
        r=calculate({'eyes':cases},include_pdf=True)['eyes']
        self.assertAlmostEqual(r['OD']['prediction']['nkpi'],53.62895524495216,places=10)
        self.assertAlmostEqual(r['OS']['prediction']['nkpi'],76.7218487793588,places=10)
        for a in r.values():self.assertEqual(a['status'],'ready');self.assertTrue(a['pdf_base64'])
        self.assertTrue(r['OS']['baseline_outlook']['forecast']['extrapolated'])

class SelectedModelTests(unittest.TestCase):
    def test_selected_model_and_no_probability_floor(self):
        from nkpi.baseline_outlook import forecast_artifact,forecast_probability
        a,_=forecast_artifact();self.assertEqual(a['model_family'],'nkpi_logit_time')
        self.assertEqual(a['active_features'],['baseline_NKPI_logit','log_interval_years'])
        self.assertTrue(all(v==0 for v in a['coef'][:7]))
        probabilities=[]
        for score in [20,35,50,55,65,75,85]:
            x=list(a['scaler_mean']);x[7]=math.log(score/(100-score));x[8]=0
            probabilities.append(forecast_probability(x))
        self.assertEqual(probabilities,sorted(probabilities))
        self.assertLess(probabilities[2],.5);self.assertLess(probabilities[4],.65)
        self.assertAlmostEqual(probabilities[4],0.4171628325229018,places=7)

    def test_support_band_boundaries_are_counts_not_probabilities(self):
        from nkpi.baseline_outlook import forecast_artifact,support_band
        a,_=forecast_artifact()
        for score,eyes,events in [(49.999,218,53),(50,13,5),(64.999,13,5),(65,1,1),(100,1,1)]:
            b=support_band(score,a);self.assertEqual(b['eyes'],eyes);self.assertEqual(b['events'],events)
        f=result(example())['baseline_outlook']['forecast']
        self.assertEqual(f['support_band'],support_band(f['nkpi_input'],a))

    def test_time_is_fixed_to_one_year_and_age_is_not_double_counted(self):
        from nkpi.baseline_outlook import forecast_artifact,forecast_values,forecast_probability
        a,_=forecast_artifact();c=example();x=forecast_values(c);self.assertEqual(x[-1],0)
        altered=x.copy();altered[0]+=1
        self.assertEqual(forecast_probability(x),forecast_probability(altered))
        c['age']+=1;self.assertNotEqual(forecast_probability(x),forecast_probability(forecast_values(c)))

class ScoreOutlookTests(unittest.TestCase):
    def test_shapley_drivers_add_to_total_without_age_effect(self):
        for age in (19,25,50,75):
            c=example();c['age']=age;t=result(c)['baseline_outlook']['forecast']['trajectory'];end=t['points'][-1]
            self.assertEqual(end['age_only_nkpi'],t['current_nkpi'])
            self.assertEqual(t['age_logit_per_year'],0)
            self.assertAlmostEqual(sum(d['effect_points'] for d in t['drivers']),t['change_at_12_months'],places=11)
            self.assertEqual(t['top_drivers'],t['drivers'][:2])
            self.assertEqual([abs(d['effect_points']) for d in t['drivers']],sorted([abs(d['effect_points']) for d in t['drivers']],reverse=True))

    def test_clinical_constraints_and_small_low_score_activity(self):
        from nkpi.baseline_outlook import forecast_artifact,topographic_basis
        a,_=forecast_artifact();coef=a['trajectory']['activity'];first=example()['first']
        activity=lambda n,age,v:sum(x*b for x,b in zip(topographic_basis(n,age,v),coef))
        scores=[0,5,10,19.9,20,27,50,65,75,95]
        rates=[activity(n,25,first) for n in scores]
        self.assertEqual(rates,sorted(rates));self.assertLess(rates[0],1e-8)
        self.assertLess(rates[2],rates[6]/3)
        self.assertLess(activity(50,65,first),activity(50,25,first))
        self.assertLess(activity(50,25,first),activity(50,25,{**first,'Kmax':first['Kmax']+5}))
        # No discontinuity at a clinical score suggestion: these are smooth predictors.
        for boundary in (20,50,65):
            self.assertLess(abs(activity(boundary+.0001,25,first)-activity(boundary-.0001,25,first)),.0001)

    def test_joint_rates_and_score_match_projected_measurements(self):
        from nkpi.baseline_outlook import forecast_artifact
        a,_=forecast_artifact();t=result(example())['baseline_outlook']['forecast']['trajectory']
        self.assertEqual(set(t['rates']),set(a['trajectory']['keys']))
        for k,d in zip(a['trajectory']['keys'],a['trajectory']['directions']):self.assertGreaterEqual(t['rates'][k]*d,0)
        # The original classifier, not a forced upward adjustment, determines the endpoint.
        c=example();c['first']=t['points'][-1]['measurements']
        self.assertEqual(t['points'][-1]['nkpi'],infer(c)['nkpi'])

    def test_validation_reports_real_comparator_and_sparse_support(self):
        from nkpi.baseline_outlook import forecast_artifact
        a,_=forecast_artifact();t=a['trajectory']
        self.assertEqual(t['version'],'2.0.0-topography')
        self.assertTrue(all(v>=0 for v in t['activity']+t['pattern']))
        near=t['validation']['near_twelve_months']
        self.assertEqual(near['joint']['eyes'],45);self.assertEqual(near['joint']['patients'],25)
        self.assertAlmostEqual(near['joint']['rmse_nkpi'],3.919471093517275,places=8)
        self.assertAlmostEqual(near['unchanged']['rmse_nkpi'],3.9314911805358,places=8)
        self.assertEqual(t['support'][-1]['eyes'],1)

if __name__=='__main__':unittest.main()
