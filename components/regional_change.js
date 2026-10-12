/* Regional research view. Numerical maps remain in this browser, outside NKPI.
 * No image-to-number reconstruction, automatic registration, clinical threshold,
 * local storage, network reader, probability or progression classification.
 */
(function(root){'use strict';
const node=typeof module!=='undefined'&&module.exports;
const C=node?require('./cornea/surface_schema.js'):root.CornealData;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LAYERS=[
 {id:'anterior',name:'Anterior curvature',unit:'D',cutoff:1,decimals:2,direction:'Increase in curvature',get:d=>d.anterior?.curvature_D,delta:(a,b)=>b-a},
 {id:'posterior',name:'Posterior curvature',unit:'D',cutoff:.25,decimals:2,direction:'Increase in curvature magnitude',get:d=>d.posterior?.curvature_D,delta:(a,b)=>Math.abs(b)-Math.abs(a)},
 {id:'thickness',name:'Thickness',unit:'µm',cutoff:10,decimals:1,direction:'Thinning',get:d=>d.thickness_um,delta:(a,b)=>a-b}
];
const DEFAULTS={anterior:1,posterior:.25,thickness:10};
function fail(s){throw new Error(s);}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function validatePair(raw){
 if(!raw||raw.schema!=='nkpi-regional-pair-1'||Object.keys(raw).some(k=>!['schema','interval_days','first','latest'].includes(k)))fail('Use the documented numerical pair JSON. Report images and six summary values do not contain map grids.');
 if(!Number.isInteger(raw.interval_days)||raw.interval_days<1||raw.interval_days>36525)fail('Supply the actual positive interval in whole days.');
 const a=C.validate(raw.first),b=C.validate(raw.latest);
 if(a.eye!==b.eye||a.visit!=='first'||b.visit!=='latest')fail('The pair must contain first and latest maps for the same eye.');
 if(a.kind!==b.kind||a.source!==b.source)fail('Measured and simulated maps cannot be combined.');
 if(!same(a.coordinate_system,b.coordinate_system)||!same(a.x_mm,b.x_mm)||!same(a.y_mm,b.y_mm))fail('The maps must have identical physical axes and coordinate definitions. This module does not align or resample scans.');
 if(!a.comparison||!b.comparison||!same(a.comparison,b.comparison))fail('A common registration and map-definition key must be supplied by the numerical conversion workflow. Matching image sizes are insufficient.');
 const layers=[];
 for(const l of LAYERS){
  if(!l.get(a)||!l.get(b))continue;
  if(l.id!=='thickness'){
   const x=a[l.id],y=b[l.id];
   if(x.curvature_type!==y.curvature_type||!['axial','tangential','mean'].includes(x.curvature_type))fail(l.name+': use the same specified curvature definition at both visits.');
   const vals=[...l.get(a).flat(),...l.get(b).flat()].filter(finite);
   if(l.id==='anterior'&&vals.some(v=>v<=0))fail('Anterior curvature must use a positive keratometric convention.');
   if(l.id==='posterior'&&!(vals.every(v=>v>0)||vals.every(v=>v<0)))fail('Posterior curvature must have one consistent nonzero sign convention across both scans.');
  }
  layers.push(l.id);
 }
 if(!layers.length)fail('No matching curvature or thickness maps were supplied at both visits. Elevation alone is not analyzed in this version.');
 return {schema:raw.schema,interval_days:raw.interval_days,first:a,latest:b};
}
function analyze(raw,settings=DEFAULTS){
 const p=validatePair(raw),a=p.first,b=p.latest,x=a.x_mm,y=a.y_mm;
 p.layers=LAYERS.filter(l=>l.get(a)&&l.get(b)).map(l=>l.id);
 const limits={};for(const l of LAYERS){const t=settings[l.id];if(!finite(t)||t<=0||t>(l.id==='thickness'?200:20))fail('Display cutoffs must be finite and positive.');limits[l.id]=t;}
 const nx=x.length-1,ny=y.length-1,cells=[];
 let apertureArea=0;
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
  const corners=[[j,i],[j,i+1],[j+1,i],[j+1,i+1]];
  // Full cell must lie inside the central 6-mm aperture. Edge cells are omitted.
  if(corners.some(([r,c])=>Math.hypot(x[c],y[r])>3+1e-9))continue;
  const area=(x[i+1]-x[i])*(y[j+1]-y[j]),v={i,j,x:(x[i]+x[i+1])/2,y:(y[j]+y[j+1])/2,area,values:{}};
  apertureArea+=area;
  for(const id of p.layers){const l=LAYERS.find(l=>l.id===id),ga=l.get(a),gb=l.get(b),va=corners.map(([r,c])=>ga[r][c]),vb=corners.map(([r,c])=>gb[r][c]);
   if([...va,...vb].every(finite)){const av=va.reduce((s,v)=>s+v,0)/4,bv=vb.reduce((s,v)=>s+v,0)/4;v.values[id]={first:av,latest:bv,change:l.delta(av,bv)};}
  }
  cells.push(v);
 }
 if(!apertureArea)fail('There are no complete grid cells inside the central 6-mm aperture.');
 const regions=[];
 function components(above){
  const lookup=new Map(above.map(v=>[v.j*nx+v.i,v])),seen=new Set(),out=[];
  for(const c of above){const key=c.j*nx+c.i;if(seen.has(key))continue;let queue=[c],area=0,sx=0,sy=0;seen.add(key);
   while(queue.length){const v=queue.pop();area+=v.area;sx+=v.x*v.area;sy+=v.y*v.area;
    for(const [i,j]of [[v.i-1,v.j],[v.i+1,v.j],[v.i,v.j-1],[v.i,v.j+1]]){if(i<0||j<0||i>=nx||j>=ny)continue;const k=j*nx+i;if(lookup.has(k)&&!seen.has(k)){seen.add(k);queue.push(lookup.get(k));}}
   }out.push({area,x:sx/area,y:sy/area});
  }return out.sort((a,b)=>b.area-a.area);
 }
 for(const id of p.layers){const valid=cells.filter(c=>c.values[id]),above=valid.filter(c=>c.values[id].change>=limits[id]);const area=above.reduce((s,c)=>s+c.area,0),patches=components(above);
  regions.push({id,valid_area:valid.reduce((s,c)=>s+c.area,0),area:valid.length?area:null,patch_count:valid.length?patches.length:null,largest:patches[0]||null,mean_change:area?above.reduce((s,c)=>s+c.area*c.values[id].change,0)/area:null});
 }
 if(!regions.some(r=>r.valid_area>0))fail('No comparable complete numerical cells are available inside the analysis aperture.');
 const common=cells.filter(c=>p.layers.every(id=>c.values[id]));
 const shared=p.layers.length>=2?common.filter(c=>p.layers.filter(id=>c.values[id].change>=limits[id]).length>=2):[];
 return {pair:p,limits,cells,regions,aperture_area:apertureArea,common_area:common.reduce((s,c)=>s+c.area,0),shared_area:p.layers.length>=2&&common.length?shared.reduce((s,c)=>s+c.area,0):null,shared_patches:components(shared)};
}
function demo(eye='OS',pattern='together'){
 const coords=Array.from({length:61},(_,i)=>+(i*.1-3).toFixed(1));
 const frame={schema:'nkpi-corneal-maps-1',kind:'synthetic',source:'synthetic_fixture',eye,units:{xy:'mm',z:'mm',elevation:'um',thickness:'um',curvature:'D'},coordinate_system:{origin:'corneal_vertex',x_positive:'temporal',y_positive:'superior',z_positive:'anterior'},x_mm:coords,y_mm:coords,comparison:{alignment:'verified_common_grid',registration_id:'synthetic-grid',map_definition_id:'synthetic-tangential'}};
 const centers=pattern==='together'?[[.55,-.7],[.85,-.6],[.65,-1]]:[[-1.2,-.9],[1.3,-.9],[0,1.3]];
 const peaks=eye==='OS'?[1.8,.55,20]:[.45,.12,4];
 const gauss=(x,y,c,s)=>Math.exp(-((x-c[0])**2+(y-c[1])**2)/(2*s*s));
 const make=(visit,future)=>{const d=structuredClone(frame);d.visit=visit;
  for(const [index,l]of LAYERS.entries()){
   const grid=coords.map(y=>coords.map(x=>{if(Math.hypot(x,y)>3.01)return null;const base=l.id==='anterior'?46+6*gauss(x,y,[.6,-.8],1):l.id==='posterior'?-6.5-.8*gauss(x,y,[.6,-.8],1):520-45*gauss(x,y,[.6,-.8],1);const change=(future?1:0)*peaks[index]*gauss(x,y,centers[index],.55);return base+(l.id==='anterior'?change:-change);}));
   if(l.id==='thickness'){d.thickness_um=grid;d.thickness_definition='device_pachymetry';}else d[l.id]={curvature_D:grid,curvature_type:'tangential'};
  }return d;
 };
 return {schema:'nkpi-regional-pair-1',interval_days:180,first:make('first',false),latest:make('latest',true)};
}
function audit(a){return {schema:'nkpi-regional-audit-1',eye:a.pair.first.eye,kind:a.pair.first.kind,interval_days:a.pair.interval_days,method:'Four-corner means on supplied common grid; complete cells within central 6-mm aperture; planar cell areas; four-neighbor patches.',alignment:'Supplied by importer; not independently verified here.',interpretation:'Descriptive display-cutoff crossings only. No repeatability calibration or progression diagnosis.',cutoffs:a.limits,regions:a.regions,common_area_mm2:a.common_area,shared_area_mm2:a.shared_area};}
const api={LAYERS,DEFAULTS,validatePair,analyze,demo,audit};if(node){module.exports=api;return;}
root.NKPIRegionalMath=api;

// DOM controller: simulated and imported maps never overwrite calculator inputs.
const el=root.document.getElementById('regional-root');if(!el)return;
let context={cases:{},results:{},sourceDirty:false},reports=[],mode='patient',eye='OS',pattern='together',layer='combined',limits={...DEFAULTS},loaded=null,loadError='',active=null,selected=null,epoch=0;
const bindings={};
const inputKey=c=>root.NKPI.stable(root.NKPI.canonical(c));
const reportKey=e=>JSON.stringify(reports.filter(s=>s.eye===e).map(s=>[s.visit,s.source_id]).sort());
const pageSelections={};
const format=(v,d=2)=>finite(v)?v.toFixed(d):'—';
const signed=(v,d=2)=>finite(v)?(v<0?'−':v>0?'+':'')+Math.abs(v).toFixed(d):'—';
function pairFromReports(){
 const c=context.cases[eye],r=context.results[eye];
 if(context.sourceDirty||!c?.enabled||!r||r.case.mode!=='longitudinal')return null;
 const first=reports.find(s=>s.eye===eye&&s.visit==='first')?.surface,latest=reports.find(s=>s.eye===eye&&s.visit==='latest')?.surface;
 if(!first||!latest)return null;
 if(!bindings[eye]||bindings[eye].inputs!==inputKey(c)||bindings[eye].reports!==reportKey(eye))throw new Error('The numerical maps are not bound to this input snapshot. Reimport the selected report pair after editing measurements.');
 // Synthetic fixtures in a report archive never acquire patient status.
 if(first.kind!=='measured'||latest.kind!=='measured')throw new Error('Synthetic numerical fixtures are not patient maps. Use the demo tab.');
 return {schema:'nkpi-regional-pair-1',interval_days:r.case.interval_days,first,latest};
}
function controls(){return '<div class="rg-toolbar"><div class="rg-tabs" role="group" aria-label="Regional data source">'+[['patient','Current case'],['demo','Explore demo'],['numeric','Numerical pair']].map(([v,n])=>'<button type="button" data-rg-mode="'+v+'" aria-pressed="'+(mode===v)+'">'+n+'</button>').join('')+'</div><div class="rg-eyes" role="group" aria-label="Regional eye">'+['OD','OS'].map(v=>'<button type="button" data-rg-eye="'+v+'" aria-pressed="'+(eye===v)+'">'+v+' · '+(v==='OD'?'Right':'Left')+'</button>').join('')+'</div></div>';}
function coordinate(c,p){if(!c)return 'No region at these cutoffs';const cs=p.first.coordinate_system;const horizontal=Math.abs(c.x)<.05?'near center':Math.abs(c.x).toFixed(2)+' mm '+(c.x>0?cs.x_positive:cs.x_positive==='temporal'?'nasal':'temporal');const vertical=Math.abs(c.y)<.05?'near center':Math.abs(c.y).toFixed(2)+' mm '+(c.y>0?cs.y_positive:cs.y_positive==='superior'?'inferior':'superior');return horizontal+' / '+vertical;}
function tableForCase(){const r=context.results[eye];if(!r||context.sourceDirty||!context.cases[eye]?.enabled)return '';const c=r.case,paired=c.mode==='longitudinal';return '<details class="rg-details"><summary>Measured values for this eye</summary><div class="rg-table-wrap"><table><thead><tr><th>Measurement</th><th>First / only</th>'+(paired?'<th>Latest</th><th>Change</th>':'')+'</tr></thead><tbody>'+root.NKPI.features.map(f=>'<tr><th>'+esc(f.label)+'</th><td>'+format(c.first[f.key],f.decimals)+' '+esc(f.unit)+'</td>'+(paired?'<td>'+format(c.latest[f.key],f.decimals)+'</td><td>'+signed(c.latest[f.key]-c.first[f.key],f.decimals)+'</td>':'')+'</tr>').join('')+'</tbody></table></div><p>These summary measurements do not specify a spatial map.'+(paired?' Observed over '+c.interval_days+' days.':' One visit cannot establish change.')+'</p></details>';}
function sourceReports(){const sets=reports.filter(s=>s.eye===eye);if(!sets.length)return '';return '<div class="rg-report-grid">'+sets.map(s=>{const k=s.eye+':'+s.visit,p=s.pages.find(p=>p.id===pageSelections[k])||s.pages.find(p=>p.kind==='topometric')||s.pages[0];return '<article class="rg-report"><label>'+ (s.visit==='first'?'First / only scan':'Latest scan')+'<select data-rg-page="'+k+'" aria-label="'+eye+' '+s.visit+' source page">'+s.pages.map(q=>'<option value="'+esc(q.id)+'"'+(q.id===p.id?' selected':'')+'>'+esc(q.label)+'</option>').join('')+'</select></label><a href="'+esc(p.url)+'" target="_blank" rel="noopener noreferrer" title="Open original report"><img src="'+esc(p.url)+'" alt="'+eye+' '+s.visit+' original report" loading="lazy"></a><small>Original report image · select to enlarge</small></article>';}).join('')+'</div>';}
function emptyPatient(message){const c=context.cases[eye],r=context.results[eye],single=r?.case.mode==='baseline';return '<div class="rg-empty"><span class="rg-tag">'+eye+' · CURRENT CASE</span><h3>'+(single?'One scan shows shape; change needs two visits':'Review the location of change')+'</h3><p>'+esc(message||'The selected reports provide images and summary values. Numerical map grids are needed to calculate regional area and shared change.')+'</p><p class="rg-small">Original reports appear below when available. The spatial demonstration uses separate simulated scans.</p><button type="button" data-rg-mode="demo" class="rg-primary">Explore the working demo →</button></div>'+sourceReports()+tableForCase();}
function dataPanel(a){const p=a.pair,synthetic=p.first.kind==='synthetic';return '<div class="rg-banner"><span class="rg-tag">'+(synthetic?'SIMULATED MAPS':mode==='numeric'?'SEPARATE NUMERICAL PAIR':'IMPORTED NUMERICAL MAPS')+'</span><p>'+(synthetic?'Fictional '+eye+' scans · independent of the patient values above':mode==='numeric'?'This research import is not linked to the current NKPI case.':'Explicitly linked to the selected report pair. Alignment is declared by the data supplier.')+'</p></div>'+
 (mode==='patient'?'<p class="rg-small">Scan quality: '+esc(context.results[eye]?.case.scan_quality.first||'unknown')+' / '+esc(context.results[eye]?.case.scan_quality.latest||'unknown')+'. Numerical parsing does not verify scan quality.</p>':'')+
 '<div class="rg-title-row"><div><h3>'+eye+' · Regional corneal change</h3><p>Earlier → latest · '+p.interval_days+' days · central 6 mm</p></div><button type="button" data-rg-download="audit">Download map audit</button></div>'+
 (mode==='demo'?'<div class="rg-demo-controls"><span>Same peak changes, different locations</span><div class="rg-tabs"><button type="button" data-rg-pattern="together" aria-pressed="'+(pattern==='together')+'">Changes nearby</button><button type="button" data-rg-pattern="apart" aria-pressed="'+(pattern==='apart')+'">Changes apart</button></div></div>':'')+
 '<div class="rg-grid"><div class="rg-map-card"><label class="rg-select-label">Map view<select id="rg-layer">'+[['combined','Shared change'],...p.layers.map(id=>[id,LAYERS.find(l=>l.id===id).name])].map(([v,n])=>'<option value="'+v+'"'+(layer===v?' selected':'')+'>'+n+'</option>').join('')+'</select></label><canvas id="rg-map" width="600" height="600" role="img" aria-label="Corneal change map; exact regional measurements in the adjacent table. Click a region to inspect values."></canvas><div class="rg-legend">'+(layer==='combined'?'<span><i style="background:#d9cced"></i>1 layer</span><span><i style="background:#a38bc8"></i>2 layers</span><span><i style="background:#67428e"></i>3 layers</span>':'<span><i style="background:#cfddd8"></i>Opposite direction</span><span><i style="background:#ede9f2"></i>Below cutoff</span><span><i style="background:#67428e"></i>At/above cutoff</span>')+'</div><p class="rg-small">Gray: no qualifying change · hatched: incomplete data.<br>Display cutoffs describe this view; they are not clinical progression thresholds.</p><div id="rg-pick" class="rg-pick" aria-live="polite">Select a map cell to inspect its values.</div></div>'+
 '<div class="rg-results"><div class="rg-stat"><span>Shared area · 2+ available layers</span><strong data-rg-shared>'+format(a.shared_area)+' <small>mm²</small></strong><p>Area at or above the current cutoffs. Overlap does not establish progression; true changes can be offset.</p></div>'+a.regions.map(r=>{const l=LAYERS.find(l=>l.id===r.id);return '<article class="rg-region"><div><h4>'+l.name+'</h4><b>'+format(r.area)+' mm²</b></div><p>'+l.direction+' ≥ '+format(a.limits[r.id],l.decimals)+' '+l.unit+'</p><dl><div><dt>Mean change in highlighted area</dt><dd>'+format(r.mean_change,l.decimals)+' '+l.unit+'</dd></div><div><dt>Largest connected region</dt><dd>'+format(r.valid_area>0?(r.largest?.area||0):null)+' mm²</dd></div></dl><small>'+esc(coordinate(r.largest,p))+'</small></article>';}).join('')+'</div></div>'+
 '<details class="rg-details"><summary>Display cutoffs &amp; calculation</summary><p>Adjust the map display only. The defaults (1 D anterior, 0.25 D posterior, 10 µm thinning) are illustrative engineering settings, not literature-derived limits for progression.</p><div class="rg-cutoffs">'+LAYERS.map(l=>'<label>'+l.name+' ('+l.unit+')<input type="number" data-rg-cutoff="'+l.id+'" value="'+limits[l.id]+'" min="'+(l.id==='thickness'?1:.01)+'" max="'+(l.id==='thickness'?200:20)+'" step="'+(l.id==='thickness'?1:.01)+'"></label>').join('')+'</div><p>Curvature: '+p.layers.filter(id=>id!=='thickness').map(id=>id+' '+p.first[id].curvature_type).join('; ')+'. Posterior change uses |latest curvature| − |earlier curvature| with a consistent sign convention. This is not the B / PRC 3-mm radius.</p><p>Four corner values are averaged within each complete grid cell. Area is its planar x–y footprint. Only full cells inside the central 6-mm aperture are used. Shared area requires data in every available layer. Connected regions share an edge; tiny regions are not removed.</p><p>Common numerical coverage: '+format(a.common_area)+' mm²; full grid cells in aperture: '+format(a.aperture_area)+' mm². Missing data are never filled with zero. Near-border changes may be outside this analysis.</p><p>No local scan-noise limits, spatial significance test, biomechanical inference, registration algorithm or validated progression diagnosis is included. Repeat scans and independent outcome validation are needed before clinical interpretation.</p><p>Largest-region centers: '+a.regions.filter(r=>r.largest).map(r=>esc(LAYERS.find(l=>l.id===r.id).name)+': '+esc(coordinate(r.largest,p))).join('; ')+'. Centers from different map types need not coincide.</p></details>';
}
function numericalTools(){return '<div class="rg-import"><h3>Analyze a numerical map pair</h3><p>Load a de-identified pair in the documented NKPI numerical format. Standard Pentacam JPEG ZIPs are not numerical exports. This separate import does not change or authenticate the NKPI case.</p><div class="rg-actions"><label class="rg-file">Choose numerical pair<input id="rg-file" type="file" accept=".json,application/json"></label><button type="button" data-rg-download="example">Download synthetic example JSON</button>'+(loaded?'<button type="button" data-rg-clear-import>Clear pair</button>':'')+'</div><p class="rg-small">Processed locally in this browser. See docs/REGIONAL_CHANGE.md for the conversion contract. No identifiers or dates are required.</p><p id="rg-load-status" role="status">'+esc(loadError)+'</p></div>';}
function render(){
 const openDetails=new Set([...el.querySelectorAll('details[open]')].map(d=>d.querySelector('summary')?.textContent));
 active=null;let content='',pair=null;
 try{pair=mode==='demo'?demo(eye,pattern):mode==='numeric'?(loaded?.first.eye===eye?loaded:null):pairFromReports();if(pair)active=analyze(pair,limits);}catch(e){content='<p class="rg-inline-error" role="status">Numerical comparison unavailable: '+esc(e.message)+'</p>';}
 if(active){if(layer!=='combined'&&!active.pair.layers.includes(layer))layer='combined';content+=dataPanel(active);}
 else if(mode==='patient')content+=emptyPatient(context.sourceDirty?'The source selection changed. Confirm the selected studies and recalculate to link the current case.':undefined);
 else if(mode==='numeric')content+='<p class="rg-empty-small">'+(loaded?'The loaded pair belongs to '+loaded.first.eye+'. Select that eye above.':'No numerical pair loaded. The synthetic example demonstrates the exact supported format.')+'</p>';
 el.innerHTML=controls()+(mode==='numeric'?numericalTools():'')+content+(mode==='patient'&&active?sourceReports()+tableForCase():'')+'<details class="rg-details rg-evidence"><summary>Research behind this supplement</summary><p>Regional averages and spatial patterns are an active research area. The strongest case is for reproducible local measurements. The displayed overlap has not been validated as a progression score.</p><p><a href="https://pubmed.ncbi.nlm.nih.gov/34050086/" target="_blank" rel="noopener noreferrer">REDCAKE · regional versus single-point parameters</a> · <a href="https://pubmed.ncbi.nlm.nih.gov/35389929/" target="_blank" rel="noopener noreferrer">Long-term zonal analysis</a> · <a href="https://pubmed.ncbi.nlm.nih.gov/36203753/" target="_blank" rel="noopener noreferrer">Differences in cone localization</a> · <a href="https://pubmed.ncbi.nlm.nih.gov/29234085/" target="_blank" rel="noopener noreferrer">Tomography alignment and repeatability</a></p></details>';
 for(const d of el.querySelectorAll('details'))if(openDetails.has(d.querySelector('summary')?.textContent))d.open=true;
 if(active)draw();
}
function project(a,x,y){const cs=a.pair.first.coordinate_system;const mx=(cs.x_positive==='temporal'?1:-1)*(a.pair.first.eye==='OD'?-1:1),my=cs.y_positive==='superior'?-1:1;return [300+x*mx*78,300+y*my*78];}
function draw(){const canvas=el.querySelector('#rg-map');if(!canvas||!active)return;const ctx=canvas.getContext('2d'),a=active;ctx.clearRect(0,0,600,600);ctx.fillStyle='#f1eff4';ctx.beginPath();ctx.arc(300,300,234,0,2*Math.PI);ctx.fill();
 for(const c of a.cells){const points=[project(a,a.pair.first.x_mm[c.i],a.pair.first.y_mm[c.j]),project(a,a.pair.first.x_mm[c.i+1],a.pair.first.y_mm[c.j+1])],x=Math.min(points[0][0],points[1][0]),y=Math.min(points[0][1],points[1][1]),w=Math.abs(points[0][0]-points[1][0]),h=Math.abs(points[0][1]-points[1][1]);
  const valid=layer==='combined'?a.pair.layers.every(id=>c.values[id]):!!c.values[layer];let fill='#eeebf2';
  if(valid){if(layer==='combined'){const count=a.pair.layers.filter(id=>c.values[id].change>=a.limits[id]).length;fill=['#eeebf2','#d9cced','#a38bc8','#67428e'][count];}else{const d=c.values[layer].change;fill=d>=a.limits[layer]?'#67428e':d<0?'#cfddd8':'#eeebf2';}}
  ctx.fillStyle=fill;ctx.fillRect(x,y,w+.15,h+.15);if(!valid){ctx.strokeStyle='#cac5d0';ctx.beginPath();ctx.moveTo(x,y+h);ctx.lineTo(x+w,y);ctx.stroke();}
 }
 ctx.strokeStyle='#c9c1d4';ctx.lineWidth=1;ctx.setLineDash([4,5]);for(const r of [78,156,234]){ctx.beginPath();ctx.arc(300,300,r,0,2*Math.PI);ctx.stroke();}ctx.beginPath();ctx.moveTo(66,300);ctx.lineTo(534,300);ctx.moveTo(300,66);ctx.lineTo(300,534);ctx.stroke();ctx.setLineDash([]);
 ctx.fillStyle='#64566e';ctx.font='18px system-ui';ctx.textAlign='center';ctx.fillText('Superior',300,39);ctx.fillText('Inferior',300,578);ctx.font='16px system-ui';ctx.fillText(a.pair.first.eye==='OD'?'T':'N',35,306);ctx.fillText(a.pair.first.eye==='OD'?'N':'T',565,306);ctx.fillText('6 mm',490,547);
 if(selected){const p=project(a,selected.x,selected.y);ctx.strokeStyle='#302239';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p[0],p[1],8,0,2*Math.PI);ctx.stroke();showPick(selected);}
}
function showPick(c){const target=el.querySelector('#rg-pick');if(!target||!active)return;target.innerHTML='<b>Cell center · '+esc(coordinate(c,active.pair))+'</b><div class="rg-table-wrap"><table><thead><tr><th>Map</th><th>Earlier</th><th>Latest</th><th>Directional change</th></tr></thead><tbody>'+active.pair.layers.map(id=>{const l=LAYERS.find(l=>l.id===id),v=c.values[id];return '<tr><th>'+l.name+'</th><td>'+format(v?.first,l.decimals)+'</td><td>'+format(v?.latest,l.decimals)+'</td><td>'+signed(v?.change,l.decimals)+' '+l.unit+'</td></tr>';}).join('')+'</tbody></table></div>';}
function save(raw,name){const url=URL.createObjectURL(new Blob([JSON.stringify(raw,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
el.addEventListener('click',event=>{const b=event.target.closest('button');if(b){if(b.dataset.rgMode){mode=b.dataset.rgMode;selected=null;render();}else if(b.dataset.rgEye){eye=b.dataset.rgEye;selected=null;render();}else if(b.dataset.rgPattern){pattern=b.dataset.rgPattern;selected=null;render();}else if(b.hasAttribute('data-rg-clear-import')){epoch++;loaded=null;loadError='';render();}else if(b.dataset.rgDownload==='example')save(demo(eye,pattern),'NKPI_synthetic_regional_pair.json');else if(b.dataset.rgDownload==='audit'&&active)save(audit(active),'NKPI_'+eye+'_regional_research_audit.json');}
 if(event.target.id==='rg-map'&&active){const rect=event.target.getBoundingClientRect(),px=(event.clientX-rect.left)*600/rect.width,py=(event.clientY-rect.top)*600/rect.height;let found=null;for(const c of active.cells){const [x,y]=project(active,c.x,c.y),w=(active.pair.first.x_mm[c.i+1]-active.pair.first.x_mm[c.i])*78,h=(active.pair.first.y_mm[c.j+1]-active.pair.first.y_mm[c.j])*78;if(Math.abs(px-x)<=w/2&&Math.abs(py-y)<=h/2){found=c;break;}}selected=found;draw();if(!found)el.querySelector('#rg-pick').textContent='Outside complete grid cells in the 6-mm aperture.';}
});
el.addEventListener('change',async event=>{const t=event.target;if(t.id==='rg-layer'){layer=t.value;selected=null;render();}else if(t.dataset.rgPage){pageSelections[t.dataset.rgPage]=t.value;render();}else if(t.dataset.rgCutoff){const l=LAYERS.find(l=>l.id===t.dataset.rgCutoff),v=Number(t.value);if(!finite(v)||v<=0||v>(l.id==='thickness'?200:20)){t.setCustomValidity('Enter a positive value within the displayed range.');t.reportValidity();return;}t.setCustomValidity('');limits[l.id]=v;selected=null;render();}else if(t.id==='rg-file'){
  const token=++epoch,file=t.files?.[0];loaded=null;loadError='';selected=null;if(!file){render();return;}
  try{if(file.size>12*1024*1024)throw new Error('Use a numerical JSON file under 12 MB.');const text=await file.text();if(token!==epoch)return;const p=validatePair(JSON.parse(text));analyze(p,limits);if(token!==epoch)return;loaded=p;eye=p.first.eye;loadError='Numerical structure accepted. Alignment is supplied in the file; this app does not verify anatomical registration.';}catch(error){if(token!==epoch)return;loadError='Pair not loaded: '+error.message;}render();
 }});
function sanitizeReports(raw){if(!Array.isArray(raw)||raw.length>4)fail('Invalid report sets');const used=new Set();return raw.map(s=>{const key=s.eye+':'+s.visit;if(!['OD','OS'].includes(s.eye)||!['first','latest'].includes(s.visit)||used.has(key)||!Array.isArray(s.pages)||s.pages.length>48)fail('Invalid report association');used.add(key);const pages=s.pages.filter(p=>{try{return typeof p.url==='string'&&p.url.startsWith('blob:')&&new URL(p.url).origin===location.origin&&typeof p.id==='string'&&/^[a-z0-9-]{1,60}$/i.test(p.id);}catch(_){return false;}}).map(p=>({id:p.id,url:p.url,label:String(p.label||'Source report').slice(0,140),kind:p.kind}));return {eye:s.eye,visit:s.visit,pages,surface:s.surface||null,source_id:String(s.source_id||'').slice(0,100)};}).filter(s=>s.pages.length);}
root.NKPIRegional={setContext(c){context=c;selected=null;render();},bindImported(cases){for(const e of ['OD','OS'])if(cases[e])bindings[e]={inputs:inputKey(cases[e]),reports:reportKey(e)};},setReports(raw){try{reports=sanitizeReports(raw);}catch(_){reports=[];}selected=null;render();},clear(){epoch++;reports=[];loaded=null;loadError='';selected=null;mode='patient';limits={...DEFAULTS};for(const k of Object.keys(bindings))delete bindings[k];for(const k of Object.keys(pageSelections))delete pageSelections[k];render();},removeEye(e){delete bindings[e];reports=reports.filter(s=>s.eye!==e);if(loaded?.first.eye===e){epoch++;loaded=null;}selected=null;render();}};
render();
})(typeof window!=='undefined'?window:globalThis);
