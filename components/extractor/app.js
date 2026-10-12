/*
 * NKPI Browser Pentacam Extractor — Version 3.4 Compact Results Transition
 *
 * Static, client-side application. Selected Continuum ZIPs are opened in browser
 * memory with JSZip. OCR is performed in browser Web Workers with Tesseract.js.
 * This code contains no patient-file upload endpoint.
 */

"use strict";

const APP_VERSION = "7.9.0-clean-review";
const REFERENCE_WIDTH = 1200;
const REFERENCE_HEIGHT = 902;

// Current Continuum PdfReport filenames use fixed page suffixes. Older history
// exports use eye/date/time filenames and a shorter six-page report set. Version
// 2.4 supports both formats without requiring users to rename or re-export files.
const REQUIRED_SUFFIXES = {
  topometric: "-0006",
  belin: "-0011",
  progression: "-0013",
};

// Exact fields validated against six eye-level Pentacam exports spanning mild,
// moderate, and severe keratoconus.
const CROPS = {
  // Topometric/KC-Staging
  // Primary A/B/C source: one labeled panel crop. Reading the labels and
  // values together prevents stage numbers from being mistaken for A or B.
  TOPOMETRIC_ABC_PANEL: [350, 475, 535, 690],
  A: [463, 533, 522, 562],
  B: [463, 566, 522, 596],
  C_STAGE: [463, 600, 527, 631],
  C_DUPLICATE: [135, 735, 220, 765],
  KMAX_TOPOMETRIC: [135, 765, 220, 798],

  // Narrow labeled rows. These are used only when the full ABC panel is
  // missing or conflicts with the printed ABC stage classification.
  A_LABELED_ROW: [342, 506, 538, 558],
  B_LABELED_ROW: [342, 545, 538, 600],
  C_LABELED_ROW: [342, 582, 538, 638],

  // Dynamic A/B/C field detection. Pentacam renders the raw ARC, PRC and C
  // values in a vertical stack of L-shaped entry boxes. Detecting those boxes
  // prevents the adjacent ABC stage numbers from being interpreted as raw
  // measurements and also supports shifted legacy layouts.
  TOPOMETRIC_ABC_SEARCH_CURRENT: [340, 420, 660, 700],
  TOPOMETRIC_ABC_SEARCH_BROAD: [180, 275, 790, 775],

  // Independent labeled PPImax row used for an ARTmax calculation fallback.
  PPI_MAX_LABELED_ROW: [720, 335, 875, 410],

  // Continuous KC-Staging bar geometry used as an independent baseline
  // consistency check for A and B. Bar position never substitutes for the
  // printed raw measurement.
  TOPOMETRIC_STAGE_A: [530, 524, 758, 563],
  TOPOMETRIC_STAGE_B: [530, 560, 758, 600],
  TOPOMETRIC_STAGE_C: [530, 596, 758, 638],
  TOPOMETRIC_STAGE_X0: 550,
  TOPOMETRIC_STAGE_X4: 755,

  // Small local verification crops. These remain inside browser memory and
  // appear only for fields that are not independently auto-confirmed.
  PREVIEW_A: [330, 500, 545, 565],
  PREVIEW_B: [330, 540, 545, 605],
  PREVIEW_C: [330, 578, 545, 642],
  PREVIEW_KMAX: [120, 742, 235, 807],
  PREVIEW_BAD_D: [610, 835, 1195, 902],
  PREVIEW_ARTMAX: [720, 330, 875, 425],

  // Broad, label-containing verification panels for legacy/history reports.
  // Legacy report geometry differs from current PdfReport exports, so narrow
  // current-layout crops are intentionally not reused.
  LEGACY_PREVIEW_ABC_PANEL: [235, 350, 650, 665],
  LEGACY_PREVIEW_KMAX_PANEL: [20, 480, 350, 855],
  LEGACY_PREVIEW_BAD_D_ROW: [430, 705, 1195, 902],
  LEGACY_PREVIEW_ARTMAX_PANEL: [500, 120, 930, 500],

  // ABCD Progression Display. The most recent table row contains the printed
  // ABC stage classification plus independent BAD-D, ARTmax, and Kmax values.
  PROGRESSION_TABLE: [78, 750, 1188, 900],
  PROGRESSION_ROW_DETECT: [84, 786, 126, 896],
  PROGRESSION_CLASS_X: [280, 394],
  PROGRESSION_DATE_X: [112, 280],
  PROGRESSION_BAD_X: [392, 454],
  PROGRESSION_ART_X: [510, 572],
  PROGRESSION_KMAX_X: [570, 638],

  // Raw A/B/C measurements printed beside the colored progression bars.
  // The extractor reads only the latest colored row on each graph and keeps
  // the established KC-Staging/Belin values as the primary sources.
  PROGRESSION_A_ROW_DETECT: [90, 200, 120, 270],
  PROGRESSION_B_ROW_DETECT: [90, 335, 120, 410],
  PROGRESSION_C_ROW_DETECT: [90, 470, 120, 545],
  PROGRESSION_RAW_VALUE_X: [170, 272],

  // Belin/Ambrósio central table and exact fields
  BELIN_PANEL: [610, 105, 870, 420],
  PPI_MAX: [795, 360, 860, 388],
  ART_MAX: [790, 382, 865, 414],
  ARTMAX_DYNAMIC_REGION: [555, 90, 955, 450],
  BAD_D: [1098, 865, 1154, 894],

  // Legacy/history fallbacks. These larger regions are used only when the
  // exact current-format final D box cannot be read.
  BAD_D_EXPANDED: [1000, 820, 1195, 902],
  BAD_D_BOTTOM_ROW: [540, 790, 1198, 902],
  BAD_D_PROGRESSION: [360, 825, 485, 902],

  // Explicit laterality fields and large OD/OS map labels.
  TOPOMETRIC_EYE_PANEL: [190, 135, 355, 225],
  TOPOMETRIC_EYE_VALUE: [255, 165, 345, 205],
  TOPOMETRIC_MAP_EYE_FRONT: [680, 125, 770, 205],
  TOPOMETRIC_MAP_EYE_BACK: [1040, 125, 1130, 205],
  BELIN_EYE_VALUE: [770, 160, 860, 205],
  BELIN_MAP_EYE: [1010, 120, 1120, 215],
};

const PLAUSIBLE_RANGES = {
  A: [2.5, 12.5],
  B: [2.5, 12.5],
  C: [200.0, 800.0],
  Kmax: [20.0, 100.0],
  BAD_D: [-5.0, 60.0],
  ARTmax: [1.0, 1000.0],
  PPImax: [0.1, 100.0],
};

const VARIABLE_META = {
  A: { label: "A / ARC (3-mm)", unit: "mm", step: "0.01", decimals: 2 },
  B: { label: "B / PRC (3-mm)", unit: "mm", step: "0.01", decimals: 2 },
  C: { label: "C / thinnest pachymetry", unit: "µm", step: "1", decimals: 0 },
  Kmax: { label: "Kmax", unit: "D", step: "0.1", decimals: 1 },
  BAD_D: { label: "BAD-D", unit: "", step: "0.01", decimals: 2 },
  ARTmax: { label: "ARTmax", unit: "µm", step: "1", decimals: 0 },
};

const TOLERANCE = {
  A: 0.04,
  B: 0.04,
  C: 3.0,
  Kmax: 0.35,
  BAD_D: 0.15,
  ARTmax: 6.0,
  PPImax: 0.12,
};

// Published ABCD stage gates. They are used as categorical constraints, not
// as substitutes for the raw measurements. A candidate that falls outside the
// printed stage interval is rejected or heavily penalized.
const ABC_STAGE_RANGES = {
  A: {
    0: [7.25, 12.0],
    1: [7.05, 7.25],
    2: [6.35, 7.05],
    3: [6.15, 6.35],
    4: [3.0, 6.15],
  },
  B: {
    0: [5.90, 10.0],
    1: [5.70, 5.90],
    2: [5.15, 5.70],
    3: [4.95, 5.15],
    4: [2.0, 4.95],
  },
  C: {
    0: [490, 700],
    1: [450, 490],
    2: [400, 450],
    3: [300, 400],
    4: [250, 300],
  },
};

const state = {
  mode: "baseline",
  workers: [],
  workerPromise: null,
  workerProgress: [0, 0],
  processing: false,
  processEpoch: 0,
  baselineStudies: [],
  earlierStudies: [],
  laterStudies: [],
  payload: null,
  previewUrls: new Set(),
  ocrJobsDone: 0,
  ocrJobsEstimated: 1,
  visitOrderNotice: "",
  verificationRequiredCount: 0,
  autoSubmitDone: false,
  autoSubmitTimer: null,
};

let lastStreamlitResetToken = null;
let frameHeightTimers = [];

function syncFrameHeight() {
  const measured =
    window.StreamlitBridge?.measureContentHeight?.();
  window.StreamlitBridge?.setFrameHeight(measured);
}

function scheduleFrameHeightSync() {
  /*
   * Streamlit reruns the Python page after the component submits its payload.
   * Several measurements are sent across the next animation frames so the
   * iframe shrinks after images, details panels, and result sections settle.
   */
  for (const timer of frameHeightTimers) {
    window.clearTimeout(timer);
  }
  frameHeightTimers = [];

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(syncFrameHeight);
  });

  for (const delay of [0, 40, 120, 300, 700]) {
    frameHeightTimers.push(
      window.setTimeout(syncFrameHeight, delay)
    );
  }
}

function sendPayloadToCalculator() {
  if (!state.payload) {
    showError("Confirm the extracted measurements first.");
    return;
  }
  const message = {
    action: "submit",
    payload: state.payload,
    nonce: Date.now(),
  };
  window.StreamlitBridge.setComponentValue(message);
  el("sendStatus").textContent = "Confirmed measurements sent to the NKPI model below.";
  scheduleFrameHeightSync();
}

function sendClearToCalculator() {
  window.StreamlitBridge.setComponentValue({ action: "clear", nonce: Date.now() });
}

function onStreamlitRender(event) {
  const args = event.detail?.args || {};
  const resetToken = args.reset_token ?? 0;
  if (lastStreamlitResetToken !== null && resetToken !== lastStreamlitResetToken) {
    clearSession(false);
  }
  lastStreamlitResetToken = resetToken;
  scheduleFrameHeightSync();
}


const el = (id) => document.getElementById(id);

function randomCaseId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return "NKPI-" + [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function basename(path) {
  return String(path).split(/[\\/]/).pop();
}

function setMode(mode) {
  state.mode = mode;
  el("baselineUploads").classList.toggle("hidden", mode !== "baseline");
  el("longitudinalUploads").classList.toggle("hidden", mode !== "longitudinal");
  resetResultsOnly();
}

function setProgress(percent, label, detail = "") {
  el("progressArea").classList.remove("hidden");
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  el("progressBar").style.width = `${value}%`;
  el("progressPercent").textContent = `${Math.round(value)}%`;
  el("progressLabel").textContent = label;
  el("progressDetail").textContent = detail;
}

function hideProgress() {
  el("progressArea").classList.add("hidden");
}

function showError(message) {
  el("errorBox").textContent = message;
  el("errorBox").classList.remove("hidden");
}

function clearError() {
  el("errorBox").textContent = "";
  el("errorBox").classList.add("hidden");
}

function revokePreviewUrls() {
  for (const url of state.previewUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch (_) {
      // Ignore cleanup errors.
    }
  }
  state.previewUrls.clear();
}

function resetResultsOnly() {
  state.processEpoch++;
  state.payload = null;
  state.baselineStudies = [];
  state.earlierStudies = [];
  state.laterStudies = [];
  state.visitOrderNotice = "";
  state.autoSubmitDone = false;
  if (state.autoSubmitTimer) { clearTimeout(state.autoSubmitTimer); state.autoSubmitTimer = null; }
  revokePreviewUrls();
  el("detectedSection").classList.add("hidden");
  el("reviewSection").classList.add("hidden");
  el("exportSection").classList.add("hidden");
  el("confirmValues").checked = false;
  el("confirmValues").disabled = false;
  el("jsonOutput").value = "";
  if (el("payloadSummary")) el("payloadSummary").textContent = "";
  if (el("sendStatus")) el("sendStatus").textContent = "";
  clearError();
  syncFrameHeight();
}

function fileLabel(input) {
  const file = input.files?.[0];
  const zone = input.closest(".upload-zone");
  if (!zone || !file) return;
  const finalSpan = zone.querySelector("span:last-child");
  if (finalSpan) finalSpan.textContent = file.name;

  // Discover report formats before requiring the optional OCR workers.

}

function formatTimestamp(date) {
  if (!date) return "Unknown date/time";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function timestampFromPrefix(prefix) {
  const match = String(prefix).match(/(\d{14})$/);
  if (!match) return null;
  const value = match[1];
  const date = new Date(
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)),
    Number(value.slice(8, 10)),
    Number(value.slice(10, 12)),
    Number(value.slice(12, 14))
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function reportFilenameParts(filename) {
  const name = basename(filename);
  const match = name.match(/^(.+?)\.PdfReport\.0000(-\d{4})?\.jpe?g$/i);
  if (!match) return null;
  return {
    prefix: match[1],
    suffix: match[2] || "-0001",
  };
}

async function blobToBitmap(blob) {
  if ("createImageBitmap" in window) {
    return await createImageBitmap(blob);
  }

  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = (event) => {
      URL.revokeObjectURL(url);
      reject(event);
    };
    image.src = url;
  });
}

function registerPreviewUrl(blob) {
  const url = URL.createObjectURL(blob);
  state.previewUrls.add(url);
  return url;
}

function cropCoordinates(bitmap, box) {
  const [x1, y1, x2, y2] = box;
  return {
    sx: (x1 * bitmap.width) / REFERENCE_WIDTH,
    sy: (y1 * bitmap.height) / REFERENCE_HEIGHT,
    sw: ((x2 - x1) * bitmap.width) / REFERENCE_WIDTH,
    sh: ((y2 - y1) * bitmap.height) / REFERENCE_HEIGHT,
  };
}

function makeCropCanvas(bitmap, box, scale = 8) {
  const { sx, sy, sw, sh } = cropCoordinates(bitmap, box);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}


function clampReferenceBox(box) {
  return [
    Math.max(0, Math.min(REFERENCE_WIDTH, box[0])),
    Math.max(0, Math.min(REFERENCE_HEIGHT, box[1])),
    Math.max(0, Math.min(REFERENCE_WIDTH, box[2])),
    Math.max(0, Math.min(REFERENCE_HEIGHT, box[3])),
  ];
}


function detectAbcFieldStackInRegion(bitmap, regionBox) {
  /*
   * The ARC/PRC/C fields are not ordinary closed rectangles. Each field has a
   * dark L-shaped top/left border. We detect a vertical stack of at least three
   * L corners with a consistent x-position and row spacing. This works across
   * current and legacy layouts and avoids the stage chart to the right.
   */
  const region = makeCropCanvas(bitmap, regionBox, 1);
  const context = region.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, region.width, region.height);
  const data = image.data;
  const width = region.width;
  const height = region.height;
  const dark = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const brightness =
        (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      dark[y * width + x] = brightness < 180 ? 1 : 0;
    }
  }

  const scaleX = width / Math.max(1, regionBox[2] - regionBox[0]);
  const scaleY = height / Math.max(1, regionBox[3] - regionBox[1]);
  const minRun = Math.max(18, Math.round(35 * scaleX));
  const maxRun = Math.max(minRun + 1, Math.round(82 * scaleX));
  const verticalLength = Math.max(12, Math.round(28 * scaleY));
  const minGap = Math.max(12, Math.round(25 * scaleY));
  const maxGap = Math.max(minGap + 1, Math.round(48 * scaleY));
  const anchors = [];

  for (let y = 0; y < height - verticalLength; y += 1) {
    let x = 0;
    while (x < width) {
      while (x < width && !dark[y * width + x]) x += 1;
      const start = x;
      while (x < width && dark[y * width + x]) x += 1;
      const runLength = x - start;
      if (runLength < minRun || runLength > maxRun) continue;

      let bestVerticalDensity = 0;
      for (let xOffset = -1; xOffset <= 3; xOffset += 1) {
        const column = start + xOffset;
        if (column < 0 || column >= width) continue;
        let count = 0;
        for (let yy = y; yy < Math.min(height, y + verticalLength); yy += 1) {
          count += dark[yy * width + column];
        }
        bestVerticalDensity = Math.max(
          bestVerticalDensity,
          count / verticalLength
        );
      }

      if (bestVerticalDensity >= 0.52) {
        anchors.push({
          x: start,
          y,
          runLength,
          verticalDensity: bestVerticalDensity,
        });
      }
    }
  }

  // Merge anti-aliased duplicates from neighboring rows/columns.
  const clustered = [];
  for (const anchor of anchors) {
    const existing = clustered.find(
      (item) =>
        Math.abs(item.x - anchor.x) <= Math.max(3, 4 * scaleX) &&
        Math.abs(item.y - anchor.y) <= Math.max(3, 4 * scaleY)
    );
    if (!existing) {
      clustered.push({ ...anchor });
    } else if (
      anchor.runLength > existing.runLength ||
      anchor.verticalDensity > existing.verticalDensity
    ) {
      Object.assign(existing, anchor);
    }
  }

  let best = null;
  for (const base of clustered) {
    const sameColumn = clustered
      .filter((item) => Math.abs(item.x - base.x) <= Math.max(5, 7 * scaleX))
      .sort((left, right) => left.y - right.y);

    const uniqueRows = [];
    for (const item of sameColumn) {
      if (
        !uniqueRows.length ||
        item.y - uniqueRows[uniqueRows.length - 1].y > Math.max(5, 7 * scaleY)
      ) {
        uniqueRows.push(item);
      }
    }

    for (let startIndex = 0; startIndex < uniqueRows.length; startIndex += 1) {
      const sequence = [uniqueRows[startIndex]];
      for (let index = startIndex + 1; index < uniqueRows.length; index += 1) {
        const gap = uniqueRows[index].y - sequence[sequence.length - 1].y;
        if (gap >= minGap && gap <= maxGap) sequence.push(uniqueRows[index]);
        else if (gap > maxGap) break;
      }

      if (sequence.length < 3) continue;
      const gaps = sequence.slice(1).map((item, index) => item.y - sequence[index].y);
      const meanGap = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
      const variance = gaps.reduce(
        (sum, value) => sum + Math.pow(value - meanGap, 2),
        0
      ) / gaps.length;
      const meanRun = sequence.reduce((sum, item) => sum + item.runLength, 0) /
        sequence.length;
      const runVariance = sequence.reduce(
        (sum, item) => sum + Math.pow(item.runLength - meanRun, 2),
        0
      ) / sequence.length;

      const score =
        sequence.length * 40 -
        Math.sqrt(variance) * 6 -
        Math.sqrt(runVariance) * 1.5 -
        Math.abs(meanGap - 35 * scaleY) * 0.8;

      if (!best || score > best.score) {
        best = { score, sequence: sequence.slice(0, 4) };
      }
    }
  }

  if (!best || best.sequence.length < 3) return null;

  const toReference = (anchor, variable) => {
    const x =
      regionBox[0] +
      (anchor.x / width) * (regionBox[2] - regionBox[0]);
    const y =
      regionBox[1] +
      (anchor.y / height) * (regionBox[3] - regionBox[1]);
    const run =
      (anchor.runLength / width) * (regionBox[2] - regionBox[0]);

    return {
      variable,
      anchorX: x,
      anchorY: y,
      runLength: run,
      valueBox: clampReferenceBox([
        x + 1,
        y + 2,
        x + run + 8,
        y + 31,
      ]),
      rowBox: clampReferenceBox([
        x - 210,
        y - 10,
        x + run + 15,
        y + 36,
      ]),
    };
  };

  return {
    detected: true,
    score: best.score,
    A: toReference(best.sequence[0], "A"),
    B: toReference(best.sequence[1], "B"),
    C: toReference(best.sequence[2], "C"),
  };
}


function detectTopometricAbcFieldStack(bitmap) {
  const current = detectAbcFieldStackInRegion(
    bitmap,
    CROPS.TOPOMETRIC_ABC_SEARCH_CURRENT
  );
  if (current) return current;
  return detectAbcFieldStackInRegion(
    bitmap,
    CROPS.TOPOMETRIC_ABC_SEARCH_BROAD
  );
}


function transformChannel(source, channel = "gray", invert = false) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const values = new Uint8Array(canvas.width * canvas.height);
  let min = 255;
  let max = 0;

  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    let value;

    if (channel === "r") value = red;
    else if (channel === "g") value = green;
    else if (channel === "b") value = blue;
    else if (channel === "max") value = Math.max(red, green, blue);
    else if (channel === "min") value = Math.min(red, green, blue);
    else value = Math.round(0.299 * red + 0.587 * green + 0.114 * blue);

    values[pixel] = value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  const span = Math.max(1, max - min);
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    let value = Math.round(((values[pixel] - min) * 255) / span);
    if (invert) value = 255 - value;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }

  context.putImageData(image, 0, 0);
  return canvas;
}

function thresholdCanvas(source, threshold = 127, invert = false) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;

  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round((data[index] + data[index + 1] + data[index + 2]) / 3);
    let value = gray > threshold ? 255 : 0;
    if (invert) value = 255 - value;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }

  context.putImageData(image, 0, 0);
  return canvas;
}

function padCanvas(source, padding = 36, background = 255) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width + padding * 2;
  canvas.height = source.height + padding * 2;
  const context = canvas.getContext("2d");
  context.fillStyle = `rgb(${background},${background},${background})`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, padding, padding);
  return canvas;
}

function grayNumericCanvas(bitmap, box, scale = 8, threshold = false) {
  const base = makeCropCanvas(bitmap, box, scale);
  const gray = transformChannel(base, "gray", false);
  const prepared = threshold ? thresholdCanvas(gray, 150, false) : gray;
  return padCanvas(prepared, 30, 255);
}

function greenNumericCanvas(bitmap, box, variant = "normal") {
  const base = makeCropCanvas(bitmap, box, 14);
  const green = transformChannel(base, "g", false);
  let prepared = green;

  if (variant === "inverse-threshold") {
    prepared = thresholdCanvas(green, 127, true);
  }

  return padCanvas(prepared, 40, 255);
}


function findRightmostColoredBoxCanvas(bitmap, regionBox = CROPS.BAD_D_BOTTOM_ROW) {
  const region = makeCropCanvas(bitmap, regionBox, 1);
  const context = region.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, region.width, region.height);
  const data = image.data;
  const width = region.width;
  const height = region.height;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const maxValue = Math.max(r, g, b);
      const minValue = Math.min(r, g, b);
      const saturation = maxValue - minValue;
      const brightness = (r + g + b) / 3;
      if (saturation >= 28 && brightness >= 45 && brightness <= 242 && x >= width * 0.35) {
        mask[y * width + x] = 1;
      }
    }
  }

  const visited = new Uint8Array(width * height);
  const components = [];
  const neighbors = [[1,0],[-1,0],[0,1],[0,-1]];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (!mask[start] || visited[start]) continue;
      const queue = [[x,y]]; visited[start] = 1;
      let pointer=0, minX=x, maxX=x, minY=y, maxY=y, area=0;
      while (pointer < queue.length) {
        const [cx,cy]=queue[pointer++]; area += 1;
        minX=Math.min(minX,cx); maxX=Math.max(maxX,cx); minY=Math.min(minY,cy); maxY=Math.max(maxY,cy);
        for (const [dx,dy] of neighbors) {
          const nx=cx+dx, ny=cy+dy;
          if (nx<0||nx>=width||ny<0||ny>=height) continue;
          const ni=ny*width+nx;
          if (mask[ni]&&!visited[ni]) { visited[ni]=1; queue.push([nx,ny]); }
        }
      }
      const cw=maxX-minX+1, ch=maxY-minY+1;
      if (area>=25 && cw>=8 && ch>=5 && cw<=width*0.28 && ch<=height*0.65) {
        components.push({minX,maxX,minY,maxY,area,rightEdge:maxX});
      }
    }
  }
  if (!components.length) return null;
  components.sort((a,b)=> b.rightEdge-a.rightEdge || b.area-a.area);
  const chosen=components[0];
  const px=Math.max(2,Math.round((chosen.maxX-chosen.minX+1)*0.08));
  const py=Math.max(2,Math.round((chosen.maxY-chosen.minY+1)*0.16));
  const sx=Math.max(0,chosen.minX-px), sy=Math.max(0,chosen.minY-py);
  const sw=Math.min(width-sx,chosen.maxX-chosen.minX+1+px*2);
  const sh=Math.min(height-sy,chosen.maxY-chosen.minY+1+py*2);
  const output=document.createElement("canvas"), scale=16;
  output.width=Math.max(1,Math.round(sw*scale)); output.height=Math.max(1,Math.round(sh*scale));
  const out=output.getContext("2d",{willReadFrequently:true});
  out.imageSmoothingEnabled=true; out.imageSmoothingQuality="high";
  out.drawImage(region,sx,sy,sw,sh,0,0,output.width,output.height);
  const rx=(regionBox[2]-regionBox[0])/width,ry=(regionBox[3]-regionBox[1])/height;
  output.referenceBox=[regionBox[0]+sx*rx,regionBox[1]+sy*ry,regionBox[0]+(sx+sw)*rx,regionBox[1]+(sy+sh)*ry];
  return output;
}


function findBottomRightColoredBoxCanvas(
  bitmap,
  regionBox = CROPS.ARTMAX_DYNAMIC_REGION
) {
  const region = makeCropCanvas(bitmap, regionBox, 1);
  const context = region.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, region.width, region.height);
  const data = image.data;
  const width = region.width;
  const height = region.height;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const maxValue = Math.max(r, g, b);
      const minValue = Math.min(r, g, b);
      const saturation = maxValue - minValue;
      const brightness = (r + g + b) / 3;
      if (
        saturation >= 25 &&
        brightness >= 40 &&
        brightness <= 245 &&
        x >= width * 0.40 &&
        y >= height * 0.42
      ) {
        mask[y * width + x] = 1;
      }
    }
  }

  const visited = new Uint8Array(width * height);
  const components = [];
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (!mask[start] || visited[start]) continue;
      const queue = [[x, y]];
      visited[start] = 1;
      let pointer = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;

      while (pointer < queue.length) {
        const [cx, cy] = queue[pointer++];
        area += 1;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        for (const [dx, dy] of neighbors) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            queue.push([nx, ny]);
          }
        }
      }

      const componentWidth = maxX - minX + 1;
      const componentHeight = maxY - minY + 1;
      if (
        area >= 22 &&
        componentWidth >= 8 &&
        componentHeight >= 10 &&
        componentWidth <= width * 0.32 &&
        componentHeight <= height * 0.35
      ) {
        components.push({ minX, maxX, minY, maxY, area });
      }
    }
  }

  if (!components.length) return null;

  // ARTmax is the lowest-right colored numeric result in the labeled panel.
  components.sort((left, right) => {
    const leftScore = left.maxY * 3 + left.maxX + Math.log1p(left.area) * 3;
    const rightScore = right.maxY * 3 + right.maxX + Math.log1p(right.area) * 3;
    return rightScore - leftScore;
  });

  const chosen = components[0];
  const padX = Math.max(3, Math.round((chosen.maxX - chosen.minX + 1) * 0.12));
  const padY = Math.max(3, Math.round((chosen.maxY - chosen.minY + 1) * 0.20));
  const sx = Math.max(0, chosen.minX - padX);
  const sy = Math.max(0, chosen.minY - padY);
  const sw = Math.min(width - sx, chosen.maxX - chosen.minX + 1 + padX * 2);
  const sh = Math.min(height - sy, chosen.maxY - chosen.minY + 1 + padY * 2);

  const output = document.createElement("canvas");
  const scale = 16;
  output.width = Math.max(1, Math.round(sw * scale));
  output.height = Math.max(1, Math.round(sh * scale));
  const out = output.getContext("2d", { willReadFrequently: true });
  out.imageSmoothingEnabled = true;
  out.imageSmoothingQuality = "high";
  out.drawImage(region, sx, sy, sw, sh, 0, 0, output.width, output.height);
  return output;
}

async function readArtmaxFromDetectedColorBox(worker, bitmap, preferredValue = null) {
  const detected = findBottomRightColoredBoxCanvas(bitmap);
  if (!detected) {
    return {
      value: null,
      raw: [],
      agreeingReads: 0,
      method: "dynamic ARTmax box unavailable",
    };
  }
  const result = await readColorCanvasEnsemble(
    worker,
    detected,
    "ARTmax",
    preferredValue
  );
  return { ...result, method: "bottom-right ARTmax box detector" };
}

function directSourceConsensus(variable, sources, preferredOrder = []) {
  const valid = (sources || []).filter((source) =>
    plausible(variable, source?.value)
  );
  if (!valid.length) {
    return { value: null, agreements: 0, sources: [], conflict: false };
  }

  const groups = [];
  for (const source of valid) {
    let group = groups.find((item) =>
      Math.abs(item.value - source.value) <= TOLERANCE[variable]
    );
    if (!group) {
      group = { value: source.value, weight: 0, sources: [], values: [] };
      groups.push(group);
    }
    group.weight += Number(source.weight) || 1;
    group.sources.push(source.name);
    group.values.push(source.value);
  }

  groups.forEach((group) => {
    group.agreements = new Set(group.sources).size;
    group.priority = Math.max(
      ...group.sources.map((name) => {
        const index = preferredOrder.indexOf(name);
        return index < 0 ? 0 : preferredOrder.length - index;
      })
    );
  });
  groups.sort((left, right) =>
    right.agreements - left.agreements ||
    right.weight - left.weight ||
    right.priority - left.priority
  );

  const selected = groups[0];
  const preferredSource = preferredOrder.find((name) =>
    selected.sources.includes(name)
  );
  const preferred = preferredSource
    ? valid.find((source) => source.name === preferredSource &&
        Math.abs(source.value - selected.value) <= TOLERANCE[variable])
    : null;

  return {
    value: preferred?.value ?? selected.value,
    agreements: selected.agreements,
    sources: selected.sources,
    conflict: groups.length > 1 &&
      groups[1].weight >= selected.weight - 0.5 &&
      Math.abs(groups[1].value - selected.value) > TOLERANCE[variable] * 2,
    groups,
  };
}

function parseBadDFromBottomRowText(text) {
  const original=String(text||"").replace(/,/g,".").replace(/[Oo]/g,"0").replace(/[Il|]/g,"1");
  const labelled=[]; const pattern=/(?:^|\s)D\s*[:=]?\s*(-?\d+(?:\.\d+)?)/gi; let match;
  while ((match=pattern.exec(original))!==null) {
    const candidates=normalizedCandidates(match[1],"BAD_D");
    if (candidates.length) labelled.push(candidates[0].value);
  }
  if (labelled.length) return labelled[labelled.length-1];
  const tokens=numericTokens(original);
  for (let i=tokens.length-1;i>=0;i-=1) {
    const candidates=normalizedCandidates(tokens[i].token,"BAD_D");
    if (candidates.length) return candidates[0].value;
  }
  return null;
}


function parseBadDComponents(text) {
  const cleaned = String(text || "")
    .replace(/,/g, ".")
    .replace(/[Oo]/g, "0")
    .replace(/(?<=\d)[Il](?=\d)/g, "1").replace(/\|/g, " ")
    .replace(/\s+/g, " ");
  const output = {};
  ["Df", "Db", "Dp", "Dt", "Da", "D"].forEach((label) => {
    const pattern = new RegExp(`(?:^|\\s)${label}\\s*[:=]?\\s*(-?\\d+(?:\\.\\d+)?)`, "i");
    const match = cleaned.match(pattern);
    if (!match) return;
    const candidates = normalizedCandidates(match[1], "BAD_D");
    if (candidates.length) output[label] = candidates[0].value;
  });
  return output;
}

function badDComponentConsistency(value, components) {
  if (!Number.isFinite(value)) return null;
  const values = ["Df", "Db", "Dp", "Dt", "Da"]
    .map((key) => components?.[key])
    .filter(Number.isFinite)
    .map(Math.abs);
  if (values.length < 3) return null;
  const maximum = Math.max(...values);
  const lower = Math.max(-5, maximum * 0.35 - 0.45);
  const upper = maximum + 3.0;
  return { maximumComponent: maximum, lower, upper, compatible: value >= lower && value <= upper };
}

function groupBadDCandidates(candidates) {
  const groups = [];
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.value)) continue;
    let group = groups.find((item) => Math.abs(item.value - candidate.value) <= 0.12);
    if (!group) {
      group = { value: candidate.value, score: 0, methods: [], candidates: [] };
      groups.push(group);
    }
    group.score += candidate.weight;
    group.methods.push(candidate.method);
    group.candidates.push(candidate);
  }
  groups.sort((left, right) => right.score - left.score);
  return groups;
}

async function readBadDFromDetectedColorBox(worker, bitmap) {
  const detected = findRightmostColoredBoxCanvas(bitmap);
  if (!detected) {
    return {
      value: null,
      raw: [],
      agreeingReads: 0,
      method: "dynamic colored-box detector unavailable",
    };
  }
  const result = await readColorCanvasEnsemble(worker, detected, "BAD_D");
  return { ...result, method: "rightmost colored-box detector" };
}

async function readBadDFromBottomRow(worker, bitmap) {
  const base=makeCropCanvas(bitmap,CROPS.BAD_D_BOTTOM_ROW,5);
  const gray=transformChannel(base,"gray",false), green=transformChannel(base,"g",false);
  const reads=[];
  reads.push(await recognize(worker,padCanvas(gray,24,255),{psm:6,whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.:- "}));
  reads.push(await recognize(worker,padCanvas(thresholdCanvas(green,145,true),24,255),{psm:6,whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.:- "}));
  let components = {};
  for (const read of reads) {
    components = { ...components, ...parseBadDComponents(read.text) };
    const value=parseBadDFromBottomRowText(read.text);
    if (Number.isFinite(value)&&plausible("BAD_D",value)) {
      return {value,raw:reads,method:"bottom-row semantic parser",components};
    }
  }
  return {value:null,raw:reads,method:"bottom-row semantic parser",components};
}

async function readBadDFromProgression(worker, bitmap) {
  if (!bitmap) return {value:null,raw:[],method:"progression page unavailable"};
  const direct=await readGrayField(worker,bitmap,CROPS.BAD_D_PROGRESSION,"BAD_D");
  return {...direct,method:"ABCD progression-table fallback"};
}

async function readBadDResilient(worker, belinBitmap, progressionBitmap=null) {
  const exact = await readColorField(worker, belinBitmap, CROPS.BAD_D, "BAD_D");
  const dynamic = await readBadDFromDetectedColorBox(worker, belinBitmap);
  const row = await readBadDFromBottomRow(worker, belinBitmap);
  // A fixed last-row crop is not date-bound. Only readProgressionSummary's
  // matched examination may supply independent progression-table evidence.
  const progression = {value:null,raw:[],method:'Use date-matched summary only'};
  const components = row.components || {};

  const candidates = [
    { value: exact.value, method: "exact final D box", weight: 5.0, agreeingReads: exact.agreeingReads || 0 },
    { value: dynamic.value, method: dynamic.method, weight: 3.5, agreeingReads: dynamic.agreeingReads || 0 },
    { value: row.value, method: row.method, weight: 3.5 },
    { value: progression.value, method: progression.method, weight: 5.0 },
  ].filter((item) => Number.isFinite(item.value));

  candidates.forEach((candidate) => {
    const check = badDComponentConsistency(candidate.value, components);
    candidate.componentCompatible = check?.compatible ?? null;
    candidate.componentCheck = check;
    if (check?.compatible === true) candidate.weight += 1.5;
    if (check?.compatible === false) candidate.weight -= 5.0;
  });

  const groups = groupBadDCandidates(candidates);
  const selected = groups[0] || null;
  if (!selected) {
    return {
      value: null, quality: "Unavailable", method: "all BAD-D methods failed",
      sources: { exactFinalDBox: exact.value, dynamicColoredBox: dynamic.value, bottomRow: row.value, progressionTable: progression.value, components },
      raw: [...(exact.raw||[]),...(dynamic.raw||[]),...(row.raw||[]),...(progression.raw||[])],
      autoConfirmed: false,
    };
  }

  const independentMethods = new Set(selected.methods).size;
  const componentCompatible = selected.candidates.some((candidate) => candidate.componentCompatible === true);
  const strongDirectRead = selected.candidates.some((candidate) =>
    ["exact final D box", "rightmost colored-box detector"].includes(candidate.method) &&
    Number(candidate.agreeingReads || 0) >= 2
  );
  const competingGroup = groups.find((group) =>
    group !== selected &&
    group.score >= selected.score - 0.5 &&
    Math.abs(group.value - selected.value) > TOLERANCE.BAD_D * 2
  );
  const directAutoConfirmed =
    independentMethods >= 2 ||
    (strongDirectRead && componentCompatible !== false && !competingGroup);
  const quality = directAutoConfirmed
    ? "High"
    : componentCompatible && selected.score >= 5
      ? "Moderate"
      : "Low";

  return {
    value: selected.value,
    quality,
    method: selected.methods.join(" + "),
    sources: {
      exactFinalDBox: exact.value,
      exactBoxAgreeingReads: exact.agreeingReads || 0,
      dynamicColoredBox: dynamic.value,
      dynamicBoxAgreeingReads: dynamic.agreeingReads || 0,
      bottomRow: row.value,
      progressionTable: progression.value,
      components,
      consensusMethods: selected.methods,
      consensusScore: Math.round(selected.score * 10) / 10,
      componentCompatibility: selected.candidates[0]?.componentCheck || null,
    },
    raw: [...(exact.raw||[]),...(dynamic.raw||[]),...(row.raw||[]),...(progression.raw||[])],
    autoConfirmed: directAutoConfirmed,
  };
}

function panelCanvas(bitmap) {
  const base = makeCropCanvas(bitmap, CROPS.BELIN_PANEL, 4);
  const gray = transformChannel(base, "gray", false);
  return padCanvas(gray, 24, 255);
}

function lateralityCanvas(bitmap, box, scale = 7, threshold = false, invert = false) {
  const base = makeCropCanvas(bitmap, box, scale);
  let gray = transformChannel(base, "gray", invert);
  if (threshold) gray = thresholdCanvas(gray, 150, invert);
  return padCanvas(gray, 28, 255);
}

function updateWorkerLoadProgress(workerIndex, message) {
  if (typeof message.progress !== "number") return;
  state.workerProgress[workerIndex] = message.progress;
  const average = (state.workerProgress[0] + state.workerProgress[1]) / 2;
  setProgress(
    Math.max(2, Math.round(average * 18)),
    "Preparing local OCR…",
    "The first visit may take longer while the browser caches the OCR model."
  );
}

async function createOcrWorker(workerIndex) {
  return await Tesseract.createWorker(
    "eng",
    Tesseract.OEM.LSTM_ONLY,
    {
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0",
      langPath: new URL("ocr_data/", window.location.href).href,
      gzip: false,
      cacheMethod: "none",
      logger: (message) => updateWorkerLoadProgress(workerIndex, message),
      errorHandler: (error) => console.error(`OCR worker ${workerIndex + 1}:`, error),
    }
  );
}

async function ensureWorkers() {
  if (state.workers.length === 2) return state.workers;
  if (state.workerPromise) return state.workerPromise;

  if (typeof Tesseract === "undefined") {
    throw new Error(
      "The OCR library did not load. Refresh the page or ask IT to allow cdn.jsdelivr.net and reload the app."
    );
  }

  setProgress(
    2,
    "Preparing two local OCR workers…",
    "Keep this tab open during clinic. After the first load, later patients are faster."
  );

  const timeout = new Promise((_, reject) => {
    window.setTimeout(
      () => reject(new Error("OCR initialization timed out. Refresh and try again.")),
      90000
    );
  });

  const creation = Promise.all([createOcrWorker(0), createOcrWorker(1)]);
  state.workerPromise = Promise.race([creation, timeout])
    .then((workers) => {
      state.workers = workers;
      state.workerPromise = null;
      setProgress(18, "OCR ready", "The report ZIP can now be processed.");
      window.setTimeout(hideProgress, 700);
      return workers;
    })
    .catch((error) => {
      state.workerPromise = null;
      state.workers = [];
      throw error;
    });

  return state.workerPromise;
}

async function recognize(worker, canvas, { psm = 7, whitelist = "" } = {}) {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    tessedit_char_whitelist: whitelist,
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  const result = await worker.recognize(canvas, {}, {text: true, blocks: true});
  state.ocrJobsDone += 1;
  const fraction = Math.min(1, state.ocrJobsDone / Math.max(1, state.ocrJobsEstimated));
  setProgress(
    20 + fraction * 75,
    "Reading the required Pentacam fields…",
    `Targeted OCR ${state.ocrJobsDone} of about ${state.ocrJobsEstimated}`
  );

  return {
    text: String(result?.data?.text || "").trim(),
    confidence: Number(result?.data?.confidence || 0),
    blocks: result?.data?.blocks || [],
  };
}

function cleanOcrText(text) {
  return String(text || "")
    .replace(/,/g, ".")
    .replace(/[Oo]/g, "0")
    .replace(/(?<=\d)[Il](?=\d)/g, "1").replace(/\|/g, " ")
    .trim();
}

function numericTokens(text) {
  const cleaned = cleanOcrText(text);
  return (cleaned.match(/-?\d+(?:\.\d+)?/g) || []).map((token) => ({
    token,
    value: Number(token),
  })).filter((item) => Number.isFinite(item.value));
}

function plausible(variable, value) {
  const [low, high] = PLAUSIBLE_RANGES[variable];
  return Number.isFinite(value) && value >= low && value <= high;
}

function normalizedCandidates(token, variable) {
  const candidates = [];
  const raw = String(token || "").replace(/[^0-9.\-]/g, "");
  if (!raw || raw === "." || raw === "-") return candidates;

  const direct = Number(raw);
  if (Number.isFinite(direct)) candidates.push({ value: direct, score: raw.includes(".") ? 5 : 2, raw });

  const negative = raw.startsWith("-");
  const unsigned = raw.replace("-", "");
  const digits = unsigned.replace(".", "");
  const sign = negative ? -1 : 1;

  const add = (value, score) => {
    if (Number.isFinite(value)) candidates.push({ value: sign * Math.abs(value), score, raw });
  };

  if (["A", "B"].includes(variable)) {
    if (!unsigned.includes(".")) {
      if (digits.length === 3) add(Number(digits) / 100, 4);
      if (digits.length === 2) add(Number(digits) / 10, 3);
      if (digits.length === 4) {
        add(Number(digits) / 1000, 2);
        add(Number(digits.slice(-3)) / 100, 4);
      }
    } else if (Math.abs(direct) > 12) {
      const decimalIndex = unsigned.indexOf(".");
      const before = unsigned.slice(0, decimalIndex);
      const after = unsigned.slice(decimalIndex + 1);
      if (before.length > 1) add(Number(`${before.slice(-1)}.${after}`), 4);
    }
  }

  if (variable === "C") {
    if (!unsigned.includes(".") && digits.length === 4 && digits.startsWith("1")) {
      add(Number(digits.slice(-3)), 5);
    }
  }

  if (variable === "Kmax") {
    if (!unsigned.includes(".")) {
      if (digits.length === 3) add(Number(digits) / 10, 4);
      if (digits.length === 4) add(Number(digits) / 100, 4);
      if (digits.length === 5 && digits.startsWith("1")) add(Number(digits.slice(-4)) / 100, 5);
    } else if (Math.abs(direct) > 100) {
      const decimalIndex = unsigned.indexOf(".");
      const before = unsigned.slice(0, decimalIndex);
      const after = unsigned.slice(decimalIndex + 1);
      if (before.length > 2) add(Number(`${before.slice(-2)}.${after}`), 5);
    }
  }

  if (["BAD_D", "PPImax"].includes(variable) && !unsigned.includes(".")) {
    if (digits.length === 2) add(Number(digits) / 10, 3);
    if (digits.length === 3) add(Number(digits) / 100, 5);
    if (digits.length === 4) {
      add(Number(digits) / 100, 5);
      add(Number(digits) / 1000, 1);
    }
  }

  if (variable === "ARTmax" && !unsigned.includes(".")) {
    if (digits.length === 4 && digits.startsWith("1")) add(Number(digits.slice(-3)), 6);
  }

  return candidates
    .filter((candidate) => plausible(variable, candidate.value))
    .map((candidate) => ({ ...candidate, value: Math.round(candidate.value * 1000) / 1000 }));
}

function chooseCandidate(results, variable, preferredValue = null) {
  const candidates = [];

  results.forEach((result, resultIndex) => {
    numericTokens(result.text).forEach(({ token }) => {
      normalizedCandidates(token, variable).forEach((candidate) => {
        let score = candidate.score;
        score += Math.max(0, result.confidence) / 50;
        if (resultIndex === 0) score += 0.6;
        if (Number.isFinite(preferredValue)) {
          const tolerance = variable === "C" ? 4 : variable === "ARTmax" ? 8 : 0.5;
          if (Math.abs(candidate.value - preferredValue) <= tolerance) score += 3;
        }
        candidates.push({ ...candidate, score, confidence: result.confidence, sourceIndex: resultIndex });
      });
    });
  });

  if (!candidates.length) return { value: null, candidates: [] };
  candidates.sort((a, b) => b.score - a.score);
  return { value: candidates[0].value, candidates };
}

async function readGrayField(worker, bitmap, box, variable) {
  const primary = await recognize(worker, grayNumericCanvas(bitmap, box, 8, false), {
    psm: 7,
    whitelist: "0123456789.-",
  });
  let selected = chooseCandidate([primary], variable);

  if (!Number.isFinite(selected.value)) {
    const fallback = await recognize(worker, grayNumericCanvas(bitmap, box, 8, true), {
      psm: 7,
      whitelist: "0123456789.-",
    });
    selected = chooseCandidate([primary, fallback], variable);
    return { ...selected, raw: [primary, fallback] };
  }

  return { ...selected, raw: [primary] };
}

function countAgreeingOcrReads(results, variable, value) {
  if (!Number.isFinite(value)) return 0;
  return results.filter((result) =>
    numericTokens(result.text).some(({ token }) =>
      normalizedCandidates(token, variable).some((candidate) =>
        Math.abs(candidate.value - value) <= TOLERANCE[variable]
      )
    )
  ).length;
}

function cropCanvasFraction(
  source,
  left = 0.07,
  top = 0.12,
  right = 0.07,
  bottom = 0.12
) {
  const sx = Math.max(0, Math.round(source.width * left));
  const sy = Math.max(0, Math.round(source.height * top));
  const sw = Math.max(1, Math.round(source.width * (1 - left - right)));
  const sh = Math.max(1, Math.round(source.height * (1 - top - bottom)));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d").drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

function lowSaturationLightInkCanvas(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const maximum = Math.max(r, g, b);
    const minimum = Math.min(r, g, b);
    const brightness = (r + g + b) / 3;
    const saturation = maximum - minimum;
    const ink = brightness > 145 && saturation < 105;
    const value = ink ? 0 : 255;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function colorFieldVariantCanvases(sourceCanvas) {
  // Remove the printed box border before OCR. Border lines were the main cause
  // of 299→249 and 5.72→.2 errors in the colored Pentacam fields.
  const inner = cropCanvasFraction(sourceCanvas);
  const gray = transformChannel(inner, "gray", false);
  const green = transformChannel(inner, "g", false);
  const red = transformChannel(inner, "r", false);
  const maximum = transformChannel(inner, "max", false);
  const whiteInk = lowSaturationLightInkCanvas(inner);

  return [
    padCanvas(gray, 44, 255),
    padCanvas(thresholdCanvas(gray, 120, false), 44, 255),
    padCanvas(thresholdCanvas(gray, 180, true), 44, 255),
    padCanvas(green, 44, 255),
    padCanvas(maximum, 44, 255),
    padCanvas(whiteInk, 44, 255),
    padCanvas(red, 44, 255),
  ];
}

async function readColorCanvasEnsemble(
  worker,
  sourceCanvas,
  variable,
  preferredValue = null
) {
  const whitelist = variable === "ARTmax"
    ? "0123456789"
    : "0123456789.-";
  const variants = colorFieldVariantCanvases(sourceCanvas);
  const reads = [];

  // Fast path: border-free grayscale plus dark-text and white-text masks.
  for (const [index, psm] of [[0, 10], [1, 8], [2, 8]]) {
    reads.push(await recognize(worker, variants[index], { psm, whitelist }));
  }

  let selected = chooseCandidate(reads, variable, preferredValue);
  let agreeingReads = countAgreeingOcrReads(reads, variable, selected.value);

  // Only uncertain fields pay for the additional OCR passes.
  if (!Number.isFinite(selected.value) || agreeingReads < 2) {
    for (const [index, psm] of [[3, 10], [4, 7], [5, 8], [6, 13]]) {
      reads.push(await recognize(worker, variants[index], { psm, whitelist }));
    }
    selected = chooseCandidate(reads, variable, preferredValue);
    agreeingReads = countAgreeingOcrReads(reads, variable, selected.value);
  }

  return {
    ...selected,
    raw: reads,
    agreeingReads,
    method: "adaptive color-box numeric ensemble",
  };
}

async function readColorField(worker, bitmap, box, variable, preferredValue = null) {
  const base = makeCropCanvas(bitmap, box, 16);
  return readColorCanvasEnsemble(worker, base, variable, preferredValue);
}

function levenshteinDistance(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array(right.length + 1).fill(0)
  );
  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[left.length][right.length];
}

function normalizedLateralityText(text) {
  return String(text || "")
    .toUpperCase()
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/[^A-Z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lateralitySignals(text) {
  const normalized = normalizedLateralityText(text);
  const tokens = normalized.split(" ").filter(Boolean);

  let rightWord = /\bRIGHT\b/.test(normalized);
  let leftWord = /\bLEFT\b/.test(normalized);

  for (const token of tokens) {
    if (token.length >= 3 && token.length <= 7) {
      if (levenshteinDistance(token, "RIGHT") <= 2) rightWord = true;
      if (levenshteinDistance(token, "LEFT") <= 1) leftWord = true;
    }
  }

  const odToken = /\bOD\b/.test(normalized);
  const osToken = /\bOS\b/.test(normalized);

  return { normalized, rightWord, leftWord, odToken, osToken };
}

function lateralityFromText(text) {
  const signals = lateralitySignals(text);

  // Explicit Right/Left words are more reliable than a stray OD/OS token from
  // a neighboring map. They therefore take precedence.
  if (signals.rightWord && !signals.leftWord) return "OD";
  if (signals.leftWord && !signals.rightWord) return "OS";

  if (signals.odToken && !signals.osToken) return "OD";
  if (signals.osToken && !signals.odToken) return "OS";

  // Conflicting evidence is intentionally left unresolved for global pairing.
  return null;
}

function addEyeEvidence(scores, evidence, eye, weight, source, text = "", confidence = 0) {
  if (!eye || !["OD", "OS"].includes(eye)) return;
  const confidenceFactor = 1 + Math.max(0, Number(confidence) || 0) / 100;
  const contribution = weight * confidenceFactor;
  scores[eye] += contribution;
  evidence.push({ eye, source, text: String(text || "").trim(), confidence, contribution });
}

function chooseEyeFromScores(scores, minimumMargin = 1.5) {
  const difference = scores.OD - scores.OS;
  if (Math.abs(difference) < minimumMargin) return null;
  return difference > 0 ? "OD" : "OS";
}





async function readGrayFieldEnsemble(worker, bitmap, box, variable) {
  const reads = [];
  reads.push(await recognize(worker, grayNumericCanvas(bitmap, box, 10, false), {
    psm: 7,
    whitelist: "0123456789.-",
  }));
  reads.push(await recognize(worker, grayNumericCanvas(bitmap, box, 10, true), {
    psm: 8,
    whitelist: "0123456789.-",
  }));
  const inverted = transformChannel(makeCropCanvas(bitmap, box, 12), "gray", true);
  reads.push(await recognize(worker, padCanvas(inverted, 34, 255), {
    psm: 13,
    whitelist: "0123456789.-",
  }));

  const selected = chooseCandidate(reads, variable);
  const agreeingReads = Number.isFinite(selected.value)
    ? reads.filter((read) =>
        numericTokens(read.text).some(({ token }) =>
          normalizedCandidates(token, variable).some((candidate) =>
            Math.abs(candidate.value - selected.value) <= TOLERANCE[variable]
          )
        )
      ).length
    : 0;

  return {
    ...selected,
    raw: reads,
    agreeingReads,
    method: "three-pass Pentacam numeric ensemble",
  };
}

function detectTopometricStageBar(bitmap, variable) {
  const box = {
    A: CROPS.TOPOMETRIC_STAGE_A,
    B: CROPS.TOPOMETRIC_STAGE_B,
    C: CROPS.TOPOMETRIC_STAGE_C,
  }[variable];
  if (!box) return null;

  const region = makeCropCanvas(bitmap, box, 1);
  const context = region.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, region.width, region.height);
  const data = image.data;
  const scores = new Array(region.width).fill(0);

  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const offset = (y * region.width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      if (b >= 115 && b >= r + 20 && b >= g - 12 && saturation >= 35) {
        scores[x] += 1;
      }
    }
  }

  let rightmost = -1;
  const threshold = Math.max(2, Math.floor(region.height * 0.12));
  for (let x = 0; x < scores.length; x += 1) {
    if (scores[x] >= threshold) rightmost = x;
  }
  if (rightmost < 0) return null;

  const globalX = box[0] + (rightmost / region.width) * (box[2] - box[0]);
  const stage = 4 * (globalX - CROPS.TOPOMETRIC_STAGE_X0) /
    (CROPS.TOPOMETRIC_STAGE_X4 - CROPS.TOPOMETRIC_STAGE_X0);
  return Math.max(0, Math.min(4, Math.round(stage * 10) / 10));
}

function expectedContinuousStage(variable, value) {
  if (!Number.isFinite(value) || !["A", "B"].includes(variable)) return null;
  const boundaries = variable === "A"
    ? [7.25, 7.05, 6.35, 6.15]
    : [5.90, 5.70, 5.15, 4.95];
  if (value > boundaries[0]) return 0;
  if (value > boundaries[1]) return 1 + (boundaries[0] - value) / (boundaries[0] - boundaries[1]);
  if (value > boundaries[2]) return 2 + (boundaries[1] - value) / (boundaries[1] - boundaries[2]);
  if (value > boundaries[3]) return 3 + (boundaries[2] - value) / (boundaries[2] - boundaries[3]);
  return 4;
}

function stageBarCompatibility(variable, value, detectedStage) {
  if (!Number.isFinite(value) || !Number.isFinite(detectedStage) || !["A", "B"].includes(variable)) return null;
  const expected = expectedContinuousStage(variable, value);
  if (!Number.isFinite(expected)) return null;
  const difference = Math.abs(expected - detectedStage);
  return { expected, difference, compatible: difference <= 0.45 };
}

function stageBarScore(variable, value, detectedStage) {
  const result = stageBarCompatibility(variable, value, detectedStage);
  if (!result) return 0;
  if (result.difference <= 0.25) return 9;
  if (result.difference <= 0.45) return 4;
  if (result.difference <= 0.75) return -4;
  return -15;
}

function stageCompatible(variable, value, stage, tolerance = null) {
  if (!Number.isFinite(value) || !Number.isInteger(stage)) return null;
  const range = ABC_STAGE_RANGES?.[variable]?.[stage];
  if (!range) return null;
  const extra = tolerance ?? (variable === "C" ? 8 : 0.07);
  return value >= range[0] - extra && value <= range[1] + extra;
}

function stageCompatibilityScore(variable, value, stage) {
  const compatible = stageCompatible(variable, value, stage);
  if (compatible === null) return 0;
  if (compatible) return 8;

  // Adjacent stage compatibility receives a small rescue score because values
  // can sit very near a published gate and the printed stage is continuous.
  for (const adjacent of [stage - 1, stage + 1]) {
    if (stageCompatible(variable, value, adjacent)) return 1;
  }
  return -12;
}

function parseAbcClassification(text) {
  const normalized = String(text || "")
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[^A-Z0-9]+/g, "");
  const match = normalized.match(/A([0-4])B([0-4])C([0-4])D/);
  if (!match) return null;
  return {
    A: Number(match[1]),
    B: Number(match[2]),
    C: Number(match[3]),
    raw: match[0],
  };
}


function parseProgressionDateTime(text, referenceTimestamp = null) {
  const cleaned = String(text || "")
    .replace(/(?<=\d)[Il](?=\d)/g, "1").replace(/\|/g, " ")
    .replace(/[Oo]/g, "0")
    .replace(/\s+/g, " ")
    .trim();

  const match = cleaned.match(
    /(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:[^0-9]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/
  );
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const secondValue = Number(match[6] || 0);

  const candidates = [
    validDateParts(year, first, second, hour, minute, secondValue),
    validDateParts(year, second, first, hour, minute, secondValue),
  ].filter(Boolean);
  if (!candidates.length) return null;
  if (!referenceTimestamp || candidates.length === 1) return candidates[0];

  return candidates.sort(
    (left, right) =>
      Math.abs(left.getTime() - referenceTimestamp.getTime()) -
      Math.abs(right.getTime() - referenceTimestamp.getTime())
  )[0];
}

async function progressionRowChoice(worker, bitmap, referenceTimestamp = null) {
  const rowYs = detectColoredProgressionRowYs(
    bitmap,
    CROPS.PROGRESSION_ROW_DETECT
  );
  if (!rowYs.length) {
    return { rowY: null, index: null, rowCount: 0, dates: [], raw: [] };
  }


  const dates = [];
  const raw = [];
  for (const rowY of rowYs) {
    const canvas = progressionCellCanvas(
      bitmap,
      progressionRowBox(CROPS.PROGRESSION_DATE_X, rowY, 14),
      7
    );
    let read = await recognize(worker, canvas, {
      psm: 7,
      whitelist: "0123456789/|:.- ",
    });
    let date = parseProgressionDateTime(read.text, referenceTimestamp);
    raw.push(read);
    if (!date) {
      read = await recognize(worker, canvas, {
        psm: 6,
        whitelist: "0123456789/|:.- ",
      });
      date = parseProgressionDateTime(read.text, referenceTimestamp);
      raw.push(read);
    }
    dates.push(date);
  }

  const index = matchedProgressionDateIndex(dates, referenceTimestamp);
  return {rowY: index === null ? null : rowYs[index], index,
    rowCount: rowYs.length, dates, raw, dateMatched: index !== null};
}

function progressionRowBox(xRange, rowY, halfHeight = 12) {
  return [xRange[0], rowY - halfHeight, xRange[1], rowY + halfHeight];
}


function detectColoredProgressionRowYs(bitmap, regionBox) {
  /*
   * Find every colored examination-row marker in a progression-display
   * section. This is used for A, B, C and the result table.
   */
  const region = makeCropCanvas(bitmap, regionBox, 1);
  const context = region.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, region.width, region.height);
  const data = image.data;
  const scores = [];

  for (let y = 0; y < region.height; y += 1) {
    let score = 0;
    for (let x = 0; x < region.width; x += 1) {
      const offset = (y * region.width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const maxValue = Math.max(r, g, b);
      const minValue = Math.min(r, g, b);
      const saturation = maxValue - minValue;
      const brightness = (r + g + b) / 3;

      if (
        saturation > 28 &&
        maxValue > 75 &&
        brightness < 248
      ) {
        score += 1;
      }
    }
    scores.push(score);
  }

  const groups = [];
  let current = null;

  for (let y = 0; y < scores.length; y += 1) {
    if (scores[y] >= 3) {
      if (!current) {
        current = {
          start: y,
          end: y,
          peak: scores[y],
        };
      } else {
        current.end = y;
        current.peak = Math.max(
          current.peak,
          scores[y]
        );
      }
    } else if (current) {
      if (current.end - current.start >= 2) {
        groups.push(current);
      }
      current = null;
    }
  }

  if (current && current.end - current.start >= 2) {
    groups.push(current);
  }

  const regionHeight =
    regionBox[3] - regionBox[1];

  return groups.map((group) => {
    const center =
      (group.start + group.end) / 2;
    return (
      regionBox[1] +
      (center / region.height) * regionHeight
    );
  });
}


function parseProgressionRawMeasurement(text, variable) {
  /*
   * Progression labels look like:
   *   7.83mm | 0.00
   *   6.23mm | 0.00
   *   528µm  | 0.54
   *
   * We intentionally parse the first raw measurement and ignore the stage
   * value printed after the vertical divider.
   */
  const cleaned = cleanOcrText(text)
    .replace(/\s+/g, "");

  if (["A", "B"].includes(variable)) {
    const decimalMatches = [
      ...cleaned.matchAll(
        /(\d{1,2})\.(\d{2,4})/g
      ),
    ];

    for (const match of decimalMatches) {
      // Tesseract may append the first stage digit, e.g. 7.212.
      // The raw ARC/PRC measurement is printed with two decimals.
      const value = Number(
        `${match[1]}.${match[2].slice(0, 2)}`
      );
      if (plausible(variable, value)) {
        return value;
      }
    }

    for (const { token } of numericTokens(cleaned)) {
      const candidates =
        normalizedCandidates(token, variable);
      if (candidates.length) {
        return candidates[0].value;
      }
    }
  }

  if (variable === "C") {
    const integerMatches =
      cleaned.match(/\d{3,4}/g) || [];

    for (const token of integerMatches) {
      const candidates =
        normalizedCandidates(token, "C");
      if (candidates.length) {
        return candidates[0].value;
      }

      const firstThree = Number(
        String(token).slice(0, 3)
      );
      if (plausible("C", firstThree)) {
        return firstThree;
      }
    }

    for (const { token } of numericTokens(cleaned)) {
      const candidates =
        normalizedCandidates(token, "C");
      if (candidates.length) {
        return candidates[0].value;
      }
    }
  }

  return null;
}


function progressionRawMeasurementCanvas(
  bitmap,
  rowY,
  xRange,
  scale = 12
) {
  const box = [
    xRange[0],
    rowY - 7,
    xRange[1],
    rowY + 7,
  ];
  const base = makeCropCanvas(
    bitmap,
    box,
    scale
  );

  // Maximum RGB suppresses yellow/green/blue row fill while retaining the
  // black printed digits and decimal point.
  const valueChannel = transformChannel(
    base,
    "max",
    false
  );

  return padCanvas(valueChannel, 28, 255);
}


async function readProgressionRawMeasurement(
  worker,
  bitmap,
  variable,
  rowY
) {
  if (!Number.isFinite(rowY)) {
    return {
      value: null,
      raw: [],
      method: "progression row unavailable",
    };
  }

  const primaryCanvas =
    progressionRawMeasurementCanvas(
      bitmap,
      rowY,
      CROPS.PROGRESSION_RAW_VALUE_X,
      12
    );

  const primary = await recognize(
    worker,
    primaryCanvas,
    {
      psm: 7,
      whitelist:
        "0123456789.mup",
    }
  );

  let value =
    parseProgressionRawMeasurement(
      primary.text,
      variable
    );

  const raw = [primary];

  if (!Number.isFinite(value)) {
    // Tighter backup crop excludes more of the adjacent stage number.
    const backupCanvas =
      progressionRawMeasurementCanvas(
        bitmap,
        rowY,
        [185, 260],
        14
      );

    const backup = await recognize(
      worker,
      backupCanvas,
      {
        psm: 8,
        whitelist:
          "0123456789.mup",
      }
    );

    raw.push(backup);
    value =
      parseProgressionRawMeasurement(
        backup.text,
        variable
      );
  }

  return {
    value:
      Number.isFinite(value) ? value : null,
    raw,
    method:
      "latest raw value beside ABCD progression bar",
  };
}


async function readProgressionRawABC(
  worker,
  bitmap,
  rowIndex = null,
  expectedRowCount = null
) {
  if (!bitmap) {
    return {
      A: null,
      B: null,
      C: null,
      rowYs: {},
      raw: [],
      method:
        "progression page unavailable",
    };
  }

  const aRows =
    detectColoredProgressionRowYs(
      bitmap,
      CROPS.PROGRESSION_A_ROW_DETECT
    );
  const bRows =
    detectColoredProgressionRowYs(
      bitmap,
      CROPS.PROGRESSION_B_ROW_DETECT
    );
  const cRows =
    detectColoredProgressionRowYs(
      bitmap,
      CROPS.PROGRESSION_C_ROW_DETECT
    );

  const chooseRow = (rows) => {
    if (!rows.length || (Number.isInteger(expectedRowCount) && rows.length !== expectedRowCount)) return null;
    if (Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < rows.length) {
      return rows[rowIndex];
    }
    return null;
  };

  const aRowY = chooseRow(aRows);
  const bRowY = chooseRow(bRows);
  const cRowY = chooseRow(cRows);

  const aRead = await readProgressionRawMeasurement(worker, bitmap, "A", aRowY);
  const bRead = await readProgressionRawMeasurement(worker, bitmap, "B", bRowY);
  const cRead = await readProgressionRawMeasurement(worker, bitmap, "C", cRowY);

  return {
    A: aRead.value,
    B: bRead.value,
    C: cRead.value,
    rowYs: {
      A: aRowY,
      B: bRowY,
      C: cRowY,
    },
    raw: [
      ...aRead.raw,
      ...bRead.raw,
      ...cRead.raw,
    ],
    method:
      "latest A/B/C progression-bar labels",
  };
}


function detectLatestProgressionRowY(bitmap) {
  const region = makeCropCanvas(bitmap, CROPS.PROGRESSION_ROW_DETECT, 1);
  const context = region.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, region.width, region.height);
  const data = image.data;
  const scores = [];

  for (let y = 0; y < region.height; y += 1) {
    let score = 0;
    for (let x = 0; x < region.width; x += 1) {
      const offset = (y * region.width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const maxValue = Math.max(r, g, b);
      const minValue = Math.min(r, g, b);
      const saturation = maxValue - minValue;
      const brightness = (r + g + b) / 3;
      if (saturation > 28 && maxValue > 75 && brightness < 248) score += 1;
    }
    scores.push(score);
  }

  const groups = [];
  let current = null;
  for (let y = 0; y < scores.length; y += 1) {
    if (scores[y] >= 3) {
      if (!current) current = { start: y, end: y, peak: scores[y] };
      else {
        current.end = y;
        current.peak = Math.max(current.peak, scores[y]);
      }
    } else if (current) {
      if (current.end - current.start >= 2) groups.push(current);
      current = null;
    }
  }
  if (current && current.end - current.start >= 2) groups.push(current);
  if (!groups.length) return null;

  const selected = groups[groups.length - 1];
  const center = (selected.start + selected.end) / 2;
  const referenceHeight = CROPS.PROGRESSION_ROW_DETECT[3] - CROPS.PROGRESSION_ROW_DETECT[1];
  return CROPS.PROGRESSION_ROW_DETECT[1] + (center / region.height) * referenceHeight;
}

function progressionCellCanvas(bitmap, box, scale = 10) {
  const base = makeCropCanvas(bitmap, box, scale);
  // Using the maximum RGB channel suppresses the blue/green/yellow row fill
  // while retaining the black printed characters.
  const valueChannel = transformChannel(base, "max", false);
  return padCanvas(valueChannel, 28, 255);
}

async function readProgressionCell(worker, bitmap, box, variable, preferredValue = null) {
  const canvas = progressionCellCanvas(bitmap, box, 10);
  const reads = [];
  for (const psm of [7, 8]) {
    reads.push(await recognize(worker, canvas, {
      psm,
      whitelist: variable === "classification" ? "ABCD01234" : "0123456789.-",
    }));
  }

  if (variable === "classification") {
    const classification = reads
      .map((item) => parseAbcClassification(item.text))
      .find(Boolean) || null;
    return { value: classification, raw: reads };
  }

  const selected = chooseCandidate(reads, variable, preferredValue);
  return { ...selected, raw: reads };
}

function parseProgressionSummaryLine(line) {
  const normalized = String(line || "").replace(/,/g, ".");
  const classification = parseAbcClassification(normalized);
  if (!classification) return null;

  const compact = normalized.toUpperCase().replace(/O/g, "0");
  const classMatch = compact.match(/A\s*[0-4]\s*B\s*[0-4]\s*C\s*[0-4]\s*D/i);
  if (!classMatch || !Number.isFinite(classMatch.index)) return null;
  const tail = compact.slice(classMatch.index + classMatch[0].length);
  const tokens = numericTokens(tail);
  if (tokens.length < 4) return { classification };

  const choose = (token, variable) => {
    const candidates = normalizedCandidates(token, variable);
    return candidates.length ? candidates[0].value : null;
  };

  return {
    classification,
    BAD_D: choose(tokens[0].token, "BAD_D"),
    progressionIndexAvg: choose(tokens[1].token, "PPImax"),
    ARTmax: choose(tokens[2].token, "ARTmax"),
    Kmax: choose(tokens[3].token, "Kmax"),
    rawLine: line,
  };
}

function parseProgressionTableText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = lines.map(parseProgressionSummaryLine).filter(Boolean);
  return parsed.length ? parsed[parsed.length - 1] : null;
}

async function readProgressionSummary(
  worker,
  bitmap,
  referenceTimestamp = null
) {
  if (!bitmap) {
    return {
      classification: null,
      A: null,
      B: null,
      C: null,
      BAD_D: null,
      ARTmax: null,
      Kmax: null,
      rowY: null,
      rowIndex: null,
      rowTimestamp: null,
      raw: [],
      method: "progression page unavailable",
    };
  }

  const fullBase = makeCropCanvas(bitmap, CROPS.PROGRESSION_TABLE, 3);
  const fullValue = transformChannel(fullBase, "max", false);
  const fullRead = await recognize(worker, padCanvas(fullValue, 20, 255), {
    psm: 6,
    whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789./: -|",
  });

  const rowChoice = await progressionRowChoice(
    worker,
    bitmap,
    referenceTimestamp
  );
  // No nearest-date or last-row substitution for an unmatched examination.
  if (!rowChoice.dateMatched) return {classification:null,A:null,B:null,C:null,
    BAD_D:null,ARTmax:null,Kmax:null,rowY:null,rowIndex:null,rowTimestamp:null,
    raw:[fullRead,...rowChoice.raw],fieldReadings:{},dateMatched:false,
    method:"Progression examination date could not be matched; not used as corroboration"};
  const rowY = rowChoice.rowY;
  const isLatestRow =
    rowChoice.index === null ||
    rowChoice.index === rowChoice.rowCount - 1;
  const parsed = isLatestRow
    ? (parseProgressionTableText(fullRead.text) || {})
    : {};

  const fieldReadings = {};
  const rawABC = await readProgressionRawABC(
    worker,
    bitmap,
    rowChoice.index, rowChoice.rowCount
  );
  const raw = [
    fullRead,
    ...rowChoice.raw,
    ...rawABC.raw,
  ];

  if (Number.isFinite(rowY)) {
    const classificationRead = await readProgressionCell(
      worker,
      bitmap,
      progressionRowBox(CROPS.PROGRESSION_CLASS_X, rowY),
      "classification"
    );
    if (classificationRead.value) parsed.classification = classificationRead.value;
    raw.push(...classificationRead.raw);

    const badRead = await readProgressionCell(
      worker,
      bitmap,
      progressionRowBox(CROPS.PROGRESSION_BAD_X, rowY),
      "BAD_D"
    );
    fieldReadings.BAD_D = [parsed.BAD_D, badRead.value].filter(Number.isFinite);
    if (Number.isFinite(badRead.value)) parsed.BAD_D = badRead.value;
    raw.push(...badRead.raw);

    const artRead = await readProgressionCell(
      worker,
      bitmap,
      progressionRowBox(CROPS.PROGRESSION_ART_X, rowY),
      "ARTmax"
    );
    fieldReadings.ARTmax = [parsed.ARTmax, artRead.value].filter(Number.isFinite);
    if (Number.isFinite(artRead.value)) parsed.ARTmax = artRead.value;
    raw.push(...artRead.raw);

    const kRead = await readProgressionCell(
      worker,
      bitmap,
      progressionRowBox(CROPS.PROGRESSION_KMAX_X, rowY),
      "Kmax"
    );
    fieldReadings.Kmax = [parsed.Kmax, kRead.value].filter(Number.isFinite);
    if (Number.isFinite(kRead.value)) parsed.Kmax = kRead.value;
    raw.push(...kRead.raw);
  }

  return {
    classification: parsed.classification || null,
    A: Number.isFinite(rawABC.A) ? rawABC.A : null,
    B: Number.isFinite(rawABC.B) ? rawABC.B : null,
    C: Number.isFinite(rawABC.C) ? rawABC.C : null,
    BAD_D: Number.isFinite(parsed.BAD_D) ? parsed.BAD_D : null,
    ARTmax: Number.isFinite(parsed.ARTmax) ? parsed.ARTmax : null,
    Kmax: Number.isFinite(parsed.Kmax) ? parsed.Kmax : null,
    progressionIndexAvg: Number.isFinite(parsed.progressionIndexAvg)
      ? parsed.progressionIndexAvg
      : null,
    rowY,
    rowIndex: rowChoice.index,
    dateMatched: rowChoice.dateMatched, fieldReadings,
    rowTimestamp: rowChoice.dates?.[rowChoice.index] || null,
    rowDates: rowChoice.dates,
    rawABCRows: rawABC.rowYs,
    raw,
    method:
      `date-matched ABCD row ${Number.isInteger(rowChoice.index) ? rowChoice.index + 1 : "latest"}` +
      " + progression-bar A/B/C cross-check",
  };
}


function weightedSourceCandidates(sources, variable) {
  const values = [];
  for (const source of sources) {
    if (!Number.isFinite(source.value)) continue;
    values.push({
      value: source.value,
      weight: Number(source.weight) || 1,
      source: source.source,
      stageScore:
        stageCompatibilityScore(variable, source.value, source.stage) +
        (Number(source.geometryScore) || 0),
    });
  }
  return values;
}

function selectStageConstrainedValue(variable, sources, stage = null) {
  const candidates = weightedSourceCandidates(
    sources.map((source) => ({ ...source, stage })),
    variable
  );
  if (!candidates.length) return { value: null, source: null, candidates: [] };

  const unique = [];
  for (const candidate of candidates) {
    let group = unique.find((item) => Math.abs(item.value - candidate.value) <= TOLERANCE[variable]);
    if (!group) {
      group = { value: candidate.value, score: 0, sources: [] };
      unique.push(group);
    }
    group.score += candidate.weight + candidate.stageScore;
    group.sources.push(candidate.source);
  }

  unique.sort((left, right) => right.score - left.score);
  const selected = unique[0];
  return {
    value: selected.value,
    source: selected.sources.join(" + "),
    candidates: unique,
    stageCompatible: stageCompatible(variable, selected.value, stage),
  };
}

function selectABPair(aSources, bSources, aStage = null, bStage = null) {
  const aCandidates = weightedSourceCandidates(
    aSources.map((source) => ({ ...source, stage: aStage })),
    "A"
  );
  const bCandidates = weightedSourceCandidates(
    bSources.map((source) => ({ ...source, stage: bStage })),
    "B"
  );
  if (!aCandidates.length || !bCandidates.length) {
    return {
      A: selectStageConstrainedValue("A", aSources, aStage),
      B: selectStageConstrainedValue("B", bSources, bStage),
      pairScore: null,
    };
  }

  let best = null;
  for (const a of aCandidates) {
    for (const b of bCandidates) {
      const difference = a.value - b.value;
      let score = a.weight + b.weight + a.stageScore + b.stageScore;
      if (difference > 0.75 && difference < 3.2) score += 7;
      else score -= 12;
      score += Math.max(-3, 4 - Math.abs(difference - 1.68) * 2.2);
      if (Math.abs(a.value - b.value) < 0.12) score -= 8;
      if (!best || score > best.score) best = { a, b, score };
    }
  }

  return {
    A: {
      value: best?.a?.value ?? null,
      source: best?.a?.source ?? null,
      candidates: aCandidates,
      stageCompatible: stageCompatible("A", best?.a?.value, aStage),
    },
    B: {
      value: best?.b?.value ?? null,
      source: best?.b?.source ?? null,
      candidates: bCandidates,
      stageCompatible: stageCompatible("B", best?.b?.value, bStage),
    },
    pairScore: best?.score ?? null,
  };
}

async function readTopometricLabeledRow(worker, bitmap, box, patterns, variable) {
  const base = makeCropCanvas(bitmap, box, 6);
  const gray = transformChannel(base, "gray", false);
  const read = await recognize(worker, padCanvas(gray, 24, 255), {
    psm: 6,
    whitelist: "",
  });
  return {
    value: parseLabeledNumericLine(read.text, patterns, variable),
    raw: [read],
  };
}

function parsePanelValue(text, labelPattern, variable) {
  return parseLabeledNumericLine(text, [labelPattern], variable);
}


function parseBelinPanel(text) {
  const normalized = String(text || "").replace(/\s+/g, " ");
  const eye = lateralityFromText(normalized);

  return {
    eye,
    C: parsePanelValue(text, /PACHY\s*THIN/i, "C"),
    Kmax: parsePanelValue(text, /K\s*M\s*A\s*X/i, "Kmax"),
    PPImax: parseProgressionIndexMax(text),
    ARTmax: parsePanelValue(text, /ART\s*MAX/i, "ARTmax"),
  };
}


function lineForLabel(text, patterns) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.find((line) =>
    patterns.some((pattern) => pattern.test(line))
  ) || "";
}


function parseLabeledNumericLine(text, patterns, variable) {
  const line = lineForLabel(text, patterns);
  if (!line) return null;

  // Remove the label area before evaluating numeric candidates. This avoids
  // accidentally choosing the 3 in "3mm Zone" or a nearby ABC stage value.
  let tail = line;
  for (const pattern of patterns) {
    const match = tail.match(pattern);
    if (match && Number.isFinite(match.index)) {
      tail = tail.slice(match.index + match[0].length);
      break;
    }
  }

  const candidates = [];
  numericTokens(tail).forEach(({ token }) => {
    candidates.push(...normalizedCandidates(token, variable));
  });

  if (!candidates.length) return null;
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0].value;
}


function parseTopometricAbcPanel(text) {
  return {
    A: parseLabeledNumericLine(
      text,
      [/ARC\s*[\[(]?\s*3\s*MM\s*ZONE\s*[\])]?\s*[:)]?/i],
      "A"
    ),
    B: parseLabeledNumericLine(
      text,
      [/PRC\s*[\[(]?\s*3\s*MM\s*ZONE\s*[\])]?\s*[:)]?/i],
      "B"
    ),
    C: parseLabeledNumericLine(
      text,
      [/THINNEST\s+PACHY\s*:?/i],
      "C"
    ),
  };
}


async function readTopometricAbcPanel(worker, bitmap) {
  const base = makeCropCanvas(bitmap, CROPS.TOPOMETRIC_ABC_PANEL, 4);
  const gray = transformChannel(base, "gray", false);
  const canvas = padCanvas(gray, 24, 255);
  const result = await recognize(worker, canvas, { psm: 6, whitelist: "" });
  return {
    result,
    parsed: parseTopometricAbcPanel(result.text),
  };
}


function parseProgressionIndexMax(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (!/^\s*MAX\s*:/i.test(line)) continue;
    const match = line.match(/^\s*MAX\s*:\s*[^0-9-]*(-?\d+(?:[.,]\d+)?)/i);
    if (!match) continue;
    const selected = chooseCandidate(
      [{ text: match[1], confidence: 80 }],
      "PPImax"
    );
    if (Number.isFinite(selected.value)) return selected.value;
  }
  return null;
}

async function readBelinPanel(worker, bitmap) {
  const result = await recognize(worker, panelCanvas(bitmap), { psm: 6, whitelist: "" });
  return { result, parsed: parseBelinPanel(result.text) };
}

async function recognizeLateralityRegion(worker, bitmap, box, options = {}) {
  const attempts = [
    { psm: 7, threshold: false, invert: false },
    { psm: 6, threshold: false, invert: false },
    { psm: 11, threshold: true, invert: false },
    { psm: 8, threshold: true, invert: true },
  ];

  for (const attempt of attempts) {
    const result = await recognize(
      worker,
      lateralityCanvas(
        bitmap,
        box,
        options.scale || 8,
        attempt.threshold,
        attempt.invert
      ),
      {
        psm: attempt.psm,
        whitelist: options.whitelist || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz: ",
      }
    );
    const eye = lateralityFromText(result.text);
    if (eye) return { eye, text: result.text, confidence: result.confidence };
  }
  return { eye: null, text: "", confidence: 0 };
}

async function collectEyeEvidence(worker, topometricBitmap, belinBitmap, belinPanel = null) {
  const scores = { OD: 0, OS: 0 };
  const evidence = [];

  if (belinPanel?.parsed?.eye) {
    addEyeEvidence(
      scores,
      evidence,
      belinPanel.parsed.eye,
      7,
      "Belin labeled patient panel",
      belinPanel.result?.text,
      belinPanel.result?.confidence
    );
  }

  const explicitSources = [
    {
      bitmap: topometricBitmap,
      box: CROPS.TOPOMETRIC_EYE_VALUE,
      weight: 10,
      source: "Topometric Eye: Right/Left field",
      scale: 10,
    },
    {
      bitmap: topometricBitmap,
      box: CROPS.TOPOMETRIC_EYE_PANEL,
      weight: 7,
      source: "Topometric patient panel",
      scale: 7,
    },
  ];

  if (belinBitmap) {
    explicitSources.push({
      bitmap: belinBitmap,
      box: CROPS.BELIN_EYE_VALUE,
      weight: 10,
      source: "Belin Eye: Right/Left field",
      scale: 10,
    });
  }

  for (const source of explicitSources) {
    const result = await recognizeLateralityRegion(
      worker,
      source.bitmap,
      source.box,
      source
    );
    addEyeEvidence(
      scores,
      evidence,
      result.eye,
      source.weight,
      source.source,
      result.text,
      result.confidence
    );
  }

  // Only consult map labels when explicit fields did not produce a clear margin.
  if (!chooseEyeFromScores(scores, 3)) {
    const mapSources = [
      {
        bitmap: topometricBitmap,
        box: CROPS.TOPOMETRIC_MAP_EYE_FRONT,
        weight: 2,
        source: "Topometric front map OD/OS",
        scale: 8,
        whitelist: "ODSLR",
      },
      {
        bitmap: topometricBitmap,
        box: CROPS.TOPOMETRIC_MAP_EYE_BACK,
        weight: 2,
        source: "Topometric back map OD/OS",
        scale: 8,
        whitelist: "ODSLR",
      },
    ];

    if (belinBitmap) {
      mapSources.push({
        bitmap: belinBitmap,
        box: CROPS.BELIN_MAP_EYE,
        weight: 2,
        source: "Belin map OD/OS",
        scale: 8,
        whitelist: "ODSLR",
      });
    }

    for (const source of mapSources) {
      const result = await recognizeLateralityRegion(
        worker,
        source.bitmap,
        source.box,
        source
      );
      addEyeEvidence(
        scores,
        evidence,
        result.eye,
        source.weight,
        source.source,
        result.text,
        result.confidence
      );
    }
  }

  return {
    eye: chooseEyeFromScores(scores, 1.5),
    scores,
    evidence,
    margin: Math.abs(scores.OD - scores.OS),
  };
}



function consensus(values, tolerance, preferred = null) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return { value: null, agreements: 0, conflict: false };

  const clusters = [];
  finite.forEach((value) => {
    let cluster = clusters.find((item) => Math.abs(item.mean - value) <= tolerance);
    if (!cluster) {
      cluster = { values: [], mean: value };
      clusters.push(cluster);
    }
    cluster.values.push(value);
    cluster.mean = cluster.values.reduce((sum, item) => sum + item, 0) / cluster.values.length;
  });

  clusters.sort((a, b) => {
    if (b.values.length !== a.values.length) return b.values.length - a.values.length;
    if (Number.isFinite(preferred)) return Math.abs(a.mean - preferred) - Math.abs(b.mean - preferred);
    return 0;
  });

  const best = clusters[0];
  const value = Number.isFinite(preferred) && best.values.some((item) => Math.abs(item - preferred) <= tolerance)
    ? preferred
    : best.mean;

  return {
    value: Math.round(value * 1000) / 1000,
    agreements: best.values.length,
    conflict: clusters.length > 1 && best.values.length < 2,
  };
}

function qualityLabel({ agreements = 1, conflict = false, available = true }) {
  if (!available) return "Unavailable";
  if (conflict) return "Moderate";
  if (agreements >= 2) return "High";
  return "Moderate";
}



function sourceAgreementCount(
  values,
  selectedValue,
  tolerance
) {
  if (!Number.isFinite(selectedValue)) {
    return 0;
  }

  return values.filter(
    (value) =>
      Number.isFinite(value) &&
      Math.abs(value - selectedValue) <= tolerance
  ).length;
}


function reconcilePrimaryWithProgression({
  variable,
  primaryValue,
  progressionValue,
  primaryTrusted,
  stage = null,
  allowProgressionRescue = true,
  primaryLabel,
}) {
  /*
   * The established KC-Staging/Belin extraction remains primary.
   * The ABCD progression display is a cross-check and a rescue source only
   * when the primary result is missing or internally weak.
   */
  const progressionValid =
    plausible(variable, progressionValue) &&
    stageCompatible(
      variable,
      progressionValue,
      stage
    ) !== false;

  if (!Number.isFinite(primaryValue)) {
    if (
      allowProgressionRescue &&
      progressionValid
    ) {
      return {
        value: progressionValue,
        quality: "Moderate",
        status:
          "primary unavailable; rescued from ABCD progression display",
        agreed: false,
        usedProgression: true,
      };
    }

    return {
      value: null,
      quality: "Unavailable",
      status:
        "neither the primary source nor progression cross-check was reliable",
      agreed: false,
      usedProgression: false,
    };
  }

  if (!progressionValid) {
    return {
      value: primaryValue,
      quality:
        primaryTrusted ? "High" : "Moderate",
      status:
        `${primaryLabel} retained; progression cross-check unavailable`,
      agreed: false,
      usedProgression: false,
    };
  }

  const difference =
    Math.abs(primaryValue - progressionValue);

  if (difference <= TOLERANCE[variable]) {
    return {
      value: primaryValue,
      quality: "High",
      status:
        `${primaryLabel} confirmed by ABCD progression display`,
      agreed: true,
      usedProgression: false,
    };
  }

  if (
    allowProgressionRescue &&
    !primaryTrusted
  ) {
    return {
      value: progressionValue,
      quality: "Moderate",
      status:
        `weak/conflicting primary extraction replaced by stage-compatible ABCD progression value`,
      agreed: false,
      usedProgression: true,
    };
  }

  return {
    value: primaryValue,
    quality: "Moderate",
    status:
      `${primaryLabel} retained, but progression display disagreed by ${difference.toFixed(
        variable === "C" ? 0 : 2
      )}`,
    agreed: false,
    usedProgression: false,
  };
}


function artmaxAgreementTolerance(referenceValue) {
  /*
   * Direct and derived ARTmax values are considered concordant when they
   * differ by no more than 8 µm or 3% of the direct value, whichever is larger.
   */
  if (!Number.isFinite(referenceValue)) return TOLERANCE.ARTmax;
  return Math.max(8, Math.abs(referenceValue) * 0.03);
}


function selectArtmaxStandard({
  printedARTmax,
  printedSource,
  progressionARTmax,
  calculatedARTmax,
  calculationConfidence = "none",
}) {
  /*
   * Direct printed values remain primary. When no direct value is readable,
   * a deterministic C / PPImax value is populated instead of leaving ARTmax
   * blank. A two-source PPI consensus is High confidence; a strong single
   * PPI read is labeled Calculated.
   */
  const printedValid = plausible("ARTmax", printedARTmax);
  const progressionValid = plausible("ARTmax", progressionARTmax);
  const calculatedValid =
    calculationConfidence !== "none" &&
    plausible("ARTmax", calculatedARTmax);

  const agrees = (left, right) => (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <= artmaxAgreementTolerance(left)
  );

  const directAgreement = printedValid && progressionValid && Math.abs(printedARTmax-progressionARTmax) <= .51;
  const chosenDirect = printedValid ? printedARTmax : progressionValid ? progressionARTmax : null;
  // A weak isolated OCR digit must not outrank the independent C/PPI identity.
  // Preserve the conflicting direct reads in the audit and require review.
  if (calculatedValid && !directAgreement && Number.isFinite(chosenDirect) &&
      !agrees(chosenDirect,calculatedARTmax) && chosenDirect < 10) {
    return {value:Math.round(calculatedARTmax),quality:'Calculated',derived:true,statusLabel:'Review source',
      method:'Approximate C / printed PPImax candidate; conflicting direct OCR requires source review',
      calculationStatus:'Tentative calculated candidate, not a verified printed ARTmax'};
  }

  if (printedValid) {
    const progressionConfirms = agrees(printedARTmax, progressionARTmax);
    const calculationConfirms = agrees(printedARTmax, calculatedARTmax);
    return {
      value: Math.round(printedARTmax),
      quality: progressionConfirms || calculationConfirms ? "High" : "Moderate",
      method: progressionConfirms
        ? `${printedSource} retained; confirmed by progression table`
        : calculationConfirms
          ? `${printedSource} retained; confirmed by C ÷ PPImax`
          : `${printedSource} retained as the primary direct measurement`,
      calculationStatus: calculationConfirms
        ? "accepted as a confirming cross-check only"
        : calculatedValid
          ? "derived check did not replace the printed value"
          : "not available",
      derived: false,
      statusLabel: "Confirmed",
    };
  }

  if (progressionValid) {
    const calculationConfirms = agrees(progressionARTmax, calculatedARTmax);
    return {
      value: Math.round(progressionARTmax),
      quality: calculationConfirms ? "High" : "Moderate",
      method: calculationConfirms
        ? "ABCD progression-table ARTmax retained; confirmed by C ÷ PPImax"
        : "ABCD progression-table ARTmax retained as a direct measurement",
      calculationStatus: calculationConfirms
        ? "accepted as a confirming cross-check only"
        : calculatedValid
          ? "derived check disagreed with the direct progression value"
          : "not available",
      derived: false,
      statusLabel: "Confirmed",
    };
  }

  if (calculatedValid) {
    return {
      value: Math.round(calculatedARTmax),
      quality: calculationConfidence === "confirmed" ? "High" : "Calculated",
      method:
        calculationConfidence === "confirmed"
          ? "calculated from C ÷ repeated PPImax readings; verify against the source"
          : "approximate C ÷ printed PPImax candidate; verify both source inputs",
      calculationStatus: "used as the final fallback because no direct ARTmax was readable",
      derived: true,
      statusLabel: "Calculated",
    };
  }

  return {
    value: null,
    quality: "Unavailable",
    method: "unavailable",
    calculationStatus: "no direct ARTmax or reliable PPImax was available",
    derived: false,
    statusLabel: "Review",
  };
}



function hasMaterialSourceConflict(variable, finalValue, values) {
  if (!Number.isFinite(finalValue)) return true;
  const materialTolerance = Math.max(
    TOLERANCE[variable] * 2.5,
    variable === "C" ? 6 : variable === "ARTmax" ? 15 : 0.10
  );
  return (values || []).some((value) =>
    Number.isFinite(value) &&
    Math.abs(value - finalValue) > materialTolerance
  );
}

function independentAgreementCount(variable, finalValue, namedSources) {
  /*
   * Count distinct source families that agree with the final value. Repeated
   * threshold/OCR passes on the same crop are not listed here and therefore do
   * not create false confidence.
   */
  if (!Number.isFinite(finalValue)) return 0;
  const agreeing = new Set();
  for (const [sourceName, sourceValue] of Object.entries(namedSources || {})) {
    if (
      Number.isFinite(sourceValue) &&
      Math.abs(sourceValue - finalValue) <= TOLERANCE[variable]
    ) {
      agreeing.add(sourceName);
    }
  }
  return agreeing.size;
}

function hardStageConstraintPasses(variable, value, printedStage) {
  // Only an explicitly printed ABCD stage is a hard gate. Stage-bar geometry
  // is a diagnostic check and is not allowed to force verification on legacy
  // layouts where panel geometry differs.
  if (!Number.isInteger(printedStage)) return true;
  return stageCompatible(variable, value, printedStage) !== false;
}

function progressionFieldPreviewCanvas(bitmap, variable, progression) {
  if (!bitmap || !progression) return null;

  if (["A", "B", "C"].includes(variable)) {
    const rowY = progression.rawABCRows?.[variable];
    if (!Number.isFinite(rowY)) return null;
    return makeCropCanvas(
      bitmap,
      [65, Math.max(0, rowY - 18), 330, Math.min(REFERENCE_HEIGHT, rowY + 18)],
      7
    );
  }

  const rowY = progression.rowY;
  if (!Number.isFinite(rowY)) return null;
  const xRange = {
    Kmax: CROPS.PROGRESSION_KMAX_X,
    BAD_D: CROPS.PROGRESSION_BAD_X,
    ARTmax: CROPS.PROGRESSION_ART_X,
  }[variable];
  if (!xRange) return null;

  return makeCropCanvas(
    bitmap,
    [xRange[0] - 10, rowY - 16, xRange[1] + 12, rowY + 16],
    13
  );
}


function verificationPreviewDataUrl({
  variable,
  descriptor,
  topometricBitmap,
  belinBitmap,
  progressionBitmap,
  progression,
  abcFields = null,
  auditItem = null,
}) {
  // For A/B/C, always show the dynamically located labeled row. This keeps
  // the raw value and its ARC/PRC/Thinnest label aligned on current and legacy
  // reports and excludes the adjacent staging number.
  if (["A", "B", "C"].includes(variable) && abcFields?.[variable]?.rowBox) {
    return makeCropCanvas(
      topometricBitmap,
      abcFields[variable].rowBox,
      5
    ).toDataURL("image/png");
  }

  // Difficult colored fields always show the exact detected result box first.
  if (variable === "BAD_D") {
    const detected = findRightmostColoredBoxCanvas(belinBitmap);
    if (detected) return detected.toDataURL("image/png");
    if (Number.isFinite(progression?.BAD_D)) {
      const progressionCanvas = progressionFieldPreviewCanvas(
        progressionBitmap,
        variable,
        progression
      );
      if (progressionCanvas) return progressionCanvas.toDataURL("image/png");
    }
    return makeCropCanvas(belinBitmap, CROPS.BAD_D, 14).toDataURL("image/png");
  }

  if (variable === "ARTmax") {
    // A calculated fallback is represented as a formula card in the UI, not
    // by an unrelated image. Direct values use only clearly labeled sources.
    // Keep the labeled ART/PPI source visible even for a calculated fallback.
    if (Number.isFinite(progression?.ARTmax)) {
      const progressionCanvas = progressionFieldPreviewCanvas(
        progressionBitmap,
        variable,
        progression
      );
      if (progressionCanvas) return progressionCanvas.toDataURL("image/png");
    }
    const legacy =
      String(descriptor?.sourceFormat || "").includes("legacy") ||
      String(descriptor?.pageResolution || "").includes("legacy");
    const box = legacy
      ? CROPS.LEGACY_PREVIEW_ARTMAX_PANEL
      : CROPS.PREVIEW_ARTMAX;
    return makeCropCanvas(belinBitmap, box, legacy ? 3 : 5).toDataURL("image/png");
  }

  const progressionValue = {
    A: progression?.A,
    B: progression?.B,
    C: progression?.C,
    Kmax: progression?.Kmax,
  }[variable];

  if (Number.isFinite(progressionValue)) {
    const progressionCanvas = progressionFieldPreviewCanvas(
      progressionBitmap,
      variable,
      progression
    );
    if (progressionCanvas) return progressionCanvas.toDataURL("image/png");
  }

  const legacy =
    String(descriptor?.sourceFormat || "").includes("legacy") ||
    String(descriptor?.pageResolution || "").includes("legacy");

  let bitmap;
  let box;
  let scale = 3;

  if (legacy) {
    if (["A", "B", "C"].includes(variable)) {
      bitmap = topometricBitmap;
      box = CROPS.LEGACY_PREVIEW_ABC_PANEL;
      scale = 2.6;
    } else if (variable === "Kmax") {
      bitmap = topometricBitmap;
      box = CROPS.LEGACY_PREVIEW_KMAX_PANEL;
      scale = 2.4;
    }
  } else {
    const current = {
      A: [topometricBitmap, CROPS.PREVIEW_A, 4],
      B: [topometricBitmap, CROPS.PREVIEW_B, 4],
      C: [topometricBitmap, CROPS.PREVIEW_C, 4],
      Kmax: [topometricBitmap, CROPS.PREVIEW_KMAX, 4],
    }[variable];
    if (current) [bitmap, box, scale] = current;
  }

  if (!bitmap || !box) return null;
  return makeCropCanvas(bitmap, box, scale).toDataURL("image/png");
}


function studyComplete(study) {
  return ["A", "B", "C", "Kmax", "BAD_D", "ARTmax"].every((variable) => {
    const value = study?.values?.[variable];
    return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  });
}

async function extractStudy(descriptor, worker) {
  const topometricBlob = await descriptor.zip.file(descriptor.pages.topometric).async("blob");
  const belinBlob = await descriptor.zip.file(descriptor.pages.belin).async("blob");
  const progressionBlob = descriptor.pages.progression
    ? await descriptor.zip.file(descriptor.pages.progression).async("blob")
    : null;

  const topometricBitmap = await blobToBitmap(topometricBlob);
  const belinBitmap = await blobToBitmap(belinBlob);
  const progressionBitmap = progressionBlob ? await blobToBitmap(progressionBlob) : null;

  const panel = await readBelinPanel(worker, belinBitmap);
  const progression = await readProgressionSummary(
    worker,
    progressionBitmap,
    descriptor.timestamp || null
  );
  const eyeEvidence = await collectEyeEvidence(
    worker,
    topometricBitmap,
    belinBitmap,
    panel
  );
  let eye = descriptor.forcedEye || eyeEvidence.eye;
  if (descriptor.forcedEye) {
    if (eyeEvidence.eye && eyeEvidence.eye !== descriptor.forcedEye && !String(descriptor.sourceFormat || '').includes('operator')) {
      eye = null;
      eyeEvidence.resolution = "Filename and printed eye disagree; source association required";
    } else {
      eyeEvidence.eye = descriptor.forcedEye;
      eyeEvidence.resolution = "from source association / filename";
    }
  }

  const abcPanel = await readTopometricAbcPanel(worker, topometricBitmap);
  const abcFields = detectTopometricAbcFieldStack(topometricBitmap);
  const aStage = progression.classification?.A ?? null;
  const bStage = progression.classification?.B ?? null;
  const cStage = progression.classification?.C ?? null;

  // The detected L-shaped value boxes are authoritative for locating A/B/C.
  // Fixed coordinates are retained only as a fallback when the stack cannot
  // be detected. This prevents A from being confused with B, C, or a stage.
  const aValueBox = abcFields?.A?.valueBox || CROPS.A;
  const bValueBox = abcFields?.B?.valueBox || CROPS.B;
  const aRowBox = abcFields?.A?.rowBox || CROPS.A_LABELED_ROW;
  const bRowBox = abcFields?.B?.rowBox || CROPS.B_LABELED_ROW;

  const Arow = await readTopometricLabeledRow(
    worker,
    topometricBitmap,
    aRowBox,
    [/ARC\s*[\[(]?\s*3\s*MM\s*ZONE\s*[\])]?\s*[:)]*/i],
    "A"
  );
  const Brow = await readTopometricLabeledRow(
    worker,
    topometricBitmap,
    bRowBox,
    [/PRC\s*[\[(]?\s*3\s*MM\s*ZONE\s*[\])]?\s*[:)]*/i],
    "B"
  );
  const Aexact = await readGrayFieldEnsemble(
    worker,
    topometricBitmap,
    aValueBox,
    "A"
  );
  const Bexact = await readGrayFieldEnsemble(
    worker,
    topometricBitmap,
    bValueBox,
    "B"
  );
  const legacyLayout =
    String(descriptor.sourceFormat || "").includes("legacy") ||
    String(descriptor.pageResolution || "").includes("legacy");

  // Stage-bar geometry is reliable on current PdfReport layouts, but legacy
  // pages use different panel geometry. On legacy pages it is disabled rather
  // than allowed to create false verification flags or bias A/B selection.
  const topometricStageA = legacyLayout
    ? null
    : detectTopometricStageBar(topometricBitmap, "A");
  const topometricStageB = legacyLayout
    ? null
    : detectTopometricStageBar(topometricBitmap, "B");
  const topometricStageC = legacyLayout
    ? null
    : detectTopometricStageBar(topometricBitmap, "C");

  // Only the explicitly printed stage from the progression display is a hard
  // categorical constraint. The visual stage bar remains a soft diagnostic.
  const aStageConstraint = Number.isInteger(aStage) ? aStage : null;
  const bStageConstraint = Number.isInteger(bStage) ? bStage : null;
  const abSelection = selectABPair(
    [
      { value: Aexact.value, weight: abcFields ? 18 : 10, source: "detected ARC value box", geometryScore: stageBarScore("A", Aexact.value, topometricStageA) },
      { value: Arow.value, weight: abcFields ? 16 : 11, source: "detected ARC labeled row", geometryScore: stageBarScore("A", Arow.value, topometricStageA) },
      { value: abcPanel.parsed.A, weight: 5, source: "full KC-Staging panel fallback", geometryScore: stageBarScore("A", abcPanel.parsed.A, topometricStageA) },
    ],
    [
      { value: Bexact.value, weight: abcFields ? 18 : 10, source: "detected PRC value box", geometryScore: stageBarScore("B", Bexact.value, topometricStageB) },
      { value: Brow.value, weight: abcFields ? 16 : 11, source: "detected PRC labeled row", geometryScore: stageBarScore("B", Brow.value, topometricStageB) },
      { value: abcPanel.parsed.B, weight: 5, source: "full KC-Staging panel fallback", geometryScore: stageBarScore("B", abcPanel.parsed.B, topometricStageB) },
    ],
    aStageConstraint,
    bStageConstraint
  );
  const Aprimary = abSelection.A.value;
  const Bprimary = abSelection.B.value;

  const aPrimaryAgreements = sourceAgreementCount(
    [
      abcPanel.parsed.A,
      Arow.value,
      Aexact.value,
    ],
    Aprimary,
    TOLERANCE.A
  );
  const bPrimaryAgreements = sourceAgreementCount(
    [
      abcPanel.parsed.B,
      Brow.value,
      Bexact.value,
    ],
    Bprimary,
    TOLERANCE.B
  );

  const aCrossCheck =
    reconcilePrimaryWithProgression({
      variable: "A",
      primaryValue: Aprimary,
      progressionValue: progression.A,
      primaryTrusted:
        abSelection.A.stageCompatible !== false &&
        aPrimaryAgreements >= 2 &&
        stageBarCompatibility("A", Aprimary, topometricStageA)?.compatible !== false,
      stage: aStageConstraint,
      allowProgressionRescue: true,
      primaryLabel: "KC-Staging A/ARC",
    });

  const bCrossCheck =
    reconcilePrimaryWithProgression({
      variable: "B",
      primaryValue: Bprimary,
      progressionValue: progression.B,
      primaryTrusted:
        abSelection.B.stageCompatible !== false &&
        bPrimaryAgreements >= 2 &&
        stageBarCompatibility("B", Bprimary, topometricStageB)?.compatible !== false,
      stage: bStageConstraint,
      allowProgressionRescue: true,
      primaryLabel: "KC-Staging B/PRC",
    });

  const A = aCrossCheck.value;
  const B = bCrossCheck.value;

  const CstageValue = abcPanel.parsed.C;
  const CduplicateRead = await readGrayFieldEnsemble(
    worker,
    topometricBitmap,
    CROPS.C_DUPLICATE,
    "C"
  );
  const Cselection = selectStageConstrainedValue(
    "C",
    [
      { value: CstageValue, weight: 9, source: "KC-Staging labeled ABC panel" },
      { value: CduplicateRead.value, weight: 10, source: "duplicate Topometric thinnest-pachy field" },
      { value: panel.parsed.C, weight: 10, source: "Belin/Ambrósio thinnest-pachy field" },
    ],
    cStage
  );
  const Cprimary = Cselection.value;
  const cPrimaryAgreements = sourceAgreementCount(
    [
      CstageValue,
      CduplicateRead.value,
      panel.parsed.C,
    ],
    Cprimary,
    TOLERANCE.C
  );

  const cCrossCheck =
    reconcilePrimaryWithProgression({
      variable: "C",
      primaryValue: Cprimary,
      progressionValue: progression.C,
      primaryTrusted:
        Cselection.stageCompatible !== false &&
        cPrimaryAgreements >= 2,
      stage: cStage,
      allowProgressionRescue: true,
      primaryLabel:
        "KC-Staging/Belin thinnest pachymetry",
    });

  const C = cCrossCheck.value;

  const KtopRead = await readGrayFieldEnsemble(
    worker,
    topometricBitmap,
    CROPS.KMAX_TOPOMETRIC,
    "Kmax"
  );
  const kPrimaryConsensus = consensus(
    [
      KtopRead.value,
      panel.parsed.Kmax,
    ],
    TOLERANCE.Kmax,
    Number.isFinite(panel.originalParsed?.Kmax) ? panel.originalParsed.Kmax : KtopRead.value
  );

  const kCrossCheck =
    reconcilePrimaryWithProgression({
      variable: "Kmax",
      primaryValue:
        kPrimaryConsensus.value,
      progressionValue:
        progression.Kmax,
      primaryTrusted:
        kPrimaryConsensus.agreements >= 2 &&
        !kPrimaryConsensus.conflict,
      allowProgressionRescue: true,
      primaryLabel:
        "Topometric/Belin Kmax",
    });

  const Kmax = kCrossCheck.value;

  // ARTmax direct sources remain primary. If no direct value is readable,
  // populate ARTmax deterministically from confirmed C and the strongest
  // available PPImax reading instead of leaving the field blank.
  const PPIread = await readGrayFieldEnsemble(
    worker,
    belinBitmap,
    CROPS.PPI_MAX,
    "PPImax"
  );
  const PPIrowRead = await readTopometricLabeledRow(
    worker,
    belinBitmap,
    CROPS.PPI_MAX_LABELED_ROW,
    [/^\s*MAX\s*:?/i],
    "PPImax"
  );

  const ppiPanelValue = panel.parsed.PPImax;
  const ppiExactValue = PPIread.value;
  const ppiRowValue = PPIrowRead.value;
  const ppiConsensus = directSourceConsensus(
    "PPImax",
    [
      { name: "Belin labeled panel", value: ppiPanelValue, weight: 8 },
      { name: "exact PPImax box", value: ppiExactValue, weight: 7 },
      { name: "labeled Max row", value: ppiRowValue, weight: 6 },
    ],
    ["exact PPImax box", "labeled Max row", "Belin labeled panel"]
  );

  const ppiConfirmed = ppiConsensus.agreements >= 2;
  const ppiStrongSingle =
    !ppiConfirmed &&
    (
      (plausible("PPImax", ppiExactValue) && PPIread.agreeingReads >= 2) ||
      (plausible("PPImax", ppiRowValue) && (PPIrowRead.raw?.[0]?.confidence || 0) >= 50) ||
      (plausible("PPImax", ppiPanelValue) && (panel.result?.confidence || 0) >= 50)
    );

  let selectedPPImax = ppiConsensus.value;
  if (!plausible("PPImax", selectedPPImax)) {
    if (plausible("PPImax", ppiExactValue) && PPIread.agreeingReads >= 2) {
      selectedPPImax = ppiExactValue;
    } else if (plausible("PPImax", ppiRowValue)) {
      selectedPPImax = ppiRowValue;
    } else if (plausible("PPImax", ppiPanelValue)) {
      selectedPPImax = ppiPanelValue;
    }
  }

  const calculationConfidence = ppiConfirmed
    ? "confirmed"
    : plausible("PPImax", selectedPPImax) && ppiStrongSingle
      ? "single"
      : plausible("PPImax", selectedPPImax) ? "candidate" : "none";

  const calculatedFromPanelPPI =
    Number.isFinite(C) && plausible("PPImax", ppiPanelValue)
      ? Math.round(C / ppiPanelValue)
      : null;
  const calculatedFromExactPPI =
    Number.isFinite(C) && plausible("PPImax", ppiExactValue)
      ? Math.round(C / ppiExactValue)
      : null;
  const calculatedFromRowPPI =
    Number.isFinite(C) && plausible("PPImax", ppiRowValue)
      ? Math.round(C / ppiRowValue)
      : null;
  const calculatedArt =
    Number.isFinite(C) && plausible("PPImax", selectedPPImax)
      ? Math.round(C / selectedPPImax)
      : null;

  const ARTread = panel.anchored?.fields?.ARTmax?.valueBox
    ? panel.anchored.fields.ARTmax
    : await readColorField(
    worker,
    belinBitmap,
    panel.anchored?.fields?.ARTmax?.valueBox || CROPS.ART_MAX,
    "ARTmax",
    null
  );

  // The previous generic bottom-right colored-box detector could select a
  // graph element. It is intentionally excluded from ARTmax source selection.
  const artBelinConsensus = directSourceConsensus(
    "ARTmax",
    [
      { name: "labeled panel", value: panel.parsed.ARTmax, weight: 6 },
      { name: "exact ARTmax box", value: ARTread.value, weight: 7 },
    ],
    ["exact ARTmax box", "labeled panel"]
  );

  const printedARTmax = artBelinConsensus.value;
  const printedARTmaxSource = artBelinConsensus.sources.length
    ? `printed Belin ${artBelinConsensus.sources.join(" + ")}`
    : "printed Belin ARTmax unavailable";
  const progressionArt = progression.ARTmax;
  const impliedPPImaxFromPrintedART =
    Number.isFinite(C) && plausible("ARTmax", printedARTmax) && printedARTmax > 0
      ? Math.round((C / printedARTmax) * 1000) / 1000
      : null;

  const artDecision = selectArtmaxStandard({
    printedARTmax,
    printedSource: printedARTmaxSource,
    progressionARTmax: progressionArt,
    calculatedARTmax: calculatedArt,
    calculationConfidence,
  });

  const ARTmax = artDecision.value;
  const artMethod = artDecision.method;

  const belinBad = await readBadDResilient(
    worker,
    belinBitmap,
    progressionBitmap
  );

  const badPrimaryTrusted =
    belinBad.quality === "High" &&
    belinBad.autoConfirmed === true;

  const badCrossCheck =
    reconcilePrimaryWithProgression({
      variable: "BAD_D",
      primaryValue: belinBad.value,
      progressionValue:
        progression.BAD_D,
      primaryTrusted: badPrimaryTrusted,
      allowProgressionRescue: true,
      primaryLabel:
        "Belin/Ambrósio final BAD-D",
    });

  const BAD_D = badCrossCheck.value;
  const badMethod =
    badCrossCheck.status;

  const values = { A, B, C, Kmax, BAD_D, ARTmax };

  // Smart verification rule: the final value plus one genuinely independent
  // matching source is sufficient for automatic confirmation, provided hard
  // validation constraints pass. This eliminates unnecessary review boxes.
  const aIndependentAgreements = independentAgreementCount("A", A, {
    labeledPanel: abcPanel.parsed.A,
    labeledRow: Arow.value,
    exactField: Aexact.value,
    progressionDisplay: progression.A,
  });
  const bIndependentAgreements = independentAgreementCount("B", B, {
    labeledPanel: abcPanel.parsed.B,
    labeledRow: Brow.value,
    exactField: Bexact.value,
    progressionDisplay: progression.B,
  });
  const cIndependentAgreements = independentAgreementCount("C", C, {
    stagingPanel: CstageValue,
    duplicateTopometric: CduplicateRead.value,
    belinPanel: panel.parsed.C,
    progressionDisplay: progression.C,
  });
  const kIndependentAgreements = independentAgreementCount("Kmax", Kmax, {
    topometric: KtopRead.value,
    belinPanel: panel.parsed.Kmax,
    progressionDisplay: progression.Kmax,
  });
  const badIndependentAgreements = independentAgreementCount("BAD_D", BAD_D, {
    exactFinalD: belinBad.sources?.exactFinalDBox,
    dynamicColoredBox: belinBad.sources?.dynamicColoredBox,
    bottomRowParser: belinBad.sources?.bottomRow,
    progressionDisplay: progression.BAD_D,
  });
  const artIndependentAgreements = independentAgreementCount("ARTmax", ARTmax, {
    printedBelin: printedARTmax,
    progressionDisplay: progressionArt,
    confirmedCalculation: calculationConfidence !== "none" ? calculatedArt : null,
  });

  const aDirectAgreements = independentAgreementCount("A", A, {
    detectedValueBox: Aexact.value,
    detectedLabeledRow: Arow.value,
    fullPanelFallback: abcPanel.parsed.A,
  });
  const bDirectAgreements = independentAgreementCount("B", B, {
    detectedValueBox: Bexact.value,
    detectedLabeledRow: Brow.value,
    fullPanelFallback: abcPanel.parsed.B,
  });
  const aStrongDirect =
    aDirectAgreements >= 2 &&
    !hasMaterialSourceConflict("A", A, [abcPanel.parsed.A, Arow.value, Aexact.value]);
  const bStrongDirect =
    bDirectAgreements >= 2 &&
    !hasMaterialSourceConflict("B", B, [abcPanel.parsed.B, Brow.value, Bexact.value]);
  const cStrongDirect = cPrimaryAgreements >= 2;
  const kStrongDirect =
    kPrimaryConsensus.agreements >= 2 &&
    !kPrimaryConsensus.conflict;

  const progressionBadConfirmed =
    Number.isFinite(progression.BAD_D) &&
    Number.isFinite(BAD_D) &&
    Math.abs(progression.BAD_D - BAD_D) <= TOLERANCE.BAD_D;
  const badStrongSupport =
    belinBad.autoConfirmed === true ||
    badIndependentAgreements >= 2 ||
    progressionBadConfirmed ||
    (badCrossCheck.usedProgression && Number.isFinite(progression.BAD_D));

  const artProgressionConfirmed =
    Number.isFinite(progressionArt) &&
    Number.isFinite(ARTmax) &&
    Math.abs(progressionArt - ARTmax) <= artmaxAgreementTolerance(ARTmax);
  const artCalculationConfirmed =
    calculationConfidence === "confirmed" &&
    Number.isFinite(calculatedArt) &&
    Number.isFinite(ARTmax) &&
    Math.abs(calculatedArt - ARTmax) <= artmaxAgreementTolerance(ARTmax);
  const artDirectStrong =
    artBelinConsensus.agreements >= 2 ||
    ARTread.agreeingReads >= 2;
  const artCalculatedFallbackStrong =
    artDecision.derived === true &&
    cStrongDirect &&
    calculationConfidence !== "none" &&
    Number.isFinite(calculatedArt) &&
    calculatedArt === ARTmax;
  const artStrongSupport =
    artIndependentAgreements >= 2 ||
    artDirectStrong ||
    artProgressionConfirmed ||
    artCalculationConfirmed ||
    artCalculatedFallbackStrong;

  const abPhysiologyPasses =
    Number.isFinite(A) && Number.isFinite(B) && A > B;

  const audit = {
    A: {
      final: A,
      quality: aCrossCheck.quality,
      autoConfirmed:
        Number.isFinite(A) &&
        (aIndependentAgreements >= 2 || aStrongDirect || aCrossCheck.agreed || aCrossCheck.usedProgression) &&
        hardStageConstraintPasses("A", A, aStage) &&
        abPhysiologyPasses,
      sources: {
        fullLabeledPanel: abcPanel.parsed.A,
        labeledRow: Arow.value,
        exactBox: Aexact.value,
        detectedFieldStack: abcFields ? "yes" : "no",
        detectedValueBox: abcFields?.A?.valueBox || null,
        primaryValue: Aprimary,
        primaryAgreements:
          aPrimaryAgreements,
        totalIndependentAgreements:
          aIndependentAgreements,
        progressionRawA: progression.A,
        printedStage: aStage,
        baselineStageBar: topometricStageA,
        expectedStageFromFinalA: expectedContinuousStage("A", A),
        stageBarCompatibility: stageBarCompatibility("A", A, topometricStageA),
        numericEnsembleAgreement: Aexact.agreeingReads,
        directSourceAgreements: aDirectAgreements,
        selectedPrimarySource:
          abSelection.A.source,
        progressionCrossCheck:
          aCrossCheck.status,
        finalUsedProgression:
          aCrossCheck.usedProgression
            ? "yes"
            : "no",
        ABPairScore:
          abSelection.pairScore,
      },
      note:
        "KC-Staging remains primary. The raw A value printed beside the latest ABCD progression bar confirms the primary result or rescues it only when the primary sources are missing/conflicting.",
    },
    B: {
      final: B,
      quality: bCrossCheck.quality,
      autoConfirmed:
        Number.isFinite(B) &&
        (bIndependentAgreements >= 2 || bStrongDirect || bCrossCheck.agreed || bCrossCheck.usedProgression) &&
        hardStageConstraintPasses("B", B, bStage) &&
        abPhysiologyPasses,
      sources: {
        fullLabeledPanel: abcPanel.parsed.B,
        labeledRow: Brow.value,
        exactBox: Bexact.value,
        detectedFieldStack: abcFields ? "yes" : "no",
        detectedValueBox: abcFields?.B?.valueBox || null,
        primaryValue: Bprimary,
        primaryAgreements:
          bPrimaryAgreements,
        totalIndependentAgreements:
          bIndependentAgreements,
        progressionRawB: progression.B,
        printedStage: bStage,
        baselineStageBar: topometricStageB,
        expectedStageFromFinalB: expectedContinuousStage("B", B),
        stageBarCompatibility: stageBarCompatibility("B", B, topometricStageB),
        numericEnsembleAgreement: Bexact.agreeingReads,
        directSourceAgreements: bDirectAgreements,
        selectedPrimarySource:
          abSelection.B.source,
        progressionCrossCheck:
          bCrossCheck.status,
        finalUsedProgression:
          bCrossCheck.usedProgression
            ? "yes"
            : "no",
        ABPairScore:
          abSelection.pairScore,
      },
      note:
        "KC-Staging remains primary. The raw B value printed beside the latest ABCD progression bar is used as an independent verification and only rescues an internally weak primary extraction.",
    },
    C: {
      final: C,
      quality: cCrossCheck.quality,
      autoConfirmed:
        Number.isFinite(C) &&
        (cIndependentAgreements >= 2 || cStrongDirect || cCrossCheck.agreed || cCrossCheck.usedProgression) &&
        hardStageConstraintPasses("C", C, cStage),
      sources: {
        stagingLabeledPanel:
          CstageValue,
        duplicateTopometricField:
          CduplicateRead.value,
        belinPanel: panel.parsed.C,
        primaryValue: Cprimary,
        primaryAgreements:
          cPrimaryAgreements,
        totalIndependentAgreements:
          cIndependentAgreements,
        progressionRawC:
          progression.C,
        printedStage: cStage,
        baselineStageBar: topometricStageC,
        selectedPrimarySource:
          Cselection.source,
        progressionCrossCheck:
          cCrossCheck.status,
        finalUsedProgression:
          cCrossCheck.usedProgression
            ? "yes"
            : "no",
      },
      note:
        "C is selected from the established KC-Staging/Topometric/Belin sources and then checked against the raw thinnest-pachymetry value on the ABCD progression display.",
    },
    Kmax: {
      final: Kmax,
      quality: kCrossCheck.quality,
      autoConfirmed:
        Number.isFinite(Kmax) &&
        (kIndependentAgreements >= 2 || kStrongDirect || kCrossCheck.agreed || kCrossCheck.usedProgression),
      sources: {
        topometricField:
          KtopRead.value,
        belinPanel:
          panel.parsed.Kmax,
        primaryValue:
          kPrimaryConsensus.value,
        primaryAgreements:
          kPrimaryConsensus.agreements,
        totalIndependentAgreements:
          kIndependentAgreements,
        progressionTable:
          progression.Kmax,
        progressionCrossCheck:
          kCrossCheck.status,
        finalUsedProgression:
          kCrossCheck.usedProgression
            ? "yes"
            : "no",
      },
      note:
        "Topometric and Belin remain the primary Kmax sources. The ABCD progression table is an independent confirmation/rescue source.",
    },
    BAD_D: {
      final: BAD_D,
      quality: badCrossCheck.quality,
      autoConfirmed:
        Number.isFinite(BAD_D) &&
        badStrongSupport,
      sources: {
        belinFinalD:
          belinBad.value,
        belinQuality:
          belinBad.quality,
        belinMethod:
          belinBad.method,
        progressionTable:
          progression.BAD_D,
        progressionMethod:
          progression.method,
        progressionCrossCheck:
          badCrossCheck.status,
        finalUsedProgression:
          badCrossCheck.usedProgression
            ? "yes"
            : "no",
        selectedMethod: badMethod,
        exactFinalDBox: belinBad.sources?.exactFinalDBox ?? null,
        dynamicColoredBox: belinBad.sources?.dynamicColoredBox ?? null,
        bottomRow: belinBad.sources?.bottomRow ?? null,
        componentIndices: belinBad.sources?.components || null,
        directConsensusMethods: belinBad.sources?.consensusMethods || null,
        totalIndependentAgreements:
          badIndependentAgreements,
      },
      note:
        "Belin/Ambrósio final D remains primary. The ABCD progression-table BAD-D confirms it and rescues only a missing or weak Belin read.",
    },
    ARTmax: {
      final: ARTmax,
      quality: artDecision.quality,
      statusLabel: artDecision.statusLabel,
      autoConfirmed:
        Number.isFinite(ARTmax) &&
        (
          artStrongSupport ||
          artDecision.derived === true
        ),
      sources: {
        printedBelinARTmax: printedARTmax,
        printedSource: printedARTmaxSource,
        labeledPanelARTmax: panel.parsed.ARTmax,
        exactBoxARTmax: ARTread.value,
        anchoredLabelARTmax: panel.anchored?.fields?.ARTmax?.labeledValue ?? null,
        exactBoxAgreeingReads: ARTread.agreeingReads || 0,
        progressionTable: progressionArt,
        PPImaxLabeledPanel: ppiPanelValue,
        PPImaxExactBox: ppiExactValue,
        PPImaxLabeledRow: ppiRowValue,
        PPImaxConsensusSources: ppiConsensus.sources,
        PPImaxIndependentAgreements: ppiConsensus.agreements,
        selectedPPImax: selectedPPImax,
        calculationConfidence: calculationConfidence,
        calculatedFromSelectedPPImax: calculatedArt,
        calculatedUsingLabeledPPImax: calculatedFromPanelPPI,
        calculatedUsingExactPPImax: calculatedFromExactPPI,
        calculatedUsingLabeledRowPPImax: calculatedFromRowPPI,
        impliedPPImaxFromPrintedARTmax: impliedPPImaxFromPrintedART,
        calculationStatus: artDecision.calculationStatus,
        selectedMethod: artMethod,
        derivedFallback: artDecision.derived ? "yes" : "no",
        totalIndependentAgreements: artIndependentAgreements,
      },
      note:
        artDecision.derived
          ? "Direct ARTmax OCR was missing or inconsistent. This approximate candidate uses C divided by rounded PPImax; verify both inputs and the printed ARTmax."
          : "A directly printed ARTmax remains primary; C ÷ PPImax is a cross-check only.",
    },
    progressionSummary: {
      classification:
        progression.classification,
      rawA: progression.A,
      rawB: progression.B,
      rawC: progression.C,
      BAD_D: progression.BAD_D,
      ARTmax: progression.ARTmax,
      Kmax: progression.Kmax,
      tableRowY: progression.rowY,
      matchedRowIndex: progression.rowIndex,
      matchedRowTimestamp: progression.rowTimestamp
        ? progression.rowTimestamp.toISOString()
        : null,
      rawABCRows:
        progression.rawABCRows,
      method: progression.method,
      rawReads:
        progression.raw.map(
          (item) => item.text
        ),
    },
  };

  enforceExtractionIntegrity(values, audit, progression);
  await refineExtractionEvidence({worker,values,audit,progression,abcFields,
    topometricBitmap,belinBitmap,panel});
  const fieldPreviews = Object.fromEntries(
    ["A", "B", "C", "Kmax", "BAD_D", "ARTmax"].map((variable) => [
      variable,
      verificationPreviewDataUrl({
        variable,
        descriptor,
        topometricBitmap,
        belinBitmap,
        progressionBitmap,
        progression,
        abcFields,
        auditItem: audit[variable],
      }),
    ])
  );

  const fieldPreviewNotes = {
    ARTmax:
      audit.ARTmax.sources.derivedFallback === 'yes' && Number.isFinite(values.ARTmax) && Number.isFinite(selectedPPImax)
        ? `Approximate candidate: ${values.C} ÷ ${Number(selectedPPImax).toFixed(2)} ≈ ${values.ARTmax}. Verify the printed ARTmax.`
        : null,
  };

  const sourcePages = {
    topometric: registerPreviewUrl(topometricBlob),
    belin: registerPreviewUrl(belinBlob),
    progression: progressionBlob ? registerPreviewUrl(progressionBlob) : null,
  };

  topometricBitmap.close?.();
  belinBitmap.close?.();
  progressionBitmap?.close?.();

  return {
    prefix: descriptor.prefix,
    timestamp: descriptor.timestamp,
    eye,
    eyeEvidence,
    scanQuality: /\bData\s*Gaps\b|\bQS\s*:?\s*(?:not\s*OK|poor|warning)/i.test(panel.result?.text || '') ? 'warning' : 'unknown',
    values,
    audit,
    sourcePages,
    fieldPreviews,
    fieldPreviewNotes,
    complete: Object.values(values).every(Number.isFinite),
    sourceFormat: descriptor.sourceFormat || "current-pdfreport",
    pageResolution: descriptor.pageResolution || "fixed current-format suffixes",
  };
}

function validDateParts(
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0
) {
  /*
   * Construct a date only when every supplied calendar component is valid.
   * JavaScript otherwise silently rolls invalid dates into another month,
   * which would be unsafe for ordering legacy Pentacam visits.
   */
  const date = new Date(
    year,
    month - 1,
    day,
    hour,
    minute,
    second
  );

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null;
  }

  return date;
}


function legacyDateTime(dateToken, timeToken, archiveDate = null) {
  const token = String(dateToken || '');
  const clock = String(timeToken || '').padStart(6, '0');
  if (!/^\d{8}$/.test(token) || !/^\d{6}$/.test(clock)) return null;

  const hour = Number(clock.slice(0, 2));
  const minute = Number(clock.slice(2, 4));
  const second = Number(clock.slice(4, 6));
  const year = Number(token.slice(4, 8));

  // Legacy Continuum history exports commonly use DDMMYYYY. MMDDYYYY is
  // retained as a fallback for regional workstation differences.
  const dayFirst = validDateParts(
    year,
    Number(token.slice(2, 4)),
    Number(token.slice(0, 2)),
    hour,
    minute,
    second
  );
  const monthFirst = validDateParts(
    year,
    Number(token.slice(0, 2)),
    Number(token.slice(2, 4)),
    hour,
    minute,
    second
  );

  const candidates = [dayFirst, monthFirst].filter(Boolean);
  if (!candidates.length) return null;
  if (!archiveDate || candidates.length === 1) return candidates[0];

  return candidates.sort(
    (left, right) =>
      Math.abs(left.getTime() - archiveDate.getTime()) -
      Math.abs(right.getTime() - archiveDate.getTime())
  )[0];
}

function legacyFilenameParts(filename, archiveDate = null) {
  const name = basename(filename);
  const lower = name.toLowerCase();

  // Examples seen in legacy/history exports:
  // patient_od_04092020_143818_....jpg
  // patient-os-04092020-143926-....jpg
  const match = lower.match(
    /(?:^|[_\-\s])(od|os)(?:[_\-\s]+)(\d{8})(?:[_\-\s]+)(\d{6})(?:[_\-\s.]|$)/i
  );
  if (!match) return null;

  const eye = match[1].toUpperCase();
  const dateToken = match[2];
  const timeToken = match[3];
  const timestamp = legacyDateTime(dateToken, timeToken, archiveDate);

  return {
    eye,
    dateToken,
    timeToken,
    timestamp,
    studyKey: `${eye}-${dateToken}-${timeToken}`,
  };
}

function legacyFilenamePageType(filename) {
  const normalized = basename(filename)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (
    normalized.includes('TOPOMETRIC') ||
    normalized.includes('KC STAGING') ||
    normalized.includes('KERATOCONUS STAGING')
  ) {
    return 'topometric';
  }
  if (
    normalized.includes('ENHANCED ECTASIA') ||
    normalized.includes('AMBROSIO') ||
    normalized.includes('BELIN')
  ) {
    return 'belin';
  }
  if (
    normalized.includes('ABCD PROGRESSION') ||
    normalized.includes('PROGRESSION DISPLAY')
  ) {
    return 'progression';
  }
  return null;
}

function groupLegacyHistoryFiles(imageEntries, archiveDate) {
  const groups = new Map();

  for (const entry of imageEntries) {
    const parsed = legacyFilenameParts(entry.filename, archiveDate);
    if (!parsed) continue;

    if (!groups.has(parsed.studyKey)) {
      groups.set(parsed.studyKey, {
        eye: parsed.eye,
        timestamp: parsed.timestamp,
        studyKey: parsed.studyKey,
        files: [],
      });
    }

    groups.get(parsed.studyKey).files.push(entry);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      files: [...group.files].sort(
        (left, right) =>
          left.archiveIndex - right.archiveIndex ||
          naturalImageSort(left.filename, right.filename)
      ),
    }))
    .sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0));
}

function isSupportedReportImage(filename) {
  return /\.(jpe?g|png)$/i.test(basename(filename));
}

function sequenceNumber(filename) {
  const match = basename(filename).match(/(\d+)(?=\.[^.]+$)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function naturalImageSort(left, right) {
  const leftNumber = sequenceNumber(left);
  const rightNumber = sequenceNumber(right);
  if (leftNumber !== rightNumber) return leftNumber - rightNumber;
  return basename(left).localeCompare(basename(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function dateFromArchiveName(filename) {
  const name = basename(filename);
  let match = name.match(
    /(\d{4})[-_](\d{2})[-_](\d{2})(?:[ T_-]?(\d{2})(\d{2})(\d{2}))?/
  );
  if (!match) {
    match = name.match(
      /(\d{4})(\d{2})(\d{2})(?:[ T_-]?(\d{2})(\d{2})(\d{2}))?/
    );
  }
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0)
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function classifyReportTitle(title) {
  const normalized = String(title || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    normalized.includes("TOPOMETRIC") ||
    normalized.includes("KC STAGING") ||
    normalized.includes("KERATOCONUS STAGING")
  ) {
    return "topometric";
  }

  if (
    normalized.includes("ENHANCED ECTASIA") ||
    (normalized.includes("BELIN") &&
      (normalized.includes("AMBROSIO") || normalized.includes("AMBR")))
  ) {
    return "belin";
  }

  if (
    normalized.includes("ABCD PROGRESSION") ||
    normalized.includes("PROGRESSION DISPLAY")
  ) {
    return "progression";
  }

  return null;
}

async function recognizeHeader(worker, bitmap) {
  const header = makeCropCanvas(bitmap, [0, 0, REFERENCE_WIDTH, 220], 2.2);
  const gray = transformChannel(header, "gray", false);
  return await recognize(worker, padCanvas(gray, 16, 255), {
    psm: 6,
    whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/- ",
  });
}

async function scanGenericPages(zip, imageFiles, visitLabel, workers) {
  const orderedFiles = [...imageFiles].sort(naturalImageSort);
  const queues = [[], []];
  orderedFiles.forEach((filename, index) => {
    queues[index % workers.length].push({ filename, index });
  });

  state.ocrJobsEstimated += orderedFiles.length;
  const records = [];

  await Promise.all(
    queues.map(async (queue, workerIndex) => {
      for (const item of queue) {
        setProgress(
          20 + (item.index / Math.max(1, orderedFiles.length)) * 15,
          `Scanning ${visitLabel} report ${item.index + 1} of ${orderedFiles.length}…`,
          "Nonstandard filenames detected; identifying only the required report titles."
        );
        const blob = await zip.file(item.filename).async("blob");
        const bitmap = await blobToBitmap(blob);
        const result = await recognizeHeader(workers[workerIndex], bitmap);
        const pageType = classifyReportTitle(result.text);
        bitmap.close?.();
        if (pageType) {
          records.push({
            filename: item.filename,
            index: item.index,
            pageType,
            title: result.text,
          });
        }
      }
    })
  );

  return records.sort((a, b) => a.index - b.index);
}

function pairGenericPages(records) {
  const topometric = records.filter((record) => record.pageType === "topometric");
  const belin = records.filter((record) => record.pageType === "belin");
  const progression = records.filter((record) => record.pageType === "progression");
  const usedBelin = new Set();
  const usedProgression = new Set();
  const pairs = [];

  for (const topometricPage of topometric) {
    const belinCandidates = belin
      .filter((record) => !usedBelin.has(record.filename))
      .sort((left, right) => {
        const leftPenalty = left.index < topometricPage.index ? 5 : 0;
        const rightPenalty = right.index < topometricPage.index ? 5 : 0;
        return (
          Math.abs(left.index - topometricPage.index) + leftPenalty -
          (Math.abs(right.index - topometricPage.index) + rightPenalty)
        );
      });

    const belinPage = belinCandidates[0];
    if (!belinPage) continue;
    usedBelin.add(belinPage.filename);

    const progressionCandidates = progression
      .filter((record) => !usedProgression.has(record.filename))
      .sort(
        (left, right) =>
          Math.abs(left.index - belinPage.index) -
          Math.abs(right.index - belinPage.index)
      );
    const progressionPage = progressionCandidates[0] || null;
    if (progressionPage) usedProgression.add(progressionPage.filename);

    pairs.push({
      topometric: topometricPage.filename,
      belin: belinPage.filename,
      progression: progressionPage?.filename || null,
      order: Math.min(topometricPage.index, belinPage.index),
    });
  }

  return pairs.sort((a, b) => a.order - b.order);
}

function reconcileStudyLaterality(results) {
  const sorted = [...results].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  // A standard bilateral visit normally contains exactly two complete studies.
  // Resolve them jointly so one false OD token cannot cause the OS study to be
  // silently discarded.
  if (sorted.length === 2) {
    const [first, second] = sorted;
    const originalEyes = [first.eye, second.eye];
    const alreadyBilateral =
      originalEyes.includes("OD") && originalEyes.includes("OS");
    if (alreadyBilateral) return sorted;

    const firstScores = first.eyeEvidence?.scores || { OD: first.eye === "OD" ? 1 : 0, OS: first.eye === "OS" ? 1 : 0 };
    const secondScores = second.eyeEvidence?.scores || { OD: second.eye === "OD" ? 1 : 0, OS: second.eye === "OS" ? 1 : 0 };

    const odThenOs = firstScores.OD + secondScores.OS;
    const osThenOd = firstScores.OS + secondScores.OD;

    if (odThenOs >= osThenOd) {
      first.eye = "OD";
      second.eye = "OS";
    } else {
      first.eye = "OS";
      second.eye = "OD";
    }

    first.eyeResolution = "auto-paired from the bilateral visit";
    second.eyeResolution = "auto-paired from the bilateral visit";
    return sorted;
  }

  const knownEyes = new Set(
    sorted.filter((study) => ["OD", "OS"].includes(study.eye)).map((study) => study.eye)
  );
  const unresolved = sorted.filter((study) => !["OD", "OS"].includes(study.eye));
  if (unresolved.length === 1 && knownEyes.size === 1) {
    unresolved[0].eye = knownEyes.has("OD") ? "OS" : "OD";
    unresolved[0].eyeResolution = "inferred from the other detected eye";
  }

  return sorted;
}


async function classifyLegacyCandidate(worker, zip, entry) {
  const filenameType = legacyFilenamePageType(entry.filename);
  if (filenameType) {
    return {
      ...entry,
      pageType: filenameType,
      classification: 'filename keyword',
    };
  }

  const blob = await zip.file(entry.filename).async('blob');
  const bitmap = await blobToBitmap(blob);
  const result = await recognizeHeader(worker, bitmap);
  bitmap.close?.();

  return {
    ...entry,
    pageType: classifyReportTitle(result.text),
    title: result.text,
    classification: 'header OCR',
  };
}

async function identifyLegacyHistoryPages(zip, group, worker, visitLabel) {
  const ordered = [...group.files];
  if (ordered.length < 3) {
    throw new Error(
      `${visitLabel}: legacy ${group.eye} study contained only ${ordered.length} report image(s); at least three are required.`
    );
  }

  const pageMap = {
    topometric: null,
    belin: null,
    progression: null,
  };

  // Historical six-page exports place the three model-relevant reports at the
  // end of each OD/OS group. Check those first, then inspect earlier images only
  // if a title is still missing.
  const tail = ordered.slice(-3);
  const remainder = ordered.slice(0, -3);
  const candidates = [...tail, ...remainder];

  for (const entry of candidates) {
    if (pageMap.topometric && pageMap.belin && pageMap.progression) break;

    setProgress(
      20,
      `Identifying legacy ${group.eye} report pages…`,
      'Older Continuum history format detected; checking only the relevant report headers.'
    );

    const record = await classifyLegacyCandidate(worker, zip, entry);
    if (record.pageType && !pageMap[record.pageType]) {
      pageMap[record.pageType] = record.filename;
    }
  }

  let pageResolution = 'legacy report titles';

  // Deterministic fallback validated against the observed six-page history
  // structure: the final three images are KC-Staging, Belin/Ambrósio, and ABCD
  // progression respectively. Source-page previews remain available so the
  // user can verify this mapping before confirmation.
  if (!pageMap.topometric || !pageMap.belin) {
    const fallback = ordered.slice(-3);
    pageMap.topometric ||= fallback[0]?.filename || null;
    pageMap.belin ||= fallback[1]?.filename || null;
    pageMap.progression ||= fallback[2]?.filename || null;
    pageResolution = 'legacy six-page ordered fallback';
  }

  if (!pageMap.topometric || !pageMap.belin) {
    throw new Error(
      `${visitLabel}: the legacy ${group.eye} history study was found, but KC-Staging and Belin/Ambrósio pages could not be identified.`
    );
  }

  return {
    pages: pageMap,
    pageResolution,
  };
}

async function parseLegacyHistoryArchive(zip, imageEntries, file, visitLabel) {
  const archiveDate = dateFromArchiveName(file.name);
  const groups = groupLegacyHistoryFiles(imageEntries, archiveDate);
  if (!groups.length) return null;

  const workers = await ensureWorkers();
  state.ocrJobsEstimated += groups.length * 14;

  const descriptors = [];
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const worker = workers[index % workers.length];
    const identified = await identifyLegacyHistoryPages(
      zip,
      group,
      worker,
      visitLabel
    );

    descriptors.push({
      visitLabel,
      zip,
      prefix: `legacy-${group.studyKey}`,
      timestamp: group.timestamp || archiveDate,
      forcedEye: group.eye,
      sourceFormat: 'legacy-history-eye-filename',
      pageResolution: identified.pageResolution,
      viewerPages: group.files.map(entry => entry.filename),
      pages: identified.pages,
    });
  }

  const queues = [[], []];
  descriptors.forEach((descriptor, index) => {
    queues[index % workers.length].push(descriptor);
  });

  const results = [];
  await Promise.all(
    queues.map(async (queue, workerIndex) => {
      for (const descriptor of queue) {
        const study = await extractStudy(descriptor, workers[workerIndex]);
        study.eye = descriptor.forcedEye;
        study.eyeResolution = 'read directly from legacy OD/OS filename';
        results.push(study);
      }
    })
  );

  return results.sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0));
}

async function parseGenericArchive(zip, imageFiles, file, visitLabel) {
  const workers = await ensureWorkers();
  const records = await scanGenericPages(zip, imageFiles, visitLabel, workers);
  const pairs = pairGenericPages(records);

  if (!pairs.length) {
    const foundTopometric = records.some((record) => record.pageType === "topometric");
    const foundBelin = records.some((record) => record.pageType === "belin");
    throw new Error(
      `${visitLabel}: ${imageFiles.length} report images were found, but the required pages ` +
      `could not be paired. KC-Staging detected: ${foundTopometric ? "yes" : "no"}; ` +
      `Belin/Ambrósio detected: ${foundBelin ? "yes" : "no"}.`
    );
  }

  const archiveDate = dateFromArchiveName(file.name);
  const descriptors = pairs.map((pair, index) => ({
    visitLabel,
    zip,
    prefix: `generic-${index + 1}`,
    timestamp: archiveDate ? new Date(archiveDate.getTime() + index * 1000) : null,
    pages: {
      topometric: pair.topometric,
      belin: pair.belin,
      progression: pair.progression,
    },
  }));

  state.ocrJobsEstimated += descriptors.length * 11;
  const queues = [[], []];
  descriptors.forEach((descriptor, index) => queues[index % workers.length].push(descriptor));
  const results = [];

  await Promise.all(
    queues.map(async (queue, workerIndex) => {
      for (const descriptor of queue) {
        results.push(await extractStudy(descriptor, workers[workerIndex]));
      }
    })
  );

  return reconcileStudyLaterality(results);
}

function representativeVisitTime(studies) {
  const times = studies
    .map((study) => study.timestamp)
    .filter(Boolean)
    .map((date) => date.getTime());
  if (!times.length) return null;
  return Math.min(...times);
}
async function parseArchive(file, visitLabel) {
  if (!file || file.size > 150 * 1024 * 1024) throw new Error("Use a Pentacam export under 150 MB per ZIP.");
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  if (entries.length > 300) throw new Error("This ZIP contains too many files; select one patient's scan export.");
  const unpacked = entries.reduce((total, entry) => total + (entry._data?.uncompressedSize || 0), 0);
  if (unpacked > 500 * 1024 * 1024) throw new Error("The expanded archive exceeds the 500 MB limit.");
  const grouped = {};
  const imageFiles = [];
  const imageEntries = [];

  Object.keys(zip.files).forEach((filename, archiveIndex) => {
    const entry = zip.files[filename];
    if (entry.dir) return;
    if (isSupportedReportImage(filename)) {
      imageFiles.push(filename);
      imageEntries.push({ filename, archiveIndex });
    }
    const parsed = reportFilenameParts(filename);
    if (!parsed) return;
    grouped[parsed.prefix] ||= {};
    grouped[parsed.prefix][parsed.suffix] = filename;
  });

  const descriptors = [];
  for (const [prefix, pages] of Object.entries(grouped)) {
    if (!pages[REQUIRED_SUFFIXES.topometric] || !pages[REQUIRED_SUFFIXES.belin]) continue;
    descriptors.push({
      visitLabel,
      zip,
      prefix,
      timestamp: timestampFromPrefix(prefix),
      viewerPages: Object.entries(pages).sort(([a],[b]) => a.localeCompare(b)).map(([,filename]) => filename),
      pages: {
        topometric: pages[REQUIRED_SUFFIXES.topometric],
        belin: pages[REQUIRED_SUFFIXES.belin],
        progression: pages[REQUIRED_SUFFIXES.progression] || null,
      },
    });
  }

  // Fast path for current Continuum PdfReport filenames.
  if (descriptors.length) {
    const workers = await ensureWorkers();
    state.ocrJobsEstimated += descriptors.length * 11;
    const queues = [[], []];
    descriptors
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .forEach((descriptor, index) => queues[index % workers.length].push(descriptor));

    const results = [];
    await Promise.all(
      queues.map(async (queue, workerIndex) => {
        for (const descriptor of queue) {
          results.push(await extractStudy(descriptor, workers[workerIndex]));
        }
      })
    );
    return reconcileStudyLaterality(results);
  }

  // Dedicated fast path for older 2020-era history exports. These filenames
  // explicitly contain OD/OS plus DDMMYYYY_HHMMSS, so laterality and visit time
  // can be recovered without OCR. The shorter six-page report set is paired
  // separately from the current PdfReport format.
  if (imageEntries.length) {
    const legacyStudies = await parseLegacyHistoryArchive(
      zip,
      imageEntries,
      file,
      visitLabel
    );
    if (legacyStudies?.length) return legacyStudies;
  }

  // Final compatibility fallback for anonymized or otherwise nonstandard names.
  // It scans report headers only, then uses the same validated extraction pipeline.
  if (imageFiles.length) {
    return await parseGenericArchive(zip, imageFiles, file, visitLabel);
  }

  throw new Error(
    `${visitLabel}: no JPG, JPEG, or PNG Pentacam report images were found in the ZIP.`
  );
}



function unresolvedStudies(studies) {
  return studies.filter((study) => !["OD", "OS"].includes(study.eye));
}

function createLateralityResolver(studies, visitKey) {
  const unresolved = unresolvedStudies(studies);
  if (!unresolved.length) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "laterality-resolver";

  const heading = document.createElement("h3");
  heading.textContent = "Confirm eye laterality";
  wrapper.appendChild(heading);

  const note = document.createElement("div");
  note.className = "alert warning";
  note.textContent =
    "The required Pentacam pages and values were found, but OD/OS was not read confidently. " +
    "Choose the eye for the unresolved study below. This does not require manual value extraction.";
  wrapper.appendChild(note);

  unresolved.forEach((study, index) => {
    const card = document.createElement("div");
    card.className = "visit-card laterality-card";

    const label = document.createElement("label");
    label.className = "field";
    const title = document.createElement("span");
    title.textContent = `Unresolved study ${index + 1} — ${formatTimestamp(study.timestamp)}`;
    label.appendChild(title);

    const select = document.createElement("select");
    select.innerHTML = `
      <option value="">Select eye…</option>
      <option value="OD">Right eye — OD</option>
      <option value="OS">Left eye — OS</option>
    `;
    select.value = ["OD", "OS"].includes(study.eye) ? study.eye : "";
    select.addEventListener("change", () => {
      const chosen = select.value;
      if (!chosen) return;

      // Prevent assigning the same eye twice within one visit unless there are
      // genuinely repeated studies. If a single opposite unresolved study
      // remains, assign it automatically.
      study.eye = chosen;
      study.eyeResolution = "confirmed by user";

      const remaining = unresolvedStudies(studies);
      const nowKnown = new Set(
        studies.filter((item) => ["OD", "OS"].includes(item.eye)).map((item) => item.eye)
      );
      if (remaining.length === 1 && nowKnown.size === 1) {
        remaining[0].eye = nowKnown.has("OD") ? "OS" : "OD";
        remaining[0].eyeResolution = "inferred from confirmed opposite eye";
      }

      renderDetected();
      renderReview();
    });
    label.appendChild(select);
    card.appendChild(label);
    card.appendChild(sourcePreview(study));
    wrapper.appendChild(card);
  });

  return wrapper;
}

function groupByEye(studies) {
  return {
    OD: studies.filter((study) => study.eye === "OD"),
    OS: studies.filter((study) => study.eye === "OS"),
  };
}

function latestStudy(studies) {
  if (!studies.length) return null;
  return [...studies].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).at(-1);
}

function studyLabel(study) {
  return `${study.eye} — ${formatTimestamp(study.timestamp)}`;
}

function createStudySelector(eye, studies, visitKey) {
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  const title = document.createElement("span");
  title.textContent = `${visitKey} study used for ${eye}`;
  wrapper.appendChild(title);

  const select = document.createElement("select");
  select.dataset.eye = eye;
  select.dataset.visit = visitKey;
  studies.forEach((study, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = studyLabel(study);
    if (index === studies.length - 1) option.selected = true;
    select.appendChild(option);
  });
  select.addEventListener("change", renderReview);
  wrapper.appendChild(select);
  return wrapper;
}

function selectedStudy(groups, eye, visitKey) {
  const studies = groups[eye] || [];
  if (!studies.length) return null;
  const select = document.querySelector(`select[data-eye="${eye}"][data-visit="${visitKey}"]`);
  const index = select ? Number(select.value) : studies.length - 1;
  return studies[index] || latestStudy(studies);
}


function auditCandidateValues(item, variable) {
  const output=[],tol=DIRECT_PRECISION[variable];
  const add=value=>{if(Number.isFinite(value)&&plausible(variable,value)&&!output.some(v=>Math.abs(v-value)<=tol))output.push(value);};
  add(item?.final);
  for(const row of item?.evidence||[])add(row.value);
  add(item?.sources?.secondReader?.value);
  for(const row of item?.sources?.verifiedRead?.reads||[])if(row.confidence>=60)add(row.value);
  // Keep full printed precision; 7.70, 7.71 and 7.00 are different candidates.
  return output.slice(0,5);
}

function fieldNeedsVerification(study, variable) {
  const item = study?.audit?.[variable];
  if (!item || !Number.isFinite(study?.values?.[variable])) return true;
  return item.autoConfirmed !== true;
}

function fieldVerificationId(inputId) { return `${inputId}_verified`; }

function allRequiredFieldsVerified() {
  return [...document.querySelectorAll(".value-field[data-needs-verification='true']")].every((wrapper) => {
    const input = wrapper.querySelector("input[type='number']");
    const checkbox = wrapper.querySelector(".field-verification-checkbox");
    return Boolean(input && input.value !== "" && checkbox?.checked && plausible(input.dataset.variable, Number(input.value)));
  });
}


function maybeAutoCalculate() {
  if (
    state.autoSubmitDone ||
    state.processing ||
    !el("autoCalculate")?.checked ||
    !el("reviewSection") ||
    el("reviewSection").classList.contains("hidden")
  ) {
    return;
  }

  const remaining = [
    ...document.querySelectorAll(
      ".value-field[data-needs-verification='true']"
    ),
  ].filter((wrapper) => {
    const input = wrapper.querySelector("input[type='number']");
    const checkbox = wrapper.querySelector(".field-verification-checkbox");
    return (
      !input ||
      input.value === "" ||
      !checkbox?.checked ||
      !plausible(input.dataset.variable, Number(input.value))
    );
  });

  if (remaining.length) return;

  state.autoSubmitDone = true;
  if (state.autoSubmitTimer) clearTimeout(state.autoSubmitTimer);
  state.autoSubmitTimer = window.setTimeout(() => {
    try {
      const confirmation = el("confirmValues");
      if (confirmation) confirmation.checked = true;
      generateExport();
      if (state.payload) sendPayloadToCalculator();
    } catch (error) {
      state.autoSubmitDone = false;
      showError(error?.message || String(error));
    }
  }, 180);
}

function updateVerificationGate() {
  const required = [...document.querySelectorAll(".value-field[data-needs-verification='true']")];
  const remaining = required.filter((wrapper) => {
    const input = wrapper.querySelector("input[type='number']");
    const checkbox = wrapper.querySelector(".field-verification-checkbox");
    return !input || input.value === "" || !checkbox?.checked || !plausible(input.dataset.variable, Number(input.value));
  });
  state.verificationRequiredCount = remaining.length;
  const summary = el("verificationSummary");
  const confirmation = el("confirmValues");
  const label = confirmation?.closest("label");
  if (summary) {
    if (!required.length) {
      summary.className = "verification-summary verification-complete";
      summary.textContent = "6/6 confirmed";
    } else if (!remaining.length) {
      summary.className = "verification-summary verification-complete";
      summary.textContent = "6/6 confirmed";
    } else {
      summary.className = "verification-summary verification-needed";
      summary.textContent = `${remaining.length} value${remaining.length === 1 ? "" : "s"} to review`;
    }
  }
  if (confirmation) {
    confirmation.disabled = remaining.length > 0;
    if (remaining.length > 0) confirmation.checked = false;
  }
  label?.classList.toggle("confirmation-disabled", remaining.length > 0);
  maybeAutoCalculate();
  syncFrameHeight();
}

function qualityClass(quality) {
  return `quality-${String(quality || "Unavailable").toLowerCase()}`;
}

function valueInput(variable, value, inputId, quality, study) {
  const meta = VARIABLE_META[variable];
  const wrapper = document.createElement("div");
  wrapper.className = "value-field";
  const needsVerification = fieldNeedsVerification(study, variable);
  wrapper.dataset.needsVerification = needsVerification ? "true" : "false";
  wrapper.dataset.variable = variable;

  const labelRow = document.createElement("div");
  labelRow.className = "value-label-row";
  const label = document.createElement("label");
  label.htmlFor = inputId;
  label.textContent = meta.label;
  labelRow.appendChild(label);
  const badge = document.createElement("span");
  const auditItem = study?.audit?.[variable];
  const statusLabel = auditItem?.statusLabel || "Confirmed";
  badge.className = `quality-badge ${
    !needsVerification && statusLabel === "Calculated"
      ? "quality-calculated"
      : qualityClass(quality)
  }`;
  badge.textContent = needsVerification ? "Review" : statusLabel;
  labelRow.appendChild(badge);
  wrapper.appendChild(labelRow);

  const input = document.createElement("input");
  input.id = inputId;
  input.type = "number";
  input.step = meta.step;
  input.dataset.variable = variable;
  input.value = Number.isFinite(value) ? Number(value).toFixed(meta.decimals) : "";
  wrapper.appendChild(input);
  input.addEventListener("input", () => { state.autoSubmitDone = false; state.payload = null; });

  if (meta.unit) {
    const unit = document.createElement("span");
    unit.className = "unit";
    unit.textContent = meta.unit;
    wrapper.appendChild(unit);
  }

  if (needsVerification) {
    const review = document.createElement("div");
    review.className = "micro-verification";
    const previewNote = study?.fieldPreviewNotes?.[variable];
    if (previewNote) {
      const calculationCard = document.createElement("div");
      calculationCard.className = "calculation-preview-card";
      calculationCard.textContent = previewNote;
      review.appendChild(calculationCard);
    }
    const previewUrl = study?.fieldPreviews?.[variable];
    if (previewUrl) {
      const image = document.createElement("img");
      image.src = previewUrl;
      image.alt = `${meta.label} source crop`;
      image.className = "micro-verification-image";
      review.appendChild(image);
    }
    if (previewUrl && !previewNote) {
      const previewHint = document.createElement("div");
      previewHint.className = "verification-preview-hint";
      previewHint.textContent = "Check the displayed source value.";
      review.appendChild(previewHint);
    }

    const candidates = auditCandidateValues(study?.audit?.[variable], variable);
    if (candidates.length > 1) {
      const choices = document.createElement("div");
      choices.className = "candidate-buttons";
      candidates.forEach((candidate) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "candidate-button";
        button.textContent = Number(candidate).toFixed(meta.decimals);
        button.addEventListener("click", () => {
          input.value = Number(candidate).toFixed(meta.decimals);
          const checkbox = el(fieldVerificationId(inputId));
          if (checkbox) {
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event("change"));
          } else {
            updateVerificationGate();
          }
        });
        choices.appendChild(button);
      });
      review.appendChild(choices);
    }
    const verifyLabel = document.createElement("label");
    verifyLabel.className = "field-verification-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = fieldVerificationId(inputId);
    checkbox.className = "field-verification-checkbox";
    checkbox.addEventListener("change", () => {
      wrapper.classList.toggle("manual-confirmed", checkbox.checked);
      badge.textContent = checkbox.checked ? "Confirmed" : "Review";
      badge.className = checkbox.checked
        ? "quality-badge quality-high"
        : `quality-badge ${qualityClass(quality)}`;
      state.autoSubmitDone = false;
      updateVerificationGate();
    });
    const text = document.createElement("span");
    text.textContent = "Source verified";
    verifyLabel.appendChild(checkbox);
    verifyLabel.appendChild(text);
    review.appendChild(verifyLabel);
    input.addEventListener("input", () => {
      checkbox.checked = false;
      wrapper.classList.remove("manual-confirmed");
      badge.textContent = "Review";
      badge.className = `quality-badge ${qualityClass(quality)}`;
      state.autoSubmitDone = false;
      updateVerificationGate();
    });
    wrapper.appendChild(review);
  }
  return wrapper;
}


function formatAuditValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.map(formatAuditValue).filter(Boolean).join(" / ");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, nested]) => {
        const formatted = formatAuditValue(nested);
        return formatted ? `${key}=${formatted}` : "";
      })
      .filter(Boolean)
      .join(", ");
  }
  return String(value);
}


function auditTable(study) {
  const details = document.createElement("details");
  details.className = "extraction-details";
  const summary = document.createElement("summary");
  summary.textContent = "View extraction cross-checks";
  details.appendChild(summary);

  const table = document.createElement("table");
  table.className = "study-table audit-table";
  table.innerHTML = "<thead><tr><th>Variable</th><th>Final</th><th>Supporting values</th><th>Method</th></tr></thead><tbody></tbody>";
  const body = table.querySelector("tbody");

  ["A", "B", "C", "Kmax", "BAD_D", "ARTmax"].forEach((variable) => {
    const item = study.audit[variable];
    const row = document.createElement("tr");
    const sources = Object.entries(item.sources || {})
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .map(([name, value]) => `${name}: ${formatAuditValue(value)}`)
      .join("; ");
    row.innerHTML = `
      <td><strong>${VARIABLE_META[variable].label}</strong></td>
      <td>${Number.isFinite(item.final) ? item.final : "Unavailable"}</td>
      <td>${sources || "—"}</td>
      <td>${item.note}</td>
    `;
    body.appendChild(row);
  });

  details.appendChild(table);
  return details;
}

function sourcePreview(study) {
  const details = document.createElement("details");
  details.className = "source-preview";
  const summary = document.createElement("summary");
  summary.textContent = "View the source Pentacam pages used";
  details.appendChild(summary);

  const note = document.createElement("p");
  note.className = "muted preview-note";
  note.textContent = "These images remain in local browser memory and are not included in the JSON export.";
  details.appendChild(note);

  const grid = document.createElement("div");
  grid.className = "source-page-grid";

  const pages = [
    ["Topometric/KC-Staging", study.sourcePages.topometric],
    ["Belin/Ambrósio Enhanced Ectasia", study.sourcePages.belin],
    ["ABCD Progression Display", study.sourcePages.progression],
  ];

  pages.forEach(([label, url]) => {
    if (!url) return;
    const figure = document.createElement("figure");
    const caption = document.createElement("figcaption");
    caption.textContent = label;
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const image = document.createElement("img");
    image.src = url;
    image.alt = label;
    link.appendChild(image);
    figure.appendChild(caption);
    figure.appendChild(link);
    grid.appendChild(figure);
  });

  details.appendChild(grid);
  return details;
}

function visitCard(study, eye, visitKey, title) {
  const card = document.createElement("div");
  card.className = "visit-card";
  const heading = document.createElement("h4");
  heading.textContent = title;
  card.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "value-grid";
  ["A", "B", "C", "Kmax", "BAD_D", "ARTmax"].forEach((variable) => {
    grid.appendChild(
      valueInput(
        variable,
        study?.values?.[variable],
        `${visitKey}_${eye}_${variable}`,
        study?.audit?.[variable]?.quality || "Unavailable",
        study
      )
    );
  });
  card.appendChild(grid);

  const incomplete = !studyComplete(study);
  const reviewCount = ["A", "B", "C", "Kmax", "BAD_D", "ARTmax"]
    .filter((variable) => fieldNeedsVerification(study, variable)).length;
  const status = document.createElement("div");
  status.className = incomplete || reviewCount ? "extraction-warning" : "extraction-ok";
  status.textContent = incomplete
    ? "Missing value"
    : reviewCount
      ? `${reviewCount} value${reviewCount === 1 ? "" : "s"} to review`
      : "6/6 confirmed";
  card.appendChild(status);

  card.appendChild(auditTable(study));
  card.appendChild(sourcePreview(study));
  return card;
}

function renderDetectedTable(studies, title) {
  const wrapper = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = title;
  wrapper.appendChild(heading);

  const table = document.createElement("table");
  table.className = "study-table";
  table.innerHTML = "<thead><tr><th>Eye</th><th>Examination</th><th>Extraction</th></tr></thead><tbody></tbody>";
  const body = table.querySelector("tbody");

  studies.forEach((study) => {
    const row = document.createElement("tr");
    const resolution = study.eyeResolution
      ? `<div class="muted" style="font-size:.76rem">${study.eyeResolution}</div>`
      : "";
    row.innerHTML = `
      <td><strong>${study.eye || "Needs confirmation"}</strong>${resolution}</td>
      <td>${formatTimestamp(study.timestamp)}</td>
      <td>${Object.values(study.values || {}).filter(Number.isFinite).length}/6 extracted · ${NKPIImport.FIELDS.filter(k => fieldNeedsVerification(study,k)).length} to review</td>
    `;
    body.appendChild(row);
  });

  wrapper.appendChild(table);
  return wrapper;
}

function renderDetected() {
  const summary = el("detectedSummary");
  summary.innerHTML = "";

  if (state.visitOrderNotice) {
    const notice = document.createElement("div");
    notice.className = "alert warning";
    notice.textContent = state.visitOrderNotice;
    summary.appendChild(notice);
  }

  if (state.mode === "baseline") {
    summary.appendChild(renderDetectedTable(state.baselineStudies, "Single-visit ZIP"));
    const baselineResolver = createLateralityResolver(state.baselineStudies, "baseline");
    if (baselineResolver) summary.appendChild(baselineResolver);
    const groups = groupByEye(state.baselineStudies);
    const selectors = document.createElement("div");
    selectors.className = "form-grid two";
    ["OD", "OS"].forEach((eye) => {
      if (groups[eye].length) selectors.appendChild(createStudySelector(eye, groups[eye], "baseline"));
    });
    summary.appendChild(selectors);
  } else {
    summary.appendChild(renderDetectedTable(state.earlierStudies, "Earlier ZIP"));
    const earlierResolver = createLateralityResolver(state.earlierStudies, "earlier");
    if (earlierResolver) summary.appendChild(earlierResolver);

    summary.appendChild(renderDetectedTable(state.laterStudies, "Later ZIP"));
    const laterResolver = createLateralityResolver(state.laterStudies, "later");
    if (laterResolver) summary.appendChild(laterResolver);

    const earlierGroups = groupByEye(state.earlierStudies);
    const laterGroups = groupByEye(state.laterStudies);
    const selectors = document.createElement("div");
    selectors.className = "form-grid two";
    ["OD", "OS"].forEach((eye) => {
      if (earlierGroups[eye].length) selectors.appendChild(createStudySelector(eye, earlierGroups[eye], "earlier"));
      if (laterGroups[eye].length) selectors.appendChild(createStudySelector(eye, laterGroups[eye], "later"));
    });
    summary.appendChild(selectors);
  }

  el("detectedSection").classList.remove("hidden");
  syncFrameHeight();
}

function renderReview() {
  const content = el("reviewContent");
  content.innerHTML = "";

  if (state.mode === "baseline") {
    const groups = groupByEye(state.baselineStudies);
    const grid = document.createElement("div");
    grid.className = "eye-grid";

    ["OD", "OS"].forEach((eye) => {
      if (!groups[eye].length) return;
      const study = selectedStudy(groups, eye, "baseline");
      const card = document.createElement("div");
      card.className = "eye-card";
      const heading = document.createElement("h3");
      heading.textContent = eye === "OD" ? "Right eye — OD" : "Left eye — OS";
      card.appendChild(heading);
      card.appendChild(visitCard(study, eye, "baseline", "Selected visit"));
      grid.appendChild(card);
    });
    if (!grid.children.length) {
      const warning = document.createElement("div");
      warning.className = "alert warning";
      warning.textContent = "Confirm OD/OS in the Detected studies section above; all extracted measurements are being retained.";
      content.appendChild(warning);
    } else {
      content.appendChild(grid);
    }
  } else {
    const earlierGroups = groupByEye(state.earlierStudies);
    const laterGroups = groupByEye(state.laterStudies);
    const commonEyes = ["OD", "OS"].filter((eye) => earlierGroups[eye].length && laterGroups[eye].length);

    const intervalWrap = document.createElement("div");
    intervalWrap.className = "form-grid two";
    intervalWrap.innerHTML = `
      <label class="field">
        <span>Days between visits</span>
        <input id="intervalDays" type="number" min="1" max="3650" step="1" />
        <small>Calculated locally from the ZIP timestamps. Exact dates are not exported.</small>
      </label>
    `;
    content.appendChild(intervalWrap);

    commonEyes.forEach((eye) => {
      const oldStudy = selectedStudy(earlierGroups, eye, "earlier");
      const newStudy = selectedStudy(laterGroups, eye, "later");
      const card = document.createElement("div");
      card.className = "eye-card";
      const heading = document.createElement("h3");
      heading.textContent = eye === "OD" ? "Right eye — OD" : "Left eye — OS";
      card.appendChild(heading);

      const visits = document.createElement("div");
      visits.className = "eye-grid";
      visits.appendChild(visitCard(oldStudy, eye, "earlier", "Earlier visit"));
      visits.appendChild(visitCard(newStudy, eye, "later", "Later visit"));
      card.appendChild(visits);
      content.appendChild(card);
    });

    const oldDates = commonEyes
      .map((eye) => selectedStudy(earlierGroups, eye, "earlier")?.timestamp)
      .filter(Boolean);
    const newDates = commonEyes
      .map((eye) => selectedStudy(laterGroups, eye, "later")?.timestamp)
      .filter(Boolean);
    if (oldDates.length && newDates.length) {
      const earliest = new Date(Math.min(...oldDates.map((date) => date.getTime())));
      const latest = new Date(Math.max(...newDates.map((date) => date.getTime())));
      el("intervalDays").value = Math.max(1, Math.round(Math.abs(latest - earliest) / 86400000));
    }
  }

  el("reviewSection").classList.remove("hidden");
  el("confirmValues").checked = false;
  window.setTimeout(updateVerificationGate, 0);
  syncFrameHeight();
  el("exportSection").classList.add("hidden");
}

function readVisitValues(visitKey, eye) {
  const values = {};
  ["A", "B", "C", "Kmax", "BAD_D", "ARTmax"].forEach((variable) => {
    const input = el(`${visitKey}_${eye}_${variable}`);
    if (!input || input.value === "") throw new Error(`${eye}: ${VARIABLE_META[variable].label} is missing.`);
    const value = Number(input.value);
    if (!plausible(variable, value)) {
      const [low, high] = PLAUSIBLE_RANGES[variable];
      throw new Error(`${eye}: ${VARIABLE_META[variable].label} must be between ${low} and ${high}.`);
    }
    values[variable] = Math.round(value * 1000) / 1000;
  });
  return values;
}

function buildPayload() {
  if (!allRequiredFieldsVerified()) {
    throw new Error("Every flagged measurement must be verified from its source crop before calculation.");
  }
  const age = Number(el("age").value);
  if (!Number.isFinite(age) || age < 1 || age > 100) throw new Error("Enter a valid age.");

  const payload = {
    nkpi_import_version: "1.0",
    generated_by: `NKPI Browser Pentacam Extractor ${APP_VERSION}`,
    case_id: el("caseId").value.trim() || randomCaseId(),
    mode: state.mode,
    age: Math.round(age * 10) / 10,
  };

  if (state.mode === "baseline") {
    payload.eyes = {};
    ["OD", "OS"].forEach((eye) => {
      if (el(`baseline_${eye}_A`)) payload.eyes[eye] = readVisitValues("baseline", eye);
    });
    if (!Object.keys(payload.eyes).length) throw new Error("No complete eye data are available.");
  } else {
    const intervalDays = Number(el("intervalDays")?.value);
    if (!Number.isFinite(intervalDays) || intervalDays < 1) throw new Error("Enter a valid scan interval.");
    payload.interval_days = Math.round(intervalDays);
    payload.baseline = {};
    payload.followup = {};

    ["OD", "OS"].forEach((eye) => {
      if (el(`earlier_${eye}_A`) && el(`later_${eye}_A`)) {
        payload.baseline[eye] = readVisitValues("earlier", eye);
        payload.followup[eye] = readVisitValues("later", eye);
      }
    });
    if (!Object.keys(payload.baseline).length) throw new Error("No eye is complete in both visits.");
  }

  return payload;
}

function generateExport() {
  clearError();
  if (!el("confirmValues").checked) {
    el("exportSection").classList.add("hidden");
    state.payload = null;
    syncFrameHeight();
    return;
  }

  try {
    state.payload = buildPayload();
    el("jsonOutput").value = JSON.stringify(state.payload, null, 2);
    const eyeCount = state.payload.mode === "baseline"
      ? Object.keys(state.payload.eyes || {}).length
      : Object.keys(state.payload.baseline || {}).length;
    const modeLabel = state.payload.mode === "baseline" ? "Baseline" : "Longitudinal";
    el("payloadSummary").textContent = `${modeLabel} case ready • ${eyeCount} eye${eyeCount === 1 ? "" : "s"} • Only confirmed numeric values will be sent.`;
    el("sendStatus").textContent = "";
    el("exportSection").classList.remove("hidden");
    el("exportSection").scrollIntoView({ behavior: "smooth", block: "start" });
    syncFrameHeight();
  } catch (error) {
    el("confirmValues").checked = false;
    showError(error?.message || String(error));
    syncFrameHeight();
  }
}

async function processFiles() {
  if (state.processing) return;
  resetResultsOnly();
  invalidateVerifiedPayload();
  clearError();
  const epoch = state.processEpoch, mode = state.mode;
  const firstFile = el(mode === 'baseline' ? 'baselineZip' : 'earlierZip').files?.[0];
  const lastFile = mode === 'longitudinal' ? el('laterZip').files?.[0] : null;
  state.processing = true;
  el('processButton').disabled = true;
  state.ocrJobsDone = 0;
  state.ocrJobsEstimated = 1;
  try {
    const age = Number(el('age').value);
    if (!el('age').value.trim() || !Number.isFinite(age) || age < 18 || age > 100) throw new Error('Enter an age between 18 and 100.');
    if (!firstFile || (mode === 'longitudinal' && !lastFile)) throw new Error(mode === 'baseline' ? 'Choose a Continuum ZIP first.' : 'Choose both visit ZIPs.');
    // Report discovery and source-only review also work when OCR is unavailable.
    if (epoch !== state.processEpoch) return;
    setProgress(20, 'Opening Continuum ZIP…', 'Extracting model values. Associated report pages will also be available in the map viewer.');
    const firstStudies = await parseArchive(firstFile, mode === 'baseline' ? 'Single visit' : 'Visit A');
    if (epoch !== state.processEpoch) return;
    if (mode === 'baseline') state.baselineStudies = firstStudies;
    else {
      const lastStudies = await parseArchive(lastFile, 'Visit B');
      if (epoch !== state.processEpoch) return;
      state.earlierStudies = firstStudies;
      state.laterStudies = lastStudies;
      const firstTime = representativeVisitTime(firstStudies), secondTime = representativeVisitTime(lastStudies);
      if (Number.isFinite(firstTime) && Number.isFinite(secondTime) && firstTime > secondTime) {
        state.earlierStudies = lastStudies; state.laterStudies = firstStudies;
        state.visitOrderNotice = 'The ZIPs were reordered chronologically. Confirm each selected eye and visit against the source.';
      }
    }
    if (epoch !== state.processEpoch) return;
    setProgress(100, 'Extraction complete', 'Verify measurements in step 3, then choose Calculate NKPI now.');
    renderDetected(); renderReview();
    setTimeout(() => {if (epoch === state.processEpoch) hideProgress();}, 900);
    el('reviewSection').scrollIntoView({behavior:'smooth',block:'start'});
  } catch (error) {
    if (epoch === state.processEpoch) {hideProgress();showError(error?.message || String(error));}
  } finally {
    state.processing = false;
    el('processButton').disabled = false;
    if (epoch !== state.processEpoch) hideProgress();
  }
}

async function copyJson() {
  const text = el("jsonOutput").value;
  try {
    await navigator.clipboard.writeText(text);
    el("copyStatus").textContent = "Copied. Paste this JSON into the NKPI Streamlit calculator.";
  } catch (_) {
    el("jsonOutput").focus();
    el("jsonOutput").select();
    document.execCommand("copy");
    el("copyStatus").textContent = "Copied.";
  }
}

function downloadJson() {
  if (!state.payload) return;
  const blob = new Blob([JSON.stringify(state.payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${String(state.payload.case_id || "NKPI_case").replace(/[^a-z0-9_-]/gi, "_")}_nkpi_import.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function clearSession(notifyParent = true) {
  for (const id of ["baselineZip", "earlierZip", "laterZip"]) {
    if (el(id)) el(id).value = "";
  }
  el("caseId").value = randomCaseId();
  resetResultsOnly();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (notifyParent) sendClearToCalculator();
  scheduleFrameHeightSync();
}

document.addEventListener("DOMContentLoaded", () => {
  el("caseId").value = randomCaseId();

  document.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.addEventListener("change", (event) => setMode(event.target.value));
  });

  ["baselineZip", "earlierZip", "laterZip"].forEach((id) => {
    el(id)?.addEventListener("change", (event) => fileLabel(event.target));
  });

  el("processButton").addEventListener("click", processFiles);
  el("confirmValues").addEventListener("change", generateExport);
  el("sendButton").addEventListener("click", sendPayloadToCalculator);
  el("clearButton").addEventListener("click", () => clearSession(true));

  window.StreamlitBridge.events.addEventListener(
    window.StreamlitBridge.RENDER_EVENT,
    onStreamlitRender
  );
  window.StreamlitBridge.setComponentReady();

  const resizeObserver = new ResizeObserver(
    () => scheduleFrameHeightSync()
  );

  for (const target of [
    document.querySelector("header"),
    document.querySelector("main"),
    document.querySelector("footer"),
  ]) {
    if (target) resizeObserver.observe(target);
  }

  const mutationObserver = new MutationObserver(
    () => scheduleFrameHeightSync()
  );
  mutationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "open", "style"],
  });

  document.addEventListener(
    "toggle",
    () => scheduleFrameHeightSync(),
    true
  );
  document.addEventListener(
    "load",
    (event) => {
      if (event.target instanceof HTMLImageElement) {
        scheduleFrameHeightSync();
      }
    },
    true
  );

  scheduleFrameHeightSync();
});
