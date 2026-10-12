'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../components/extractor');
const ctx={Date,console,document:{addEventListener(){}},addEventListener(){},NKPIImport:require(root+'/numeric_import.js')};ctx.window=ctx;vm.createContext(ctx);
for(const name of ['app.js','extraction_integrity.js'])vm.runInContext(fs.readFileSync(root+'/'+name,'utf8'),ctx,{filename:name});
const same={dateMatched:true,fieldReadings:{ARTmax:[296,296]}};
let rows=ctx.sourceEvidence('ARTmax',{labeledPanelARTmax:236,exactBoxARTmax:236,progressionTable:296},same);
let d=ctx.integrityDecision('ARTmax',236,rows,296);
assert.equal(d.autoConfirmed,false);assert.equal(d.statusLabel,'Conflict');assert(d.derivedConflict);
// Multiple transforms of the identical printed field count once.
rows=ctx.sourceEvidence('ARTmax',{labeledPanelARTmax:236,exactBoxARTmax:236},{});
d=ctx.integrityDecision('ARTmax',236,rows);assert.equal(d.autoConfirmed,false);assert.equal(d.independentSources.length,1);
// A single/derived value is retained, never silently declared verified.
d=ctx.integrityDecision('ARTmax',296,[],296);assert.equal(d.autoConfirmed,false);
// Matching direct report cells agree; derived conflict overrides that agreement.
rows=ctx.sourceEvidence('ARTmax',{labeledPanelARTmax:296,exactBoxARTmax:296,progressionTable:296},same);
assert.equal(ctx.integrityDecision('ARTmax',296,rows,296).autoConfirmed,true);
assert.equal(ctx.integrityDecision('ARTmax',296,rows,236).autoConfirmed,false);
// Full-row/cell disagreements cannot be erased by overwriting the selected read.
rows=ctx.sourceEvidence('ARTmax',{labeledPanelARTmax:236,progressionTable:236},{dateMatched:true,fieldReadings:{ARTmax:[296,236]}});
assert.equal(ctx.integrityDecision('ARTmax',236,rows).autoConfirmed,false);
// Even a smaller digit error exceeds printed precision, not broad clinical tolerance.
assert.equal(ctx.integrityDecision('ARTmax',296,[{family:'A',value:296},{family:'B',value:298}]).autoConfirmed,false);
for(const key of ['A','B','C','Kmax','BAD_D']) {
 const v={A:7.57,B:6.16,C:471,Kmax:45.3,BAD_D:2.31}[key];
 assert.equal(ctx.integrityDecision(key,v,[{family:'A',value:v},{family:'A',value:v}]).autoConfirmed,false);
 assert.equal(ctx.integrityDecision(key,v,[{family:'A',value:v},{family:'B',value:v}]).autoConfirmed,true);
 assert.equal(ctx.integrityDecision(key,v,[{family:'A',value:v},{family:'B',value:v+1}]).autoConfirmed,false);
}
const date=new Date(2026,5,19,11,52,28);
assert.equal(ctx.matchedProgressionDateIndex([new Date(2026,2,31),date],date),1);
assert.equal(ctx.matchedProgressionDateIndex([new Date(2026,5,18)],date),null);
assert.equal(ctx.matchedProgressionDateIndex([new Date(2026,5,19,10),new Date(2026,5,19,12)],date),null);
assert.equal(ctx.matchedProgressionDateIndex([date,date],date),null);
assert.equal(ctx.matchedProgressionDateIndex([date],null),null);
assert.equal(ctx.matchedProgressionDateIndex([null],date),null);
// Severe readings previously rejected by extraction bounds.
for(const [key,value] of [['ARTmax',30],['ARTmax',29],['PPImax',10.66],['BAD_D',21.25],['C',239]])assert(ctx.plausible(key,value));
assert.equal(ctx.parseProgressionIndexMax('ARTmax: 296\nMax: 1.60'),1.6);
assert.equal(ctx.parseProgressionIndexMax('ARTmax: 296'),null);
assert.equal(ctx.parsePanelValue('ARTmax: | 340',/ART\s*MAX/i,'ARTmax'),340);
assert.equal(ctx.parsePanelValue('ARTmax: | 359',/ART\s*MAX/i,'ARTmax'),359);
assert.equal(ctx.parsePanelValue('ARTmax: |',/ART\s*MAX/i,'ARTmax'),null);
assert.equal(ctx.parseLabeledNumericLine('Min: 0.83 Max: | 1.56',[/\bMax\s*:/i],'PPImax'),1.56);
assert.equal(ctx.chooseCandidate([{text:'296',confidence:85},{text:'296',confidence:80},{text:'236',confidence:99}],'ARTmax').value,296);
const estimated=ctx.selectArtmaxStandard({printedARTmax:2,printedSource:'isolated OCR',progressionARTmax:null,calculatedARTmax:27,calculationConfidence:'candidate',printedReliable:false});
assert.equal(estimated.value,27);assert.equal(estimated.derived,true);
assert.equal(ctx.integrityDecision('ARTmax',27,[{family:'Belin ARTmax',value:2}],27).autoConfirmed,false);
const noGuess=ctx.selectArtmaxStandard({printedARTmax:null,progressionARTmax:null,calculatedARTmax:null,calculationConfidence:'none'});
assert.equal(noGuess.value,null);
const printed=ctx.selectArtmaxStandard({printedARTmax:359,printedSource:'labeled report',progressionARTmax:399,calculatedARTmax:132,calculationConfidence:'single'});
assert.equal(printed.value,359);assert.equal(printed.derived,false);
const ppi=ctx.directSourceConsensus('PPImax',[{name:'Belin labeled panel',value:1.47,weight:8},{name:'labeled Max row',value:4,weight:6}]);
assert.equal(ppi.value,1.47);

console.log('PASS extraction integrity: wrong ARTmax blocked; source independence, disagreements, derived checks, date matching, severe ranges, PPI label and repeated literal OCR.');

// 7.5: literal, label-bound automatic reads, not independent OCR votes.
for(const [text,k,value] of [['2.96 mm','B',2.96],['31.92','BAD_D',31.92],['315 µm','C',315],['27','ARTmax',27],['11.63','PPImax',11.63],['86.0D','Kmax',86]])assert.equal(ctx.strictNumericToken(text,k),value);
for(const [text,k] of [['296','B'],['31','BAD_D'],['O.50','A'],['27 2','ARTmax'],['27%','ARTmax'],['315.2','C'],['3.0','B'],['Infinity','A']])assert.equal(ctx.strictNumericToken(text,k),null);
const clear=Array.from({length:4},()=>({text:'2.96 mm',confidence:94}));
const context=[{value:2.96,confidence:90}];
assert(ctx.decideLiteralReads('B',clear,context).passed);
assert(!ctx.decideLiteralReads('B',clear,[]).passed);
assert(!ctx.decideLiteralReads('B',clear,[{value:9.60,confidence:90}]).passed);
assert(!ctx.decideLiteralReads('B',clear.slice(0,2),context).passed);
assert(!ctx.decideLiteralReads('B',[...clear,{text:'9.60',confidence:90}],context).passed);
assert(!ctx.decideLiteralReads('B',clear.map(r=>({...r,confidence:70})),context).passed);
assert(ctx.decideLiteralReads('B',[...clear,{text:'9.60',confidence:20}],context).passed);
for(const [s,k,n] of [['ARC (3mm Zone): 4.50 mm A 4+','A',4.5],['PRC (3mm Zone): 2.96 mm','B',2.96],['ARTmax: 27','ARTmax',27],['Max: 11.63','PPImax',11.63],['Df: 42.49 Db: 40.29 D: 31.25','BAD_D',31.25]])assert.equal(ctx.literalLabelValue(s,k),n);
assert.equal(ctx.literalLabelValue('ARTmax: 27','PPImax'),null);
assert.equal(ctx.literalLabelValue('Df: 31.25','BAD_D'),null);
assert.equal(ctx.literalLabelValue('PRC (3mm Zone): 296','B'),null);
assert.equal(ctx.literalLabelValue('ARTmax: 27\nARTmax: 2','ARTmax'),null);
for(const [c,ppi,art] of [[315,11.63,27],[319,10.66,30],[474,1.60,296],[528,1.47,359]])assert.equal(ctx.roundedArtmaxCheck(c,ppi,art).status,'consistent');
for(const [c,ppi,art] of [[315,11.63,2],[474,1.60,236],[528,1.47,399]])assert.equal(ctx.roundedArtmaxCheck(c,ppi,art).status,'conflict');
assert.equal(ctx.roundedArtmaxCheck(null,11.63,27).status,'unavailable');
assert.equal(ctx.roundedArtmaxCheck(315,0,27).status,'unavailable');
const fresh={passed:true,value:2.96,family:'KC staging',agreeingReads:4};
rows=ctx.sourceEvidence('B',{fullLabeledPanel:2.96,exactBox:9.60,verifiedRead:fresh},{});
assert.equal(rows.length,1);assert.equal(rows[0].value,2.96);
rows=ctx.sourceEvidence('B',{fullLabeledPanel:2.96,exactBox:9.60,verifiedRead:fresh,progressionRawB:3.01},{dateMatched:true});
assert.equal(rows.length,2);assert.equal(ctx.integrityDecision('B',2.96,rows).autoConfirmed,false);
const auditValues={A:4.57,B:2.96,C:315,Kmax:86,BAD_D:31.92,ARTmax:27};
const audit=Object.fromEntries(Object.keys(auditValues).map(k=>[k,{sources:{}}]));
audit.B.sources={exactBox:9.60,fullLabeledPanel:2.96,verifiedRead:fresh};
audit.ARTmax.sources={labeledPanelARTmax:2,derivedFallback:'yes',selectedPPImax:11.63,ppiVerifiedRead:{passed:true}};
ctx.enforceExtractionIntegrity(auditValues,audit,{});
assert.equal(audit.B.autoConfirmed,true);assert.equal(audit.B.statusLabel,'Auto-read');assert.equal(audit.B.independentSources.length,1);
assert.equal(audit.ARTmax.autoConfirmed,false);assert.equal(audit.ARTmax.statusLabel,'Review derived value');
audit.ARTmax.sources={labeledPanelARTmax:2,derivedFallback:'no',selectedPPImax:11.63,ppiVerifiedRead:{passed:true},verifiedRead:{passed:true,value:27,family:'Belin ARTmax'}};
ctx.enforceExtractionIntegrity(auditValues,audit,{});assert.equal(audit.ARTmax.autoConfirmed,true);assert.equal(audit.ARTmax.mathCheck.status,'consistent');
auditValues.C=415;ctx.enforceExtractionIntegrity(auditValues,audit,{});assert.equal(audit.ARTmax.autoConfirmed,false);assert.equal(audit.ARTmax.mathCheck.status,'conflict');
console.log('PASS 7.5: literal precision, label binding, competing-read rejection, single-source badges, cross-report conflicts, rounded ART identity and derived-only gate.');
const box=ctx.ocrBoxToReference({width:1200,height:838},[540,240,920,445],4,{x0:100,y0:100,x1:140,y1:140},0);
assert.equal(box[0],565);assert(Math.abs(box[1]-(240+25*902/838))<1e-10);
const double=ctx.ocrBoxToReference({width:2400,height:1804},[540,240,920,445],4,{x0:200,y0:200,x1:280,y1:280},0);
assert.equal(double[0],565);assert.equal(double[1],265);
assert.equal(ctx.strictNumericToken('319 pm','C'),319);
assert.equal(ctx.strictNumericToken('319 wm','C'),319);
assert.equal(ctx.strictNumericToken('3l9 pm','C'),null);
const wordRead={text:'4.60 mm',confidence:50,blocks:[{paragraphs:[{lines:[{words:[{text:'4.60',confidence:95},{text:'mm',confidence:10}]}]}]}]};
assert.equal(ctx.numericWordConfidence(wordRead,'B'),95);
console.log('PASS variable-height/double-resolution OCR coordinate conversion and numeric-word versus unit confidence.');
