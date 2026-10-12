/* Presentation-only categories of the displayed NKPI integer. No diagnosis,
 * probability calibration, treatment threshold or fitted cutpoint is implied. */
(function(root){'use strict';
const bands=Object.freeze([
  Object.freeze({key:'lower',label:'Lower NKPI',short:'Lower',range:'0–32'}),
  Object.freeze({key:'intermediate',label:'Intermediate NKPI',short:'Intermediate',range:'33–66'}),
  Object.freeze({key:'higher',label:'Higher NKPI',short:'Higher',range:'67–100'})
]);
function classify(score){
  if(typeof score!=='number'||!Number.isFinite(score)||score<0||score>100)return null;
  const displayed=Number(score.toFixed(0));
  return {...bands[displayed<33?0:displayed<67?1:2],displayed};
}
function render(score){
  const b=classify(score);if(!b)return '';
  return '<div class="clinical-card score-band-card" data-score-band="'+b.key+'">'+
    '<div class="score-band-heading"><span class="score-label">NKPI score band</span><strong>'+b.label+'</strong></div>'+
    '<div class="gauge" role="img" aria-label="NKPI '+b.displayed+' of 100, '+b.label+', descriptive score band"><div class="marker" style="left:'+Math.min(98,Math.max(2,score))+'%"></div></div>'+
    '<div class="score-band-legend">'+bands.map(v=>'<span'+(v.key===b.key?' class="active"':'')+'><b>'+v.short+'</b><small>'+v.range+'</small></span>').join('')+'</div>'+
    '<p class="micro score-band-note">Descriptive score bands · not validated progression stages or probabilities.</p></div>';
}
const api={bands,classify,render};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.NKPIScoreBand=api;
})(typeof window!=='undefined'?window:globalThis);
