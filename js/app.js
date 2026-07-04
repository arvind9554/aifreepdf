// ── APP.JS ── SwiftPDF UI Controller

// ── STATE ──
const state = {
  compress: { files: [], level: 'low' },
  img2pdf: { files: [] },
  merge: { files: [] },
  split: { files: [] },
  rotate: { files: [], deg: 90 },
  pdf2img: { files: [] },
  reorder: { files: [], order: [] },
  protect: { files: [] },
};

// ── NAVIGATION ──
function scrollToTools() {
  document.getElementById('tools').scrollIntoView({ behavior: 'smooth' });
}

function openTool(toolId) {
  // Hide tools grid area visually
  document.querySelector('.tools-section').style.marginBottom = '0';
  
  // Show workspace
  const ws = document.querySelector('.workspace');
  ws.classList.add('visible');
  
  // Hide all panels
  document.querySelectorAll('.tool-panel').forEach(p => p.classList.remove('active'));
  
  // Show selected
  const panel = document.getElementById(`panel-${toolId}`);
  if (panel) panel.classList.add('active');
  
  // Scroll to workspace
  setTimeout(() => ws.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  
  // Update tool cards
  document.querySelectorAll('.tool-card').forEach(c => c.classList.remove('active'));
  document.querySelector(`[data-tool="${toolId}"]`)?.classList.add('active');
}

function closeTool() {
  document.querySelector('.workspace').classList.remove('visible');
  document.querySelectorAll('.tool-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tools').scrollIntoView({ behavior: 'smooth' });
}

// ── FILE HANDLING ──
function triggerInput(id) { document.getElementById(id)?.click(); }

function preventDefault(e) { e.preventDefault(); }

function handleDrop(e, tool) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const files = [...e.dataTransfer.files];
  addFiles(tool, files);
}

function handleFile(e, tool) {
  addFiles(tool, [...e.target.files]);
  e.target.value = '';
}

function addFiles(tool, newFiles) {
  const toolState = state[tool];
  const isMulti = ['img2pdf', 'merge'].includes(tool);
  
  if (!isMulti) {
    toolState.files = newFiles.slice(0, 1);
  } else {
    toolState.files.push(...newFiles);
  }
  
  renderFileList(tool);
}

function removeFile(tool, idx) {
  state[tool].files.splice(idx, 1);
  renderFileList(tool);
}

function renderFileList(tool) {
  const list = document.getElementById(`${tool}-files`);
  const opts = document.getElementById(`${tool}-options`);
  const files = state[tool].files;
  
  list.innerHTML = '';
  
  files.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    const icon = tool === 'img2pdf' ? '🖼️' : '📄';
    item.innerHTML = `
      <span class="fi-icon">${icon}</span>
      <span class="fi-name">${f.name}</span>
      <span class="fi-size">${formatBytes(f.size)}</span>
      <button class="fi-remove" onclick="removeFile('${tool}',${i})" title="Remove">✕</button>
    `;
    list.appendChild(item);
  });
  
  if (files.length > 0 && opts) {
    opts.style.display = 'block';

    // Special case: compress — show original size & set default target
    if (tool === 'compress') showOriginalSize(files[0].size);

    // Special case: reorder — render thumbnails
    if (tool === 'reorder') {
      const grid = document.getElementById('reorder-pages-grid');
      grid.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px">Loading page previews...</div>';
      renderPageThumbnails(files[0], grid, state.reorder.order);
    }
  } else if (opts) {
    opts.style.display = 'none';
  }
  
  // Reset results
  const result = document.getElementById(`${tool}-result`);
  if (result) { result.style.display = 'none'; result.textContent = ''; }
  
  const progress = document.getElementById(`${tool}-progress`);
  if (progress) progress.style.display = 'none';
}

// ── DRAG OVER ──
document.querySelectorAll('.upload-zone').forEach(zone => {
  zone.addEventListener('dragenter', () => zone.classList.add('drag-over'));
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
});

// ── UNIVERSAL DOWNLOAD / SUCCESS OVERLAY ──
// pendingDownloads holds {blob, filename} entries waiting for the user to click "Download Now"
let pendingDownloads = [];

function openProcessingOverlay(title, icon, statusText) {
  const overlay = document.getElementById('dl-overlay');
  document.getElementById('dl-step-processing').style.display = 'block';
  document.getElementById('dl-step-success').style.display = 'none';
  document.getElementById('dl-step-error').style.display = 'none';

  document.querySelector('#dl-step-processing .dl-title').textContent = title;
  document.querySelector('#dl-step-processing .dl-center-icon').textContent = icon;
  document.getElementById('dl-status-text').textContent = statusText || 'Processing...';
  document.getElementById('dl-bar').style.width = '0%';
  document.getElementById('dl-pct').textContent = '0%';
  document.getElementById('dl-file-info').textContent = '';

  overlay.classList.add('open');
}

function setOverlayProgress(pct, statusText) {
  document.getElementById('dl-bar').style.width = pct + '%';
  document.getElementById('dl-pct').textContent = pct + '%';
  if (statusText) document.getElementById('dl-status-text').textContent = statusText;
}

// downloads: array of {blob, filename}
// statsHtml: optional HTML string shown inside the result stats box (e.g. size before/after)
function showSuccessOverlay({ title, message, downloads, statsHtml }) {
  pendingDownloads = downloads || [];

  document.getElementById('dl-step-processing').style.display = 'none';
  document.getElementById('dl-step-error').style.display = 'none';
  document.getElementById('dl-step-success').style.display = 'block';

  document.querySelector('#dl-step-success .dl-title').textContent = title || 'File Ready!';
  document.querySelector('#dl-step-success .dl-sub').textContent = message || 'Click below to download your file.';

  const statsBox = document.getElementById('dl-result-stats');
  if (statsHtml) {
    statsBox.innerHTML = statsHtml;
    statsBox.style.display = 'flex';
  } else {
    statsBox.style.display = 'none';
  }

  // Update download button label based on number of files
  const dlBtn = document.getElementById('dl-download-again');
  dlBtn.textContent = pendingDownloads.length > 1
    ? `⬇ Download Now (${pendingDownloads.length} files)`
    : '⬇ Download Now';

  document.getElementById('dl-overlay').classList.add('open');
}

function showErrorOverlay(message) {
  document.getElementById('dl-step-processing').style.display = 'none';
  document.getElementById('dl-step-success').style.display = 'none';
  document.getElementById('dl-step-error').style.display = 'block';
  document.getElementById('dl-error-msg').textContent = message || 'Something went wrong. Please try again.';
  document.getElementById('dl-overlay').classList.add('open');
}

// Triggered by the "Download Now" button — this is the user-initiated download click
function downloadAgain() {
  if (!pendingDownloads.length) return;

  if (typeof isInAppBrowser === 'function' && isInAppBrowser()) {
    showToast('If download doesn\'t start, tap ⋮ menu → "Open in Browser"', 'error');
  }

  pendingDownloads.forEach((d, i) => {
    setTimeout(() => downloadBlob(d.blob, d.filename), i * 250);
  });
}

function closeDLOverlay() {
  document.getElementById('dl-overlay').classList.remove('open');
  pendingDownloads = [];
}

// ── COMPRESS ──

// Called when a file is loaded — fills "Original Size" box and sets default target
function showOriginalSize(bytes) {
  const mb = bytes / (1024 * 1024);
  const kb = bytes / 1024;

  // Show original
  const origEl = document.getElementById('cbox-original');
  if (origEl) {
    origEl.textContent = mb >= 1 ? mb.toFixed(2) + ' MB' : kb.toFixed(0) + ' KB';
  }

  // Default target = 50% of original
  const defMB = (mb * 0.5).toFixed(2);
  const defKB = Math.round(kb * 0.5);
  const mbInput = document.getElementById('target-mb');
  const kbInput = document.getElementById('target-kb');
  if (mbInput) mbInput.value = defMB;
  if (kbInput) kbInput.value = defKB;

  updateHint();
}

// Keep MB and KB in sync when user types in either box
function syncTarget(from) {
  const mbInput = document.getElementById('target-mb');
  const kbInput = document.getElementById('target-kb');
  if (!mbInput || !kbInput) return;

  if (from === 'mb') {
    const mb = parseFloat(mbInput.value);
    if (!isNaN(mb) && mb > 0) kbInput.value = Math.round(mb * 1024);
  } else {
    const kb = parseFloat(kbInput.value);
    if (!isNaN(kb) && kb > 0) mbInput.value = (kb / 1024).toFixed(2);
  }
  updateHint();
}

// Step +/- buttons for MB and KB
function stepTarget(unit, dir) {
  const mbInput = document.getElementById('target-mb');
  const kbInput = document.getElementById('target-kb');
  if (!mbInput || !kbInput) return;

  if (unit === 'mb') {
    const cur = parseFloat(mbInput.value) || 0;
    const step = cur >= 1 ? 0.1 : 0.05;
    mbInput.value = Math.max(0.05, cur + dir * step).toFixed(2);
    syncTarget('mb');
  } else {
    const cur = parseFloat(kbInput.value) || 0;
    const step = cur >= 500 ? 50 : cur >= 100 ? 20 : 10;
    kbInput.value = Math.max(10, cur + dir * step);
    syncTarget('kb');
  }
}

function updateHint() {
  const hint = document.getElementById('compress-hint');
  if (!hint) return;
  const files = state.compress.files;
  if (!files.length) return;

  const origBytes = files[0].size;
  const targetKB  = parseFloat(document.getElementById('target-kb')?.value);
  if (isNaN(targetKB) || targetKB <= 0) { hint.textContent = ''; return; }

  const targetBytes = targetKB * 1024;
  const reduction   = Math.round((1 - targetBytes / origBytes) * 100);

  if (targetBytes >= origBytes) {
    hint.style.color = 'var(--amber)';
    hint.textContent = '⚠️ Target is larger than original — no compression needed.';
  } else if (reduction > 85) {
    hint.style.color = 'var(--amber)';
    hint.textContent = `⚠️ ${reduction}% reduction requested — tool will apply maximum safe compression. Actual size may be slightly higher than target to preserve readability.`;
  } else if (reduction > 70) {
    hint.style.color = 'var(--text2)';
    hint.textContent = `~${reduction}% reduction — good compression, slight quality loss possible.`;
  } else {
    hint.style.color = 'var(--green)';
    hint.textContent = `✓ ~${reduction}% reduction — safe range, good output quality expected.`;
  }
}

async function compressPDF() {
  const files = state.compress.files;
  if (!files.length) return showToast('Please upload a PDF first', 'error');

  const file     = files[0];
  const origSize = file.size;
  const targetKB = parseFloat(document.getElementById('target-kb')?.value);

  if (isNaN(targetKB) || targetKB <= 0) return showToast('Please set a valid target size', 'error');

  const targetBytes = targetKB * 1024;

  openProcessingOverlay('Compressing your PDF', '📦', 'Rendering pages...');

  try {
    const blob = await compressPDFFile(file, targetBytes, (pct) => {
      setOverlayProgress(pct, pct < 95 ? `Compressing... ${pct}%` : 'Finalizing...');
    });

    const saved = origSize - blob.size;
    const pct   = Math.max(0, Math.round((saved / origSize) * 100));
    const fname = file.name.replace('.pdf', '-compressed.pdf');
    const hitTarget = blob.size <= targetBytes;

    const statsHtml = `
      <div class="dl-stat"><span class="dl-stat-val old">${formatBytes(origSize)}</span><span class="dl-stat-label">Original</span></div>
      <span class="dl-stat-arrow">→</span>
      <div class="dl-stat"><span class="dl-stat-val new">${formatBytes(blob.size)}</span><span class="dl-stat-label">Compressed</span></div>
      <div class="dl-stat"><span class="dl-stat-val saved">-${pct}%</span><span class="dl-stat-label">Saved</span></div>
    `;

    showSuccessOverlay({
      title: hitTarget ? 'Your PDF is Compressed!' : 'Compressed to Smallest Safe Size',
      message: hitTarget
        ? 'Click below to download your compressed file.'
        : `This PDF couldn't reach your exact target without becoming unreadable, so we compressed it as much as safely possible (${formatBytes(blob.size)}).`,
      downloads: [{ blob, filename: fname }],
      statsHtml,
    });
  } catch (err) {
    showErrorOverlay('Compression failed: ' + err.message);
    console.error(err);
  }
}

// ── IMAGE TO PDF ──
async function imagesToPDF() {
  const files = state.img2pdf.files;
  if (!files.length) return showToast('Please add at least one image', 'error');
  
  const pageSize = document.getElementById('img2pdf-pagesize').value;
  const orientation = document.getElementById('img2pdf-orient').value;
  const margin = parseFloat(document.getElementById('img2pdf-margin').value) || 0;
  
  openProcessingOverlay('Converting your images', '🖼️', 'Converting images...');
  
  try {
    const blob = await imagesToPDFFile(files, pageSize, orientation, margin, (pct) => {
      setOverlayProgress(pct, `Converting... ${pct}%`);
    });

    const statsHtml = `
      <div class="dl-stat"><span class="dl-stat-val new">${files.length}</span><span class="dl-stat-label">Image${files.length>1?'s':''}</span></div>
      <span class="dl-stat-arrow">→</span>
      <div class="dl-stat"><span class="dl-stat-val new">${formatBytes(blob.size)}</span><span class="dl-stat-label">PDF Size</span></div>
    `;

    showSuccessOverlay({
      title: 'Your PDF is Ready!',
      message: `${files.length} image(s) converted successfully.`,
      downloads: [{ blob, filename: 'converted.pdf' }],
      statsHtml,
    });
  } catch (err) {
    showErrorOverlay('Conversion failed: ' + err.message);
    console.error(err);
  }
}

// ── MERGE ──
async function mergePDFs() {
  const files = state.merge.files;
  if (files.length < 2) return showToast('Add at least 2 PDFs to merge', 'error');
  
  openProcessingOverlay('Merging your PDFs', '🔗', 'Merging PDFs...');
  
  try {
    const blob = await mergePDFFiles(files);

    const statsHtml = `
      <div class="dl-stat"><span class="dl-stat-val new">${files.length}</span><span class="dl-stat-label">Files Merged</span></div>
      <span class="dl-stat-arrow">→</span>
      <div class="dl-stat"><span class="dl-stat-val new">${formatBytes(blob.size)}</span><span class="dl-stat-label">Final Size</span></div>
    `;

    showSuccessOverlay({
      title: 'Your PDFs are Merged!',
      message: `${files.length} files combined into one document.`,
      downloads: [{ blob, filename: 'merged.pdf' }],
      statsHtml,
    });
  } catch (err) {
    showErrorOverlay('Merge failed: ' + err.message);
    console.error(err);
  }
}

// ── SPLIT ──
function updateSplitMode() {
  const mode = document.querySelector('[name="split-mode"]:checked').value;
  document.getElementById('split-range-opts').style.display = mode === 'range' ? 'block' : 'none';
  document.getElementById('split-every-opts').style.display = mode === 'every' ? 'block' : 'none';
}

async function splitPDF() {
  const files = state.split.files;
  if (!files.length) return showToast('Please upload a PDF first', 'error');
  
  const mode = document.querySelector('[name="split-mode"]:checked').value;
  const rangeStr = document.getElementById('split-range').value;
  const n = parseInt(document.getElementById('split-n').value) || 1;
  
  openProcessingOverlay('Splitting your PDF', '✂️', 'Splitting PDF...');
  
  try {
    const blobs = await splitPDFFile(files[0], mode, rangeStr, n);

    const statsHtml = `
      <div class="dl-stat"><span class="dl-stat-val new">${blobs.length}</span><span class="dl-stat-label">File${blobs.length>1?'s':''} Created</span></div>
    `;

    showSuccessOverlay({
      title: 'Your PDF is Split!',
      message: blobs.length > 1
        ? `Split into ${blobs.length} files. Click below to download all.`
        : 'Click below to download your file.',
      downloads: blobs.map(b => ({ blob: b.blob, filename: b.name })),
      statsHtml,
    });
  } catch (err) {
    showErrorOverlay('Split failed: ' + err.message);
    console.error(err);
  }
}

// ── ROTATE ──
function selectRotation(btn) {
  document.querySelectorAll('.rotate-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.rotate.deg = parseInt(btn.dataset.deg);
}

document.getElementById('rotate-pages')?.addEventListener('change', function() {
  const custom = document.getElementById('rotate-custom');
  custom.style.display = this.value === 'custom' ? 'block' : 'none';
});

async function rotatePDF() {
  const files = state.rotate.files;
  if (!files.length) return showToast('Please upload a PDF first', 'error');
  
  const pagesMode = document.getElementById('rotate-pages').value;
  const customRange = document.getElementById('rotate-custom').value;

  openProcessingOverlay('Rotating your PDF', '🔄', 'Rotating pages...');
  
  try {
    const blob = await rotatePDFFile(files[0], state.rotate.deg, pagesMode, customRange);
    const fname = files[0].name.replace('.pdf', '-rotated.pdf');

    setOverlayProgress(100, 'Done!');

    const statsHtml = `
      <div class="dl-stat"><span class="dl-stat-val new">${state.rotate.deg}°</span><span class="dl-stat-label">Rotated</span></div>
    `;

    showSuccessOverlay({
      title: 'Your PDF is Rotated!',
      message: 'Click below to download your rotated file.',
      downloads: [{ blob, filename: fname }],
      statsHtml,
    });
  } catch (err) {
    showErrorOverlay('Rotation failed: ' + err.message);
    console.error(err);
  }
}

// ── PDF TO IMAGES ──
async function pdfToImages() {
  const files = state.pdf2img.files;
  if (!files.length) return showToast('Please upload a PDF first', 'error');
  
  const scale = parseFloat(document.getElementById('pdf2img-dpi').value);
  const fmt = document.getElementById('pdf2img-fmt').value;
  const ext = fmt === 'image/jpeg' ? 'jpg' : 'png';
  
  openProcessingOverlay('Converting PDF to images', '📸', 'Rendering pages...');
  const preview = document.getElementById('pdf2img-previews');
  preview.innerHTML = '';
  
  try {
    const images = await pdfToImagesFiles(files[0], scale, fmt, (pct) => {
      setOverlayProgress(pct, `Converting... ${pct}%`);
    });

    // Build preview grid (kept for visual reference) and blob list for download
    const downloads = [];
    for (let i = 0; i < images.length; i++) {
      const dataUrl = images[i];
      const blob = await (await fetch(dataUrl)).blob();
      const filename = `page-${i + 1}.${ext}`;
      downloads.push({ blob, filename });

      const item = document.createElement('div');
      item.className = 'preview-item';
      item.innerHTML = `
        <img src="${dataUrl}" alt="Page ${i+1}"/>
        <button class="dl-btn" onclick="downloadDataUrl('${dataUrl}','${filename}')">⬇ Download</button>
      `;
      preview.appendChild(item);
    }

    const statsHtml = `
      <div class="dl-stat"><span class="dl-stat-val new">${images.length}</span><span class="dl-stat-label">Page${images.length>1?'s':''} Exported</span></div>
    `;

    showSuccessOverlay({
      title: 'Your Images are Ready!',
      message: images.length > 1
        ? `${images.length} pages exported. Click below to download all.`
        : 'Click below to download your image.',
      downloads,
      statsHtml,
    });
  } catch (err) {
    showErrorOverlay('Conversion failed: ' + err.message);
    console.error(err);
  }
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

// ── REORDER ──
async function saveReorderedPDF() {
  const files = state.reorder.files;
  if (!files.length) return showToast('Please upload a PDF first', 'error');

  openProcessingOverlay('Saving reordered PDF', '📋', 'Rebuilding pages...');
  
  try {
    const blob = await reorderPDFFile(files[0], state.reorder.order);
    const fname = files[0].name.replace('.pdf', '-reordered.pdf');

    setOverlayProgress(100, 'Done!');

    const statsHtml = `
      <div class="dl-stat"><span class="dl-stat-val new">${state.reorder.order.length}</span><span class="dl-stat-label">Pages Reordered</span></div>
    `;

    showSuccessOverlay({
      title: 'Your PDF is Reordered!',
      message: 'Click below to download your file.',
      downloads: [{ blob, filename: fname }],
      statsHtml,
    });
  } catch (err) {
    showErrorOverlay('Reorder failed: ' + err.message);
    console.error(err);
  }
}

// ── PROTECT ──
async function protectPDF() {
  const files = state.protect.files;
  if (!files.length) return showToast('Please upload a PDF first', 'error');
  
  const pass = document.getElementById('protect-pass').value;
  const confirm = document.getElementById('protect-confirm').value;
  
  if (!pass) return showToast('Please enter a password', 'error');
  if (pass.length < 4) return showToast('Password must be at least 4 characters', 'error');
  if (pass !== confirm) return showToast('Passwords do not match', 'error');

  openProcessingOverlay('Protecting your PDF', '🔒', 'Encrypting file...');
  
  try {
    const blob = await protectPDFFile(files[0], pass);
    const fname = files[0].name.replace('.pdf', '-protected.pdf');

    setOverlayProgress(100, 'Done!');

    const statsHtml = `
      <div class="dl-stat"><span class="dl-stat-val new">🔒 AES</span><span class="dl-stat-label">Encrypted</span></div>
    `;

    showSuccessOverlay({
      title: 'Your PDF is Protected!',
      message: 'Click below to download your password-protected file.',
      downloads: [{ blob, filename: fname }],
      statsHtml,
    });
  } catch (err) {
    showErrorOverlay('Protection failed: ' + err.message);
    console.error(err);
  }
}

function togglePasswordVis(inputId) {
  const inp = document.getElementById(inputId);
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

// ── PROGRESS HELPERS ──
function showProgress(tool, label) {
  const container = document.getElementById(`${tool}-progress`);
  const status = document.getElementById(`${tool}-status`);
  if (container) container.style.display = 'block';
  if (status) status.textContent = label;
  setProgress(tool, 0, label);
}

function setProgress(tool, pct, label) {
  const bar = document.getElementById(`${tool}-bar`);
  const pctEl = document.getElementById(`${tool}-pct`);
  const status = document.getElementById(`${tool}-status`);
  if (bar) bar.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (status && label) status.textContent = label;
}

let progressTimers = {};
function animateProgress(tool, targetPct, duration) {
  clearInterval(progressTimers[tool]);
  let current = 0;
  const step = targetPct / (duration / 50);
  progressTimers[tool] = setInterval(() => {
    current = Math.min(current + step, targetPct);
    setProgress(tool, Math.round(current));
    if (current >= targetPct) clearInterval(progressTimers[tool]);
  }, 50);
}

// ── FAQ ──
function toggleFAQ(item) { item.classList.toggle('open'); }

// ── TOAST ──
let toastTimeout;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.classList.remove('show'); }, 3500);
}

// ── DRAG OVER ZONES ──
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.upload-zone').forEach(zone => {
    zone.addEventListener('dragenter', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  });
});

// ── MOBILE HAMBURGER MENU ──
function toggleMobileMenu() {
  const drawer = document.getElementById('mobile-drawer');
  const btn    = document.getElementById('hamburger');
  if (!drawer || !btn) return;
  const isOpen = drawer.classList.contains('open');
  if (isOpen) {
    drawer.classList.remove('open');
    btn.classList.remove('open');
  } else {
    drawer.classList.add('open');
    btn.classList.add('open');
  }
}

function closeMobileMenu() {
  const drawer = document.getElementById('mobile-drawer');
  const btn    = document.getElementById('hamburger');
  drawer?.classList.remove('open');
  btn?.classList.remove('open');
}

// Close drawer if user clicks outside it
document.addEventListener('click', (e) => {
  const drawer = document.getElementById('mobile-drawer');
  const btn    = document.getElementById('hamburger');
  if (!drawer || !btn) return;
  if (!drawer.contains(e.target) && !btn.contains(e.target)) {
    drawer.classList.remove('open');
    btn.classList.remove('open');
  }
});