'use strict';
// Browser-independent DOM harness. Runs production field editing, selectors,
// bilateral review, verification and numeric submission functions.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.handlers={};this.className='';this.attrs={};this.disabled=false;this.checked=false;this.selected=false;this.hidden=false;this._value=undefined;this._text='';}
 append(...nodes){for(let n of nodes){if(typeof n==='string'){const e=new Element('span');e.textContent=n;n=e;}n.remove();n.parentNode=this;this.children.push(n);}}
 appendChild(n){this.append(n);return n;}
 prepend(...nodes){for(const n of nodes.reverse()){n.remove();n.parentNode=this;this.children.unshift(n);}}
 replaceChildren(...nodes){for(const c of this.children)c.parentNode=null;this.children=[];this._text='';this.append(...nodes);}
 remove(){if(this.parentNode){const p=this.parentNode;p.children=p.children.filter(n=>n!==this);this.parentNode=null;}}
 before(n){const p=this.parentNode,i=p.children.indexOf(this);n.parentNode=p;p.children.splice(i,0,n);}
 after(n){const p=this.parentNode,i=p.children.indexOf(this);n.parentNode=p;p.children.splice(i+1,0,n);}
 get value(){if(this._value!==undefined)return this._value;if(this.tagName==='SELECT')return this.children.find(n=>n.selected)?.value??(this.multiple?'':this.children[0]?.value)??'';return '';}
 set value(v){this._value=String(v);}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join(' ');}
 set textContent(v){this.replaceChildren();this._text=String(v);}
 set innerHTML(s){assert.equal(s,'','Harness only permits clearing HTML');this.replaceChildren();}
 get classList(){const e=this;return {contains:k=>e.className.split(/\s+/).includes(k),add(...k){e.className=[...new Set([...e.className.split(/\s+/),...k])].join(' ').trim();},remove(...k){e.className=e.className.split(/\s+/).filter(x=>!k.includes(x)).join(' ');},toggle(k,on){if(on===undefined)on=!this.contains(k);on?this.add(k):this.remove(k);}};}
 setAttribute(k,v){this.attrs[k]=String(v);if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v);}
 getAttribute(k){return this.attrs[k];}
 addEventListener(k,f){(this.handlers[k]||=[]).push(f);}
 dispatchEvent(e){e.target||=this;for(const f of this.handlers[e.type]||[])f(e);this['on'+e.type]?.(e);return true;}
 click(){if(!this.disabled)this.dispatchEvent({type:'click',target:this});}
 matches(s){
  s=s.trim();if(s.startsWith(':scope > '))s=s.slice(9);
  const id=s.match(/#([\w-]+)/)?.[1];if(id&&this.id!==id)return false;
  for(const [,cls] of s.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(cls))return false;
  const tag=s.match(/^[a-zA-Z][\w-]*/)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;
  for(const m of s.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)){
   const k=m[1],v=k.startsWith('data-')?this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:(this[k]??this.attrs[k]);
   if(v===undefined||(m[2]!==undefined&&String(v)!==m[2]))return false;
  }return true;
 }
 closest(s){for(let n=this;n;n=n.parentNode)if(n.matches(s))return n;return null;}
 querySelectorAll(s){
  if(s.includes(','))return [...new Set(s.split(',').flatMap(p=>this.querySelectorAll(p)))];
  const parts=s.trim().split(/\s+(?![^\[]*\])/);const last=parts.pop();
  const out=[];const visit=n=>{for(const c of n.children){if(c.matches(last)){
   let p=c.parentNode,ok=true;for(let i=parts.length-1;i>=0;i--){if(parts[i]==='>'||parts[i]===':scope')continue;while(p&&!p.matches(parts[i]))p=p.parentNode;if(!p){ok=false;break;}p=p.parentNode;}if(ok)out.push(c);
  }visit(c);}};visit(this);return out;
 }
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
 scrollIntoView(){}
 get options(){return this.children;}
 get selectedOptions(){return this.children.filter(o=>o.selected||o.value===this.value);}
}
const body=new Element('body'),doc={body,addEventListener(){},createElement:tag=>new Element(tag),getElementById:id=>body.querySelector('#'+id),querySelector:s=>body.querySelector(s),querySelectorAll:s=>body.querySelectorAll(s)};
const add=(tag,id,parent=body)=>{const e=new Element(tag);if(id)e.id=id;parent.append(e);return e;};
for(const id of ['reviewContent','detectedSummary','reviewSection','detectedSection','exportSection','verificationSummary','jsonOutput','sendStatus','payloadSummary','errorBox','progressArea'])add('div',id);
const confirm=add('input','confirmValues',add('label'));confirm.type='checkbox';add('input','age').value='34';add('button','processButton',add('section'));
let messages=[];
const ctx={console,Date,Blob,URL,setTimeout:()=>0,clearTimeout(){},document:doc,addEventListener(){},location:{origin:'http://localhost'},NKPIImport:require('../components/extractor/numeric_import.js'),Event:class{constructor(t){this.type=t;}},StreamlitBridge:{setComponentValue:m=>messages.push(m)}};ctx.window=ctx;vm.createContext(ctx);
const root=path.resolve(__dirname,'../components/extractor');
for(const f of ['app.js','extraction_integrity.js','review_fixes.js','report_discovery.js','archive_integration.js','bilateral_review.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});
ctx.syncFrameHeight=()=>{};ctx.scheduleFrameHeightSync=()=>{};ctx.publishSourceReportMaps=()=>{};
ctx.auditTable=()=>new Element('details');ctx.sourcePreview=()=>new Element('details');ctx.renderDetectedTable=()=>new Element('table');
const state=vm.runInContext('state',ctx),el=id=>doc.getElementById(id),values={A:7.1,B:5.8,C:490,Kmax:48,BAD_D:3.2,ARTmax:240};
function study(eye,day,offset=0){return {eye,timestamp:new Date(2026,0,day),values:{...values,C:490+offset},audit:Object.fromEntries(Object.keys(values).map(k=>[k,{autoConfirmed:true,quality:'High'}])),manualEdits:{}};}
function load(earlier,later){state.mode='longitudinal';state.earlierStudies=earlier;state.laterStudies=later;ctx.renderDetected();ctx.renderReview();}
// Reproduce the screenshot: earlier OS only, later OD+OS. The old UI hid OD.
load([study('OS',1)],[study('OD',20,-5),study('OS',20,-10)]);
assert(el('later_OD_A'));assert.equal(el('later_OD_C').value,'485');assert.equal(doc.querySelectorAll('#reviewContent .value-field').length,18);assert(el('verificationSummary').textContent.includes('OD: earlier visit source is missing'));assert(confirm.disabled);assert.throws(()=>ctx.buildPayload(),/OD.*missing/);
// Single-eye calculation requires explicit choice and does not erase OD values.
el('calculationEyes').value='OS';el('calculationEyes').dispatchEvent({type:'change'});assert(!confirm.disabled);let p=ctx.buildPayload();assert.equal(Object.keys(p.baseline).join(','),'OS');assert(el('later_OD_C'));assert.equal(p.interval_days_by_eye.OS,19);
el('calculationEyes').value='both';el('calculationEyes').dispatchEvent({type:'change'});assert(confirm.disabled);
const firstOD=study('OD',1),firstOS=study('OS',1),lastOD=study('OD',20,-5),lastOS=study('OS',20,-10);
load([firstOD,firstOS],[lastOD,lastOS]);assert.equal(doc.querySelectorAll('#reviewContent .value-field').length,24);assert(!confirm.disabled);
p=ctx.buildPayload();assert.equal(Object.keys(p.baseline).sort().join(','),'OD,OS');assert.equal(p.followup.OD.C,485);assert.equal(p.followup.OS.C,480);assert.equal(p.interval_days_by_eye.OD,19);
// Editing clears ready state; verification survives a rerender and eye selection.
el('earlier_OD_A').value='7.20';el('earlier_OD_A').dispatchEvent({type:'input'});assert(confirm.disabled);const wrapper=el('earlier_OD_A').closest('.value-field'),check=wrapper.querySelector('.field-verification-checkbox');check.checked=true;check.dispatchEvent({type:'change'});assert(!confirm.disabled);ctx.renderReview();assert.equal(el('earlier_OD_A').value,'7.20');assert(!confirm.disabled);
el('intervalDays_OD').value='25';el('intervalDays_OD').dispatchEvent({type:'input'});ctx.renderReview();assert.equal(el('intervalDays_OD').value,'25');assert.equal(ctx.buildPayload().interval_days_by_eye.OD,25);
confirm.checked=true;ctx.sendPayloadToCalculator();const submit=messages.findLast(m=>m.action==='submit');assert(submit);assert.equal(Object.keys(submit.payload.baseline).sort().join(','),'OD,OS');assert(!JSON.stringify(submit).includes('timestamp'));assert(!JSON.stringify(submit).includes('manualEdits'));
// Every source input and source selection invalidates prior submission state.
el('later_OS_C').value='479';el('later_OS_C').dispatchEvent({type:'input'});assert.equal(state.payload,null);assert(!confirm.checked);
// Unresolved studies retain six review inputs and block laterality guessing.
const unknown=study(null,1);load([firstOD,firstOS,unknown],[lastOD,lastOS]);assert(el('earlier_unassigned2_A'));assert.equal(doc.querySelectorAll('#reviewContent .value-field').length,30);assert(confirm.disabled);
// Equal-day scans and missing intervals cannot calculate longitudinal results.
load([study('OD',1),study('OS',1)],[study('OD',1),study('OS',1)]);assert(confirm.disabled);assert.throws(()=>ctx.buildPayload(),/chronological/);
// Baseline mode also shows both eye input grids and sends both eyes.
state.mode='baseline';state.baselineStudies=[study('OD',1),study('OS',1,-20)];ctx.renderDetected();ctx.renderReview();assert.equal(doc.querySelectorAll('#reviewContent .value-field').length,12);assert(!confirm.disabled);assert.equal(Object.keys(ctx.buildPayload().eyes).sort().join(','),'OD,OS');
// Reproduce the reported false cross-check and verify the live submission gate.
const conflict=study('OD',1);conflict.values.ARTmax=236;
conflict.audit.ARTmax={...ctx.integrityDecision('ARTmax',236,[{family:'Belin ARTmax',value:236},{family:'Progression display',value:296}],296),final:236};
state.mode='baseline';state.baselineStudies=[conflict,study('OS',1)];ctx.renderReview();
const artInput=el('baseline_OD_ARTmax'),artWrap=artInput.closest('.value-field');
assert.equal(artWrap.querySelector('.quality-badge').textContent,'Review source');assert(confirm.disabled);
assert(artWrap.querySelector('details').open);assert.throws(()=>ctx.buildPayload(),/Verify/);
artInput.value='296';artInput.dispatchEvent({type:'input'});
assert(confirm.disabled);const verified=artWrap.querySelector('.field-verification-checkbox');verified.checked=true;verified.dispatchEvent({type:'change'});
assert(!confirm.disabled);assert.equal(ctx.buildPayload().eyes.OD.ARTmax,296);
assert.equal(artWrap.querySelector('.quality-badge').textContent,'Source verified');
// 7.5 automatic fields have no required per-value checkbox. A newly edited
// related value reruns identity checks and invalidates prior acknowledgments.
const autoStudy=study('OD',1);autoStudy.audit.B.statusLabel='Auto-read';
autoStudy.audit.ARTmax.sources={selectedPPImax:2.04,ppiVerifiedRead:{passed:true}};
autoStudy.audit.ARTmax.mathCheck=ctx.roundedArtmaxCheck(490,2.04,240);
state.baselineStudies=[autoStudy,study('OS',1)];ctx.renderReview();
assert(!confirm.disabled);assert(el('reviewNextException').disabled);
assert.equal(el('baseline_OD_B').closest('.value-field').querySelector('.quality-badge').textContent,'Auto-read');
assert(el('baseline_OD_B').closest('.value-field').querySelector('.field-verification-label').hidden);
const cEdit=el('baseline_OD_C');cEdit.value='550';cEdit.dispatchEvent({type:'input'});
assert(confirm.disabled);assert(!el('reviewNextException').disabled);
const cWrap=cEdit.closest('.value-field'),artAutoWrap=el('baseline_OD_ARTmax').closest('.value-field');
assert(artAutoWrap.dataset.consistencyIssue.includes('C 550'));assert(!artAutoWrap.querySelector('.live-consistency-check').hidden);
for(const w of [cWrap,artAutoWrap]){const cb=w.querySelector('.field-verification-checkbox');cb.checked=true;cb.dispatchEvent({type:'change'});}
assert(!confirm.disabled);cEdit.value='551';cEdit.dispatchEvent({type:'input'});assert(confirm.disabled);
assert.equal(artAutoWrap.querySelector('.field-verification-checkbox').checked,false);
// Numeric-only quality propagation, never patient identifiers or OCR text.
autoStudy.scanQuality='warning';state.baselineStudies=[autoStudy,study('OS',1)];
autoStudy.manualEdits={};ctx.renderReview();const qp=ctx.buildPayload();assert.equal(qp.display_by_eye.OD.first_quality,'warning');assert.equal(qp.display_by_eye.OS.first_quality,'unknown');
assert(!JSON.stringify(qp).includes('verifiedRead'));
console.log('PASS 7.5 review: compact automatic fields, next-exception action, live cross-field math, acknowledgment invalidation and quality flags.');
// Resolved panels collapse; edits reopen them. Candidate selection is one
// explicit source-review action and retains decimals lost by old de-duplication.
const compactStudy=study('OD',1);compactStudy.values.BAD_D=7.71;
compactStudy.fieldPreviews={BAD_D:'data:image/png;base64,AA=='};
compactStudy.audit.BAD_D={autoConfirmed:false,final:7.71,evidence:[{family:'Belin final D',value:7.7},{family:'Belin final D',value:7}],sources:{}};
state.baselineStudies=[compactStudy,study('OS',1)];ctx.renderReview();
const bad=el('baseline_OD_BAD_D'),bw=bad.closest('.value-field'),buttons=bw.querySelectorAll('.candidate-button');
assert.deepEqual(buttons.map(b=>b.textContent),['7.71','7.70','7.00']);
assert(bw.querySelector('details').open);assert(confirm.disabled);
const children=bw.querySelector('details').children;
assert(children.indexOf(bw.querySelector('.candidate-buttons'))<children.indexOf(bw.querySelector('img')));
buttons[0].click();assert(!confirm.disabled);assert.equal(bw.querySelector('.quality-badge').textContent,'Source verified');
assert(!bw.querySelector('details').open);assert(bw.querySelector('.candidate-buttons').hidden);
ctx.renderReview();assert(!el('baseline_OD_BAD_D').closest('.value-field').querySelector('details').open);
const edited=el('baseline_OD_BAD_D');edited.value='7.72';edited.dispatchEvent({type:'input'});
assert(confirm.disabled);assert(edited.closest('.value-field').querySelector('details').open);
console.log('PASS compact source review: candidate precision, source above confirmation, one-click selection, collapse and edit invalidation.');
console.log('PASS wrong ARTmax 236/296: visible conflict, calculation blocked, corrected/verified 296 submitted.');
console.log('PASS production bilateral review: all available inputs visible, both-eye gate, explicit one-eye choice, 24-value payload, verification/edit retention, interval persistence, unresolved-eye and same-day blocks, baseline mode.');
(async()=>{
 state.processEpoch=8;
 ctx.registerPreviewUrl=()=> 'blob:test';
 const files=['od-top.png','od-belin.png','os-top.png','os-belin.png'];
 const loaded={imageFiles:files,metadata:Object.fromEntries(files.map(f=>[f,{format:'PNG'}])),zip:{file:()=>({async:async()=>new Blob(['synthetic'])})}};
 const seeds=['OD','OS'].map((eye,i)=>({forcedEye:eye,timestamp:new Date(2026,0,1,14,i,17),pages:{topometric:files[i*2],belin:files[i*2+1],progression:null},viewerPages:[files[i*2],files[i*2+1]]}));
 const result=ctx.chooseReportPages(loaded,'Visit A',8,seeds);
 await new Promise(setImmediate);
 assert.equal(doc.querySelectorAll('.repair-study').length,2);
 const dates=doc.querySelectorAll('input[type="datetime-local"]');assert(dates.every(d=>d.value.endsWith(':17')));
 const box=el('sourcePageRepair');const sourceConfirm=box.querySelectorAll('.repair-confirm').find(e=>e.textContent.includes('I matched'));sourceConfirm.querySelector('input').checked=true;
 box.querySelectorAll('button').find(e=>e.textContent.startsWith('Use these pages')).click();
 const repairError=box.querySelector('.alert.error');assert(repairError.hidden,repairError.textContent);
 const chosen=await result;assert.equal(chosen.length,2);assert.equal(chosen[0].forcedEye,'OD');assert.equal(chosen[1].forcedEye,'OS');assert.equal(chosen[0].timestamp.getSeconds(),17);
 const oldInputs=el('baseline_OD_A').value,oldSource=state.baselineStudies;
 state.baselineStudies.importContext={loaded,label:'Selected visit',descriptors:seeds};
 for(let i=0;i<2;i++)state.baselineStudies[i].importDescriptor=seeds[i];
 const recovery=ctx.repairVisitSources('baseline');await new Promise(setImmediate);
 el('sourcePageRepair').querySelectorAll('button').find(e=>e.textContent==='Cancel import').click();await recovery;
 assert.equal(state.baselineStudies,oldSource);assert.equal(el('baseline_OD_A').value,oldInputs);assert(!state.processing);assert(!el('processButton').disabled);
 console.log('PASS source recovery UI: both eye cards seeded, second-precision dates preserved, cancelling retains both imported eyes and existing inputs.');
// Additional visit history: only resolved same-eye QS-OK scans, no identifiers.
const hFirst=study('OD',1),hLast=study('OD',20,-5),hMid=study('OD',10,-2),hOS=study('OS',10,-2);
for(const s of [hFirst,hLast,hMid,hOS])s.scanQuality='ok';
hMid.patientName='NEVER SUBMIT';hMid.filename='private-report';
load([hFirst,study('OS',1)],[hMid,hOS,hLast,study('OS',20)]);
const historyPayload=ctx.buildPayload();assert.equal(historyPayload.display_by_eye.OD.history.length,1);
assert.equal(historyPayload.display_by_eye.OD.history[0].day,9);assert.equal(historyPayload.display_by_eye.OD.history[0].values.C,488);
assert(!JSON.stringify(historyPayload).includes('NEVER SUBMIT'));assert(!JSON.stringify(historyPayload).includes('filename'));
hMid.audit.A.autoConfirmed=false;assert.equal(ctx.buildPayload().display_by_eye.OD.history.length,0);
hMid.audit.A.autoConfirmed=true;hMid.manualEdits.A={value:7.2,verified:true};assert.equal(ctx.buildPayload().display_by_eye.OD.history.length,0);
hMid.manualEdits={};hMid.scanQuality='unknown';assert.equal(ctx.buildPayload().display_by_eye.OD.history.length,0);
hMid.scanQuality='ok';el('intervalDays_OD').value='25';assert.equal(ctx.buildPayload().display_by_eye.OD.history.length,0);
console.log('PASS additional history: dated eligible scan, eye separation, numeric allowlist, unresolved/manual/quality exclusion and edited-interval protection.');

})().catch(e=>{console.error(e);process.exitCode=1;});
