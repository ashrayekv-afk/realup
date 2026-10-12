/* Local report association. Filename groups and printed eyes are evidence;
 * archive order, color, and the existence of a second scan are not laterality.
 * No source identity leaves this frame. */
'use strict';

function discoveryAlive(epoch) {
  if (epoch !== state.processEpoch) throw new NKPIArchiveReader.ImportError('cancelled', 'Source changed.');
}
function sourceScope(name) {
  const p = String(name).replace(/\\/g, '/');
  return p.slice(0, p.lastIndexOf('/') + 1);
}
function sourceIdentity(loaded, filename) {
  const original = loaded.metadata[filename]?.original || filename;
  const legacy = legacyFilenameParts(original);
  const current = reportFilenameParts(original);
  if (legacy) return {key: sourceScope(original) + legacy.studyKey, eye: legacy.eye,
    timestamp: legacy.timestamp, legacy: true};
  if (current) return {key: current.prefix, eye: null,
    timestamp: timestampFromPrefix(current.prefix), suffix: current.suffix};
  return {key: null, eye: null, timestamp: null};
}
function reportDescriptor(loaded, label, key, pages, identity = {}, viewerPages = null) {
  return {visitLabel: label, zip: loaded.zip, prefix: key,
    timestamp: identity.timestamp || null, forcedEye: identity.eye || null,
    sourceFormat: identity.legacy ? 'legacy-history-eye-filename' : 'automatic-report-association',
    pageResolution: identity.legacy ? 'Legacy eye/date filename and report titles' : 'Report titles and printed eye',
    viewerPages: viewerPages || Object.values(pages).filter(Boolean), pages,
    originalPages: Object.fromEntries(Object.entries(pages).filter(([, f]) => f)
      .map(([kind, f]) => [kind, loaded.metadata[f]?.original || f])),
    partial: !pages.topometric || !pages.belin};
}
// A fast-path group no longer fails just because another format or an extra
// unrecognized page exists in the same archive. Those pages get a separate pass.
function discoverNamedReports(loaded, label) {
  const groups = new Map(), descriptors = [], used = new Set();
  for (const f of loaded.imageFiles) {
    const id = sourceIdentity(loaded, f);
    if (!id.key || id.legacy || !id.suffix) continue;
    if (!groups.has(id.key)) groups.set(id.key, {id, files: [], bySuffix: new Map()});
    const g = groups.get(id.key); g.files.push(f);
    const list = g.bySuffix.get(id.suffix) || []; list.push(f); g.bySuffix.set(id.suffix, list);
  }
  for (const [key, g] of groups) {
    const one = suffix => g.bySuffix.get(suffix)?.length === 1 ? g.bySuffix.get(suffix)[0] : null;
    const pages = {topometric: one(REQUIRED_SUFFIXES.topometric), belin: one(REQUIRED_SUFFIXES.belin),
      progression: one(REQUIRED_SUFFIXES.progression)};
    if (!pages.topometric || !pages.belin) continue;
    descriptors.push(reportDescriptor(loaded, label, key, pages, g.id, g.files));
    g.files.forEach(f => used.add(f));
  }
  return {descriptors, remaining: loaded.imageFiles.filter(f => !used.has(f))};
}

async function identifyReportRecords(loaded, files, label, epoch, workers) {
  const records = [];
  for (const [index, filename] of files.entries()) {
    discoveryAlive(epoch);
    const original = loaded.metadata[filename]?.original || filename;
    const identity = sourceIdentity(loaded, filename);
    let pageType = identity.legacy ? legacyFilenamePageType(original) : null;
    let eye = identity.eye, conflict = false, bitmap = null;
    setProgress(18 + 22 * index / Math.max(1, files.length),
      `Identifying ${label} report ${index + 1} of ${files.length}…`,
      'Checking both eyes and retaining every recognized source study.');
    try {
      if (workers?.length && (!pageType || !eye)) {
        bitmap = await blobToBitmap(await loaded.zip.file(filename).async('blob'));
        const worker = workers[index % workers.length];
        const header = await recognizeHeader(worker, bitmap);
        discoveryAlive(epoch);
        pageType ||= classifyReportTitle(header.text);
        let printedEye = autoHeaderEye(header.text);
        // OD/OS often sits below the report header; the old route only searched
        // the title strip and silently lost that eye's pages.
        if (!printedEye && ['topometric', 'belin'].includes(pageType)) {
          const box = pageType === 'topometric' ? CROPS.TOPOMETRIC_EYE_VALUE : CROPS.BELIN_EYE_VALUE;
          const read = await recognizeLateralityRegion(worker, bitmap, box);
          printedEye = read.eye;
        }
        conflict = Boolean(eye && printedEye && eye !== printedEye);
        if (conflict) eye = null;
        else eye ||= printedEye;
      }
    } catch (e) { discoveryAlive(epoch); }
    finally { bitmap?.close?.(); }
    discoveryAlive(epoch);
    records.push({filename, index, pageType, eye, identity, conflict,
      scope: sourceScope(original)});
  }
  return records;
}

function associateReportRecords(loaded, records, label) {
  const descriptors = [], groups = new Map();
  for (const r of records) {
    // Named study boundaries take precedence over any order in the archive.
    // Anonymous reports must agree on printed eye and folder. Repeated same-eye
    // pages remain separate unless a unique pair can be established.
    const key = r.identity.key ? 'named:' + r.identity.key :
      r.eye ? 'eye:' + r.scope + ':' + r.eye : 'unknown:' + r.filename;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const [key, rows] of groups) {
    const types = kind => rows.filter(r => r.pageType === kind);
    const top = types('topometric'), belin = types('belin'), prog = types('progression');
    const eyes = [...new Set(rows.map(r => r.eye).filter(Boolean))];
    const identity = {...rows[0].identity, eye: eyes.length === 1 ? eyes[0] : null};
    const conflict = eyes.length > 1 || rows.some(r => r.conflict);
    if (!conflict && top.length <= 1 && belin.length <= 1 && (top.length || belin.length)) {
      const pages = {topometric: top[0]?.filename || null, belin: belin[0]?.filename || null,
        progression: prog.length === 1 ? prog[0].filename : null};
      const d = reportDescriptor(loaded, label, key, pages, identity, rows.map(r => r.filename));
      if (d.partial) d.associationNotice = 'One required report title was not identified. Available measurements and source pages are retained.';
      descriptors.push(d);
    } else if (top.length || belin.length) {
      // Never choose the nearest page across examinations; retain all candidates
      // for source review instead of discarding an eye or mixing two scans.
      for (const r of [...top, ...belin]) {
        const d = reportDescriptor(loaded, label, key + ':' + r.index,
          {topometric: null, belin: null, progression: null, [r.pageType]: r.filename},
          {...r.identity, eye: conflict ? null : r.eye}, [r.filename]);
        d.associationNotice = conflict ? 'Conflicting eye labels. Confirm the source eye and report pairing.' :
          'Multiple candidate reports for this eye. Match pages from the same examination.';
        descriptors.push(d);
      }
    } else if (identity.eye && identity.key) {
      // Legacy filename evidence still identifies the study even if title OCR
      // fails. Expose a six-field review card; do not assume the final pages.
      const d = reportDescriptor(loaded, label, key,
        {topometric: null, belin: null, progression: null}, identity, rows.map(r => r.filename));
      d.associationNotice = 'Eye and examination found in the filename; report titles need source review.';
      descriptors.push(d);
    }
  }
  return descriptors;
}

async function discoverAllReports(loaded, label, epoch, workers) {
  const named = discoverNamedReports(loaded, label);
  const records = await identifyReportRecords(loaded, named.remaining, label, epoch, workers);
  return [...named.descriptors, ...associateReportRecords(loaded, records, label)];
}

// If only one primary report is readable, keep its labeled measurements.
// Every partial result requires human source verification; missing values stay
// blank. No opposite-eye values or previous-patient values are substituted.
async function extractPartialReport(d, worker, epoch) {
  const study = await blankSourceStudy(d, d.associationNotice ||
    'Only part of this study was identified. Review the recovered inputs and match any missing report.');
  if (!worker) return study;
  async function read(kind, fn) {
    if (!d.pages[kind]) return;
    let bitmap;
    try {
      bitmap = await blobToBitmap(await d.zip.file(d.pages[kind]).async('blob'));
      await fn(bitmap);
    } catch (_) { discoveryAlive(epoch); }
    finally { bitmap?.close?.(); }
    discoveryAlive(epoch);
  }
  function keep(key, value, kind) {
    if (!Number.isFinite(value)) return;
    study.values[key] = value;
    study.audit[key] = {quality: 'Review', autoConfirmed: false,
      reason: 'Recovered from one report; verify against the source.', sources: {[kind]: value}};
  }
  await read('topometric', async bitmap => {
    const panel = await readTopometricAbcPanel(worker, bitmap);
    for (const key of ['A','B','C']) keep(key, panel.parsed?.[key], 'KC-Staging');
    if (!study.eye) study.eye = (await recognizeLateralityRegion(worker, bitmap, CROPS.TOPOMETRIC_EYE_VALUE)).eye;
    // Kmax is read only from the labeled/current layout source supported by
    // the existing engine, and remains explicitly unverified here.
    if (!d.sourceFormat.includes('legacy')) keep('Kmax',
      (await readGrayField(worker, bitmap, CROPS.KMAX_TOPOMETRIC, 'Kmax')).value, 'Topometric');
  });
  await read('belin', async bitmap => {
    const panel = await readBelinPanel(worker, bitmap);
    for (const key of ['C','Kmax','ARTmax']) keep(key, panel.parsed?.[key], 'Belin/Ambrósio');
    if (!study.eye) study.eye = panel.parsed?.eye ||
      (await recognizeLateralityRegion(worker, bitmap, CROPS.BELIN_EYE_VALUE)).eye;
    keep('BAD_D', (await readBadDResilient(worker, bitmap)).value, 'Belin/Ambrósio');
  });
  study.complete = studyComplete(study);
  return study;
}
