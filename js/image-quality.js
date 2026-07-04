// ── IMAGE QUALITY TOOL ──
// All processing done via Canvas 2D pixel manipulation — no external library needed

const iqState = {
  file: null,
  mode: 'sharpen',
  scale: 1.5,
  img: null,
};

// ── FILE HANDLING (reuses same drag/drop pattern as app.js) ──
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('imgq-zone');
  if (zone) {
    zone.addEventListener('dragenter', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  }
});

// Override the global handleDrop — this page only has the imgq tool, so this is safe
function handleDrop(e, tool) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (tool === 'imgq') {
    const files = [...e.dataTransfer.files];
    if (files.length) loadImageFile(files[0]);
  }
}

// Override / extend handleFile and triggerInput already defined in app.js for shared tools.
// For imgq specifically we define our own light versions to avoid collisions.
const _origHandleFile = window.handleFile;
window.handleFile = function (e, tool) {
  if (tool === 'imgq') {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) loadImageFile(file);
    return;
  }
  if (_origHandleFile) _origHandleFile(e, tool);
};

function loadImageFile(file) {
  iqState.file = file;

  // Show file in list
  const list = document.getElementById('imgq-files');
  list.innerHTML = `
    <div class="file-item">
      <span class="fi-icon">🖼️</span>
      <span class="fi-name">${file.name}</span>
      <span class="fi-size">${formatBytes(file.size)}</span>
      <button class="fi-remove" onclick="removeIQFile()" title="Remove">✕</button>
    </div>`;

  const img = new Image();
  img.onload = () => {
    iqState.img = img;
    document.getElementById('imgq-options').style.display = 'block';
    renderPreview();
  };
  img.src = URL.createObjectURL(file);
}

function removeIQFile() {
  iqState.file = null;
  iqState.img = null;
  document.getElementById('imgq-files').innerHTML = '';
  document.getElementById('imgq-options').style.display = 'none';
  document.getElementById('iq-preview-wrap').style.display = 'none';
}

// ── MODE SELECTION ──
function selectIQMode(btn, mode) {
  document.querySelectorAll('.iq-mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  iqState.mode = mode;

  document.querySelectorAll('.iq-mode-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`iq-panel-${mode}`).style.display = 'block';

  renderPreview();
}

function selectScale(btn) {
  document.querySelectorAll('.iq-scale-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  iqState.scale = parseFloat(btn.dataset.scale);
  renderPreview();
}

function updateRangeLabel(inputId, labelId) {
  document.getElementById(labelId).textContent = document.getElementById(inputId).value;
  renderPreview();
}

// ── LIVE PREVIEW (debounced) ──
let previewTimer = null;
function renderPreview() {
  if (!iqState.img) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const wrap = document.getElementById('iq-preview-wrap');
    wrap.style.display = 'flex';

    const PREVIEW_MAX = 220;
    const img = iqState.img;
    const ratio = Math.min(PREVIEW_MAX / img.width, PREVIEW_MAX / img.height, 1);
    const pw = Math.round(img.width * ratio);
    const ph = Math.round(img.height * ratio);

    const beforeCanvas = document.getElementById('iq-canvas-before');
    beforeCanvas.width = pw; beforeCanvas.height = ph;
    beforeCanvas.getContext('2d').drawImage(img, 0, 0, pw, ph);

    const afterCanvas = document.getElementById('iq-canvas-after');
    afterCanvas.width = pw; afterCanvas.height = ph;
    const actx = afterCanvas.getContext('2d');
    actx.drawImage(img, 0, 0, pw, ph);

    applyModeToCanvas(afterCanvas, iqState.mode, true);
  }, 150);
}

// ── CORE PIXEL OPERATIONS ──

// Convolution-based sharpen (unsharp-mask style kernel)
function sharpenCanvas(canvas, amount) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const s = src.data, d = dst.data;

  const strength = amount / 10; // 0.1–1.0
  const center = 1 + 4 * strength;
  const edge = -strength;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let val =
          s[i + c] * center +
          getPx(s, w, h, x - 1, y, c) * edge +
          getPx(s, w, h, x + 1, y, c) * edge +
          getPx(s, w, h, x, y - 1, c) * edge +
          getPx(s, w, h, x, y + 1, c) * edge;
        d[i + c] = clamp(val);
      }
      d[i + 3] = s[i + 3];
    }
  }
  ctx.putImageData(dst, 0, 0);
}

function getPx(data, w, h, x, y, c) {
  x = Math.max(0, Math.min(w - 1, x));
  y = Math.max(0, Math.min(h - 1, y));
  return data[(y * w + x) * 4 + c];
}

function clamp(v) { return Math.max(0, Math.min(255, v)); }

// Simple box-blur based denoise (averages neighborhood, reduces grain)
function denoiseCanvas(canvas, amount) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const radius = Math.max(1, Math.round(amount / 3)); // 1–3px radius
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const s = src.data, d = dst.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
          const idx = (yy * w + xx) * 4;
          r += s[idx]; g += s[idx + 1]; b += s[idx + 2];
          count++;
        }
      }
      const i = (y * w + x) * 4;
      d[i] = r / count; d[i + 1] = g / count; d[i + 2] = b / count;
      d[i + 3] = s[i + 3];
    }
  }
  ctx.putImageData(dst, 0, 0);

  // Re-apply a light sharpen pass after denoise to recover some edge detail
  sharpenCanvas(canvas, 2);
}

// Brightness / Contrast / Saturation / Sharpness manual adjustments
function manualAdjustCanvas(canvas, { brightness, contrast, saturation, sharpness }) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  const bFactor = brightness * 2.55; // -50..50 -> -127.5..127.5
  const cFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const sFactor = 1 + saturation / 50; // -50..50 -> 0..2

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];

    // Brightness
    r += bFactor; g += bFactor; b += bFactor;

    // Contrast
    r = cFactor * (r - 128) + 128;
    g = cFactor * (g - 128) + 128;
    b = cFactor * (b - 128) + 128;

    // Saturation
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * sFactor;
    g = gray + (g - gray) * sFactor;
    b = gray + (b - gray) * sFactor;

    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
  }
  ctx.putImageData(img, 0, 0);

  if (sharpness > 0) sharpenCanvas(canvas, sharpness);
}

// Upscale: draws to larger canvas with smoothing, then a gentle sharpen to recover crispness
function upscaleCanvas(srcCanvas, scale) {
  const newCanvas = document.createElement('canvas');
  newCanvas.width = Math.round(srcCanvas.width * scale);
  newCanvas.height = Math.round(srcCanvas.height * scale);
  const ctx = newCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(srcCanvas, 0, 0, newCanvas.width, newCanvas.height);
  sharpenCanvas(newCanvas, 4);
  return newCanvas;
}

// Applies whichever mode is selected to a given canvas (used both for preview + final export)
function applyModeToCanvas(canvas, mode, isPreview) {
  if (mode === 'sharpen') {
    const amt = parseInt(document.getElementById('iq-sharpen-amount').value);
    sharpenCanvas(canvas, amt);
  } else if (mode === 'denoise') {
    const amt = parseInt(document.getElementById('iq-denoise-amount').value);
    denoiseCanvas(canvas, amt);
  } else if (mode === 'manual') {
    manualAdjustCanvas(canvas, {
      brightness: parseInt(document.getElementById('iq-brightness').value),
      contrast: parseInt(document.getElementById('iq-contrast').value),
      saturation: parseInt(document.getElementById('iq-saturation').value),
      sharpness: parseInt(document.getElementById('iq-manual-sharp').value),
    });
  } else if (mode === 'upscale' && isPreview) {
    // For preview, just show a light sharpen since real upscale changes canvas size
    sharpenCanvas(canvas, 3);
  }
  return canvas;
}

// ── MAIN APPLY + DOWNLOAD ──
async function applyImageQuality() {
  if (!iqState.img || !iqState.file) return showToast('Please upload an image first', 'error');

  const modeNames = {
    sharpen: 'Sharpened',
    upscale: 'Upscaled',
    denoise: 'Denoised',
    manual: 'Adjusted',
  };

  openProcessingOverlay('Enhancing your image', '✨', 'Preparing image...');

  try {
    await new Promise(r => setTimeout(r, 150)); // let UI paint

    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = iqState.img.width;
    fullCanvas.height = iqState.img.height;
    fullCanvas.getContext('2d').drawImage(iqState.img, 0, 0);

    setOverlayProgress(35, 'Applying enhancement...');
    await new Promise(r => setTimeout(r, 100));

    let outputCanvas = fullCanvas;

    if (iqState.mode === 'upscale') {
      outputCanvas = upscaleCanvas(fullCanvas, iqState.scale);
    } else {
      applyModeToCanvas(fullCanvas, iqState.mode, false);
      outputCanvas = fullCanvas;
    }

    setOverlayProgress(80, 'Encoding image...');
    await new Promise(r => setTimeout(r, 100));

    const mime = iqState.file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const quality = mime === 'image/jpeg' ? 0.92 : undefined;

    outputCanvas.toBlob((blob) => {
      const ext = mime === 'image/png' ? 'png' : 'jpg';
      const baseName = iqState.file.name.replace(/\.[^.]+$/, '');
      const fname = `${baseName}-enhanced.${ext}`;

      const statsHtml = `
        <div class="dl-stat"><span class="dl-stat-val new">${modeNames[iqState.mode]}</span><span class="dl-stat-label">Enhancement</span></div>
        <span class="dl-stat-arrow">→</span>
        <div class="dl-stat"><span class="dl-stat-val new">${formatBytes(blob.size)}</span><span class="dl-stat-label">File Size</span></div>
      `;

      showSuccessOverlay({
        title: 'Your Image is Enhanced!',
        message: 'Click below to download your improved image.',
        downloads: [{ blob, filename: fname }],
        statsHtml,
      });
    }, mime, quality);

  } catch (err) {
    showErrorOverlay('Enhancement failed: ' + err.message);
    console.error(err);
  }
}

function setIQProgress(pct, label) {
  document.getElementById('imgq-bar').style.width = pct + '%';
  document.getElementById('imgq-pct').textContent = pct + '%';
  document.getElementById('imgq-status').textContent = label;
}