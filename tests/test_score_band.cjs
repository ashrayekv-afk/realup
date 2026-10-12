const assert=require('node:assert/strict'),B=require('../components/score_band.js');
for(const [value,key,displayed] of [[0,'lower',0],[32.49,'lower',32],[32.5,'intermediate',33],[33,'intermediate',33],[50,'intermediate',50],[66.49,'intermediate',66],[66.5,'higher',67],[67,'higher',67],[72,'higher',72],[100,'higher',100]]){
 const b=B.classify(value);assert.equal(b.key,key);assert.equal(b.displayed,displayed);
 const html=B.render(value);assert(html.includes('data-score-band="'+key+'"'));assert(html.includes('NKPI '+displayed+' of 100'));assert(html.includes('not validated progression stages'));assert.equal((html.match(/class="active"/g)||[]).length,1);
}
for(const bad of [null,undefined,NaN,Infinity,-1,100.01,'72',{},[]]){assert.equal(B.classify(bad),null);assert.equal(B.render(bad),'');}
console.log('PASS descriptive bands: every rounded boundary, invalid input suppression, matching labels, single active category and clear scope.');
