/* Bilateral source review: show both eyes and every available visit. */
'use strict';
const bilateralSelection = new Map();
let bilateralEyeChoice = 'both';
const bilateralReset = resetResultsOnly;
resetResultsOnly = function () {
  bilateralSelection.clear(); bilateralEyeChoice = 'both';
  return bilateralReset();
};
function calculationEyes() { return bilateralEyeChoice === 'both' ? ['OD','OS'] : [bilateralEyeChoice]; }
function reviewVisits() {
  return state.mode === 'baseline' ? [['baseline','Selected visit',state.baselineStudies]] :
    [['earlier','Earlier visit',state.earlierStudies],['later','Later visit',state.laterStudies]];
}
function currentReviewStudy(visit, eye, studies) { return selectedStudy(groupByEye(studies), eye, visit); }

createStudySelector = function (eye, studies, visitKey) {
  const label = repairNode('label','field'), select = repairNode('select');
  label.append(repairNode('span','',`${visitKey} study used for ${eye}`));
  select.dataset.eye=eye;select.dataset.visit=visitKey;
  const saved=bilateralSelection.get(visitKey+eye);
  // Prefer a complete study to a newer title-only placeholder, but keep every
  // candidate visible. Explicit user selection is retained across re-renders.
  const fallback=[...studies].reverse().find(studyComplete)||studies.at(-1);
  const chosen=studies.includes(saved)?saved:fallback;
  for(const [i,study] of studies.entries()){
    const n=NKPIImport.FIELDS.filter(k=>Number.isFinite(study.values?.[k])).length;
    const option=repairNode('option','',`${studyLabel(study)} · ${n}/6 extracted`);
    option.value=String(i);option.selected=study===chosen;select.append(option);
  }
  bilateralSelection.set(visitKey+eye,chosen);
  select.addEventListener('change',()=>{bilateralSelection.set(visitKey+eye,studies[Number(select.value)]);renderReview();});
  label.append(select);return label;
};

const bilateralDetected=renderDetected;
renderDetected=function(){
  bilateralDetected();
  const actions=repairNode('div','repair-actions');
  for(const [key,label,studies] of reviewVisits()){
    if(!studies.importContext)continue;
    const b=repairNode('button','secondary',`${label}: recover / match source pages`);
    b.type='button';b.addEventListener('click',()=>repairVisitSources(key));actions.append(b);
  }
  el('detectedSummary').append(actions);
};

function missingVisitCard(eye,key,label,studies){
  const card=repairNode('div','visit-card missing-visit');
  card.append(repairNode('h4','',label),repairNode('strong','',`${eye} source study not identified`),
    repairNode('p','muted','The other visit’s inputs are retained below. Recover this eye’s source pages to calculate both eyes.'));
  if(studies.importContext){const b=repairNode('button','secondary','Recover from this uploaded file');b.type='button';b.onclick=()=>repairVisitSources(key);card.append(b);}
  return card;
}

renderReview=function(){
  invalidateVerifiedPayload();
  const content=el('reviewContent');content.replaceChildren();
  const choice=repairNode('label','field bilateral-choice'), select=repairNode('select');select.id='calculationEyes';
  for(const [value,label] of [['both','Both eyes — OD and OS'],['OD','OD only — exclude OS'],['OS','OS only — exclude OD']]){
    const op=repairNode('option','',label);op.value=value;select.append(op);
  }
  select.value=bilateralEyeChoice;
  select.onchange=()=>{bilateralEyeChoice=select.value;renderReview();};
  choice.append(repairNode('span','','Eyes to calculate'),select,
    repairNode('small','','Both eyes are selected by default. A missing source will not silently reduce the calculation to one eye.'));
  content.append(choice);
  const queue=repairNode('div','exception-queue');
  queue.append(repairNode('strong','','Automatic extraction checks'),
    repairNode('span','muted','Review highlighted exceptions, then confirm the case once. Source crops remain available for every value.'));
  const next=repairNode('button','secondary','Review next exception');next.type='button';next.id='reviewNextException';
  next.addEventListener('click',()=>{
    const field=selectedReviewFields().find(w=>reviewIssue(w));if(!field)return;
    const details=field.querySelector('details');if(details)details.open=true;
    field.scrollIntoView({behavior:'smooth',block:'center'});field.querySelector('input[type="number"]')?.focus?.();syncFrameHeight();
  });queue.append(next);content.append(queue);
  for(const eye of ['OD','OS']){
    const card=repairNode('section','eye-card');card.dataset.reviewEye=eye;
    card.append(repairNode('h3','',eye==='OD'?'Right eye — OD':'Left eye — OS'));
    if(!calculationEyes().includes(eye))card.append(repairNode('p','notice','Excluded from this calculation. Recovered inputs remain available.'));
    const visits=repairNode('div',state.mode==='longitudinal'?'eye-grid':'');
    for(const [key,label,studies] of reviewVisits()){
      const study=currentReviewStudy(key,eye,studies);
      if(study){
        const visit=visitCard(study,eye,key,label+' · '+formatTimestamp(study.timestamp));
        visit.dataset.reviewEye=eye;visit.dataset.reviewVisit=key;
        if(study.scanQuality==='warning')visit.prepend(repairNode('p','notice','The source reports a scan-quality warning. Readable numbers do not establish an acceptable scan.'));
        visits.append(visit);
      }else visits.append(missingVisitCard(eye,key,label,studies));
    }
    card.append(visits);
    if(state.mode==='longitudinal'){
      const first=currentReviewStudy('earlier',eye,state.earlierStudies),last=currentReviewStudy('later',eye,state.laterStudies);
      if(first&&last){
        const wrap=repairNode('label','field'),input=repairNode('input'),days=selectedIntervalDays(first.timestamp,last.timestamp);
        input.id=`intervalDays_${eye}`;input.type='number';input.min='1';input.step='1';
        const saved=first.intervalReview;
        if(saved?.last===last)input.value=saved.value;
        else if(days>0)input.value=String(days);
        wrap.append(repairNode('span','',`${eye} — days between selected visits`),input,
          repairNode('small','',days!==null&&days<=0?'Choose distinct visits in chronological order.':'Confirm the interval against the source. Exact dates stay in this browser.'));
        input.addEventListener('input',()=>{first.intervalReview={last,value:input.value};invalidateVerifiedPayload();updateVerificationGate();});
        card.append(wrap);
      }
    }
    content.append(card);
  }
  // Unknown laterality is not a reason to conceal recovered measurements.
  for(const [key,label,studies] of reviewVisits())for(const [i,study] of studies.entries()){
    if(['OD','OS'].includes(study.eye))continue;
    const card=visitCard(study,'unassigned'+i,key,`${label} · eye not confirmed`);
    card.prepend(repairNode('p','alert warning','Confirm this source eye in Detected studies. These extracted inputs are retained.'));
    content.append(card);
  }
  el('reviewSection').classList.remove('hidden');el('exportSection').classList.add('hidden');
  updateVerificationGate();publishSourceReportMaps();syncFrameHeight();
};

function selectedReviewFields(){
  return [...document.querySelectorAll('#reviewContent .value-field')].filter(w=>
    calculationEyes().includes(w.closest('[data-review-eye]')?.dataset.reviewEye));
}
function bilateralBlockers(){
  const blockers=[];
  if(unresolvedCurrentStudyCount())blockers.push('Confirm the eye on every unassigned source study.');
  for(const eye of calculationEyes()){
    for(const [key,label,studies] of reviewVisits())if(!currentReviewStudy(key,eye,studies))blockers.push(`${eye}: ${label.toLowerCase()} source is missing.`);
    if(state.mode==='longitudinal'){
      const first=currentReviewStudy('earlier',eye,state.earlierStudies),last=currentReviewStudy('later',eye,state.laterStudies);
      if(first&&last){
        const days=selectedIntervalDays(first.timestamp,last.timestamp),input=el(`intervalDays_${eye}`),value=Number(input?.value);
        if(days!==null&&days<=0)blockers.push(`${eye}: choose distinct visits in chronological order.`);
        else if(!input?.value||!Number.isInteger(value)||value<=0)blockers.push(`${eye}: enter the interval in whole days.`);
      }
    }
  }
  return blockers;
}
function refreshLiveConsistencyChecks(){
  for(const eye of calculationEyes())for(const [key,,studies] of reviewVisits()) {
    const study=currentReviewStudy(key,eye,studies);if(!study)continue;
    const wrappers={},values={};
    for(const variable of NKPIImport.FIELDS) {
      const input=el(`${key}_${eye}_${variable}`);if(!input)continue;
      wrappers[variable]=input.closest('.value-field');values[variable]=input.value===''?null:Number(input.value);
    }
    const issues={};
    if(Number.isFinite(values.A)&&Number.isFinite(values.B)&&values.A<=values.B) {
      issues.A=issues.B='Check ARC / PRC labels and units: ARC is not larger than PRC. Values have not been swapped.';
    }
    const art=study.audit?.ARTmax,ppi=art?.sources?.selectedPPImax;
    const trustedPPI=art?.sources?.ppiVerifiedRead?.passed||art?.mathCheck?.status==='consistent'||art?.mathCheck?.status==='conflict';
    if(trustedPPI) {
      const check=roundedArtmaxCheck(values.C,ppi,values.ARTmax);
      if(check.status==='conflict')issues.C=issues.ARTmax=check.text+' Check the printed values; a mismatch does not authorize changing them.';
    }
    for(const [variable,wrapper] of Object.entries(wrappers)) {
      const issue=issues[variable]||'',signature=variable==='A'||variable==='B'?`${values.A}|${values.B}`:`${values.C}|${ppi}|${values.ARTmax}`;
      const checkbox=wrapper.querySelector('.field-verification-checkbox');
      if(issue&&wrapper.dataset.consistencySignature&&wrapper.dataset.consistencySignature!==signature) {
        checkbox.checked=false;if(study.manualEdits?.[variable])study.manualEdits[variable].verified=false;
      }
      wrapper.dataset.consistencySignature=signature;wrapper.dataset.consistencyIssue=issue;
      const note=wrapper.querySelector('.live-consistency-check');if(note){note.textContent=issue;note.hidden=!issue;}
      const label=wrapper.querySelector('.field-verification-label');if(label)label.hidden=!issue&&wrapper.dataset.baseNeedsVerification!=='true';
      if(issue&&!checkbox.checked) {wrapper.querySelector('details').open=true;const badge=wrapper.querySelector('.quality-badge');badge.textContent='Check calculation';badge.className='quality-badge quality-unavailable';}
      else if(!issue&&wrapper.dataset.baseNeedsVerification!=='true') {
        const badge=wrapper.querySelector('.quality-badge');badge.textContent=study.audit?.[variable]?.statusLabel||'Reports agree';badge.className='quality-badge quality-high';
      }
    }
  }
}
allRequiredFieldsVerified=function(){
  refreshLiveConsistencyChecks();
  const fields=selectedReviewFields(),expected=calculationEyes().length*6*(state.mode==='longitudinal'?2:1);
  return !bilateralBlockers().length&&fields.length===expected&&fields.every(w=>!reviewIssue(w));
};
updateVerificationGate=function(){
  refreshLiveConsistencyChecks();
  const fields=selectedReviewFields(),remaining=fields.filter(reviewIssue),blockers=bilateralBlockers();
  state.verificationRequiredCount=remaining.length;
  for(const wrapper of document.querySelectorAll('#reviewContent .value-field')){
    wrapper.querySelector('input[type="number"]')?.setAttribute('aria-invalid',reviewIssue(wrapper)?'true':'false');
    syncReviewAppearance(wrapper);
  }
  for(const status of document.querySelectorAll('[data-review-status]')){
    const local=[...status.closest('.visit-card').querySelectorAll('.value-field')],ready=local.filter(w=>!reviewIssue(w)).length;
    const found=local.filter(w=>{const v=w.querySelector('input[type="number"]')?.value;return v!==''&&Number.isFinite(Number(v));}).length;
    status.textContent=`${found}/${local.length} extracted · ${ready}/${local.length} ready after checks`;status.className=ready===local.length?'extraction-ok':'extraction-warning';
  }
  const summary=el('verificationSummary');
  summary.textContent=`${calculationEyes().join(' + ')} · ${fields.length-remaining.length}/${calculationEyes().length*6*(state.mode==='longitudinal'?2:1)} values ready`+
    (remaining.length?` · ${remaining.length} exception${remaining.length===1?'':'s'} to review`:' · No field exceptions')+(blockers.length?' · '+blockers.join(' '):'');
  const next=el('reviewNextException');if(next){next.disabled=!remaining.length;next.textContent=remaining.length?`Review next exception (${remaining.length})`:'All field checks complete';}
  const ready=allRequiredFieldsVerified();summary.className='verification-summary '+(ready?'verification-complete':'verification-needed');
  const confirm=el('confirmValues');confirm.disabled=!ready;if(!ready)confirm.checked=false;
  confirm.closest('label')?.classList.toggle('confirmation-disabled',!ready);syncFrameHeight();
};
buildPayload=function(){
  const blockers=bilateralBlockers();if(blockers.length)throw new Error(blockers.join(' '));
  if(!allRequiredFieldsVerified())throw new Error('Verify the displayed measurements for each selected eye.');
  const value={mode:state.mode,age:NKPIImport.number(el('age').value,'Age',true)};
  if(state.mode==='baseline')value.eyes=Object.fromEntries(calculationEyes().map(eye=>[eye,readVisitValues('baseline',eye)]));
  else{
    value.baseline={};value.followup={};value.interval_days_by_eye={};
    for(const eye of calculationEyes()){
      value.baseline[eye]=readVisitValues('earlier',eye);value.followup[eye]=readVisitValues('later',eye);
      value.interval_days_by_eye[eye]=NKPIImport.number(el(`intervalDays_${eye}`).value,`${eye} interval`,true);
    }
  }
  value.display_by_eye=Object.fromEntries(calculationEyes().map(eye=>{
    const first=currentReviewStudy(state.mode==='baseline'?'baseline':'earlier',eye,state.mode==='baseline'?state.baselineStudies:state.earlierStudies);
    const latest=state.mode==='baseline'?first:currentReviewStudy('later',eye,state.laterStudies);
    const meta={first_quality:first?.scanQuality||'unknown',latest_quality:latest?.scanQuality||'unknown',history:[]};
    // Only automatically resolved, acceptable same-eye scans inside the verified interval.
    // Relative days and numeric values cross the boundary; source dates stay local.
    if(state.mode==='longitudinal'&&first?.timestamp&&latest?.timestamp&&selectedIntervalDays(first.timestamp,latest.timestamp)===value.interval_days_by_eye[eye]){
      const seen=new Set();
      for(const study of [...state.earlierStudies,...state.laterStudies]){
        if(study===first||study===latest||study.eye!==eye||!study.timestamp||study.scanQuality!=='ok'||Object.keys(study.manualEdits||{}).length)continue;
        const day=selectedIntervalDays(first.timestamp,study.timestamp);
        if(day===null||day<0||day>value.interval_days_by_eye[eye]||NKPIImport.FIELDS.some(k=>fieldNeedsVerification(study,k)))continue;
        const values=Object.fromEntries(NKPIImport.FIELDS.map(k=>[k,study.values?.[k]]));
        if(Object.values(values).some(v=>!Number.isFinite(v)))continue;
        const token=JSON.stringify([day,values]);if(seen.has(token))continue;seen.add(token);
        if(meta.history.length<40)meta.history.push({eye,day,values,quality:'ok',verified:true});
      }
    }
    return [eye,meta];
  }));
  return NKPIImport.sanitize(value);
};
