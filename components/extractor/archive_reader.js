/* Browser-local report discovery. File content, not just a filename extension,
 * determines how a report is opened. Never uploads bytes or extracts anatomy.
 * All nonstandard page/eye associations require explicit review by the operator.
 */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.NKPIArchiveReader=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';
const MB=1024*1024;
const LIMITS=Object.freeze({inputBytes:150*MB,expandedBytes:500*MB,entryBytes:80*MB,renderedBytes:200*MB,entries:500,pages:120,depth:3,pixels:16000000});
const PDF_BASE='https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/';
class ImportError extends Error{constructor(code,message){super(message);this.name='ReportImportError';this.code=code;}}
function fail(code,msg){throw new ImportError(code,msg);}
function cleanPath(name){const p=String(name).replace(/\\/g,'/').replace(/\s+$/,'');if(!p||p.length>2048||p.includes('\0')||p.startsWith('/')||/^[a-z]:/i.test(p)||p.split('/').some(s=>s==='..'||s==='__proto__'))fail('unsafe-path','Archive has unsafe or ambiguous entry paths.');return p;}
function ignored(name){return name.split('/').some(s=>s==='__MACOSX'||s.startsWith('._'))||/(^|\/)(\.DS_Store|Thumbs\.db)$/i.test(name);}
function ascii(b,p,n){return String.fromCharCode(...b.subarray(p,p+n));}
function sniff(bytes,name=''){
 const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 if(b.length>=4&&b[0]===0x50&&b[1]===0x4b&&[3,5,7].includes(b[2])&&[4,6,8].includes(b[3]))return 'ZIP';
 if(b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255)return 'JPEG';
 if(b.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))return 'PNG';
 if(b.length>=132&&ascii(b,128,4)==='DICM')return 'DICOM';
 if(ascii(b,0,Math.min(1024,b.length)).includes('%PDF-'))return 'PDF';
 if(b.length>=4&&((b[0]===73&&b[1]===73&&b[2]===42&&b[3]===0)||(b[0]===77&&b[1]===77&&b[2]===0&&b[3]===42)))return 'TIFF';
 if(b.length>=4&&((b[0]===73&&b[1]===73&&b[2]===43)||(b[0]===77&&b[1]===77&&b[3]===43)))return 'BIGTIFF';
 if(b.length>=12&&ascii(b,0,4)==='RIFF'&&ascii(b,8,4)==='WEBP')return 'WEBP';
 if(b.length>=26&&b[0]===66&&b[1]===77)return 'BMP';
 // Declared but unrecognized report formats must not silently become "no images".
 if(/\.(dcm|dicom|ima)$/i.test(name))return 'DICOM_RAW';
 if(/\.pdf$/i.test(name))return 'BROKEN_PDF';
 if(/\.(tif|tiff)$/i.test(name))return 'BROKEN_TIFF';
 if(/\.(jpe?g|jfif|jpe|png|bmp|webp)$/i.test(name))return 'BROKEN_IMAGE';
 if(/\.zip$/i.test(name))return 'BROKEN_ZIP';
 if(/\.json$/i.test(name))return 'JSON';
 return 'OTHER';
}
function increment(obj,k){obj[k]=(obj[k]||0)+1;}
function diagnostics(){return {schema:'nkpi-import-diagnostic-1',counts:{},pages:0,nested_archives:0,ignored_entries:0,issues:{}};}
function summarize(d){const types=Object.entries(d.counts).filter(([k])=>!['JSON','OTHER'].includes(k)).map(([k,n])=>`${n} ${k}`).join(', ');return `${types||'No supported report formats detected'}; ${d.pages} readable report page${d.pages===1?'':'s'}.`;}
function safeDiagnostics(d){return JSON.parse(JSON.stringify({schema:d.schema,counts:d.counts,pages:d.pages,nested_archives:d.nested_archives,ignored_entries:d.ignored_entries,issues:d.issues}));}
function renamed(name,ext){return name.replace(/\.(jpe?g|jpe|jfif|png|bmp|webp|bin|dat|dcm|dicom|ima)$/i,'')+'.'+ext;}
function blobEntry(name,blob){return {name,dir:false,_data:{uncompressedSize:blob.size},async:async(type)=>{if(type==='blob')return blob;if(type==='string')return blob.text();const a=new Uint8Array(await blob.arrayBuffer());if(type==='uint8array')return a;if(type==='arraybuffer')return a.buffer;fail('internal-type','Unsupported byte representation.');}};}
async function canvasBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new ImportError('render-failed','Could not render the report page.')),'image/png'));}
async function imageSize(blob,maxPixels=LIMITS.pixels){if(!root.createImageBitmap)return;const bm=await root.createImageBitmap(blob);try{if(!bm.width||!bm.height||bm.width*bm.height>maxPixels)fail('image-limit','Report image dimensions exceed the safety limit.');return {width:bm.width,height:bm.height};}finally{bm.close?.();}}
let pdfPromise=null,utifPromise=null;
async function pdfLibrary(){if(!pdfPromise)pdfPromise=import(PDF_BASE+'pdf.mjs').then(lib=>{lib.GlobalWorkerOptions.workerSrc=PDF_BASE+'pdf.worker.mjs';return lib;}).catch(()=>{pdfPromise=null;fail('pdf-library-unavailable','PDF report detected, but the browser could not load its PDF renderer. Allow the pinned PDF.js assets or export JPEG/PNG reports from the imaging viewer.');});return pdfPromise;}
function loadScript(url){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.onload=resolve;s.onerror=()=>{s.remove();reject(new ImportError('tiff-library-unavailable','TIFF report detected, but its browser decoder could not be loaded. Export JPEG/PNG/PDF reports or allow the pinned TIFF decoder.'));};document.head.append(s);});}
async function tiffLibrary(){if(!utifPromise)utifPromise=(async()=>{if(!root.pako)await loadScript('https://cdn.jsdelivr.net/npm/pako@1.0.11/dist/pako.min.js');if(!root.UTIF)await loadScript('https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js');if(!root.UTIF?.decode)fail('tiff-library-unavailable','TIFF decoder did not initialize.');return root.UTIF;})().catch(e=>{utifPromise=null;throw e;});return utifPromise;}
async function renderPDF(bytes,ctx){const pdf=await pdfLibrary();let task,doc;try{
 task=pdf.getDocument({data:bytes.slice(),isEvalSupported:false,useSystemFonts:true,useWasm:false,isOffscreenCanvasSupported:false,disableAutoFetch:true,stopAtErrors:true,maxImageSize:ctx.limits.pixels});
 task.onPassword=()=>task.destroy();doc=await task.promise;ctx.alive();
 if(doc.numPages>ctx.remaining())fail('page-limit','PDF has more report pages than this session allows. Export just the required Pentacam examination.');
 const out=[];
 for(let n=1;n<=doc.numPages;n++){ctx.alive();const page=await doc.getPage(n),view=page.getViewport({scale:1}),scale=Math.min(2400/Math.max(view.width,view.height),Math.sqrt(ctx.limits.pixels/(view.width*view.height)));if(!Number.isFinite(scale)||scale<=0)fail('pdf-page-size','PDF page size is invalid.');const vp=page.getViewport({scale});const c=document.createElement('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);if(c.width*c.height>ctx.limits.pixels)fail('image-limit','PDF page exceeds the pixel limit.');await page.render({canvasContext:c.getContext('2d'),viewport:vp,background:'rgb(255,255,255)'}).promise;ctx.alive();const blob=await canvasBlob(c);out.push({blob,page:n});page.cleanup();c.width=c.height=1;}
 return out;
 }catch(e){if(e instanceof ImportError)throw e;fail('pdf-render-failed','PDF was detected but could not be rendered (damaged, encrypted, unsupported, or renderer blocked). No measurements were substituted.');}finally{if(doc)await doc.destroy();else if(task)await task.destroy().catch(()=>{});}}
async function renderTIFF(bytes,ctx){const lib=await tiffLibrary(),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),ifds=lib.decode(buffer),out=[];if(ifds.length>ctx.remaining())fail('page-limit','Too many TIFF report pages.');for(const [i,ifd] of ifds.entries()){ctx.alive();const w=Number(ifd.t256?.[0]),h=Number(ifd.t257?.[0]),orientation=Number(ifd.t274?.[0]||1);if(!w||!h||w*h>ctx.limits.pixels)fail('image-limit','TIFF dimensions exceed the safety limit.');if(orientation!==1)fail('tiff-orientation','TIFF orientation needs conversion to JPEG/PNG before source review; no eye orientation was guessed.');lib.decodeImage(buffer,ifd);const data=lib.toRGBA8(ifd);if(data.length!==w*h*4)fail('tiff-render-failed','TIFF pixel dimensions are inconsistent.');const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data),w,h),0,0);out.push({blob:await canvasBlob(c),page:i+1});ifd.data=null;c.width=c.height=1;}return out;}
async function renderDICOM(bytes,ctx){if(!root.NKPIDicomReports)fail('dicom-decoder-missing','DICOM report adapter is missing from this app installation. Restore the complete release.');const d=root.NKPIDicomReports.parse(bytes,{maxPixels:ctx.limits.pixels,maxPages:ctx.remaining()});if(d.kind==='pdf')return renderPDF(d.bytes,ctx);if(d.kind==='jpeg'){const out=[];for(const [i,b] of d.images.entries()){ctx.alive();const blob=new Blob([b],{type:'image/jpeg'});const dims=await imageSize(blob,ctx.limits.pixels);if(dims&&(dims.width!==d.cols||dims.height!==d.rows))fail('dicom-dimensions','DICOM JPEG dimensions disagree with the declared report size.');out.push({blob,page:i+1,ext:'jpg'});}return out;}const out=[];for(let i=0;i<d.frames;i++){ctx.alive();const c=document.createElement('canvas');c.width=d.cols;c.height=d.rows;c.getContext('2d').putImageData(new ImageData(root.NKPIDicomReports.rgbaFrame(d,i),d.cols,d.rows),0,0);out.push({blob:await canvasBlob(c),page:i+1});c.width=c.height=1;}return out;}
// Stream each entry with a strict actual-byte cap, rather than trusting ZIP headers.
async function readBounded(entry,max){if((entry._data?.uncompressedSize||0)>max)fail('entry-limit','An archive entry exceeds the import safety limit.');if(typeof entry.internalStream!=='function'){const b=await entry.async('uint8array');if(b.length>max)fail('entry-limit','Expanded archive entry exceeds the safety limit.');return b;}
 return new Promise((resolve,reject)=>{const chunks=[];let size=0,stopped=false;const stream=entry.internalStream('uint8array');stream.on('data',c=>{if(stopped)return;size+=c.length;if(size>max){stopped=true;stream.pause();reject(new ImportError('entry-limit','Expanded archive entry exceeds the safety limit.'));return;}chunks.push(c);}).on('error',()=>{if(!stopped){stopped=true;reject(new ImportError('zip-entry-unreadable','An archive entry is damaged, encrypted, or unsupported.'));}}).on('end',()=>{if(stopped)return;const result=new Uint8Array(size);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}resolve(result);}).resume();});}
async function open(file,options={}){
 const limits={...LIMITS,...options.limits},diag=diagnostics(),out=Object.create(null),pages=[],meta=Object.create(null);let expanded=0,rendered=0,entries=0;
 const alive=()=>{if(options.cancelled?.())fail('cancelled','Import cancelled because the selected source changed.');};
 const ctx={limits,alive,remaining:()=>limits.pages-pages.length};
 const Zip=options.JSZip||root.JSZip;if(!Zip)fail('zip-library-unavailable','ZIP reader did not load. Restore this release including the vendor folder.');
 if(!file||file.size>limits.inputBytes)fail('input-limit','Use a scan export under 150 MB.');
 async function put(name,blob,info){alive();if(pages.length>=limits.pages)fail('page-limit','Too many rendered report pages. Export one examination only.');rendered+=blob.size;if(rendered>limits.renderedBytes)fail('render-limit','Rendered report data exceed the session safety limit.');if(Object.hasOwn(out,name))fail('duplicate-path','Two report entries share the same normalized path; no page was chosen arbitrarily.');out[name]=blobEntry(name,blob);pages.push(name);meta[name]=info;diag.pages=pages.length;options.onDiagnostic?.(safeDiagnostics(diag));}
 async function consume(b,name,depth){alive();const type=sniff(b,name);increment(diag.counts,type);
  if(type==='ZIP'){if(depth>=limits.depth)fail('nested-limit','Nested ZIP depth exceeds the import limit.');diag.nested_archives++;await archive(b,name+'!/',depth+1);return;}
  if(type==='JSON'){if(Object.hasOwn(out,name))fail('duplicate-path','Duplicate archive path.');out[name]=blobEntry(name,new Blob([b],{type:'application/json'}));return;}
  if(['JPEG','PNG','WEBP','BMP'].includes(type)){const ext={JPEG:'jpg',PNG:'png',WEBP:'webp',BMP:'bmp'}[type],mime={JPEG:'image/jpeg',PNG:'image/png',WEBP:'image/webp',BMP:'image/bmp'}[type];const blob=new Blob([b],{type:mime});try{await (options.imageSize||imageSize)(blob,limits.pixels);}catch(e){increment(diag.issues,e.code||'image-decode-failed');return;}await put(renamed(name,ext),blob,{original:name,format:type,page:1,converted:false});return;}
  if(['PDF','TIFF','DICOM'].includes(type)){try{const fn=options.decoders?.[type]||{PDF:renderPDF,TIFF:renderTIFF,DICOM:renderDICOM}[type],converted=await fn(b,ctx);if(!Array.isArray(converted)||!converted.length)fail('render-failed','No report pages decoded.');for(let i=0;i<converted.length;i++){const p=converted[i];await put(name+`/@page-${String(i+1).padStart(4,'0')}.${p.ext||'png'}`,p.blob,{original:name,format:type,page:p.page||i+1,converted:true});}}catch(e){if(['cancelled','page-limit','render-limit','entry-limit','duplicate-path'].includes(e.code))throw e;increment(diag.issues,e.code||`${type.toLowerCase()}-decode-failed`);}return;}
  if(type!=='OTHER')increment(diag.issues,type.toLowerCase().replace(/_/g,'-'));
 }
 async function archive(data,prefix='',depth=0){alive();let zip;try{zip=await Zip.loadAsync(data);}catch(_){fail('zip-open-failed','Archive is not a readable ZIP, or is damaged, encrypted, or split across files.');}
  for(const entry of Object.values(zip.files)){alive();if(entry.dir)continue;if(++entries>limits.entries)fail('entry-count-limit','Archive contains too many files. Select one examination, not a multi-patient archive.');const name=cleanPath(entry.unsafeOriginalName||entry.name);if(ignored(name)){diag.ignored_entries++;continue;}const rawSize=entry._data?.uncompressedSize;if(rawSize>limits.entryBytes||expanded+rawSize>limits.expandedBytes)fail('expanded-limit','Expanded ZIP exceeds the import safety limit.');const b=await readBounded(entry,Math.min(limits.entryBytes,limits.expandedBytes-expanded));expanded+=b.length;await consume(b,prefix+name,depth);options.onDiagnostic?.(safeDiagnostics(diag));}
 }
 const data=new Uint8Array(await file.arrayBuffer());alive();const type=sniff(data,file.name||'');
 if(type==='ZIP')await archive(data);else{if(data.length>limits.entryBytes)fail('entry-limit','Report exceeds the individual file safety limit.');await consume(data,cleanPath(file.name||'report'),0);}
 options.onDiagnostic?.(safeDiagnostics(diag));
 const virtual={files:out,file:name=>out[name]||null};
 return {zip:virtual,imageFiles:pages,metadata:meta,diagnostic:safeDiagnostics(diag)};
}
return Object.freeze({open,sniff,cleanPath,ignored,readBounded,safeDiagnostics,summarize,LIMITS,ImportError,renderPDF,renderTIFF,renderDICOM});
});
