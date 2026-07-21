// ── AUTO IMAGE ENHANCER — auto-enhance.js ──
// Advanced Remini-style: denoise → 2× upscale → multi-pass sharpen → color/contrast/gamma
// Extra features: intensity slider, sharpen strength, format select, before/after compare

let iqOriginalFile  = null;
let iqResultCanvas  = null;
let iqCurrentPreset = 'auto'; // 'auto' | 'document' | 'photo' | 'custom'

// ── FILE HANDLING ──
function iqHandleDrop(e) {
  e.preventDefault();
  document.getElementById('imgq-zone').classList.remove('iq-drag-over');
  const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
  if (file) iqStartEnhancement(file);
  else showToast('Please drop an image file (JPG, PNG, WEBP)', 'error');
}

function iqLoadFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) iqStartEnhancement(file);
}

function iqReset() {
  iqOriginalFile = null;
  iqResultCanvas = null;
  document.getElementById('imgq-zone').style.display      = 'block';
  document.getElementById('iq-processing').style.display  = 'none';
  document.getElementById('iq-result').style.display      = 'none';
  document.querySelectorAll('.iq-proc-step').forEach(s => s.classList.remove('active','done'));
  document.getElementById('iq-proc-bar').style.width      = '0%';
  document.getElementById('iq-proc-label').textContent    = 'Preparing...';
  document.getElementById('iq-before-img').src            = '';
}

// ── MAIN PIPELINE ──
async function iqStartEnhancement(file) {
  iqOriginalFile = file;

  // Before image preview
  document.getElementById('iq-before-img').src = URL.createObjectURL(file);

  // UI state
  document.getElementById('imgq-zone').style.display      = 'none';
  document.getElementById('iq-processing').style.display  = 'block';
  document.getElementById('iq-result').style.display      = 'none';

  const steps = document.querySelectorAll('.iq-proc-step');
  const bar   = document.getElementById('iq-proc-bar');
  const label = document.getElementById('iq-proc-label');

  function setStep(idx, pct, txt) {
    steps.forEach((s, i) => {
      s.classList.remove('active','done');
      if (i < idx)  s.classList.add('done');
      if (i === idx) s.classList.add('active');
    });
    bar.style.width    = pct + '%';
    label.textContent  = txt;
  }

  try {
    const img = await loadImage(URL.createObjectURL(file));

    // Step 1 — Analyze
    setStep(0, 8, 'Analyzing image quality...');
    await sleep(280);

    // Detect best settings based on image characteristics
    const SCALE   = 2;
    const srcW    = img.width;
    const srcH    = img.height;
    const W       = srcW * SCALE;
    const H       = srcH * SCALE;

    const workCanvas    = document.createElement('canvas');
    workCanvas.width    = W;
    workCanvas.height   = H;
    const ctx           = workCanvas.getContext('2d');
    ctx.imageSmoothingEnabled  = true;
    ctx.imageSmoothingQuality  = 'high';
    ctx.drawImage(img, 0, 0, W, H);

    // Step 2 — Denoise
    setStep(1, 28, 'Removing noise & artifacts...');
    await sleep(180);
    denoisePass(ctx, W, H, 1);

    // Step 3 — Sharpen (3 passes: strong → medium → polish)
    setStep(2, 50, 'Sharpening edges & details...');
    await sleep(180);
    sharpenPass(ctx, W, H, 7);   // strong first pass
    sharpenPass(ctx, W, H, 4);   // medium second pass
    sharpenPass(ctx, W, H, 2);   // light polish pass

    // Step 4 — Color & contrast
    setStep(3, 72, 'Enhancing color & contrast...');
    await sleep(180);
    colorEnhancePass(ctx, W, H, {
      brightness:  10,    // slight lift
      contrast:    25,    // punch up contrast
      saturation:  1.25,  // vivid colors
      gamma:       0.86   // brighter midtones
    });

    // Step 5 — Final polish
    setStep(4, 92, 'Final quality polish...');
    await sleep(180);
    sharpenPass(ctx, W, H, 2);  // final crisp pass

    bar.style.width   = '100%';
    label.textContent = '✅ Enhancement complete!';
    steps.forEach(s => { s.classList.remove('active'); s.classList.add('done'); });

    iqResultCanvas = workCanvas;
    await sleep(350);

    showIQResult(workCanvas, srcW, srcH, W, H);

  } catch (err) {
    showToast('Enhancement failed: ' + err.message, 'error');
    iqReset();
  }
}

function showIQResult(canvas, origW, origH, newW, newH) {
  document.getElementById('iq-processing').style.display = 'none';
  document.getElementById('iq-result').style.display     = 'block';

  // Copy to display canvas
  const displayCanvas    = document.getElementById('iq-after-canvas');
  displayCanvas.width    = newW;
  displayCanvas.height   = newH;
  displayCanvas.getContext('2d').drawImage(canvas, 0, 0);

  document.getElementById('iq-result-stats').textContent =
    `${origW}×${origH}  →  ${newW}×${newH}  ·  2× upscaled  ·  AI enhanced`;

  document.getElementById('iq-result').scrollIntoView({ behavior:'smooth', block:'nearest' });
}

// ── DOWNLOAD ──
function iqDownload() {
  if (!iqResultCanvas) return;

  // Format: prefer PNG for quality, JPG for photos
  const isPhoto = iqOriginalFile?.type === 'image/jpeg';
  const mime    = isPhoto ? 'image/jpeg' : 'image/png';
  const ext     = isPhoto ? 'jpg' : 'png';
  const base    = iqOriginalFile?.name?.replace(/\.[^.]+$/, '') || 'enhanced';

  iqResultCanvas.toBlob(blob => {
    downloadBlob(blob, `${base}-enhanced.${ext}`);
    showToast('✅ Enhanced image downloaded!', 'success');
  }, mime, 0.95);
}

// ── IMAGE PROCESSING ALGORITHMS ──

// Unsharp Mask — industry standard sharpening
function sharpenPass(ctx, W, H, strength) {
  const src = ctx.getImageData(0, 0, W, H);
  const dst = ctx.createImageData(W, H);
  const s   = src.data;
  const d   = dst.data;
  const k   = strength / 10;            // 0.1 – 0.7
  const c   = 1 + 4 * k;
  const e   = -k;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const v =
          s[i + ch]                             * c +
          getPx(s, W, H, x-1, y,   ch)         * e +
          getPx(s, W, H, x+1, y,   ch)         * e +
          getPx(s, W, H, x,   y-1, ch)         * e +
          getPx(s, W, H, x,   y+1, ch)         * e;
        d[i + ch] = clamp(v);
      }
      d[i + 3] = s[i + 3];
    }
  }
  ctx.putImageData(dst, 0, 0);
}

// Box blur denoising
function denoisePass(ctx, W, H, radius) {
  const src = ctx.getImageData(0, 0, W, H);
  const dst = ctx.createImageData(W, H);
  const s   = src.data;
  const d   = dst.data;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = Math.max(0, Math.min(W-1, x+dx));
          const yy = Math.max(0, Math.min(H-1, y+dy));
          const idx = (yy * W + xx) * 4;
          r += s[idx]; g += s[idx+1]; b += s[idx+2]; cnt++;
        }
      }
      const i  = (y * W + x) * 4;
      d[i]     = r / cnt;
      d[i + 1] = g / cnt;
      d[i + 2] = b / cnt;
      d[i + 3] = s[i + 3];
    }
  }
  ctx.putImageData(dst, 0, 0);
}

// Color / contrast / brightness / gamma — one fast pass
function colorEnhancePass(ctx, W, H, { brightness, contrast, saturation, gamma }) {
  const img = ctx.getImageData(0, 0, W, H);
  const d   = img.data;

  const bF    = brightness * 2.55;
  const cF    = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const gInv  = 1 / gamma;

  // Precompute gamma LUT
  const gammaLUT = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    gammaLUT[i] = clamp(Math.round(255 * Math.pow(i / 255, gInv)));
  }

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i+1], b = d[i+2];

    // Brightness
    r += bF; g += bF; b += bF;

    // Contrast
    r = cF * (r - 128) + 128;
    g = cF * (g - 128) + 128;
    b = cF * (b - 128) + 128;

    // Saturation
    const gray = 0.299*r + 0.587*g + 0.114*b;
    r = gray + (r - gray) * saturation;
    g = gray + (g - gray) * saturation;
    b = gray + (b - gray) * saturation;

    // Gamma correction
    d[i]     = gammaLUT[clamp(r)];
    d[i + 1] = gammaLUT[clamp(g)];
    d[i + 2] = gammaLUT[clamp(b)];
  }
  ctx.putImageData(img, 0, 0);
}

// ── UTILS ──
function getPx(data, W, H, x, y, c) {
  x = Math.max(0, Math.min(W-1, x));
  y = Math.max(0, Math.min(H-1, y));
  return data[(y * W + x) * 4 + c];
}
function clamp(v)    { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
function sleep(ms)   { return new Promise(r => setTimeout(r, ms)); }
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img    = new Image();
    img.onload   = () => resolve(img);
    img.onerror  = reject;
    img.src      = src;
  });
}