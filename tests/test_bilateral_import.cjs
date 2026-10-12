'use strict';
// Production discovery + import orchestration with controlled OCR/decoded pages.
// Real ZIP decoding is exercised separately when source ZIP paths are supplied.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
let loaded,header={},focused={},manualCalls=0,extracted=[];
const ctx={console,Date,Blob,URL,setTimeout,clearTimeout,Uint8Array,document:{addEventListener(){}},addEventListener(){},location:{origin:'http://localhost'},NKPIImport:require('../components/extractor/numeric_import.js'),NKPIArchiveReader:require('../components/extractor/archive_reader.js')};ctx.window=ctx;vm.createContext(ctx);
for(const f of ['app.js','extraction_integrity.js','review_fixes.js','report_discovery.js','archive_integration.js'])vm.runInContext(fs.readFileSync(path.join(root,'components/extractor',f),'utf8'),ctx,{filename:f});
const state=vm.runInContext('state',ctx);state.processEpoch=1;
ctx.setProgress=()=>{};ctx.updateImportDiagnostic=()=>{};ctx.ensureWorkers=async()=>[{}];ctx.attachAssociatedReportPages=async(d,s)=>s;ctx.registerPreviewUrl=()=> 'blob:test';
ctx.blobToBitmap=async b=>({filename:b.filename,close(){}});ctx.recognizeHeader=async(_,b)=>({text:header[b.filename]||''});ctx.recognizeLateralityRegion=async(_,b)=>({eye:focused[b.filename]||null});
ctx.readTopometricAbcPanel=async()=>({parsed:{A:7.1,B:5.8,C:490}});ctx.readGrayField=async()=>({value:48});ctx.readBelinPanel=async()=>({parsed:{C:490,Kmax:48,ARTmax:240}});ctx.readBadDResilient=async()=>({value:3.2});
const vals={A:7.1,B:5.8,C:490,Kmax:48,BAD_D:3.2,ARTmax:240};
ctx.extractStudy=async d=>{extracted.push(d);return {eye:d.forcedEye||focused[d.pages.topometric]||'OD',timestamp:d.timestamp,values:{...vals},audit:{},manualEdits:{}};};
ctx.chooseReportPages=async()=>{manualCalls++;return [{manual:true,forcedEye:'OD',pages:{},zip:loaded.zip}];};
ctx.NKPIArchiveReader={...ctx.NKPIArchiveReader,open:async()=>loaded};
function setup(rows,converted=true){header=Object.fromEntries(rows);focused={};loaded={imageFiles:rows.map(r=>r[0]),metadata:Object.fromEntries(rows.map(([f])=>[f,{converted,original:f}])),zip:{file:f=>({async:async()=>({filename:f})})},diagnostic:{issues:{}}};manualCalls=0;extracted=[];}
(async()=>{
setup([['1.png','Topometric KC-Staging OD'],['2.png','Belin Ambrosio OD'],['3.png','Topometric KC-Staging OS'],['4.png','Belin Ambrosio OS']]);
let r=await ctx.parseArchive({},'Visit A');assert.equal(r.length,2);assert.equal(manualCalls,0);assert.equal(r.map(x=>x.eye).sort().join(','),'OD,OS');
setup([['1.png','Topometric KC-Staging OD'],['2.png','Belin Ambrosio OD'],['3.png','Topometric KC-Staging'],['4.png','Belin Ambrosio']]);focused={'3.png':'OS','4.png':'OS'};
r=await ctx.parseArchive({},'Visit A');assert.equal(r.length,2);assert.equal(r.map(x=>x.eye).sort().join(','),'OD,OS');assert.equal(manualCalls,0);
// One recognized eye may not suppress the title-only reports for the other.
focused={};r=await ctx.parseArchive({},'Visit A');assert.equal(r.length,3);assert.equal(r.filter(s=>s.eye===null).length,2);assert.equal(r.find(s=>!s.eye&&s.values.A)?.values.A,7.1);assert.equal(manualCalls,0);
const legacy=['case_od_17032020_141103_topometric.jpg','case_od_17032020_141103_belin.jpg','case_os_17032020_141403_topometric.jpg','case_os_17032020_141403_belin.jpg'];
setup(legacy.map(f=>[f,'']),false);r=await ctx.parseArchive({},'Visit A');assert.equal(r.length,2);assert.equal(manualCalls,0);assert.equal(r.map(x=>x.eye).sort().join(','),'OD,OS');assert(r.every(x=>x.timestamp.getFullYear()===2020));assert(extracted.every(d=>d.sourceFormat.includes('legacy')));
setup([['current-20260122141839.PdfReport.0000-0006.jpg',''],['current-20260122141839.PdfReport.0000-0011.jpg',''],['extra.png','Unrelated'],...legacy.slice(2).map(f=>[f,''])],false);
r=await ctx.parseArchive({},'Visit A');assert.equal(r.length,2);assert.equal(manualCalls,0);assert(r.some(x=>x.eye==='OS'));assert.equal(extracted.length,2);
setup([['case_od_17032020_141103_01.jpg',''],['case_os_17032020_141403_01.jpg','']],false);r=await ctx.parseArchive({},'Visit A');assert.equal(r.length,2);assert(r.every(x=>Object.values(x.values).every(v=>v===null)));assert.equal(manualCalls,0);
setup([['folder1/'+legacy[0],''],['folder1/'+legacy[1],''],['folder2/'+legacy[0],''],['folder2/'+legacy[1],'']],false);r=await ctx.parseArchive({},'Visit A');assert.equal(r.length,2);assert(r.every(x=>x.eye==='OD'));assert.notEqual(extracted[0].prefix,extracted[1].prefix);
setup([['1.png','Topometric KC-Staging OD'],['2.png','Topometric KC-Staging OD'],['3.png','Belin Ambrosio OD'],['4.png','Belin Ambrosio OD']]);r=await ctx.parseArchive({},'Visit A');assert.equal(r.length,4);assert(r.every(s=>s.eye==='OD'));assert.equal(extracted.length,0,'No nearest-neighbor pairing across repeated eye scans');
setup([['1.png','Topometric KC-Staging OS']]);r=await ctx.parseArchive({},'Visit A');assert.equal(r[0].values.A,7.1);assert.equal(r[0].values.BAD_D,null);assert.equal(r[0].audit.A.autoConfirmed,false);
setup([['unreadable.png','Unrecognized report']]);r=await ctx.parseArchive({},'Visit A');assert.equal(manualCalls,1);assert(Object.values(r[0].values).every(v=>v===null));
setup([['1.png','Topometric KC-Staging OD']]);await assert.rejects(ctx.autoIdentifyConvertedReports(loaded,'Visit A',0,[{}]),e=>e.code==='cancelled');
const oldRecognize=ctx.recognizeHeader;ctx.recognizeHeader=async()=>{state.processEpoch++;return {text:'Topometric KC-Staging OD'};};await assert.rejects(ctx.parseArchive({},'Visit A'),e=>e.code==='cancelled');ctx.recognizeHeader=oldRecognize;
assert.equal(ctx.autoHeaderEye('OD OS'),null);assert.equal(ctx.autoHeaderEye('METHOD'),null);assert.equal(ctx.autoHeaderEye('Eye: Left'),'OS');
assert.equal(ctx.autoHeaderEye('Eye: Right'),'OD');
// Unchanged source selections preserve corrected values/verification when recovery is reopened.
setup(legacy.map(f=>[f,'']),false);r=await ctx.parseArchive({},'Visit A');r[0].manualEdits.A={value:'7.2',verified:true};const kept=await ctx.extractReportDescriptors(loaded,r.importContext.descriptors,'Visit A',state.processEpoch,[{}],r);assert.equal(kept[0],r[0]);assert(kept[0].manualEdits.A.verified);
// Corrected values survive a manual confirmation of an unchanged named group,
// including reordered additional page lists and eye labels recovered by OCR.
setup([['current-20260122141839.PdfReport.0000-0006.jpg',''],['current-20260122141839.PdfReport.0000-0011.jpg','']],false);
r=await ctx.parseArchive({},'Visit A');r[0].manualEdits.C={value:'488',verified:true};
const seed={...r[0].importDescriptor,forcedEye:r[0].eye,sourceFormat:'operator-associated-report-pages',viewerPages:[...r[0].importDescriptor.viewerPages].reverse()};
const cached=await ctx.extractReportDescriptors(loaded,[seed],'Visit A',state.processEpoch,[{}],r);assert.equal(cached[0],r[0]);assert.equal(cached[0].manualEdits.C.value,'488');
// No worker: preserve both explicit legacy identities and blank source fields.
const oldWorkers=ctx.ensureWorkers;ctx.ensureWorkers=async()=>{throw new Error('offline')};
setup(legacy.map(f=>[f,'']),false);r=await ctx.parseArchive({},'Visit A');assert.equal(r.length,2);assert.equal(r.map(s=>s.eye).sort().join(','),'OD,OS');assert(r.every(s=>Object.values(s.values).every(v=>v===null)));ctx.ensureWorkers=oldWorkers;
// A forced filename eye must not overwrite conflicting printed laterality.
const extractBeforeConflict=ctx.extractStudy;
ctx.extractStudy=async d=>({eye:null,eyeEvidence:{eye:'OS',resolution:'Filename and printed eye disagree; source association required'},timestamp:d.timestamp,values:{...vals},audit:{},manualEdits:{}});
setup(legacy.slice(0,2).map(f=>[f,'']),false);
r=await ctx.parseArchive({},'Visit A');assert.equal(r[0].eye,null);
ctx.extractStudy=extractBeforeConflict;
const archive=require('../components/extractor/archive_reader.js'),JSZip=require('../components/extractor/vendor/jszip-3.10.1.min.js');
for(const filename of process.argv.slice(2)){
 const bytes=fs.readFileSync(filename),file={name:path.basename(filename),size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
 const source=await archive.open(file,{JSZip,imageSize:async()=>({width:1200,height:902})}),found=ctx.discoverNamedReports(source,'Test visit');
 assert.equal(source.imageFiles.length,26);assert.equal(found.descriptors.length,2);assert.equal(found.remaining.length,0);assert(found.descriptors.every(d=>d.pages.topometric&&d.pages.belin&&d.timestamp));
 console.log('PASS real uploaded archive: 26 decoded JPEG pages, 2 complete source groups and examination times.');
}
console.log('PASS bilateral discovery: legacy/current/mixed formats, focused eye OCR, unmatched/partial inputs, same-eye repeats, folder boundaries, missing titles, cancellation and edit retention.');
})().catch(e=>{console.error(e);process.exitCode=1;});
