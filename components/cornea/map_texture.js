/* Source-pixel crop proposals. Never decodes a clinical value from a color and
 * never uses colors, landmarks, or scalar indices to displace geometry.
 */
(function(root){'use strict';
function localBlob(url){if(typeof url!=='string'||url.length>2048||!url.startsWith('blob:'))return false;try{return new URL(url).origin===location.origin;}catch(_){return false;}}
function detect(data,w,h){
 const mask=new Uint8Array(w*h),grown=new Uint8Array(w*h),seen=new Uint8Array(w*h),px=data;
 for(let y=Math.floor(h*.065);y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,max=Math.max(px[i],px[i+1],px[i+2]),min=Math.min(px[i],px[i+1],px[i+2]);if(px[i+3]>0&&max>65&&max-min>38&&(max-min)/max>.27)mask[y*w+x]=1;}
 for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){if(!mask[y*w+x])continue;for(let j=-2;j<=2;j++)for(let i=-2;i<=2;i++)grown[(y+j)*w+x+i]=1;}
 const found=[],queue=new Int32Array(w*h);
 for(let k=0;k<w*h;k++){if(!grown[k]||seen[k])continue;let read=0,write=0;queue[write++]=k;seen[k]=1;let x0=w,y0=h,x1=0,y1=0,area=0;while(read<write){const p=queue[read++],x=p%w,y=(p-x)/w;area++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);for(const q of [p-1,p+1,p-w,p+w]){if(q<0||q>=w*h||seen[q]||!grown[q]||(q===p-1&&x===0)||(q===p+1&&x===w-1))continue;seen[q]=1;queue[write++]=q;}}
  const bw=x1-x0+1,bh=y1-y0+1,ratio=bw/bh,r=(bw+bh)/4-1.5,cx=(x0+x1)/2,cy=(y0+y1)/2;
  if(bw<Math.max(18,w*.05)||bh<Math.max(18,h*.05)||bw>w*.67||bh>h*.68||ratio<.77||ratio>1.29||area/(bw*bh)<.47)continue;
  let inside=0,total=0,outside=0,outtotal=0;for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const d=(x-cx)**2+(y-cy)**2;if(d<r*r*.82){total++;inside+=mask[y*w+x];}else if(d>r*r*1.10){outtotal++;outside+=mask[y*w+x];}}
  if(!total||inside/total<.36||(outtotal&&outside/outtotal>.42))continue;
  found.push({cx:cx/w,cy:cy/h,rx:r/w,ry:r/h,score:inside/total,method:'color-region-proposal'});
 }
 return found.sort((a,b)=>Math.abs(a.cy-b.cy)<.08?a.cx-b.cx:a.cy-b.cy).slice(0,12);
}
function crop(image,region){const canvas=document.createElement('canvas');canvas.width=canvas.height=640;const x=canvas.getContext('2d');x.clearRect(0,0,640,640);x.save();x.beginPath();x.arc(320,320,318,0,2*Math.PI);x.clip();const iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height;x.drawImage(image,(region.cx-region.rx)*iw,(region.cy-region.ry)*ih,region.rx*2*iw,region.ry*2*ih,0,0,640,640);x.restore();return canvas;}
const LABELS=Object.freeze({curvature_front:'Curvature',curvature_back:'Posterior curvature',elevation_front:'Elevation',elevation_back:'Posterior elevation',thickness:'Thickness',elevation_front_exclusion:'Anterior exclusion reference',elevation_back_exclusion:'Posterior exclusion reference',reference_difference_front:'Anterior reference-surface difference',reference_difference_back:'Posterior reference-surface difference'});
const median=xs=>{const a=[...xs].sort((a,b)=>a-b);return a[Math.floor(a.length/2)];};
function describe(loaded,kind){
 const regions=loaded.regions.map(r=>({...r,role:null,label:'Unidentified map'}));
 if(!regions.length)return regions;
 const rx=median(regions.map(r=>r.rx||.08)),ry=median(regions.map(r=>r.ry||.11));
 const name=(r,role)=>Object.assign(r,{role,label:LABELS[role],identity:'report-layout'});
 const close=(a,b,tol)=>Math.abs(a-b)<=tol;
 // Topometric / KC-Staging has one anterior/posterior pair. Its relative
 // left/right order survives page padding, resolution and canvas aspect changes.
 if(kind==='topometric'&&regions.length===2){const [a,b]=[...regions].sort((a,b)=>a.cx-b.cx);
  if(close(a.cy,b.cy,ry*.7)&&b.cx-a.cx>rx*2&&(!a.rx||!b.rx||Math.max(a.rx,b.rx)/Math.min(a.rx,b.rx)<1.35)){
   name(a,'curvature_front');name(b,'curvature_back');
  }
 }
 if(kind==='belin'){
  // Identify the two repeated elevation columns and their rows, then the
  // isolated upper-right pachymetry map. No dependence on page coordinates.
  const mapSized=regions.filter(r=>r.rx>=rx*.55&&r.ry>=ry*.55);
  const columns=[];for(const r of [...mapSized].sort((a,b)=>a.cx-b.cx)){let c=columns.find(c=>close(c[0].cx,r.cx,rx*.65));if(!c){c=[];columns.push(c);}c.push(r);}
  const core=columns.filter(c=>c.length>=2);
  if(core.length===2){const [left,right]=core;const dx=median(right.map(r=>r.cx))-median(left.map(r=>r.cx));
   const rows=[];for(const r of [...left,...right].sort((a,b)=>a.cy-b.cy)){let row=rows.find(row=>close(row[0].cy,r.cy,ry*.65));if(!row){row=[];rows.push(row);}row.push(r);}
   const validRows=rows.length>=2&&rows.length<=3&&rows.every(row=>row.length<=2)&&rows.filter(row=>row.length===2).length>=2;
   const upper=rows[0]?.[0].cy;
   const extras=regions.filter(r=>!left.includes(r)&&!right.includes(r));
   // Colored summary-value boxes can form small round connected components.
   // Pachymetry must also have the scale of the repeated elevation maps.
   const coreRadius=median([...left,...right].map(r=>r.rx));
   const pachy=extras.filter(r=>r.rx>=coreRadius*.65&&r.rx<=coreRadius*1.5&&r.cx>Math.max(...right.map(r=>r.cx))+rx*2&&close(r.cy,upper,ry*.75));
   // With no pachymetry anchor, require all three elevation rows. A lone
   // 2x2 display is not enough to assert that its top row is the baseline BFS.
   if(validRows&&dx>rx*2&&(pachy.length===1||rows.length===3)){
    const front=rows[0].filter(r=>left.includes(r)),back=rows[0].filter(r=>right.includes(r));
    if(front.length===1)name(front[0],'elevation_front');if(back.length===1)name(back[0],'elevation_back');
    if(pachy.length===1)name(pachy[0],'thickness');
    if(rows.length===3)for(let j=1;j<3;j++)for(const r of rows[j])name(r,j===1?(left.includes(r)?'elevation_front_exclusion':'elevation_back_exclusion'):(left.includes(r)?'reference_difference_front':'reference_difference_back'));
   }
  }
 }
 return regions;
}
function titleRole(text,confidence){
 if(!Number.isFinite(confidence)||confidence<55)return null;
 const t=String(text||'').toLowerCase().replace(/[^a-z]+/g,' ');
 if(/\b(difference|diff|exclusion|excluded|enhanced)\b/.test(t))return null;
 const front=/\b(front|anterior)\b/.test(t),back=/\b(back|posterior)\b/.test(t);
 const thickness=/\b(thickness|pachymetry|pachymetric|pachy)\b/.test(t);
 const elevation=/\b(elevation)\b/.test(t),curvature=/\b(curvature|axial|sagittal|tangential)\b/.test(t);
 if(Number(thickness)+Number(elevation)+Number(curvature)!==1)return null;
 if(thickness)return 'thickness';if(front===back)return null;
 return elevation?(front?'elevation_front':'elevation_back'):(front?'curvature_front':'curvature_back');
}
function sanitizeHints(raw){if(raw===undefined)return [];if(!Array.isArray(raw)||raw.length>12)return [];
 return raw.filter(r=>r&&Object.hasOwn(LABELS,r.role)&&['cx','cy','rx','ry'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k]))&&r.rx>.005&&r.ry>.005&&r.rx<.5&&r.ry<.5&&r.cx-r.rx>=-.015&&r.cx+r.rx<=1.015&&r.cy-r.ry>=-.015&&r.cy+r.ry<=1.015&&['report-layout','printed-title'].includes(r.identity)).map(r=>({cx:r.cx,cy:r.cy,rx:r.rx,ry:r.ry,role:r.role,label:LABELS[r.role],identity:r.identity}));
}
function withHints(regions,hints){const clean=sanitizeHints(hints);return regions.map(r=>{const hits=clean.filter(h=>Math.abs(h.cx-r.cx)<r.rx*.35&&Math.abs(h.cy-r.cy)<r.ry*.35&&Math.abs(h.rx-r.rx)<r.rx*.35&&Math.abs(h.ry-r.ry)<r.ry*.35);return hits.length===1?{...r,role:hits[0].role,label:hits[0].label,identity:hits[0].identity}:r;});}
function roleRegion(regions,role){const found=regions.filter(r=>r.role===role);return found.length===1?found[0]:null;}
function analyze(image){const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;if(!w||w*h>32000000)throw new Error('Source image exceeds the viewer limit.');const canvas=document.createElement('canvas'),scale=Math.min(1,420/w);canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);return {image,regions:detect(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height)};}
function caption(image,r,regions){
 const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
 let x0=Math.max(0,r.cx-r.rx*1.35),x1=Math.min(1,r.cx+r.rx*1.35);
 for(const other of regions){if(other===r||Math.abs(other.cy-r.cy)>r.ry)continue;if(other.cx<r.cx)x0=Math.max(x0,(other.cx+r.cx)/2);if(other.cx>r.cx)x1=Math.min(x1,(other.cx+r.cx)/2);}
 const y0=Math.max(0,r.cy-r.ry*1.9),y1=Math.max(0,r.cy-r.ry*.9),out=document.createElement('canvas');
 out.width=Math.max(1,Math.round((x1-x0)*w*2));out.height=Math.max(1,Math.round((y1-y0)*h*2));out.getContext('2d').drawImage(image,x0*w,y0*h,(x1-x0)*w,(y1-y0)*h,0,0,out.width,out.height);return out;
}
async function load(url){if(!localBlob(url))throw new Error('Only the current ZIP’s local source image can be displayed.');const image=new Image();image.referrerPolicy='no-referrer';await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Source report no longer available. Reimport the ZIP.'));image.src=url;});return analyze(image);}

function manualRegion(cx,cy,rx,aspect){const ry=rx*aspect;if(![cx,cy,rx,aspect].every(Number.isFinite)||rx<=.01||ry<=.01||cx-rx<0||cx+rx>1||cy-ry<0||cy+ry>1)throw new Error('Choose a circular map region entirely inside the report.');return {cx,cy,rx,ry,method:'operator-selected'};}
const api={detect,describe,crop,load,localBlob,manualRegion,analyze,titleRole,sanitizeHints,withHints,roleRegion,caption,LABELS};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ReportTexture=api;
})(typeof window!=='undefined'?window:globalThis);
