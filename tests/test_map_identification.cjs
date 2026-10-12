'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),T=require('../components/cornea/map_texture.js');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const raw=[[.176,.242],[.407,.242],[.845,.242],[.176,.543],[.407,.543],[.176,.86],[.407,.86]].map(([cx,cy])=>({cx,cy,rx:.065,ry:.093}));
check('Belin roles survive padding, independent scaling and detection order',()=>{for(const [sx,sy,tx,ty]of [[.8,.65,.1,.2],[.7,.9,.24,.025],[1.02,.82,-.01,.1]]){const regions=raw.map(r=>({cx:r.cx*sx+tx,cy:r.cy*sy+ty,rx:r.rx*sx,ry:r.ry*sy})).reverse(),d=T.describe({regions,image:{naturalWidth:1600,naturalHeight:1200}},'belin');assert.equal(d.find(r=>r.role==='thickness').cx,raw[2].cx*sx+tx);assert.equal(d.find(r=>r.role==='elevation_front').cy,raw[0].cy*sy+ty);}});
check('Topometric front/back pair is selected without the old aspect ratio',()=>{const d=T.describe({image:{naturalWidth:2048,naturalHeight:1536},regions:[{cx:.3,cy:.38,rx:.1,ry:.133},{cx:.74,cy:.39,rx:.1,ry:.133}]},'topometric');assert.equal(d[0].role,'curvature_front');assert.equal(d[1].role,'curvature_back');});
check('Unknown four-map display needs map titles, not a guessed quadrant',()=>assert(T.describe({regions:raw.slice(0,4),image:{}},'report').every(r=>r.role===null)));
for(const [title,role]of [['Sagittal Curvature (Front)','curvature_front'],['Elevation (Front)','elevation_front'],['Elevation (Back)','elevation_back'],['Corneal Thickness','thickness'],['Pachymetry','thickness']])check('Printed title: '+title,()=>assert.equal(T.titleRole(title,90),role));
for(const title of ['Elevation Front Difference','Enhanced Elevation Back','Elevation Front Exclusion','Elevation Front Back','Elevation','Corneal Thickness / Elevation Front'])check('Ambiguous/reference title rejected: '+title,()=>assert.equal(T.titleRole(title,90),null));
check('Low-confidence title is not assigned a role',()=>assert.equal(T.titleRole('Corneal Thickness',25),null));
check('Duplicate title roles do not arbitrarily choose a circle',()=>assert.equal(T.roleRegion([{role:'thickness'},{role:'thickness'}],'thickness'),null));
check('Malformed or off-image map metadata is discarded',()=>assert.equal(T.sanitizeHints([{...raw[2],cx:3,role:'thickness',identity:'printed-title'},{...raw[2],role:'imagined',identity:'printed-title'}]).length,0));
check('Title hints only attach to their own detected circle',()=>{const hint={...raw[2],role:'thickness',identity:'printed-title'},result=T.withHints(raw,[hint]);assert.equal(result[2].role,'thickness');assert(!result[0].role);});
// Execute the actual report-map import wrapper plus the numerical association
// wrapper to prove that the worker is forwarded and title hints are attached.
const ctx={console,Map,Set,WeakMap,URL,location:{origin:'http://test.local'},document:{createElement:()=>({width:1,height:1,getContext:()=>({drawImage(){}})})},state:{ocrJobsEstimated:0},lastStreamlitResetToken:'test',setTimeout,clearTimeout,extractStudy:async()=>({eye:'OD',sourcePages:{report:'blob:http://test.local/report'}}),resetResultsOnly(){},invalidateVerifiedPayload(){},renderReview(){},isSupportedReportImage:()=>true,reportFilenameParts:()=>null,parent:{postMessage(){}},addEventListener(){},CornealData:{}};ctx.window=ctx;vm.createContext(ctx);
for(const name of ['cornea/map_texture.js','extractor/report_maps.js','extractor/auto_surfaces.js'])vm.runInContext(fs.readFileSync(path.join(root,'components',name),'utf8'),ctx,{filename:name});
const region={cx:.5,cy:.5,rx:.15,ry:.15};ctx.ReportTexture.load=async()=>({image:{naturalWidth:1000,naturalHeight:1000},regions:[region]});let receivedWorker=null;ctx.recognize=async(worker)=>{receivedWorker=worker;return {text:'Corneal Thickness',confidence:90};};
(async()=>{
 const worker={id:'existing-ocr-worker'},descriptor={pages:{report:'report.png'},zip:{file:()=>null}};
 const study=await ctx.extractStudy(descriptor,worker);assert.equal(receivedWorker,worker);assert.equal(study.reportPages[0].map_regions[0].role,'thickness');console.log('PASS existing OCR worker survives same-ZIP wrapper and labels the actual source page');count++;
 // Verify the real gallery sanitizer preserves hints before the viewer frame.
 const gallery=fs.readFileSync(path.join(root,'components/report_gallery.js'),'utf8'),a=gallery.indexOf('function localBlob('),b=gallery.indexOf('function current()');ctx.CornealData={validate:v=>v};vm.runInContext(gallery.slice(a,b),ctx);const cleaned=ctx.sanitize([{eye:'OD',visit:'first',source_id:'study-one',pages:study.reportPages}]);assert.equal(cleaned[0].pages[0].map_regions[0].role,'thickness');console.log('PASS map identities survive the production gallery/frame boundary');count++;
 console.log(count+' automatic map identification / metadata checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
