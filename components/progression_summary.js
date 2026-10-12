/* Experimental observed evidence; never reads NKPI to classify observed change. */
(function(root){'use strict';
const S=typeof module!=='undefined'&&module.exports?require('./schema.js'):root.NKPI,E=S.esc;
const fmt=(v,n=2)=>Number.isFinite(v)?v.toFixed(n):'—';
const signed=(v,n=2)=>Number.isFinite(v)?(v>0?'+':v<0?'−':'')+Math.abs(v).toFixed(n):'—';
function summarize(current,result,dirty=false,config=null){
 const out={eye:current.eye,status:'unavailable',title:'Awaiting calculation',reason:'Import or enter verified visits, then calculate above.',demo:current.demo===true};
 if(!current.enabled)return {...out,title:'Eye not included',reason:'Enable this eye to include its measurements.'};
 if(dirty)return {...out,title:'Source changed',reason:'Reimport confirmed measurements before reviewing change.'};
 if(!result)return out;
 try{
  if(result.eye!==current.eye||S.stable(S.canonical(current))!==S.stable(result.case))throw new Error('Recalculate after changing measurements.');
  if(!config)throw new Error('Observed evidence is not connected. Recalculate this eye.');
  S.verifyEvidence(result,config);
  const p=result.evidence;
  return {...out,...p,demo:result.case.demo===true,title:p.status==='ready'?p.title:result.case.mode==='baseline'?'A second visit is needed':'Comparison needs review'};
 }catch(error){return {...out,title:'Recalculation needed',reason:error.message};}
}
function measureLabel(key){return S.features.find(f=>f.key===key);}
function component(p,key){const r=p.rows.find(x=>x.key===key),f=measureLabel(key);return '<div class="ev-measure"><span>'+E(f.label)+'</span><strong>'+signed(r.change,f.decimals)+' '+E(f.unit)+'</strong><small>'+fmt(r.first,f.decimals)+' → '+fmt(r.latest,f.decimals)+'</small></div>';}
function render(p){
 const eye=p.eye==='OD'?'OD · Right eye':'OS · Left eye';
 const heading='<div class="progression-eye-heading"><h3>'+eye+'</h3>'+(p.demo?'<span class="badge">SYNTHETIC EXAMPLE</span>':'')+'</div>';
 if(p.status!=='ready')return '<article class="progression-eye" data-progression-eye="'+E(p.eye)+'"><div class="progression-overview">'+heading+'<h3>'+E(p.title)+'</h3><p>'+E(p.reason)+'</p></div></article>';
 const conflict=p.domains.some(d=>d.mixed),k=p.rows.find(r=>r.key==='Kmax'),c=p.rows.find(r=>r.key==='C');
 const domainRows=p.domains.map(d=>{
  const label=d.signal?'Above reference':d.mixed?'Mixed directions':'Within reference';
  const pos=50+Math.max(-3,Math.min(3,d.z))*50/3;
  return '<details class="ev-domain" data-domain="'+E(d.key)+'"><summary><span>'+E(d.name)+'</span><span class="ev-state '+(d.signal?'active':'')+'">'+label+'</span></summary><div class="ev-domain-body">'+d.components.map(key=>component(p,key)).join('')+'<div class="ev-signal" role="img" aria-label="Signed standardized trend '+fmt(d.z)+'; positive indicates worsening"><span style="left:'+pos+'%"></span></div><div class="ev-signal-labels"><span>Opposite direction</span><span>Worsening direction</span></div><p class="micro">Signed evidence '+fmt(d.z)+' · multiple comparisons accounted for.'+(d.mixed?' Measurements in this group move in opposite directions.':'')+'</p></div></details>';
 }).join('');
 const composite='<details class="ev-domain" data-domain="composite"><summary><span>Composite deviation<small>Supporting evidence</small></span><span class="ev-state">'+(p.composite.support?'Supports worsening':p.composite.direction==='opposite'?'Opposite direction':'Below reference')+'</span></summary><div class="ev-domain-body">'+component(p,'BAD_D')+'<p class="micro">BAD-D overlaps the structural measurements. It does not add a fourth independent vote.</p></div></details>';
 const bodyRows=p.rows.map(r=>{const f=measureLabel(r.key);return '<tr><th>'+E(f.label)+'<small>'+E(f.unit)+'</small></th><td>'+signed(r.change,f.decimals)+'</td><td>'+signed(r.annual_rate,f.decimals)+'</td><td>'+signed(r.cohort_annual_rate,f.decimals)+'</td><td>'+fmt(r.reference_pair_limit,f.decimals+1)+'</td></tr>';}).join('');
 const counts=p.structural_count+' structural '+(p.structural_count===1?'group':'groups')+' above the reference evidence rule';
 return '<article class="progression-eye" data-progression-eye="'+E(p.eye)+'"><div class="progression-overview">'+heading+
 '<div class="progression-observed-label">Observed over '+p.interval_days+' days</div><div class="ev-evidence-title">'+E(p.title)+'</div><div class="ev-count"><b>'+p.structural_count+'</b><span>of 3 structural groups<br>show a reference signal</span></div><p class="ev-qualifier">Experimental evidence rule · not a progression diagnosis</p><div class="ev-history">'+p.visits+' visit dates · '+p.scans+' distinct scans analysed</div></div><div class="progression-detail">'+domainRows+composite+
 '<div class="ev-pace"><div class="progression-observed-label">Observed pace</div><div><span>Kmax</span><strong>'+signed(k.annual_rate,2)+' D/year</strong></div><div><span>Thinnest thickness</span><strong>'+signed(c.annual_rate,1)+' µm/year</strong></div><p>Rate over the measured interval; no future scan is predicted.</p></div>'+
 '<details class="progression-values"><summary>Measurements &amp; calculation</summary><p>'+E(counts)+'. '+(p.structural_count===0?'This does not establish stability.':'Reference signals require clinical review.')+'</p>'+
 '<div class="table-wrap"><table class="ev-audit"><thead><tr><th>Measure</th><th>Measured Δ</th><th>Annual rate</th><th>Adjusted rate</th><th>Pair reference</th></tr></thead><tbody>'+bodyRows+'</tbody></table></div>'+
 '<p>Measured Δ uses the selected first and latest scans. Annual rate uses all included visit dates. Adjusted rate is a separate joint cohort estimate from '+p.cohort.eyes+' eligible eye pairs / '+p.cohort.patients+' patients; it never changes the observed signal count.</p>'+
 '<p>ARC and Kmax contribute to anterior curvature; thickness and ARTmax contribute to pachymetry. Their signed standardized trends are averaged using a conservative bound for unknown within-group correlation. Holm adjustment covers the three structural comparisons. The Gaussian error approximation and transferred reference values have not been clinically calibrated.</p>'+
 '<p>Kmax precision varies by severity. Other measurements use pooled published references; no unsupported severity formula is applied. Same-day scans are grouped and duplicates suppressed. Repeats receive no automatic square-root precision bonus. Irregular multi-visit trends increase uncertainty.</p>'+
 '<p>Earlier fixed research rules: '+p.historical_rule_count+'/4 crossed between the two selected scans. This legacy count is different from the new reference-evidence assessment.</p>'+
 '<p>Age and NKPI do not add evidence of observed worsening. Two visits cannot validate a future progression probability. Cohort adjustment is omitted outside its fitted range.</p>'+
 '<p>Sources: <a href="https://doi.org/10.1038/s41598-020-76020-6" target="_blank" rel="noopener noreferrer">Neuhann et al., 2020</a>; <a href="https://doi.org/10.1371/journal.pone.0228992" target="_blank" rel="noopener noreferrer">Gustafsson et al., 2020</a>.</p></details>'+
 '<details class="progression-values"><summary>Reference limits &amp; reliability</summary><ul>'+p.notes.map(n=>'<li>'+E(n)+'</li>').join('')+'</ul><p>Acceptable acquisition, correct extraction and biological progression are separate questions. These calculations cannot establish that an unconfirmed scan is reliable.</p></details>'+
 (conflict?'<p class="ev-inline-note">Some measurements move in opposite directions.</p>':'')+'</div></article>';
}
const api={summarize,render};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.NKPIProgression=api;
})(typeof window!=='undefined'?window:globalThis);
