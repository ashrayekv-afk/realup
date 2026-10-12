"""The revised coefficient and UI/explanation must agree exactly."""
import copy
import math
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nkpi.assessment import infer, model, registry
from nkpi.service import calculate

m = model('longitudinal')
i = m['features'].index('interval_years')
assert m['coefficients'][i] == -0.9175287013369997 * .5
assert m['calibration_applied'] is False
assert registry()['models']['longitudinal']['auc'] is None
assert m['metadata']['validation']['status'] == 'not_revalidated'
case = dict(eye='OD', mode='longitudinal', age=22, interval_days=80, verified=True,
            treatment='untreated', scan_quality={'first':'ok','latest':'ok'},
            first=dict(A=7.57,B=6.16,C=471,Kmax=45.3,BAD_D=2.31,ARTmax=273),
            latest=dict(A=7.60,B=6.19,C=474,Kmax=45.3,BAD_D=2.23,ARTmax=296))
def logit(score):
    return math.log(score / (100-score))
r = infer(case)
assert math.isclose(r['nkpi'], 29.327910775245666, abs_tol=1e-10)
for days in [1,80,429,1000,3652]:
    other = dict(case, interval_days=days)
    difference = logit(infer(other)['nkpi']) - logit(r['nkpi'])
    expected = (days-80)/365.2425/m['scale'][i]*m['coefficients'][i]
    assert math.isclose(difference,expected,abs_tol=1e-12)
payload = {'eyes':[case,dict(copy.deepcopy(case),eye='OS')]}
out = calculate(payload,include_pdf=False)
for eye in ['OD','OS']:
    result = out['eyes'][eye]
    assert result['status'] == 'ready'
    assert result['impact_audit']['rows']
    assert any('50%' in w for w in result['warnings'])
    assert all(row['match'] for row in result['audit'])
print('PASS model: half interval coefficient, exact score/logit changes, both-eye inference and independent impact audit; amended validation metadata.')
