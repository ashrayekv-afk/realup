/* Repair layer: broader format discovery + explicit source-page association.
 * Does not change OCR math, model features, source verification or 3D geometry.
 */
'use strict';
let importRepairPending=null,importRepairDiagnostics=[],forceManualImport=false;
const IMPORT_HELP={
 'pdf-library-unavailable':'PDF renderer could not load. This network must allow the pinned PDF.js module and worker, or the source can be exported as JPEG/PNG.',
 'pdf-render-failed':'A PDF could not be rendered. It may be encrypted, damaged or unsupported.',
 'tiff-library-unavailable':'TIFF decoder could not load. Allow its pinned assets or export JPEG/PNG/PDF.',
 'tiff-orientation':'A TIFF has a nonstandard orientation; convert to a correctly oriented report image before review.',
 'dicom-transfer-syntax':'A DICOM uses unsupported compression (such as JPEG 2000, JPEG-LS or RLE). Export its report pages as JPEG/PNG/PDF. Renaming it will not convert it.',
 'dicom-pixel-format':'A DICOM contains unsupported diagnostic/OCT pixels rather than a supported report image.',
 'dicom-raw':'A file labelled DICOM has no recognized Part 10 header. Its transfer syntax was not guessed.',
 'bigtiff':'BigTIFF is detected but not supported by this adapter.',
 'dicom-no-pixels':'A DICOM has no displayable report pixels or encapsulated PDF.',
 'image-decode-failed':'An image could not be decoded by this browser.',
 'broken-image':'An image filename does not contain recognized image bytes.',
 'broken-pdf':'A file named PDF does not contain a valid PDF header.',
 'broken-zip':'An entry named ZIP is not a readable nested archive.'
};
function repairNode(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls+(cls==='primary'?' primary-button':cls==='secondary'?' secondary-button':'');if(text!==undefined)e.textContent=text;return e;}
function repairSection(){let box=el('archiveDiagnostics');if(!box){box=repairNode('details','archive-diagnostics');box.id='archiveDiagnostics';el('processButton').closest('section').append(box);}return box;}
function updateImportDiagnostic(label,diagnostic){const index=importRepairDiagnostics.findIndex(d=>d.slot===label),r={slot:label,...diagnostic};if(index<0)importRepairDiagnostics.push(r);else importRepairDiagnostics[index]=r;const box=repairSection(),wasOpen=box.open;box.replaceChildren();box.append(repairNode('summary','',`Report-file detection · ${importRepairDiagnostics.reduce((s,d)=>s+d.pages,0)} readable pages`));for(const d of importRepairDiagnostics){box.append(repairNode('p','',d.slot+': '+NKPIArchiveReader.summarize(d)));for(const [key,n] of Object.entries(d.issues))box.append(repairNode('p','import-issue',`${n} item(s): ${IMPORT_HELP[key]||key.replaceAll('-',' ')+' — source format needs review.'}`));}box.append(repairNode('p','muted','Counts only. The diagnostic download excludes names, filenames, dates, image pixels and measurements.'));
 const b=repairNode('button','secondary','Download file-type diagnostic');b.type='button';b.onclick=()=>{const clean=importRepairDiagnostics.map(d=>({slot:d.slot,...NKPIArchiveReader.safeDiagnostics(d)}));const u=URL.createObjectURL(new Blob([JSON.stringify({release:'7.1.0-bilateral-import',imports:clean},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='NKPI_import_file_types.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);};box.append(b);box.open=wasOpen||importRepairDiagnostics.some(d=>Object.keys(d.issues).length||d.pages===0);syncFrameHeight();}
function repairCancel(){if(importRepairPending){importRepairPending.reject(new NKPIArchiveReader.ImportError('cancelled','Report selection cancelled.'));importRepairPending=null;}el('sourcePageRepair')?.remove();}
const repairReset=resetResultsOnly;
resetResultsOnly=function(){repairCancel();importRepairDiagnostics=[];el('archiveDiagnostics')?.remove();return repairReset();};
// Retain folder/container scope. Equal timestamps from different directories may
// refer to different eyes or repeat scans and must never merge into one study.
reportFilenameParts=function(filename){const path=String(filename).replace(/\\/g,'/'),name=basename(path),m=name.match(/^(.+?)\.PdfReport\.0000(-\d{4})?\.(jpe?g|png|webp|bmp)$/i);if(!m)return null;return {prefix:path.slice(0,path.lastIndexOf('/')+1)+m[1],suffix:m[2]||'-0001'};};
isSupportedReportImage=function(filename){return /\.(jpe?g|png|webp|bmp)$/i.test(String(filename).trim());};
function imageSourceName(loaded,filename){return loaded.metadata[filename]?.original||filename;}
function makeDescriptors(loaded,label){const found=discoverNamedReports(loaded,label);return found.remaining.length ? null : found.descriptors;}
function verifiedAssociations(rows,loaded,label){const taken=new Map(),descriptors=[];for(const [i,r] of rows.entries()){if(!['OD','OS'].includes(r.eye))throw new Error(`Study ${i+1}: choose the eye printed on the reports.`);if(!r.topometric||!r.belin)throw new Error(`Study ${i+1}: select the KC-Staging and Belin/Ambrósio source pages.`);if(r.topometric===r.belin&&!r.manual)throw new Error(`Study ${i+1}: automatic extraction needs the two report pages separately. For a combined page, select manual entry.`);
 const associated=[...new Set([r.topometric,r.belin,r.progression,...(r.extras||[])].filter(Boolean))];for(const f of associated){if(!loaded.imageFiles.includes(f))throw new Error('A selected page is no longer available.');if(taken.has(f))throw new Error('The same report page was assigned to more than one study. Match each eye and repeat scan separately.');taken.set(f,i);}
 let timestamp=null;if(r.datetime){timestamp=new Date(r.datetime);if(!Number.isFinite(timestamp.getTime()))throw new Error('Check the local examination date/time.');}
 const pages={topometric:r.topometric,belin:r.belin,progression:r.progression||null};descriptors.push({visitLabel:label,zip:loaded.zip,prefix:`operator-study-${i+1}`,forcedEye:r.eye,timestamp,sourceFormat:'operator-associated-report-pages',pageResolution:'Operator-confirmed report titles, eye and examination',viewerPages:associated,pages,originalPages:Object.fromEntries(Object.entries(pages).filter(([,f])=>f).map(([k,f])=>[k,imageSourceName(loaded,f)])),manual:r.manual});}
 if(!descriptors.length)throw new Error('Add at least one source study.');return descriptors;}
// v4.5: automatically identify decoded DICOM/PDF/TIFF report pages.
function autoHeaderEye(text){
 const t=String(text||'').toUpperCase();
 const od=/\bOD\b|\b(?:EYE\s*[:=-]?\s*RIGHT|RIGHT\s+EYE)\b/.test(t);
 const os=/\bOS\b|\b(?:EYE\s*[:=-]?\s*LEFT|LEFT\s+EYE)\b/.test(t);
 return od&&!os?'OD':os&&!od?'OS':null;
}
async function autoIdentifyConvertedReports(loaded,label,epoch,workers){
 return discoverAllReports(loaded,label,epoch,workers);
}

async function chooseReportPages(loaded,label,epoch,seeds=[]){repairCancel();hideProgress();const box=repairNode('section','card source-page-repair');box.id='sourcePageRepair';el('detectedSection').before(box);box.append(repairNode('h2','',`${label}: report pages found`),repairNode('p','',`Found ${loaded.imageFiles.length} readable page(s). Match the report titles, eye and examination below. No file renaming or second upload is required.`),repairNode('p','muted','An unfamiliar layout is not proof that measurements are missing. The software does not pair unrelated pages by their order. Exclude OCT images, other patients and unrelated visits.'));
 const columns=repairNode('div','repair-columns'),left=repairNode('div','repair-preview'),right=repairNode('div','repair-associations');columns.append(left,right);box.append(columns);
 const previewSelect=repairNode('select',''),preview=repairNode('img','repair-report');preview.alt='Selected original/decoded source report; verify printed eye and title';const caption=repairNode('p','muted');left.append(repairNode('label','', 'Preview source report'),previewSelect,preview,caption);
 const labels=new Map(loaded.imageFiles.map((f,i)=>[f,`Page ${String(i+1).padStart(3,'0')} · ${loaded.metadata[f]?.format||'image'}${loaded.metadata[f]?.converted?' · document/frame '+loaded.metadata[f].page:''}`]));
 for(const [value,text] of labels){const op=repairNode('option','',text);op.value=value;previewSelect.append(op);}
 const urls=new Map();async function show(f){if(!f)return;const file=loaded.zip.file(f);if(!file)return;const b=await file.async('blob');if(epoch!==state.processEpoch)return;if(!urls.has(f))urls.set(f,registerPreviewUrl(b));preview.src=urls.get(f);previewSelect.value=f;caption.textContent=labels.get(f)+' · the full report is retained; do not assign it based on color alone.';syncFrameHeight();}
 previewSelect.onchange=()=>show(previewSelect.value);await show(loaded.imageFiles[0]);
 const cards=[],confirm=repairNode('input',''),confirmation=repairNode('label','repair-confirm');confirm.type='checkbox';confirmation.append(confirm,repairNode('span','','I matched the printed titles and confirmed that each study contains one patient, one eye and one examination.'));
 const status=repairNode('div','alert error');status.hidden=true;
 function select(label,optional=false,multiple=false){const wrap=repairNode('label','field'),s=repairNode('select','');if(multiple){s.multiple=true;s.size=4;}else{const blank=repairNode('option','',optional?'Not included':'Choose page…');blank.value='';s.append(blank);}for(const [value,text] of labels){const op=repairNode('option','',text);op.value=value;s.append(op);}wrap.append(repairNode('span','',label),s);s.onchange=()=>{confirm.checked=false;show(multiple?s.selectedOptions[0]?.value:s.value);};return {wrap,s};}
 function add(seed=null){if(cards.length>=16)return;confirm.checked=false;const card=repairNode('div','repair-study'),title=repairNode('h3','',`Source study ${cards.length+1}`),eye=repairNode('select','');for(const [v,t] of [['','Choose eye…'],['OD','Right eye — OD'],['OS','Left eye — OS']]){const o=repairNode('option','',t);o.value=v;eye.append(o);}const ew=repairNode('label','field');ew.append(repairNode('span','','Printed eye'),eye);eye.onchange=()=>{confirm.checked=false;};const top=select('Topometric / KC-Staging page'),belin=select('Belin/Ambrósio Enhanced Ectasia page'),prog=select('ABCD Progression page (optional)',true),extra=select('Additional map pages from this same study (optional)',true,true),dt=repairNode('input','');dt.type='datetime-local';dt.step='1';dt.onchange=()=>{confirm.checked=false;};const dw=repairNode('label','field');dw.append(repairNode('span','','Examination date/time (optional; browser only)'),dt);const manual=repairNode('input','');manual.type='checkbox';manual.onchange=()=>{confirm.checked=false;};const mw=repairNode('label','repair-confirm');mw.append(manual,repairNode('span','','Enter measurements manually from these pages (skip OCR)'));
 const details=repairNode('details','');details.append(repairNode('summary','','Extra maps, examination date and manual-entry option'),extra.wrap,dw,mw);const remove=repairNode('button','secondary','Remove study');remove.type='button';const record={card,eye,top:top.s,belin:belin.s,prog:prog.s,extra:extra.s,dt,manual};remove.onclick=()=>{cards.splice(cards.indexOf(record),1);card.remove();confirm.checked=false;syncFrameHeight();};card.append(title,ew,top.wrap,belin.wrap,prog.wrap,details,remove);if(seed){eye.value=seed.forcedEye||'';top.s.value=seed.pages.topometric||'';belin.s.value=seed.pages.belin||'';prog.s.value=seed.pages.progression||'';manual.checked=Boolean(seed.manual);if(seed.timestamp){const z=new Date(seed.timestamp.getTime()-seed.timestamp.getTimezoneOffset()*60000);dt.value=z.toISOString().slice(0,19);}for(const o of extra.s.options)o.selected=(seed.viewerPages||[]).includes(o.value)&&!Object.values(seed.pages).includes(o.value);}
 cards.push(record);right.append(card);syncFrameHeight();}
 if(seeds.length)seeds.forEach(seed=>add(seed));else{add();add();}const addButton=repairNode('button','secondary','Add other eye / repeat study');addButton.type='button';addButton.onclick=()=>add();right.append(addButton);box.append(confirmation,status);const actions=repairNode('div','repair-actions'),next=repairNode('button','primary','Use these pages → verify measurements'),cancel=repairNode('button','secondary','Cancel import');next.type=cancel.type='button';actions.append(next,cancel);box.append(actions);box.scrollIntoView({behavior:'smooth',block:'start'});syncFrameHeight();
 if(epoch!==state.processEpoch){box.remove();throw new NKPIArchiveReader.ImportError('cancelled','Source changed.');}
 return await new Promise((resolve,reject)=>{importRepairPending={reject};cancel.onclick=()=>{importRepairPending=null;box.remove();invalidateVerifiedPayload();reject(new Error('Source review cancelled. Existing inputs retained.'));};next.onclick=()=>{try{if(epoch!==state.processEpoch)throw new Error('Selected source changed. Import again.');if(!confirm.checked)throw new Error('Confirm the source-page association before continuing.');const rows=cards.map(c=>({eye:c.eye.value,topometric:c.top.value,belin:c.belin.value,progression:c.prog.value,extras:[...c.extra.selectedOptions].map(o=>o.value),datetime:c.dt.value,manual:c.manual.checked}));const result=verifiedAssociations(rows,loaded,label);importRepairPending=null;box.remove();resolve(result);}catch(e){status.textContent=e.message;status.hidden=false;syncFrameHeight();}};});}
async function blankSourceStudy(d,message){const epoch=state.processEpoch,sourcePages={};for(const [kind,f] of Object.entries(d.pages)){if(f){const blob=await d.zip.file(f).async('blob');if(epoch!==state.processEpoch)throw new NKPIArchiveReader.ImportError('cancelled','Source changed.');sourcePages[kind]=registerPreviewUrl(blob);}}const values=Object.fromEntries(NKPIImport.FIELDS.map(k=>[k,null]));const study={eye:d.forcedEye||null,prefix:d.prefix,timestamp:d.timestamp||null,sourcePages,values,complete:false,audit:Object.fromEntries(NKPIImport.FIELDS.map(k=>[k,{quality:'Unavailable',autoConfirmed:false,reason:message}])),manualEdits:{},extractionWarning:message,eyeResolution:d.forcedEye?'Explicit source-page assignment':'Confirm printed eye before entry'};return await attachAssociatedReportPages(d,study);}
async function extractReportDescriptors(loaded,descriptors,label,epoch,workers,previous=[]){
 const results=[];
 const pageKey=d=>JSON.stringify(Object.entries(d.pages||{}).filter(([,f])=>f).sort());
 const viewerKey=d=>JSON.stringify([...(d.viewerPages||[])].sort());
 const same=(study,b)=>{const a=study.importDescriptor;return a&&b&&(b.forcedEye||study.eye)===study.eye&&Boolean(a.manual)===Boolean(b.manual)&&
   String(a.timestamp?.getTime()||'')===String(b.timestamp?.getTime()||'')&&pageKey(a)===pageKey(b)&&viewerKey(a)===viewerKey(b);};
 for(let i=0;i<descriptors.length;i++){
  discoveryAlive(epoch);const d=descriptors[i];
  const old=previous.find(s=>same(s,d));
  if(old){results.push(old);continue;}
  setProgress(40+55*i/descriptors.length,`Reading ${label} study ${i+1} of ${descriptors.length}…`,'Recovered inputs for each eye will remain visible.');
  let study;
  if(d.manual||!workers?.length)study=await blankSourceStudy(d,d.manual?'Manual source entry selected. Enter and verify the measurements.':'OCR is unavailable. Source pages remain available for verified entry.');
  else if(d.partial)study=await extractPartialReport(d,workers[i%workers.length],epoch);
  else try{study=await extractStudy(d,workers[i%workers.length]);}
  catch(_){discoveryAlive(epoch);study=await extractPartialReport(d,workers[i%workers.length],epoch);}
  discoveryAlive(epoch);
  if(d.forcedEye&&!String(study.eyeEvidence?.resolution||'').includes('disagree')){study.eye=d.forcedEye;study.eyeResolution=d.sourceFormat==='operator-associated-report-pages'?'Operator-confirmed source-page association':String(d.sourceFormat).includes('legacy')?'OD/OS and examination from legacy filename':'Printed eye identified automatically';}
  study.importDescriptor=d;results.push(study);
 }
 const sorted=reconcileStudyLaterality(results);
 sorted.importContext={loaded,descriptors,label,epoch};
 return sorted;
}
parseArchive=async function(file,label){
 const epoch=state.processEpoch;
 const loaded=await NKPIArchiveReader.open(file,{cancelled:()=>epoch!==state.processEpoch,onDiagnostic:d=>{if(epoch===state.processEpoch)updateImportDiagnostic(label,d);}});
 discoveryAlive(epoch);
 if(!loaded.imageFiles.length)throw new Error(`${label}: ${NKPIArchiveReader.summarize(loaded.diagnostic)} Open Report-file detection for the unavailable formats.`);
 let workers=null;try{workers=await ensureWorkers();}catch(_){discoveryAlive(epoch);}
 let descriptors=forceManualImport?[]:await discoverAllReports(loaded,label,epoch,workers);
 if(!descriptors.length)descriptors=await chooseReportPages(loaded,label,epoch);
 discoveryAlive(epoch);
 return extractReportDescriptors(loaded,descriptors,label,epoch,workers);
};
async function repairVisitSources(visitKey){
 const property={baseline:'baselineStudies',earlier:'earlierStudies',later:'laterStudies'}[visitKey];
 const previous=state[property],source=previous?.importContext;
 if(!source||state.processing)return;
 const epoch=state.processEpoch;state.processing=true;el('processButton').disabled=true;
 invalidateVerifiedPayload();clearError();
 try{
  const seeds=previous.map(s=>({...s.importDescriptor,forcedEye:s.eye||null}));
  const descriptors=await chooseReportPages(source.loaded,source.label,epoch,seeds);
  discoveryAlive(epoch);let workers=null;try{workers=await ensureWorkers();}catch(_){discoveryAlive(epoch);}
  const results=await extractReportDescriptors(source.loaded,descriptors,source.label,epoch,workers,previous);
  discoveryAlive(epoch);state[property]=results;renderDetected();renderReview();
 }catch(e){if(epoch===state.processEpoch)showError(e.message);}
 finally{state.processing=false;el('processButton').disabled=false;hideProgress();}
}
const repairVisitCard=visitCard;
visitCard=function(study,...args){const card=repairVisitCard(study,...args);if(study.extractionWarning)card.prepend(repairNode('p','alert warning',study.extractionWarning));return card;};
document.addEventListener('DOMContentLoaded',()=>{const b=repairNode('button','secondary','Choose report pages manually');b.id='manualPageSelection';b.type='button';b.onclick=async()=>{if(state.processing)return;forceManualImport=true;try{await processFiles();}finally{forceManualImport=false;}};el('processButton').after(b);for(const id of ['baselineZip','earlierZip','laterZip'])el(id)?.setAttribute('accept','.zip,.pdf,.dcm,.dicom,.tif,.tiff,.jpg,.jpeg,.jfif,.png,.bmp,.webp');const help=repairNode('p','muted','ZIP, PDF or supported report images. Nested ZIPs and supported DICOM/TIFF reports are read locally. Unfamiliar page layouts can be matched without another upload.');b.after(help);});
