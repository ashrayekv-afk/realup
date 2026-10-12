 'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),S=require('../components/schema.js'),P=require('../components/progression_summary.js');
const make=(eye='OD')=>({...S.blank(eye),enabled:true,mode:'longitudinal',age:24,verified:true,interval_days:180,treatment:'untreated',scan_quality:{first:'ok',latest:'ok'},first:{A:7.2,B:5.8,C:480,Kmax:52,BAD_D:4,ARTmax:230},latest:{A:7,B:5.6,C:460,Kmax:54,BAD_D:5,ARTmax:180}});
const html=fs.readFileSync(path.join(root,'components/index.html'),'utf8');
assert(!/<details[^>]*id="progression-drawer"[^>]*\bopen\b/.test(html));
assert(html.indexOf('id="progression-drawer"')>html.indexOf('id="results-area"'));
assert.equal((html.match(/id="progression-drawer"/g)||[]).length,1);
assert(html.includes('Observed change &amp; evidence'));
assert.equal((html.match(/<iframe /g)||[]).length,1);
const ids={},events={},posted=[];
class Element{
 constructor(id){this.id=id;this.handlers={};this.innerHTML='';this.textContent='';this.hidden=false;this.open=false;this.disabled=false;this.style={};this.dataset={};this.contentWindow={postMessage(){}};}
 addEventListener(k,f){(this.handlers[k]??=[]).push(f);}
 fire(k,event={}){for(const f of this.handlers[k]||[])f({target:this,currentTarget:this,...event});}
 getBoundingClientRect(){return {height:ids['progression-drawer']?.open?1600:900};}
 scrollIntoView(){} focus(){} setAttribute(k,v){this[k]=v;}
}
for(const m of html.matchAll(/\bid="([^"]+)"/g))ids[m[1]]=new Element(m[1]);
const parent={postMessage:(data)=>posted.push(data)},win={parent,location:{origin:'https://local.example'},NKPI:S,NKPIProgression:P,NKPIBaseline:require('../components/baseline_outlook.js'),NKPIScoreBand:require('../components/score_band.js'),NKPIImpact:{render:()=>''},addEventListener:(k,f)=>events[k]=f};
const context={window:win,document:{getElementById:id=>{assert(ids[id],id);return ids[id];}},crypto:{randomUUID:()=> 'test-session'},structuredClone,ResizeObserver:class{observe(){}},requestAnimationFrame:f=>f(),setTimeout:()=>1,clearTimeout(){},console};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'components/app.js'),'utf8'),context);
const service=payload=>JSON.parse(execFileSync('python3',['-c',"import sys,json; from nkpi.service import calculate,configuration; p=json.load(sys.stdin); print(json.dumps({'config':configuration(),'result':calculate(p,include_pdf=False) if p else None}))"],{cwd:root,input:JSON.stringify(payload),encoding:'utf8'}));


const both=service({eyes:[make('OD'),make('OS')]});
for(const eye of ['OD','OS']){
 const audited=both.result.eyes[eye],active={...S.blank(eye),...audited.case,enabled:true};
 assert(S.verify(active,audited,both.config));
 const p=P.summarize(active,audited,false,both.config.evidence),view=P.render(p);
 assert.equal(p.status,'ready');assert.equal(p.structural_count,3);
 assert.equal((view.match(/class="ev-domain"/g)||[]).length,4);
 assert(view.includes('Supporting evidence'));assert(view.includes('179 eligible eye pairs'));
 assert(view.indexOf('Observed over 180 days')<view.indexOf('Observed pace'));
 assert(!view.includes('Projected domain crossings'));assert(!view.includes('0–4'));
 assert(!view.includes('notice warning'));assert(!view.includes('clinical progression probability'));
 for(const edit of [p=>p.eye='XX',p=>p.input_sha256='bad',p=>p.model_sha256='bad',p=>p.structural_count=0,p=>p.rows[0].annual_se=-1,p=>p.domains[0].z=99,p=>p.rows[0].first=8,p=>p.domains[0].signal=false]){
  const tampered=structuredClone(audited);edit(tampered.evidence);
  assert.throws(()=>S.verify(active,tampered,both.config));
  assert.equal(P.summarize(active,tampered,false,both.config.evidence).status,'unavailable');
 }
 assert.equal(P.summarize({...active,latest:{...active.latest,B:6}},audited,false,both.config.evidence).status,'unavailable');
 assert.equal(P.summarize(active,audited,true,both.config.evidence).status,'unavailable');
 const other=structuredClone(audited);other.prediction.nkpi=0;
 assert.equal(P.render(P.summarize(active,other,false,both.config.evidence)),view,'NKPI does not set evidence');
}
// History contract is identical in Python and JS, including duplicate order.
const c=make();c.history=[{eye:'OD',day:90,values:{...c.first,B:5.7},verified:true,quality:'ok',name:'discard'}];c.history.push(structuredClone(c.history[0]));
const hist=service({eyes:[c]});assert(S.verify(c,hist.result.eyes.OD,hist.config));
assert.equal(hist.result.eyes.OD.case.history.length,1);assert.equal(hist.result.eyes.OD.evidence.visits,3);
assert(!JSON.stringify(S.canonical(c)).includes('discard'));
const badHistory={...c,history:[{...c.history[0],eye:'OS'}]};assert.throws(()=>S.canonical(badHistory));
// Actual app events, stale responses, source changes, reset, unchanged score layout.
events.message({source:parent,data:{type:'streamlit:render',args:{config:both.config}}});
ids['load-example'].fire('click');
const request=posted.findLast(x=>x.value?.action==='assess').value,real=service(request.payload);
events.message({source:parent,data:{type:'streamlit:render',args:{config:real.config,response:{id:request.id,result:real.result}}}});
assert(ids['error'].hidden,ids['error'].textContent);
assert(ids['result-columns'].innerHTML.includes('result-model-notes'));
assert(!ids['result-columns'].innerHTML.includes('Clinical interpretation'));
assert.equal((ids['result-columns'].innerHTML.match(/data-score-band=/g)||[]).length,2);
assert(!ids['result-columns'].innerHTML.includes('notice warning'));
assert(ids['progression-columns'].innerHTML.includes('A second visit is needed'));
assert(ids['progression-columns'].innerHTML.includes('SYNTHETIC EXAMPLE'));
assert(ids['progression-columns'].innerHTML.includes('Observed pace'));
ids['progression-drawer'].open=true;ids['progression-drawer'].fire('toggle');
assert.equal(posted.findLast(x=>x.type==='streamlit:setFrameHeight').height,1610);
const checks={checked:true},wrap={dataset:{editor:'OS'},querySelector:()=>checks};
ids['eye-inputs'].fire('input',{target:{dataset:{field:'latest-B'},value:'5.20',type:'number',closest:()=>wrap}});
assert(!ids['progression-columns'].innerHTML.includes('Observed pace'));
events.message({source:parent,data:{type:'streamlit:render',args:{response:{id:request.id,result:real.result}}}});
assert(!ids['progression-columns'].innerHTML.includes('Observed pace'),'Stale response cannot restore evidence');
events.message({source:ids['extractor-frame'].contentWindow,origin:'https://local.example',data:{type:'nkpi:extractor:dirty'}});
assert(ids['progression-columns'].innerHTML.includes('Source changed'));
ids['confirm-reset'].fire('click');assert(!ids['progression-drawer'].open);
assert(!ids['result-columns'].innerHTML.includes('data-score-band='));
console.log('PASS observed evidence UI: bilateral service, numeric history, snapshot binding, stale/edit/reset, disclosures and unchanged NKPI layout.');
