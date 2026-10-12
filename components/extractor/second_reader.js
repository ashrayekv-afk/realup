/* A second local LSTM weight set, not a second clinical source or cloud AI.
 * Only unresolved, label-bound fields are reread. No report pixels leave the browser.
 */
'use strict';
const SECOND_READER_MODEL = 'tessdata_best-4.1.0-eng';
let secondaryWorker = null, secondaryPromise = null, secondaryQueue = Promise.resolve();
let secondaryGeneration = 0, secondaryUnavailable = false;

function secondReaderDecision(variable, primary, secondary) {
  const tol = DIRECT_PRECISION[variable] || .0051;
  const reads = secondary.reads.map(r=>({value:strictNumericToken(r.text,variable),confidence:Number(r.confidence)||0,text:r.text}));
  const strong = reads.filter(r=>Number.isFinite(r.value)&&r.confidence>=85);
  const value = strong[0]?.value;
  const agrees = Number.isFinite(value)&&strong.length>=2&&strong.every(r=>Math.abs(r.value-value)<=tol);
  const label = secondary.labels.some(r=>r.labelOnly===true&&r.confidence>=85);
  const otherLabelValue = secondary.labels.some(r=>Number.isFinite(r.value)&&Math.abs(r.value-value)>tol&&r.confidence>=60);
  const competitor = reads.some(r=>Number.isFinite(r.value)&&r.confidence>=60&&Math.abs(r.value-value)>tol);
  // A second model cannot turn an unsupported guess into automatic acceptance.
  const support = primary.reads?.some(r=>Number.isFinite(r.value)&&r.confidence>=80&&Math.abs(r.value-value)<=tol);
  const primaryConflict = primary.reads?.some(r=>Number.isFinite(r.value)&&r.confidence>=80&&Math.abs(r.value-value)>tol);
  const primaryLabel = primary.labelReads?.some(r=>r.confidence>=80&&(r.labelOnly===true||Number.isFinite(r.value)));
  return {passed:Boolean(agrees&&label&&!otherLabelValue&&!competitor&&support&&!primaryConflict&&primaryLabel),
    value:Number.isFinite(value)?value:null,reads,labels:secondary.labels,model:SECOND_READER_MODEL,
    primarySupport:Boolean(support),primaryConflict:Boolean(primaryConflict),policy:'two-model-label-consensus-v1'};
}

async function ensureSecondaryWorker() {
  if(secondaryUnavailable)throw new Error('Second reader unavailable for this session');
  if(secondaryWorker)return secondaryWorker;
  if(secondaryPromise)return secondaryPromise;
  const generation=secondaryGeneration;
  const creation=Tesseract.createWorker('eng',Tesseract.OEM.LSTM_ONLY,{
    workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
    // The float best model aborts in the 7.0 relaxed-SIMD build. Use the
    // portable LSTM core for this small unresolved-field pass.
    corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-lstm.wasm.js',
    langPath:new URL('ocr_second',window.location.href).href,
    gzip:false,cacheMethod:'none',logger:()=>{},errorHandler:()=>{}
  });
  let timedOut=false,timer;
  secondaryPromise=Promise.race([creation,new Promise((_,reject)=>{
    timer=setTimeout(()=>{timedOut=true;reject(new Error('Second reader initialization timeout'));},45000);
  })]).then(w=>{
    if(generation!==secondaryGeneration){w.terminate();throw new Error('Reader session changed');}
    secondaryWorker=w;return w;
  }).catch(e=>{if(generation===secondaryGeneration)secondaryUnavailable=true;throw e;})
    .finally(()=>{clearTimeout(timer);if(generation===secondaryGeneration)secondaryPromise=null;});
  creation.then(w=>{if(timedOut)w.terminate();}).catch(()=>{});
  return secondaryPromise;
}

async function readSecondaryNumber(worker,bitmap,primary,variable) {
  const b=primary.valueBox,row=primary.rowBox;
  if(!b||!row)throw new Error('No bound numeric crop');
  const labelBox=[row[0],row[1],b[0]-2,row[3]];
  if(labelBox[2]<=labelBox[0])throw new Error('No bound label crop');
  const pattern={A:/\bARC\b/i,B:/\bPRC\b/i,C:/\b(?:Thinnest\s*Pachy|Pachy\s*Thin)/i,
    Kmax:/\bK\s*max\b/i,ARTmax:/\bART\s*max\b/i,BAD_D:/^\s*D\s*:?\s*$/}[variable];
  const labelRead=await recognize(worker,padCanvas(transformChannel(makeCropCanvas(bitmap,labelBox,5),'gray',false),24,255),{psm:7});
  const labels=[{labelOnly:Boolean(pattern?.test(labelRead.text)),value:literalLabelValue(labelRead.text,variable),confidence:labelRead.confidence}];
  const reads=[];
  const interior=['A','B','C'].includes(variable)?[b[0]+4,b[1]+2,b[2]-3,b[1]+20]:b;
  for(const scale of [4,6]) {
    const base=makeCropCanvas(bitmap,interior,scale);
    const gray=transformChannel(base,'gray',false);
    const variants=['BAD_D','ARTmax','Kmax'].includes(variable)
      ? [gray,lowSaturationLightInkCanvas(base)]
      : [gray,thresholdCanvas(gray,150,false)];
    for(const canvas of variants) {
      const read=await recognize(worker,padCanvas(canvas,28,255),{psm:7});
      reads.push({...read,confidence:numericWordConfidence(read,variable)});
    }
  }
  return secondReaderDecision(variable,primary,{reads,labels});
}

function applySecondReader(variable,values,audit,result) {
  const item=audit[variable],primary=item.sources.verifiedRead;
  item.sources.secondReader=result;
  if(!result.passed)return;
  item.sources.primaryVerifiedRead=primary;
  item.sources.verifiedRead={...primary,passed:true,value:result.value,
    secondModel:result.model,acceptanceMethod:'two-model-consensus'};
  values[variable]=result.value;
  if(variable==='ARTmax')item.sources.derivedFallback='no';
}

const firstReaderRefinement=refineExtractionEvidence;
refineExtractionEvidence=async function(args) {
  await firstReaderRefinement(args);
  const generation=secondaryGeneration;
  const run=async()=>{
    if(generation!==secondaryGeneration)return;
    const pending=NKPIImport.FIELDS.filter(k=>!args.audit[k].autoConfirmed&&args.audit[k].sources?.verifiedRead?.valueBox);
    if(!pending.length)return;
    let w;
    try{w=await ensureSecondaryWorker();}catch{
      for(const k of pending)args.audit[k].secondReaderNote='Second local reader unavailable; source review retained.';
      return;
    }
    for(const k of pending) {
      if(generation!==secondaryGeneration)return;
      const bitmap=['A','B','C'].includes(k)?args.topometricBitmap:args.belinBitmap;
      try {
        const result=await readSecondaryNumber(w,bitmap,args.audit[k].sources.verifiedRead,k);
        if(generation!==secondaryGeneration)return;
        applySecondReader(k,args.values,args.audit,result);
      }catch{args.audit[k].secondReaderNote='Second local reader could not resolve this field; source review retained.';}
    }
    enforceExtractionIntegrity(args.values,args.audit,args.progression);
    for(const k of pending) {
      const item=args.audit[k];
      if(item.autoConfirmed&&item.sources.secondReader?.passed) {
        item.statusLabel=item.independentSources.length>=2?'Reports agree':'Two readers agree';
        item.acceptanceMethod='two-model-consensus';
        item.reason='Two local OCR weight sets agree on the labelled number. This remains one printed source, not independent clinical validation.';
      }
    }
  };
  const task=secondaryQueue.then(run,run);
  secondaryQueue=task.catch(()=>{});
  await task;
};

const clearBeforeSecondReader=clearSession;
clearSession=function(...args) {
  secondaryGeneration++;
  if(secondaryWorker)Promise.resolve(secondaryWorker.terminate()).catch(()=>{});
  secondaryWorker=null;secondaryPromise=null;secondaryUnavailable=false;
  return clearBeforeSecondReader(...args);
};
