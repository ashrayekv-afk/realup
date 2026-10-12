/* Original report-page previews: browser-only, separate from numeric inference.
 * Never derive a surface, a measurement, or a map type from report colors.
 * Only pages belonging to an importer-associated study are made available.
 */
'use strict';
const REPORT_LABELS = Object.freeze({
  topometric: 'Curvature / Topometric & KC-Staging',
  belin: 'Elevation & thickness / Belin-Ambrósio',
  progression: 'ABCD Progression Display'
});
let reportGeneration = 0, reportPublishTimer = null;
function reportPost(maps = [], notice = '') {
  window.parent.postMessage({type:'nkpi:extractor:maps',
    session:lastStreamlitResetToken, maps, notice}, window.location.origin);
}
function selectedReportSets() {
  const paired = state.mode === 'longitudinal', sets = [];
  for (const [visitKey, visit, studies] of paired ?
    [['earlier','first',state.earlierStudies],['later','latest',state.laterStudies]] :
    [['baseline','first',state.baselineStudies]]) {
    const groups = groupByEye(studies);
    for (const eye of ['OD','OS']) {
      if (!groups[eye]?.length) continue;
      const study = selectedStudy(groups, eye, visitKey);
      if (!study || study.eye !== eye) continue;
      // A report's eye label still requires the operator's source check in step 3.
      let pages = study.reportPages;
      if (!Array.isArray(pages)) pages = Object.entries(REPORT_LABELS)
        .filter(([kind]) => study.sourcePages?.[kind])
        .map(([kind,label]) => ({id:kind,kind,label,url:study.sourcePages[kind]}));
      if (!pages.length) continue;
      study.mapStudyId ||= crypto.randomUUID ? crypto.randomUUID() : 'source-'+Math.random().toString(16).slice(2);
      const candidate=study.numericalSurface;
      const matched=candidate?.data?.eye===eye&&candidate?.data?.visit===visit;
      sets.push({eye, visit, source_id:study.mapStudyId, pages,
        surface:matched?candidate.data:null,
        surface_notice:candidate?(matched?candidate.notice:(candidate.data?'Numerical visit does not match this selected slot; reference geometry is shown.':candidate.notice)):'', 
        note:study.reportMapNotice || 'Selected study. Check the printed eye, visit and map titles against the source; no page colors are converted to geometry.'});
    }
  }
  return sets;
}
function publishSourceReportMaps() {
  reportPost(selectedReportSets());
}
function scheduleSourceReportMaps() {
  clearTimeout(reportPublishTimer);
  const generation = reportGeneration;
  reportPublishTimer = setTimeout(() => {
    if (generation === reportGeneration) publishSourceReportMaps();
  }, 0);
}
window.publishSourceReportMaps = publishSourceReportMaps;

const mapsExtractStudy = extractStudy;
extractStudy = async function(descriptor, worker) {
  const generation = reportGeneration;
  const study = await mapsExtractStudy(descriptor, worker);
  if (generation !== reportGeneration) return study;
  return attachAssociatedReportPages(descriptor, study, generation, worker);
};
async function attachAssociatedReportPages(descriptor, study, generation = reportGeneration, worker = null) {
  const original = Object.entries(descriptor.pages).filter(([,name]) => name);
  // Current PdfReport and legacy filename groups explicitly supply same-study
  // pages. For generic anonymized reports use only associated primary pages;
  // never guess that a neighboring image belongs to this eye.
  const filenames = [...new Set([...(descriptor.viewerPages || []), ...original.map(([,name]) => name)])];
  const pages = [], notices = [];
  const cap = 48, maxImage = 18*1024*1024, maxStudy = 96*1024*1024;
  let bytes = 0;
  for (let index=0; index<filenames.length; index++) {
    if (generation !== reportGeneration) return study;
    if (pages.length >= cap) {notices.push('Viewer limited to the first 48 associated report pages.');break;}
    const filename = filenames[index];
    if (!isSupportedReportImage(filename)) continue;
    const kind = original.find(([,name]) => name===filename)?.[0] || 'report';
    const suffix = reportFilenameParts(filename)?.suffix;
    const label = REPORT_LABELS[kind] || (suffix ? 'Report page '+suffix.slice(1)+' · check printed title' : 'Additional report page '+(index+1)+' · check printed title');
    let url = study.sourcePages?.[kind];
    if (!url) {
      try {
        const entry = descriptor.zip.file(filename);
        if (!entry) throw new Error('Missing report entry');
        if ((entry._data?.uncompressedSize || 0)>maxImage) throw new Error('Image size limit');
        const blob = await entry.async('blob');
        if (generation !== reportGeneration) return study;
        if (blob.size>maxImage || bytes+blob.size>maxStudy) throw new Error('Image size limit');
        bytes += blob.size;
        url = registerPreviewUrl(blob);
      } catch (_) {notices.push('An additional report image could not be loaded or exceeded the viewer size limit.');continue;}
    }
    let map_regions=[];
    // Identify source-map roles once during import. Reuse this metadata for
    // instant named-button switching; no report title text leaves this frame.
    if(kind!=='progression')try{
      const loaded=await ReportTexture.load(url);
      if(generation!==reportGeneration)return study;
      const regions=ReportTexture.describe(loaded,kind);
      for(const region of regions){
        if(region.role||!worker)continue;
        if(generation!==reportGeneration)return study;
        state.ocrJobsEstimated+=1;
        const result=await recognize(worker,ReportTexture.caption(loaded.image,region,regions),{psm:6});
        if(generation!==reportGeneration)return study;
        const role=ReportTexture.titleRole(result.text,result.confidence);
        if(role)Object.assign(region,{role,identity:'printed-title'});
      }
      map_regions=ReportTexture.sanitizeHints(regions.filter(r=>r.role));
    }catch(_){/* Known layouts can still be identified by the viewer locally. */}
    if(generation!==reportGeneration)return study;
    pages.push({id:'page-'+(index+1),kind,label,url,map_regions});
  }
  study.reportPages = pages;
  study.reportMapNotice = [...new Set(notices)].join(' ') ||
    (descriptor.viewerPages ? 'Original pages from this selected study. Generic page labels are not an automatic map classification; use the printed titles and legends.' :
      'Only the importer-associated source pages are shown. Additional anonymized pages are not assigned to an eye by guessing.');
  return study;
}

const mapsReset = resetResultsOnly;
resetResultsOnly = function() {
  reportGeneration++;
  clearTimeout(reportPublishTimer);
  reportPost([], 'Report previews cleared. Import and select the current source studies.');
  return mapsReset();
};
const mapsInvalidate = invalidateVerifiedPayload;
invalidateVerifiedPayload = function() {
  const result = mapsInvalidate();
  scheduleSourceReportMaps();
  return result;
};
const mapsRenderReview = renderReview;
renderReview = function() {
  const result = mapsRenderReview();
  publishSourceReportMaps();
  return result;
};
window.addEventListener('pagehide', () => {clearTimeout(reportPublishTimer);reportPost([]);});
