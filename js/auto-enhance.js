// ── AUTO IMAGE ENHANCER — auto-enhance.js ──
// Natural quality enhancement — NO size change, NO noise, NO over-sharpening
// Balanced approach: gentle denoise → soft sharpen → natural color lift

let iqOriginalFile = null;
let iqResultCanvas = null;

function iqHandleDrop(e) {
  e.preventDefault();
  const zone = document.getElementById('imgq-zone');
  if (zone) { zone.style.borderColor='rgba(20,184,166,0.3)'; zone.style.background='rgba(20,184,166,0.02)'; }
  const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
  if (file) iqStartEnhancement(file);
  else showToast('Please drop an image file','error');
}

function iqLoadFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) iqStartEnhancement(file);
}

function iqReset() {
  iqOriginalFile = null;
  iqResultCanvas = null;
  const zone = document.getElementById('imgq-zone');
  if (zone) zone.style.display = 'block';
  const proc = document.getElementById('iq-processing');
  if (proc) proc.style.display = 'none';
  const res  = document.getElementById('iq-result');
  if (res)  res.style.display  = 'none';
  document.querySelectorAll('.iq-proc-step').forEach(s => s.classList.remove('active','done'));
  const bar = document.getElementById('iq-proc-bar');
  if (bar) bar.style.width = '0%';
  const lbl = document.getElementById('iq-proc-label');
  if (lbl) lbl.textContent = 'Preparing...';
  const bImg = document.getElementById('iq-before-img');
  if (bImg) bImg.src = '';
}

async function iqStartEnhancement(file) {
  iqOriginalFile = file;

  const bImg = document.getElementById('iq-before-img');
  if (bImg) bImg.src = URL.createObjectURL(file);

  const zone = document.getElementById('imgq-zone');
  const proc = document.getElementById('iq-processing');
  const res  = document.getElementById('iq-result');
  if (zone) zone.style.display = 'none';
  if (proc) proc.style.display = 'block';
  if (res)  res.style.display  = 'none';

  const steps = document.querySelectorAll('.iq-proc-step');
  const bar   = document.getElementById('iq-proc-bar');
  const label = document.getElementById('iq-proc-label');

  function setStep(idx, pct, txt) {
    steps.forEach((s, i) => {
      s.classList.remove('active','done');
      if (i < idx)  s.classList.add('done');
      if (i === idx) s.classList.add('active');
    });
    if (bar)   bar.style.width   = pct + '%';
    if (label) label.textContent = txt;
  }

  try {
    const img = await loadImage(URL.createObjectURL(file));

    // EXACT original size — no upscaling
    const W = img.naturalWidth  || img.width;
    const H = img.naturalHeight || img.height;

    const canvas   = document.createElement('canvas');
    canvas.width   = W;
    canvas.height  = H;
    const ctx      = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);

    // Step 1: Analyze
    setStep(0, 10, 'Analyzing image...');
    await sleep(200);

    // Step 2: Light denoise — only 1 pass, radius 1
    setStep(1, 28, 'Removing noise & artifacts...');
    await sleep(200);
    gentleDenoisePass(ctx, W, H);

    // Step 3: Subtle sharpening — 1 pass only, low strength
    setStep(2, 50, 'Sharpening edges & details...');
    await sleep(200);
    subtleSharpenPass(ctx, W, H, 2.5); // very gentle

    // Step 4: Natural color & brightness lift
    setStep(3, 72, 'Enhancing color & contrast...');
    await sleep(200);
    naturalColorPass(ctx, W, H);

    // Step 5: Final polish — 1 very light sharpen
    setStep(4, 90, 'Final polish...');
    await sleep(200);
    subtleSharpenPass(ctx, W, H, 1.5); // barely noticeable

    if (bar)   bar.style.width   = '100%';
    if (label) label.textContent = '✅ Enhancement complete!';
    steps.forEach(s => { s.classList.remove('active'); s.classList.add('done'); });

    iqResultCanvas = canvas;
    await sleep(300);
    showIQResult(canvas, W, H);

  } catch(err) {
    showToast('Enhancement failed: ' + err.message, 'error');
    console.error(err);
    iqReset();
  }
}

function showIQResult(canvas, W, H) {
  const proc = document.getElementById('iq-processing');
  const res  = document.getElementById('iq-result');
  if (proc) proc.style.display = 'none';
  if (res)  res.style.display  = 'block';

  const dc = document.getElementById('iq-after-canvas');
  if (dc) {
    dc.width  = W;
    dc.height = H;
    dc.getContext('2d').drawImage(canvas, 0, 0);
  }

  const stats = document.getElementById('iq-result-stats');
  if (stats) stats.textContent = `${W}×${H} · Original size · AI enhanced`;

  res?.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

// ── DOWNLOAD ──
function iqDownload() {
  if (!iqResultCanvas) return;
  const isPNG = iqOriginalFile?.type === 'image/png';
  const mime  = isPNG ? 'image/png' : 'image/jpeg';
  const ext   = isPNG ? 'png' : 'jpg';
  const base  = iqOriginalFile?.name?.replace(/\.[^.]+$/, '') || 'enhanced';

  iqResultCanvas.toBlob(blob => {
    downloadBlob(blob, `${base}-enhanced.${ext}`);
    showToast('✅ Enhanced image downloaded!', 'success');
  }, mime, isPNG ? undefined : 0.96);
}

// ══════════════════════════
//   ALGORITHMS — BALANCED
// ══════════════════════════

// Very gentle denoise — just a tiny bilateral-style blur
// Only blurs pixels that are very close in color (preserves edges)
function gentleDenoisePass(ctx, W, H) {
  const src = ctx.getImageData(0, 0, W, H);
  const dst = ctx.createImageData(W, H);
  const s   = src.data;
  const d   = dst.data;
  const SIG_COLOR = 25; // color sensitivity — only blur similar-colored neighbors
  const RADIUS    = 1;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ci = (y * W + x) * 4;
      const cr = s[ci], cg = s[ci+1], cb = s[ci+2];

      let wr = 0, wg = 0, wb = 0, wt = 0;

      for (let dy = -RADIUS; dy <= RADIUS; dy++) {
        for (let dx = -RADIUS; dx <= RADIUS; dx++) {
          const nx  = Math.max(0, Math.min(W-1, x+dx));
          const ny  = Math.max(0, Math.min(H-1, y+dy));
          const ni  = (ny * W + nx) * 4;
          const nr  = s[ni], ng = s[ni+1], nb = s[ni+2];

          // Weight based on color similarity
          const colorDiff = Math.sqrt((nr-cr)**2 + (ng-cg)**2 + (nb-cb)**2);
          const w = Math.exp(-(colorDiff * colorDiff) / (2 * SIG_COLOR * SIG_COLOR));

          wr += nr * w; wg += ng * w; wb += nb * w; wt += w;
        }
      }

      d[ci]     = clamp(wr / wt);
      d[ci + 1] = clamp(wg / wt);
      d[ci + 2] = clamp(wb / wt);
      d[ci + 3] = s[ci + 3];
    }
  }
  ctx.putImageData(dst, 0, 0);
}

// Subtle unsharp mask — enhances edges without creating noise
function subtleSharpenPass(ctx, W, H, strength) {
  const src = ctx.getImageData(0, 0, W, H);
  const dst = ctx.createImageData(W, H);
  const s   = src.data;
  const d   = dst.data;
  const k   = strength / 10; // 0.15 – 0.35 range
  const c   = 1 + 4 * k;
  const e   = -k;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const v =
          s[i + ch]                     * c +
          getPx(s, W, H, x-1, y,   ch) * e +
          getPx(s, W, H, x+1, y,   ch) * e +
          getPx(s, W, H, x,   y-1, ch) * e +
          getPx(s, W, H, x,   y+1, ch) * e;
        d[i + ch] = clamp(v);
      }
      d[i + 3] = s[i + 3];
    }
  }
  ctx.putImageData(dst, 0, 0);
}

// Natural color lift — subtle, balanced adjustments
// Mimics what phone cameras do automatically
function naturalColorPass(ctx, W, H) {
  const img = ctx.getImageData(0, 0, W, H);
  const d   = img.data;

  // Very gentle settings — like auto-enhance in Google Photos
  const brightness = 5;      // barely noticeable lift
  const contrast   = 15;     // mild punch
  const saturation = 1.12;   // 12% more vivid — not oversaturated
  const gamma      = 0.92;   // slightly brighter midtones

  const bF   = brightness * 2.55;
  const cF   = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const gInv = 1 / gamma;

  const gLUT = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    gLUT[i] = clamp(Math.round(255 * Math.pow(i / 255, gInv)));
  }

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i+1], b = d[i+2];

    // Brightness
    r += bF; g += bF; b += bF;

    // Contrast (mild)
    r = cF * (r - 128) + 128;
    g = cF * (g - 128) + 128;
    b = cF * (b - 128) + 128;

    // Saturation (gentle)
    const gray = 0.299*r + 0.587*g + 0.114*b;
    r = gray + (r - gray) * saturation;
    g = gray + (g - gray) * saturation;
    b = gray + (b - gray) * saturation;

    // Gamma
    d[i]     = gLUT[clamp(r)];
    d[i + 1] = gLUT[clamp(g)];
    d[i + 2] = gLUT[clamp(b)];
  }
  ctx.putImageData(img, 0, 0);
}

// ── UTILS ──
function getPx(data, W, H, x, y, c) {
  x = Math.max(0, Math.min(W-1, x));
  y = Math.max(0, Math.min(H-1, y));
  return data[(y * W + x) * 4 + c];
}
function clamp(v)  { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img    = new Image();
    img.onload   = () => resolve(img);
    img.onerror  = reject;
    img.src      = src;
  });
}