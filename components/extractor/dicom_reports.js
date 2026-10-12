/* Bounded DICOM Part 10 report adapter. Not a general diagnostic DICOM viewer.
 * Only explicit/implicit little-endian unsigned 8-bit RGB/MONOCHROME1/2,
 * encapsulated JPEG Baseline frames, and encapsulated PDF are accepted.
 * No patient identifiers are read, returned, or logged. No geometry is derived.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NKPIDicomReports=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
class DicomError extends Error {constructor(code,message){super(message);this.name='DicomReportError';this.code=code;}}
const LONG=new Set(['OB','OD','OF','OL','OV','OW','SQ','UC','UR','UT','UN']);
const VALID=new Set(['AE','AS','AT','CS','DA','DS','DT','FD','FL','IS','LO','LT','PN','SH','SL','SS','ST','SV','TM','UI','UL','US','UV',...LONG]);
const KEEP=new Set(['00020010','00080016','00280002','00280004','00280006','00280008','00280010','00280011','00280100','00280101','00280102','00280103','00420011','00420012','00420015','7fe00010']);
const EXPLICIT='1.2.840.10008.1.2.1',IMPLICIT='1.2.840.10008.1.2',JPEG='1.2.840.10008.1.2.4.50';
function parse(input,limits={}){
 const b=input instanceof Uint8Array?input:new Uint8Array(input),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 const fail=(c,m)=>{throw new DicomError(c,m);};
 const bounds=(p,n)=>{if(p<0||n<0||!Number.isSafeInteger(p+n)||p+n>b.length)fail('dicom-truncated','DICOM report is truncated or has invalid element lengths.');};
 bounds(0,132);if(String.fromCharCode(...b.subarray(128,132))!=='DICM')fail('dicom-preamble','Raw/non-Part-10 DICOM needs an explicit export format; no transfer syntax was guessed.');
 const tagAt=p=>{bounds(p,4);return v.getUint16(p,true).toString(16).padStart(4,'0')+v.getUint16(p+2,true).toString(16).padStart(4,'0');};
 let count=0;
 function header(p,explicit){bounds(p,8);if(++count>30000)fail('dicom-limit','DICOM element-count limit reached.');const tag=tagAt(p);let len,off,vr='';
  if(tag.startsWith('fffe')){len=v.getUint32(p+4,true);off=p+8;}
  else if(explicit){vr=String.fromCharCode(b[p+4],b[p+5]);if(!VALID.has(vr))fail('dicom-vr','Unsupported or malformed DICOM value representation.');if(LONG.has(vr)){bounds(p,12);len=v.getUint32(p+8,true);off=p+12;}else{len=v.getUint16(p+6,true);off=p+8;}}
  else{len=v.getUint32(p+4,true);off=p+8;}
  if(len!==0xffffffff)bounds(off,len);return {tag,len,off,vr};
 }
 function skipUndefined(p,explicit,depth){if(depth>24)fail('dicom-limit','DICOM nesting limit reached.');while(p<b.length){const h=header(p,explicit);if(h.tag==='fffee00d'||h.tag==='fffee0dd'){if(h.len!==0)fail('dicom-malformed','Invalid DICOM delimiter.');return h.off;}p=h.len===0xffffffff?skipUndefined(h.off,explicit,depth+1):h.off+h.len;}fail('dicom-truncated','DICOM sequence is incomplete.');}
 const fields=Object.create(null);let p=132;
 while(p<b.length&&tagAt(p).startsWith('0002')){const h=header(p,true);if(h.len===0xffffffff)fail('dicom-malformed','Invalid DICOM file metadata.');if(KEEP.has(h.tag))fields[h.tag]=h;p=h.off+h.len;}
 function str(tag){const h=fields[tag];if(!h)return '';return new TextDecoder('ascii').decode(b.subarray(h.off,h.off+h.len)).replace(/[\0 ]+$/g,'').trim();}
 function us(tag,def=0){const h=fields[tag];if(!h)return def;if(h.len!==2)fail('dicom-malformed','Invalid DICOM image attribute.');return v.getUint16(h.off,true);}
 const ts=str('00020010');if(![EXPLICIT,IMPLICIT,JPEG].includes(ts))fail('dicom-transfer-syntax',ts.includes('.4.9')?'DICOM JPEG 2000 is detected but not decoded by this release. Export a JPEG/PNG/PDF report; do not rename the DICOM file.':'This DICOM transfer syntax is not supported. Export a JPEG/PNG/PDF report; do not rename the DICOM file.');
 let fragments=null,bot=null;
 while(p<b.length){const h=header(p,ts!==IMPLICIT);if(KEEP.has(h.tag))fields[h.tag]=h;
  if(h.tag==='7fe00010'&&h.len===0xffffffff){let q=h.off,items=[],closed=false;while(q<b.length){const t=header(q,false);if(t.tag==='fffee0dd'){if(t.len!==0)fail('dicom-malformed','Invalid pixel delimiter.');q=t.off;closed=true;break;}if(t.tag!=='fffee000'||t.len===0xffffffff)fail('dicom-malformed','Invalid encapsulated pixel fragment.');items.push({itemOffset:q,data:b.subarray(t.off,t.off+t.len)});q=t.off+t.len;if(items.length>512)fail('dicom-limit','Too many DICOM fragments.');}if(!closed)fail('dicom-truncated','Encapsulated DICOM pixel delimiter is missing.');if(!items.length)fail('dicom-pixels','No encapsulated pixels.');bot=items[0].data;fragments=items.slice(1);p=q;}
  else p=h.len===0xffffffff?skipUndefined(h.off,ts!==IMPLICIT,0):h.off+h.len;
 }
 if(fields['00420011']){const h=fields['00420011'];if(str('00420012')!=='application/pdf'||h.len===0xffffffff)fail('dicom-document','Encapsulated DICOM document is not a supported PDF report.');return {kind:'pdf',bytes:b.slice(h.off,h.off+h.len)};}
 const rows=us('00280010'),cols=us('00280011'),frames=Number(str('00280008')||1),spp=us('00280002',1),bits=us('00280100'),stored=us('00280101',bits),signed=us('00280103'),photo=str('00280004'),planar=us('00280006',0);
 if(!rows||!cols||rows*cols>(limits.maxPixels||16000000)||!Number.isInteger(frames)||frames<1||frames>(limits.maxPages||120)||rows*cols*frames>160000000)fail('dicom-limit','DICOM image dimensions or frame count exceed the report limits.');
 const pixels=fields['7fe00010'];if(!pixels)fail('dicom-no-pixels','This DICOM object contains no displayable report pixels or encapsulated PDF.');
 function joined(fs){const size=fs.reduce((s,f)=>s+f.data.length,0),out=new Uint8Array(size);let k=0;for(const f of fs){out.set(f.data,k);k+=f.data.length;}return out;}
 if(ts===JPEG){if(!fragments?.length||bits!==8)fail('dicom-jpeg','JPEG Baseline pixel data is missing or has unsupported precision.');let images=[];
  if(bot.length){if(bot.length!==frames*4)fail('dicom-frame-boundary','DICOM frame offset table does not match the declared frame count.');const offsets=new DataView(bot.buffer,bot.byteOffset,bot.byteLength),origin=fragments[0].itemOffset;
   const starts=Array.from({length:frames},(_,i)=>offsets.getUint32(i*4,true));if(starts[0]!==0||starts.some((n,i)=>i&&n<=starts[i-1])||starts.some(n=>!fragments.some(f=>f.itemOffset-origin===n)))fail('dicom-frame-boundary','DICOM frame boundaries are invalid.');
   images=starts.map((start,i)=>joined(fragments.filter(f=>f.itemOffset-origin>=start&&(i+1===frames||f.itemOffset-origin<starts[i+1]))));
  }else if(frames===1)images=[joined(fragments)];else if(fragments.length===frames)images=fragments.map(f=>f.data);else fail('dicom-frame-boundary','Multi-frame DICOM has ambiguous JPEG boundaries. No frames were guessed.');
  for(const x of images)if(x.length<4||x[0]!==255||x[1]!==216)fail('dicom-jpeg','Invalid JPEG report frame.');return {kind:'jpeg',images,rows,cols};
 }
 if(bits!==8||stored!==8||us('00280102',7)!==7||signed!==0||!['RGB','MONOCHROME1','MONOCHROME2'].includes(photo)||(photo==='RGB'?spp!==3:spp!==1)||![0,1].includes(planar))fail('dicom-pixel-format','DICOM pixels use an unsupported bit depth or color encoding. This report adapter does not rescale diagnostic or OCT pixels. Export report images/PDF instead.');
 const size=rows*cols*spp;if(pixels.len!==frames*size&&pixels.len!==frames*size+(frames*size%2))fail('dicom-pixels','DICOM pixel length does not match its image attributes.');
 return {kind:'native',rows,cols,frames,spp,photo,planar,bytes:b.subarray(pixels.off,pixels.off+frames*size)};
}
function rgbaFrame(d,index){if(d.kind!=='native'||!Number.isInteger(index)||index<0||index>=d.frames)throw new DicomError('dicom-frame','Invalid frame.');const n=d.rows*d.cols,o=index*n*d.spp,out=new Uint8ClampedArray(n*4);for(let i=0;i<n;i++){const p=i*4;if(d.spp===1){const g=d.photo==='MONOCHROME1'?255-d.bytes[o+i]:d.bytes[o+i];out[p]=out[p+1]=out[p+2]=g;}else for(let c=0;c<3;c++)out[p+c]=d.bytes[o+(d.planar?c*n+i:i*3+c)];out[p+3]=255;}return out;}
return Object.freeze({parse,rgbaFrame,DicomError});});
