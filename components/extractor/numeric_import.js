/* Numeric-only import boundary. No raw file, image, filename, dates or free text is returned. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NKPIImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FIELDS = Object.freeze(['A', 'B', 'C', 'Kmax', 'BAD_D', 'ARTmax']);
  const EYES = Object.freeze(['OD', 'OS']);
  function number(value, label, positive = false) {
    if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`${label}: enter a number.`);
    if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) throw new Error(`${label}: enter a number.`);
    const result = Number(value);
    if (!Number.isFinite(result) || (positive && result <= 0)) throw new Error(`${label}: enter a finite ${positive ? 'positive ' : ''}number.`);
    return result;
  }
  function measurements(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: measurements are missing.`);
    return Object.fromEntries(FIELDS.map(field => [field, number(value[field], `${label} ${field}`, field !== 'BAD_D')]));
  }
  function eyes(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: eye measurements are missing.`);
    const keys = Object.keys(value);
    if (!keys.length || keys.some(eye => !EYES.includes(eye))) throw new Error(`${label}: use OD and/or OS.`);
    return Object.fromEntries(keys.map(eye => [eye, measurements(value[eye], `${label} ${eye}`)]));
  }
  function sanitize(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Import must be a JSON object.');
    if (value.nkpi_import_version !== undefined && value.nkpi_import_version !== '1.0') throw new Error('Unsupported numeric import version.');
    const age = number(value.age, 'Age', true);
    if (age > 120) throw new Error('Age must be 120 years or less.');
    const result = {nkpi_import_version: '1.0', mode: value.mode, age};
    if (value.mode === 'baseline') result.eyes = eyes(value.eyes, 'Current scan');
    else if (value.mode === 'longitudinal') {
      result.baseline = eyes(value.baseline, 'Earlier scan');
      result.followup = eyes(value.followup, 'Later scan');
      const keys = Object.keys(result.baseline);
      if (keys.sort().join() !== Object.keys(result.followup).sort().join()) throw new Error('Each eye needs both an earlier and a later scan.');
      result.interval_days_by_eye = Object.fromEntries(keys.map(eye => {
        const days = number(value.interval_days_by_eye?.[eye] ?? value.interval_days, `${eye} interval`, true);
        if (!Number.isInteger(days)) throw new Error(`${eye} interval: use whole days.`);
        return [eye, days];
      }));
      // Compatibility field only. Consumers MUST prefer interval_days_by_eye[eye].
      result.interval_days = result.interval_days_by_eye[keys[0]];
    } else throw new Error('Analysis mode must be baseline or longitudinal.');
    // An allowlist keeps acquisition flags and verified geometry separate from identity data.
    result.display_by_eye = {};
    const included = Object.keys(result.eyes || result.baseline);
    for (const eye of included) {
      const m = value.display_by_eye?.[eye] || {};
      const q = v => ['ok','warning','unknown'].includes(v) ? v : 'unknown';
      const clean = {first_quality:q(m.first_quality), latest_quality:q(m.latest_quality)};
      const l = m.landmarks;
      if (l && l.verified === true) {
        const coords = {};
        for (const key of ['thin_x','thin_y','kmax_x','kmax_y']) {
          coords[key] = number(l[key], `${eye} ${key}`);
          if (Math.abs(coords[key]) > 6) throw new Error(`${eye}: coordinates must be between −6 and +6 mm.`);
        }
        clean.landmarks = {...coords, verified:true};
      }
      if(value.mode==='longitudinal' && m.history!=null && !Array.isArray(m.history))throw new Error('Additional history must be an array of verified scans.');
      if(value.mode==='longitudinal' && Array.isArray(m.history)) {
        if(m.history.length>40)throw new Error('Too many additional scans.');
        clean.history=m.history.map(row=>{
          if(row?.eye!==eye||row.verified!==true||row.quality!=='ok')throw new Error('Additional scan is not verified for this eye.');
          const day=number(row.day,'Additional scan day');
          if(!Number.isInteger(day)||day<0||day>result.interval_days_by_eye[eye])throw new Error('Additional scan lies outside the selected interval.');
          return {eye,day,quality:'ok',verified:true,values:measurements(row.values,'Additional scan')};
        });
      }
      result.display_by_eye[eye] = clean;
    }
    return result;
  }
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', quoted = false;
    const raw = String(text).replace(/^\uFEFF/, '');
    for (let index = 0; index <= raw.length; index++) {
      const char = raw[index];
      if (quoted) {
        if (char === '"' && raw[index + 1] === '"') {cell += '"'; index++;}
        else if (char === '"') quoted = false;
        else if (char === undefined) throw new Error('CSV has an unclosed quotation mark.');
        else cell += char;
      } else if (char === '"') {
        if (cell.trim()) throw new Error('CSV quotation marks must begin a field.');
        quoted = true;
      } else if (char === ',' || char === '\n' || char === '\r' || char === undefined) {
        row.push(cell.trim()); cell = '';
        if (char !== ',') {
          if (row.some(Boolean)) rows.push(row);
          row = [];
          if (char === '\r' && raw[index + 1] === '\n') index++;
        }
      } else cell += char;
    }
    if (rows.length < 2 || rows.length > 5) throw new Error('CSV needs a header and one to four eye/visit rows.');
    const headers = rows.shift();
    const allowed = new Set(['mode','eye','visit','age','interval_days', ...FIELDS]);
    if (new Set(headers).size !== headers.length || headers.some(key => !allowed.has(key))) throw new Error('Use the supplied numeric CSV template; duplicate or unknown columns are not accepted.');
    for (const required of ['eye', 'age', ...FIELDS]) if (!headers.includes(required)) throw new Error(`CSV column ${required} is required.`);
    const records = rows.map((cells, index) => {
      if (cells.length !== headers.length) throw new Error(`CSV row ${index + 2} has the wrong number of fields.`);
      return Object.fromEntries(headers.map((key, j) => [key, cells[j]]));
    });
    const mode = records[0].mode || (records.some(row => row.visit === 'followup') ? 'longitudinal' : 'baseline');
    const age = number(records[0].age, 'Age', true);
    const payload = {mode, age, eyes: {}, baseline: {}, followup: {}, interval_days_by_eye: {}};
    records.forEach((record, index) => {
      const label = `CSV row ${index + 2}`;
      if ((record.mode && record.mode !== mode) || number(record.age, `${label} age`, true) !== age) throw new Error('CSV rows must describe one case with the same age and analysis mode.');
      if (!EYES.includes(record.eye)) throw new Error(`${label}: eye must be OD or OS.`);
      const visit = record.visit || 'baseline';
      if (!['baseline', 'followup'].includes(visit)) throw new Error(`${label}: visit must be baseline or followup.`);
      if (mode === 'baseline' && visit !== 'baseline') throw new Error('Single-scan CSV rows must use baseline as visit.');
      const target = mode === 'baseline' ? payload.eyes : payload[visit];
      if (target[record.eye]) throw new Error(`${label}: duplicate ${record.eye} ${visit} row.`);
      target[record.eye] = measurements(record, label);
      if (mode === 'longitudinal' && record.interval_days !== '') {
        const days = number(record.interval_days, `${label} interval`, true);
        if (payload.interval_days_by_eye[record.eye] !== undefined && payload.interval_days_by_eye[record.eye] !== days) throw new Error(`${record.eye}: interval differs between CSV rows.`);
        payload.interval_days_by_eye[record.eye] = days;
      }
    });
    return sanitize(payload);
  }
  function parse(text, format) {
    if (typeof text !== 'string' || text.length > 1000000) throw new Error('Choose a small numeric JSON or CSV file (under 1 MB).');
    return format === 'csv' ? parseCSV(text) : sanitize(JSON.parse(text));
  }
  return {FIELDS, EYES, number, measurements, sanitize, parseCSV, parse};
});
