// ── PDF ENGINE ──
// Uses pdf-lib (CDN) and pdf.js (CDN) for all processing

const { PDFDocument, degrees, rgb, StandardFonts } = PDFLib;

// ── COMPRESSION ──
// targetBytes: desired output size in bytes.
// Renders pages once, then iteratively tries progressively more aggressive
// quality/downscale combos until output size <= targetBytes (or floor reached).
async function compressPDFFile(file, targetBytes, onProgress) {
  const arrayBuf = await file.arrayBuffer();

  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const pdfJsDoc = await pdfjsLib.getDocument({ data: arrayBuf.slice(0) }).promise;
  const totalPages = pdfJsDoc.numPages;

  // Render every page ONCE at a fixed decent scale — reused for every compression attempt
  const RENDER_SCALE = 1.5;
  const pageCanvases = [];
  for (let i = 1; i <= totalPages; i++) {
    const page = await pdfJsDoc.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    pageCanvases.push(canvas);
    onProgress && onProgress(Math.round((i / totalPages) * 35)); // 0-35% = rendering
  }

  // Build a full PDF from the rendered canvases at a given JPEG quality + size factor
  async function buildAtQuality(quality, downscale) {
    const doc = await PDFDocument.create();
    for (const canvas of pageCanvases) {
      let srcCanvas = canvas;
      if (downscale < 1) {
        const small = document.createElement('canvas');
        small.width = Math.max(1, Math.round(canvas.width * downscale));
        small.height = Math.max(1, Math.round(canvas.height * downscale));
        small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
        srcCanvas = small;
      }
      const jpegDataUrl = srcCanvas.toDataURL('image/jpeg', quality);
      const base64 = jpegDataUrl.split(',')[1];
      const jpegBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const jpegImage = await doc.embedJpg(jpegBytes);
      const pdfPage = doc.addPage([srcCanvas.width, srcCanvas.height]);
      pdfPage.drawImage(jpegImage, { x: 0, y: 0, width: srcCanvas.width, height: srcCanvas.height });
    }
    const bytes = await doc.save({ useObjectStreams: true });
    return new Blob([bytes], { type: 'application/pdf' });
  }

  // Binary search on JPEG quality to land as close to targetBytes as possible,
  // without going over. Much more precise than fixed steps.
  async function buildAtScale(downscale) {
    let lo = 0.20, hi = 0.92;
    let bestUnder = null;   // largest blob that is still <= target
    let bestOverall = null; // smallest blob seen overall (fallback if nothing fits under target)

    for (let iter = 0; iter < 6; iter++) {
      const mid = (lo + hi) / 2;
      const blob = await buildAtQuality(mid, downscale);

      if (!bestOverall || blob.size < bestOverall.size) bestOverall = blob;

      if (blob.size <= targetBytes) {
        if (!bestUnder || blob.size > bestUnder.size) bestUnder = blob; // keep the best quality that still fits
        lo = mid; // try higher quality (closer to target from below)
      } else {
        hi = mid; // too big, reduce quality
      }
    }
    return bestUnder || bestOverall;
  }

  // Try at full render resolution first; if even lowest quality at full size
  // can't reach target, progressively downscale and binary-search again.
  const downscaleSteps = [1.0, 0.85, 0.7, 0.55, 0.4];
  let bestBlob = null;

  for (let i = 0; i < downscaleSteps.length; i++) {
    const ds = downscaleSteps[i];
    const blob = await buildAtScale(ds);
    if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;

    const progressPct = 35 + Math.round(((i + 1) / downscaleSteps.length) * 60);
    onProgress && onProgress(Math.min(95, progressPct));

    if (blob.size <= targetBytes) {
      onProgress && onProgress(100);
      return blob;
    }
  }

  // Could not reach target even at smallest scale + lowest quality — return smallest achieved
  onProgress && onProgress(100);
  return bestBlob;
}

// ── MERGE ──
async function mergePDFFiles(files) {
  const merged = await PDFDocument.create();
  
  for (let i = 0; i < files.length; i++) {
    const buf = await files[i].arrayBuffer();
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pageIndices = doc.getPageIndices();
    const pages = await merged.copyPages(doc, pageIndices);
    pages.forEach(p => merged.addPage(p));
    
    updateProgress('merge', Math.round(((i + 1) / files.length) * 100));
  }
  
  const saved = await merged.save();
  return new Blob([saved], { type: 'application/pdf' });
}

// ── SPLIT ──
async function splitPDFFile(file, mode, rangeStr, n) {
  const buf = await file.arrayBuffer();
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const totalPages = doc.getPageCount();
  const blobs = [];
  
  if (mode === 'all') {
    for (let i = 0; i < totalPages; i++) {
      const newDoc = await PDFDocument.create();
      const [page] = await newDoc.copyPages(doc, [i]);
      newDoc.addPage(page);
      const saved = await newDoc.save();
      blobs.push({ blob: new Blob([saved], { type: 'application/pdf' }), name: `page-${i + 1}.pdf` });
      updateProgress('split', Math.round(((i + 1) / totalPages) * 100));
    }
  } else if (mode === 'every') {
    let pageIdx = 0;
    let fileNum = 1;
    while (pageIdx < totalPages) {
      const newDoc = await PDFDocument.create();
      const chunk = [];
      for (let j = 0; j < n && pageIdx < totalPages; j++, pageIdx++) chunk.push(pageIdx);
      const pages = await newDoc.copyPages(doc, chunk);
      pages.forEach(p => newDoc.addPage(p));
      const saved = await newDoc.save();
      blobs.push({ blob: new Blob([saved], { type: 'application/pdf' }), name: `part-${fileNum++}.pdf` });
      updateProgress('split', Math.round((pageIdx / totalPages) * 100));
    }
  } else if (mode === 'range') {
    const indices = parsePageRange(rangeStr, totalPages);
    if (!indices.length) throw new Error('Invalid page range');
    const newDoc = await PDFDocument.create();
    const pages = await newDoc.copyPages(doc, indices);
    pages.forEach(p => newDoc.addPage(p));
    const saved = await newDoc.save();
    blobs.push({ blob: new Blob([saved], { type: 'application/pdf' }), name: `extracted.pdf` });
    updateProgress('split', 100);
  }
  
  return blobs;
}

// ── ROTATE ──
async function rotatePDFFile(file, angleDeg, pagesMode, customRange) {
  const buf = await file.arrayBuffer();
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const totalPages = doc.getPageCount();
  
  const targetIndices = new Set();
  if (pagesMode === 'all') for (let i = 0; i < totalPages; i++) targetIndices.add(i);
  else if (pagesMode === 'odd') for (let i = 0; i < totalPages; i += 2) targetIndices.add(i);
  else if (pagesMode === 'even') for (let i = 1; i < totalPages; i += 2) targetIndices.add(i);
  else if (pagesMode === 'custom') {
    const parsed = parsePageRange(customRange, totalPages);
    parsed.forEach(idx => targetIndices.add(idx));
  }
  
  doc.getPages().forEach((page, idx) => {
    if (targetIndices.has(idx)) {
      const curr = page.getRotation().angle;
      page.setRotation(degrees((curr + angleDeg) % 360));
    }
  });
  
  const saved = await doc.save();
  return new Blob([saved], { type: 'application/pdf' });
}

// ── IMAGES TO PDF ──
async function imagesToPDFFile(files, pageSize, orientation, margin, onProgress) {
  const doc = await PDFDocument.create();
  
  const pageSizes = {
    A4: [595.28, 841.89],
    A3: [841.89, 1190.55],
    Letter: [612, 792],
  };
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    
    let img;
    const mime = file.type;
    if (mime === 'image/jpeg' || mime === 'image/jpg') {
      img = await doc.embedJpg(bytes);
    } else {
      img = await doc.embedPng(bytes);
    }
    
    let pw, ph;
    if (pageSize === 'fit') {
      pw = img.width + margin * 2;
      ph = img.height + margin * 2;
    } else {
      [pw, ph] = pageSizes[pageSize] || pageSizes.A4;
      if (orientation === 'landscape') [pw, ph] = [ph, pw];
    }
    
    const page = doc.addPage([pw, ph]);
    
    const maxW = pw - margin * 2;
    const maxH = ph - margin * 2;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (pw - w) / 2;
    const y = (ph - h) / 2;
    
    page.drawImage(img, { x, y, width: w, height: h });
    onProgress && onProgress(Math.round(((i + 1) / files.length) * 100));
  }
  
  const saved = await doc.save();
  return new Blob([saved], { type: 'application/pdf' });
}

// ── PDF TO IMAGES ──
async function pdfToImagesFiles(file, scale, fmt, onProgress) {
  const buf = await file.arrayBuffer();
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const total = pdf.numPages;
  const results = [];
  
  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL(fmt, 0.95);
    results.push(dataUrl);
    onProgress && onProgress(Math.round((i / total) * 100));
  }
  
  return results;
}

// ── REORDER ──
async function reorderPDFFile(file, newOrder) {
  const buf = await file.arrayBuffer();
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const newDoc = await PDFDocument.create();
  const pages = await newDoc.copyPages(doc, newOrder.map(n => n - 1));
  pages.forEach(p => newDoc.addPage(p));
  const saved = await newDoc.save();
  return new Blob([saved], { type: 'application/pdf' });
}

// ── RENDER PAGE THUMBNAILS ──
async function renderPageThumbnails(file, container, orderArr) {
  const buf = await file.arrayBuffer();
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  container.innerHTML = '';
  orderArr.length = 0;
  
  for (let i = 1; i <= pdf.numPages; i++) {
    orderArr.push(i);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 0.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    
    const thumb = document.createElement('div');
    thumb.className = 'page-thumb';
    thumb.draggable = true;
    thumb.dataset.page = i;
    thumb.innerHTML = `<div class="page-num">Page ${i}</div>`;
    thumb.insertBefore(canvas, thumb.firstChild);
    
    thumb.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', i);
      thumb.classList.add('dragging');
    });
    thumb.addEventListener('dragend', () => thumb.classList.remove('dragging'));
    thumb.addEventListener('dragover', e => { e.preventDefault(); });
    thumb.addEventListener('drop', e => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData('text/plain'));
      const to = parseInt(thumb.dataset.page);
      swapPages(from, to, container, orderArr);
    });
    
    container.appendChild(thumb);
  }
}

function swapPages(from, to, container, orderArr) {
  const fi = orderArr.indexOf(from);
  const ti = orderArr.indexOf(to);
  if (fi === -1 || ti === -1) return;
  [orderArr[fi], orderArr[ti]] = [orderArr[ti], orderArr[fi]];
  
  const thumbs = [...container.querySelectorAll('.page-thumb')];
  const fromEl = thumbs.find(t => parseInt(t.dataset.page) === from);
  const toEl = thumbs.find(t => parseInt(t.dataset.page) === to);
  if (fromEl && toEl) {
    const tmp = document.createElement('div');
    fromEl.parentNode.insertBefore(tmp, fromEl);
    toEl.parentNode.insertBefore(fromEl, toEl);
    tmp.parentNode.insertBefore(toEl, tmp);
    tmp.remove();
  }
}

// ── PROTECT PDF ──
// Real encryption using @cantoo/pdf-lib's doc.encrypt() — AES-256, actually requires password to open
async function protectPDFFile(file, password) {
  const buf = await file.arrayBuffer();
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });

  // Real PDF encryption: user must enter this password to open the file in any PDF reader
  doc.encrypt({
    userPassword: password,
    ownerPassword: password,
    permissions: {
      printing: 'highResolution',
      modifying: false,
      copying: false,
      annotating: false,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: false,
    },
  });

  const saved = await doc.save();
  return new Blob([saved], { type: 'application/pdf' });
}

// ── UTILS ──
function parsePageRange(str, total) {
  const indices = [];
  const parts = str.split(',').map(s => s.trim());
  for (const part of parts) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let i = a; i <= Math.min(b, total); i++) {
        if (i >= 1) indices.push(i - 1);
      }
    } else {
      const n = parseInt(part);
      if (n >= 1 && n <= total) indices.push(n - 1);
    }
  }
  return [...new Set(indices)].sort((a, b) => a - b);
}

function updateProgress(tool, pct) {
  const bar = document.getElementById(`${tool}-bar`);
  const pctEl = document.getElementById(`${tool}-pct`);
  if (bar) bar.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
}

// ── IN-APP BROWSER DETECTION ──
// Instagram, Facebook, and similar in-app browsers often block or silently fail
// programmatic downloads (the <a download> trick). Detect them so we can warn the user.
function isInAppBrowser() {
  const ua = navigator.userAgent || '';
  return /Instagram|FBAN|FBAV|FB_IAB|Line\/|MicroMessenger|Snapchat|TikTok/i.test(ua);
}

function showInAppBrowserWarning() {
  if (document.getElementById('iab-warning')) return; // already shown
  const bar = document.createElement('div');
  bar.id = 'iab-warning';
  bar.innerHTML = `
    <span>⚠️ You're using an in-app browser (Instagram/Facebook/etc). Downloads may not work here.</span>
    <button onclick="document.getElementById('iab-warning').remove()">✕</button>
  `;
  bar.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    background: #b45309; color: #fff; font-size: .82rem;
    padding: 10px 16px; display: flex; align-items: center; justify-content: space-between;
    gap: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.3);
  `;
  bar.querySelector('button').style.cssText = `
    background: none; border: none; color: #fff; font-size: 1rem; cursor: pointer; flex-shrink: 0;
  `;
  document.body.prepend(bar);
}

document.addEventListener('DOMContentLoaded', () => {
  if (isInAppBrowser()) showInAppBrowserWarning();
});

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);

  try {
    a.click();
  } catch (err) {
    // Some in-app browsers throw on programmatic click — fall back to opening in a new tab
    // so the user can long-press / use the browser's native save option.
    window.open(url, '_blank');
  }

  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}