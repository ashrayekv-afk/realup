/* OCR agreement is evidence, never a guarantee. All evidence stays local. */
'use strict';

function matchedProgressionDateIndex(dates, reference) {
  if (!(reference instanceof Date) || !Number.isFinite(reference.getTime())) return null;
  const sameDay = dates.map((date,index)=>({date,index})).filter(({date})=>
    date instanceof Date && date.getFullYear()===reference.getFullYear() &&
    date.getMonth()===reference.getMonth() && date.getDate()===reference.getDate());
  if (sameDay.length===1) return sameDay[0].index;
  // Repeated same-day examinations require an exact printed time match.
  const exact = sameDay.filter(({date})=>date.getHours()===reference.getHours() &&
    date.getMinutes()===reference.getMinutes() && date.getSeconds()===reference.getSeconds());
  return exact.length===1 ? exact[0].index : null;
}

const DIRECT_PRECISION = {A:.0051,B:.0051,C:.51,Kmax:.051,BAD_D:.0051,ARTmax:.51};
function sourceEvidence(variable, sources, progression) {
  const s=sources||{}, rows=[];
  const add=(family,name,value)=>{if(Number.isFinite(value)&&plausible(variable,value)) rows.push({family,name,value});};
  if (['A','B'].includes(variable)) {
    for(const k of ['fullLabeledPanel','labeledRow','exactBox']) add('KC staging',k,s[k]);
    if(progression?.dateMatched) add('Progression display','Progression '+variable,s['progressionRaw'+variable]);
  } else if(variable==='C') {
    add('KC staging','Staging value',s.stagingLabeledPanel);
    add('Topometric pachymetry','Topometric value',s.duplicateTopometricField);
    add('Belin display','Belin value',s.belinPanel);
    if(progression?.dateMatched) add('Progression display','Progression C',s.progressionRawC);
  } else if(variable==='Kmax') {
    add('Topometric','Topometric Kmax',s.topometricField);
    add('Belin display','Belin Kmax',s.belinPanel);
  } else if(variable==='BAD_D') {
    for(const k of ['belinFinalD','exactFinalDBox','dynamicColoredBox','bottomRow']) add('Belin final D',k,s[k]);
  } else if(variable==='ARTmax') {
    for(const k of ['labeledPanelARTmax','exactBoxARTmax','anchoredLabelARTmax']) add('Belin ARTmax',k,s[k]);
  }
  if(['Kmax','BAD_D','ARTmax'].includes(variable)&&progression?.dateMatched) {
    add('Progression display','Progression table',s.progressionTable);
    for(const value of progression.fieldReadings?.[variable]||[]) add('Progression display','Progression row/cell',value);
  }
  // A newly located complete label/value read can supersede legacy crops of
  // THAT SAME printed occurrence. Other reports/dates never disappear.
  const fresh=s.verifiedRead;
  if(fresh?.passed===true) {
    const retained=rows.filter(r=>r.family!==fresh.family);
    retained.push({family:fresh.family,name:'Label + numeric reread',value:fresh.value});
    return retained;
  }
  return rows;
}

function roundedArtmaxCheck(c,ppi,art) {
  if(![c,ppi,art].every(Number.isFinite)||c<=0||ppi<=.005||art<=0) return {status:'unavailable'};
  // Printed C and ARTmax have integer precision; PPImax has 2 decimals.
  // Compare possible intervals, not an arbitrary percentage error tolerance.
  const lower=(c-.5)/(ppi+.005), upper=(c+.5)/(ppi-.005);
  const passed=art+.5>=lower-1e-9&&art-.5<=upper+1e-9;
  return {status:passed?'consistent':'conflict',estimate:c/ppi,lower,upper,c,ppi,art,
    text:`ARTmax ${art}: C ${c} ÷ PPImax ${ppi.toFixed(2)} ≈ ${(c/ppi).toFixed(2)}; rounded-source interval ${lower.toFixed(2)}–${upper.toFixed(2)}.`};
}

function integrityDecision(variable, final, evidence, derivedCheck=null) {
  const tolerance=DIRECT_PRECISION[variable], finite=Number.isFinite(final);
  const groups=new Set(evidence.filter(e=>finite&&Math.abs(e.value-final)<=tolerance).map(e=>e.family));
  const conflicts=evidence.filter(e=>finite&&Math.abs(e.value-final)>tolerance);
  // C / rounded PPI is approximate and is never a second direct report read.
  const derivedConflict=variable==='ARTmax'&&finite&&Number.isFinite(derivedCheck)&&
    Math.abs(final-derivedCheck)>Math.max(2,Math.abs(final)*.015);
  const agreed=finite&&groups.size>=2&&!conflicts.length&&!derivedConflict;
  return {autoConfirmed:agreed,independentSources:[...groups],evidence,conflicts,
    derivedCheck,derivedConflict,statusLabel:!finite?'Missing':conflicts.length||derivedConflict?'Conflict':agreed?'Reports agree':'Review source',
    reason:!finite?'No readable value.':conflicts.length||derivedConflict?
      'Source readings disagree. Compare the printed values before calculating.':agreed?
      'Distinct printed sources agree. OCR agreement does not establish accuracy.':
      'Only one printed source supports this value; repeated OCR passes are not independent confirmation.'};
}

function enforceExtractionIntegrity(values,audit,progression) {
  for(const variable of NKPIImport.FIELDS) {
    const item=audit[variable]||{},s=item.sources||{};
    const evidence=sourceEvidence(variable,s,progression);
    const decision=integrityDecision(variable,values[variable],evidence,
      variable==='ARTmax'&&s.calculationConfidence!=='none'?s.calculatedFromSelectedPPImax:null);
    const fresh=s.verifiedRead;
    if(fresh?.passed&&Math.abs(values[variable]-fresh.value)<=DIRECT_PRECISION[variable]&&!decision.conflicts.length) {
      decision.autoConfirmed=true;
      decision.statusLabel=decision.independentSources.length>=2?'Reports agree':'Auto-read';
      decision.reason=decision.independentSources.length>=2?'Distinct printed sources agree after targeted rereading.':
        'The complete label and repeated numeric-box readings agree. Single-source automatic reading; not independent report confirmation.';
      decision.acceptanceMethod=decision.independentSources.length>=2?'multiple-printed-sources':'label-and-number';
    }
    decision.checks=[];
    if(variable==='ARTmax') {
      const ppiReads=[s.PPImaxLabeledPanel,s.PPImaxExactBox,s.PPImaxLabeledRow].filter(Number.isFinite);
      const ppiTrusted=s.ppiVerifiedRead?.passed===true||ppiReads.filter(v=>Math.abs(v-s.selectedPPImax)<=.0051).length>=2;
      const check=ppiTrusted?roundedArtmaxCheck(values.C,s.selectedPPImax,values.ARTmax):{status:'unavailable'};
      decision.mathCheck=check;decision.derivedConflict=check.status==='conflict';
      // A noisy legacy calculation cannot veto a reliable printed value, but
      // genuine consistency conflicts are never silently replaced by a formula.
      if(check.status!=='unavailable')decision.checks.push(check.text);
      if(check.status==='conflict') {
        decision.autoConfirmed=false;decision.statusLabel='Check calculation';
        decision.reason='Printed ARTmax and C/PPImax do not agree within their printed rounding. Review C, PPImax and ARTmax.';
      }else if(decision.statusLabel==='Conflict'&&!decision.conflicts.length) {
        decision.autoConfirmed=Boolean(fresh?.passed)||decision.independentSources.length>=2;
        decision.statusLabel=decision.autoConfirmed?(decision.independentSources.length>=2?'Reports agree':'Auto-read'):'Review source';
        decision.reason=check.status==='consistent'?'Printed ARTmax passes the rounded C/PPImax consistency check.':'PPImax could not be reliably confirmed; the calculated candidate is not used as corroboration.';
      }
      if(s.derivedFallback==='yes'&&!fresh?.passed) {
        decision.autoConfirmed=false;decision.statusLabel='Review derived value';
        decision.reason='Only an approximate C/PPImax candidate is available. Confirm the printed ARTmax; a calculation is not a second measurement.';
      }
    }
    // A stronger reading can fill a missing value but conflicts never silently
    // replace the chosen input. The clinician sees both candidates.
    Object.assign(item,decision,{final:values[variable],quality:decision.autoConfirmed?'High':'Review'});
    if(['A','B'].includes(variable)&&Number.isFinite(values.A)&&Number.isFinite(values.B)&&!(values.A>values.B)) {
      item.autoConfirmed=false;item.statusLabel='Check A / B';item.reason='ARC is not larger than PRC. Check the labels, units and source values; no automatic swap was made.';
    }
    if(!plausible(variable,values[variable])) {item.autoConfirmed=false;item.statusLabel='Review source';}
    audit[variable]=item;
  }
}

// Literal tokens only: do not invent decimal points, replace letters by digits,
// or clip an extra digit merely to fit a range or a desired model result.
function strictNumericToken(text,variable) {
  // In this label-bound pachymetry field, OCR commonly renders the printed
  // micro sign as p or w. This normalizes a unit glyph, never a numeric digit.
  if(variable==='C')text=String(text||'').replace(/\s+[pw]m\s*$/i,' µm');
  const clean=String(text||'').trim().replace(/[,]/g,'.').replace(/[−–]/g,'-')
    .replace(/^[|\[\]()\s]+|[|\[\]()\s]+$/g,'').replace(/\s*(?:mm|[µμu]m|D)\s*$/i,'').trim();
  const decimals={A:2,B:2,C:0,Kmax:1,BAD_D:2,ARTmax:0,PPImax:2}[variable];
  const pattern=new RegExp(decimals?`^[+-]?\\d+\\.\\d{${decimals}}$`:'^\\d+$');
  const n=Number(clean);
  return pattern.test(clean)&&plausible(variable,n)?n:null;
}
function decideLiteralReads(variable,reads,contextValues) {
  const tol=DIRECT_PRECISION[variable]||.0051;
  const parsed=reads.map(r=>({value:strictNumericToken(r.text,variable),confidence:Number(r.confidence)||0,text:r.text}));
  const strong=parsed.filter(r=>Number.isFinite(r.value)&&r.confidence>=80);
  const groups=[...new Set(strong.map(r=>r.value))].map(value=>({value,count:strong.filter(r=>Math.abs(r.value-value)<=tol).length})).sort((a,b)=>b.count-a.count);
  const best=groups[0];
  const competing=best&&parsed.some(r=>Number.isFinite(r.value)&&r.confidence>=60&&Math.abs(r.value-best.value)>tol);
  const context=(contextValues||[]).filter(r=>(Number.isFinite(r.value)||r.labelOnly===true)&&r.confidence>=80);
  const contextOK=best&&context.length&&context.every(r=>r.labelOnly===true||Math.abs(r.value-best.value)<=tol);
  return {passed:Boolean(best&&best.count>=3&&!competing&&contextOK),value:best?.value??null,
    agreeingReads:best?.count||0,competing:Boolean(competing),reads:parsed,contextValues:context};
}
function literalLabelValue(text,variable) {
  const patterns={A:/\bARC\s*[\[(]?\s*3\s*mm\s*Zone\s*[\])}]?\s*:?\s*/i,
    B:/\bPRC\s*[\[(]?\s*3\s*mm\s*Zone\s*[\])}]?\s*:?\s*/i,
    C:/\b(?:Thinnest\s*Pachy|Pachy\s*Thin(?:\s*Locat)?)\s*:?\s*/i,
    Kmax:/\bK\s*max\s*:?\s*/i,ARTmax:/\bART\s*max\s*:?\s*/i,
    PPImax:/(?<!ART\s)(?<!K\s)\bMax\s*:\s*/i,BAD_D:/\bD\s*:\s*/};
  const output=[];
  for(const line of String(text||'').split(/\r?\n/)) {
    const match=line.match(patterns[variable]); if(!match)continue;
    if(variable==='PPImax'&&/(?:ART|K)\s*Max/i.test(line))continue;
    // The first complete token after the exact label; trailing other fields
    // cannot become the target. Preserve the token's original precision.
    const token=line.slice(match.index+match[0].length).match(/^[\s|\[]*([+-]?\d+(?:[.,]\d+)?)(?=\s|(?:mm|[µμu]m|D)\b|$)/i)?.[1];
    const value=strictNumericToken(token,variable);if(Number.isFinite(value))output.push(value);
  }
  return output.length===1?output[0]:null;
}
async function rereadLabeledNumber(worker,bitmap,valueBox,rowBox,variable,numberCanvas=null) {
  const rows=[];
  const labelPatterns={A:/\bARC\b/i,B:/\bPRC\b/i,C:/\b(?:Thinnest\s*Pachy|Pachy\s*Thin)/i,Kmax:/\bK\s*max\b/i,ARTmax:/\bART\s*max\b/i,PPImax:/^\s*Max\s*:?\s*$/i,BAD_D:/^\s*D\s*:?\s*$/};
  const b=valueBox||numberCanvas?.referenceBox;
  const labelBox=b?[rowBox[0],rowBox[1],b[0]-2,rowBox[3]]:null;
  for(const scale of [4,6]) {
    const canvas=makeCropCanvas(bitmap,labelBox||rowBox,scale);
    const r=await recognize(worker,padCanvas(transformChannel(canvas,'gray',false),24,255),{psm:7});
    const labelWord={A:/^ARC\b/i,B:/^PRC\b/i,C:/^(?:Thinnest|Pachy)\b/i,Kmax:/^K(?:max)?\b/i,ARTmax:/^ART(?:max)?\b/i,PPImax:/^Max\b/i,BAD_D:/^D\b/}[variable];
    const words=ocrLines(r.blocks).flatMap(l=>l.words||[]).filter(w=>labelWord.test(w.text));
    const confidence=words.length?Math.min(...words.map(w=>Number(w.confidence)||0)):r.confidence;
    rows.push({value:literalLabelValue(r.text,variable),labelOnly:Boolean(labelBox&&labelPatterns[variable].test(r.text)),confidence,text:r.text});
  }
  const reads=[];
  for(const scale of [4,6]) {
    const interior=['A','B','C'].includes(variable)?[valueBox[0]+4,valueBox[1]+2,valueBox[2]-3,valueBox[1]+20]:valueBox;
    const base=numberCanvas?.referenceBox?makeCropCanvas(bitmap,numberCanvas.referenceBox,scale):numberCanvas||makeCropCanvas(bitmap,interior,scale);
    const variants=['BAD_D','ARTmax','Kmax'].includes(variable)?
      [transformChannel(base,'gray',false),lowSaturationLightInkCanvas(base),transformChannel(base,'g',true)]:
      [transformChannel(base,'gray',false),thresholdCanvas(transformChannel(base,'gray',false),150,false)];
    for(const [i,canvas] of variants.entries()) {
      const r=await recognize(worker,padCanvas(canvas,24,255),{psm:scale===4?7:(i===1?8:7)});
      r.confidence=numericWordConfidence(r,variable);
      reads.push(r);
    }
  }
  // Only a still-unresolved, correctly labelled field gets extra segmentation
  // passes. Confidence is OCR confidence, not a clinical probability.
  if(!decideLiteralReads(variable,reads,rows).passed&&rows.some(r=>r.labelOnly&&r.confidence>=80)) {
    const interior=['A','B','C'].includes(variable)?[valueBox[0]+4,valueBox[1]+2,valueBox[2]-3,valueBox[1]+20]:valueBox;
    const base=makeCropCanvas(bitmap,numberCanvas?.referenceBox||interior,8);
    for(const canvas of [transformChannel(base,'gray',false),lowSaturationLightInkCanvas(base)]) {
      const r=await recognize(worker,padCanvas(canvas,32,255),{psm:8});r.confidence=numericWordConfidence(r,variable);reads.push(r);
    }
  }
  const result=decideLiteralReads(variable,reads,rows);
  return {...result,labelReads:rows,valueBox:valueBox||numberCanvas?.referenceBox||null,rowBox,policy:'literal-label-box-v1'};
}
function numericWordConfidence(read,variable) {
  const value=strictNumericToken(read.text,variable);
  if(!Number.isFinite(value))return read.confidence;
  const words=ocrLines(read.blocks).flatMap(l=>l.words||[]).filter(w=>strictNumericToken(w.text,variable)===value);
  return words.length===1?Number(words[0].confidence)||0:read.confidence;
}
function ocrBoxToReference(bitmap,region,scale,b,padding=2) {
  const sx=scale*bitmap.width/REFERENCE_WIDTH,sy=scale*bitmap.height/REFERENCE_HEIGHT;
  return [region[0]+b.x0/sx-padding,region[1]+b.y0/sy-padding,region[0]+b.x1/sx+padding,region[1]+b.y1/sy+padding];
}
async function refineExtractionEvidence({worker,values,audit,progression,abcFields,topometricBitmap,belinBitmap,panel}) {
  // The same worker is used sequentially; no racing OCR parameter mutations.
  const attempt=async(variable,bitmap,box,rowBox,family,canvas=null)=>{
    if(!box&&!canvas)return;
    let read;
    try {read=await rereadLabeledNumber(worker,bitmap,box,rowBox,variable,canvas);}
    catch {audit[variable].rereadError='Additional OCR check unavailable. Retained the original reading and source-review requirement.';return;}
    const item=audit[variable];read.family=family;
    read.superseded=sourceEvidence(variable,item.sources,{}).filter(e=>e.family===family);
    item.sources.verifiedRead=read;
    if(read.passed) {values[variable]=read.value;if(variable==='ARTmax')item.sources.derivedFallback='no';}
  };
  for(const k of ['A','B','C'])if(!audit[k].autoConfirmed&&abcFields?.[k]) {
    const b=abcFields[k].valueBox,row=[b[0]-130,b[1]-3,b[2]+3,b[1]+22];
    await attempt(k,topometricBitmap,b,row,'KC staging');
  }
  if(!audit.BAD_D.autoConfirmed) {
    const dynamic=findRightmostColoredBoxCanvas(belinBitmap);
    if(dynamic?.referenceBox){const b=dynamic.referenceBox;
      await attempt('BAD_D',belinBitmap,null,[b[0]-32,b[1],b[2],b[3]],'Belin final D',dynamic);}
  }
  if(!audit.Kmax.autoConfirmed) {
    const field=panel.anchored?.fields?.Kmax;
    if(field?.valueBox) {
      const b=field.valueBox,row=[Math.max(540,b[0]-110),b[1]-6,Math.min(920,b[2]+8),b[3]+6];
      await attempt('Kmax',belinBitmap,b,row,'Belin display');
    }
  }
  const s=audit.ARTmax.sources;
  if(!audit.ARTmax.autoConfirmed||audit.ARTmax.mathCheck?.status!=='consistent') {
    const field=panel.anchored?.fields?.PPImax;
    if(field?.valueBox) {
      const b=field.valueBox, row=[Math.max(540,b[0]-110),b[1]-6,Math.min(920,b[2]+8),b[3]+6];
      try {s.ppiVerifiedRead=await rereadLabeledNumber(worker,belinBitmap,b,row,'PPImax');}
      catch {s.ppiVerifiedRead={passed:false,value:null,error:'Additional PPImax check unavailable'};}
      if(s.ppiVerifiedRead.passed) {s.selectedPPImax=s.ppiVerifiedRead.value;s.calculationConfidence='reread';}
    }
  }
  if(!audit.ARTmax.autoConfirmed) {
    const field=panel.anchored?.fields?.ARTmax;
    if(field?.valueBox) {
      const b=field.valueBox,row=[Math.max(540,b[0]-120),b[1]-6,Math.min(920,b[2]+8),b[3]+6];
      await attempt('ARTmax',belinBitmap,b,row,'Belin ARTmax');
    }
  }
  if(Number.isFinite(s.selectedPPImax)&&s.selectedPPImax>0) s.calculatedFromSelectedPPImax=Math.round(values.C/s.selectedPPImax);
  enforceExtractionIntegrity(values,audit,progression);
}

// Prefer an unmodified numeric token supported by multiple preprocessing passes.
// Missing-decimal rescue remains available, but can no longer beat a literal
// reading solely through a range-conversion heuristic.
const legacyChooseCandidate=chooseCandidate;
chooseCandidate=function(results,variable,preferredValue=null) {
  const old=legacyChooseCandidate(results,variable,null);
  const counts=new Map();
  results.forEach((read,index)=>{
    for(const {token} of numericTokens(read.text)) {
      const value=Number(token);
      if(!plausible(variable,value)) continue;
      if(!counts.has(value)) counts.set(value,{value,reads:new Set(),confidence:0});
      const candidate=counts.get(value); candidate.reads.add(index);
      candidate.confidence=Math.max(candidate.confidence,Number(read.confidence)||0);
    }
  });
  const literal=[...counts.values()].sort((a,b)=>b.reads.size-a.reads.size||b.confidence-a.confidence);
  if(literal.length&&literal[0].reads.size>=2&&literal[0].confidence>=30) return {...old,value:literal[0].value};
  return old;
};

function ocrLines(blocks) {
  return (blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[]));
}

// Read ARTmax in context, then re-read only its actual printed value. This
// survives moved panels and avoids assuming the lower-right colored box is ART.
async function readAnchoredBelinFields(worker,bitmap) {
  const box=[540,240,920,445],scale=4;
  const sx=scale*bitmap.width/REFERENCE_WIDTH,sy=scale*bitmap.height/REFERENCE_HEIGHT;
  const base=makeCropCanvas(bitmap,box,scale),read=await recognize(worker,base,{psm:6});
  const output={raw:read,fields:{}};
  const patterns={ARTmax:/ART\s*max\s*:?/i,Kmax:/K\s*max\s*:?/i,PPImax:/\bMax\s*:/i};
  for(const [variable,pattern] of Object.entries(patterns)) {
    const lines=ocrLines(read.blocks).filter(l=>{const t=l.text||l.words?.map(w=>w.text).join(' ')||'';return pattern.test(t)&&(variable!=='PPImax'||!/(ART|K)\s*max/i.test(t));});
    if(lines.length!==1) continue;
    const line=lines[0],text=line.text||line.words.map(w=>w.text).join(' ');
    const label=text.match(pattern);
    const parsed=parseLabeledNumericLine(text,[pattern],variable);
    const words=line.words||[];
    let labelWord=words.find(w=>variable==='ARTmax'?/ART/i.test(w.text):variable==='PPImax'?/^Max/i.test(w.text):/^K/i.test(w.text));
    if(variable==='ARTmax'&&labelWord) {
      const next=words[words.indexOf(labelWord)+1];
      if(next?.bbox&&/^max/i.test(next.text)) labelWord={...labelWord,bbox:{...labelWord.bbox,x1:next.bbox.x1}};
    }
    let result={value:parsed,raw:[read],agreeingReads:0};
    if(labelWord?.bbox&&label) {
      const b=labelWord.bbox;
      const h=Math.max(10,(b.y1-b.y0)/sy),cy=box[1]+(b.y0+b.y1)/2/sy;
      // Include the full text height. Unlike the old fixed box, this region
      // follows the actual label and is not fractionally cropped again.
      const numericWord=words.find(w=>w.bbox&&w.bbox.x0>b.x1&&/\d/.test(w.text));
      const left=box[0]+b.x1/sx+(variable==='Kmax'?20:7);
      const valueBox=numericWord ? ocrBoxToReference(bitmap,box,scale,numericWord.bbox) : [left,cy-h*.8,left+48,cy+h*.8];
      const direct=await readAnchoredNumber(worker,bitmap,valueBox,variable);
      result={...direct,value:Number.isFinite(parsed)?parsed:direct.value,valueBox};
    }
    output.fields[variable]={...result,labeledValue:parsed};
  }
  return output;
}

async function readAnchoredNumber(worker,bitmap,box,variable) {
  const reads=[];
  // Numeric labels in these reports are small. Several moderate scales avoid
  // relying on one oversampled shape or treating a single glyph as a word.
  for(const scale of [4,7]) {
    const base=makeCropCanvas(bitmap,box,scale),gray=transformChannel(base,'gray',false);
    const variants=[gray,transformChannel(base,'max',false),lowSaturationLightInkCanvas(base),transformChannel(base,'g',false)];
    for(const [index,canvas] of variants.entries()) {
      reads.push(await recognize(worker,padCanvas(canvas,24,255),{psm:scale===4?7:8,whitelist:variable==='ARTmax'?'0123456789':'0123456789.-'}));
    }
  }
  const selected=chooseCandidate(reads,variable),agreeingReads=countAgreeingOcrReads(reads,variable,selected.value);
  const confident=reads.some(r=>r.confidence>=35&&numericTokens(r.text).some(t=>Number(t.token)===selected.value));
  return {...selected,value:agreeingReads>=2||confident?selected.value:null,raw:reads,agreeingReads};
}

const legacyReadBelinPanel=readBelinPanel;
readBelinPanel=async function(worker,bitmap) {
  const panel=await legacyReadBelinPanel(worker,bitmap);
  const anchored=await readAnchoredBelinFields(worker,bitmap);
  panel.anchored=anchored;
  panel.originalParsed={...panel.parsed};
  for(const [key,field] of Object.entries(anchored.fields))
    if(!Number.isFinite(panel.parsed[key])&&Number.isFinite(field.value)) panel.parsed[key]=field.value;
  return panel;
};
