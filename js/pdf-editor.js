// ── PDF EDITOR — pdf-editor.js ──
// Full featured: text, images, signatures, highlight, underline, sticky notes, draw

const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;

// ── STATE ──
let edPdfDoc        = null;   // pdf-lib document
let edPdfJsDoc      = null;   // pdf.js document for rendering
let edCurrentPage   = 1;
let edTotalPages    = 1;
let edZoom          = 1.0;
let edCurrentTool   = 'select';
let edAnnotColor    = '#000000';
let edHLColor       = 'rgba(254,240,138,0.5)';
let edOriginalBytes = null;
let edHistory       = [];     // undo stack
let edSelectedElem  = null;
let brushSize       = 3;
let brushOpacity    = 1;
let edSigMode       = 'draw';
let edSigFont       = 'Dancing Script';

// Drawing state
let edIsDrawing     = false;
let edDrawPath      = [];
let edStartX        = 0;
let edStartY        = 0;

// Per-page annotation store
// edAnnotations[pageNum] = { texts:[], images:[], stickies:[], draws:[], highlights:[], underlines:[], signatures:[] }
const edAnnotations = {};

function getPageAnnots(pg) {
  if (!edAnnotations[pg]) {
    edAnnotations[pg] = { texts:[], images:[], stickies:[], draws:[], highlights:[], underlines:[], signatures:[] };
  }
  return edAnnotations[pg];
}

// ── FILE LOADING ──
function editorOpenFile() {
  document.getElementById('pdf-file-input').click();
}

function edHandleDrop(e) {
  e.preventDefault();
  const file = [...e.dataTransfer.files].find(f => f.type === 'application/pdf');
  if (file) edLoadPDFFile(file);
  else showToast('Please drop a PDF file', 'error');
}

async function edLoadPDF(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) await edLoadPDFFile(file);
}

async function edLoadPDFFile(file) {
  try {
    showToast('Loading PDF...', 'success');
    const bytes = await file.arrayBuffer();
    edOriginalBytes = bytes.slice(0);

    // Load with pdf-lib for saving
    edPdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });

    // Load with pdf.js for rendering
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    edPdfJsDoc   = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    edTotalPages = edPdfJsDoc.numPages;
    edCurrentPage = 1;

    // Show editor UI
    document.getElementById('upload-screen').style.display    = 'none';
    document.getElementById('editor-toolbar').style.display   = 'flex';
    document.getElementById('editor-right').style.display     = 'flex';
    document.getElementById('page-nav').style.display         = 'flex';
    document.getElementById('mini-bar').style.display         = 'flex';
    document.getElementById('btn-save').disabled              = false;

    await edRenderPage(edCurrentPage);
    edUpdatePageInfo();
    showToast(`✅ PDF loaded — ${edTotalPages} page(s)`, 'success');
  } catch (err) {
    showToast('Failed to load PDF: ' + err.message, 'error');
  }
}

// ── RENDER PAGE ──
async function edRenderPage(pageNum) {
  const container = document.getElementById('pages-container');
  container.innerHTML = '';

  const page     = await edPdfJsDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: edZoom * 1.5 });

  // Wrapper
  const wrap = document.createElement('div');
  wrap.className = 'page-container';
  wrap.id = 'page-wrap-' + pageNum;
  wrap.style.width  = viewport.width  + 'px';
  wrap.style.height = viewport.height + 'px';

  // PDF canvas
  const pdfCanvas    = document.createElement('canvas');
  pdfCanvas.id       = 'pdf-canvas-' + pageNum;
  pdfCanvas.width    = viewport.width;
  pdfCanvas.height   = viewport.height;

  // Draw canvas (for free drawing)
  const drawCanvas   = document.createElement('canvas');
  drawCanvas.id      = 'draw-canvas-' + pageNum;
  drawCanvas.width   = viewport.width;
  drawCanvas.height  = viewport.height;
  drawCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:5';

  // SVG layer for highlights/underlines
  const svgLayer = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svgLayer.setAttribute('class','annotation-layer');
  svgLayer.id = 'svg-layer-' + pageNum;

  wrap.appendChild(pdfCanvas);
  wrap.appendChild(drawCanvas);
  wrap.appendChild(svgLayer);
  container.appendChild(wrap);

  // Render PDF
  await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise;

  // Restore saved annotations
  edRestoreAnnotations(pageNum, wrap, viewport.width, viewport.height);

  // Event listeners
  wrap.addEventListener('click',      (e) => edHandleCanvasClick(e, wrap, pageNum, viewport));
  wrap.addEventListener('mousedown',  (e) => edHandleMouseDown(e, wrap, pageNum, viewport));
  wrap.addEventListener('mousemove',  (e) => edHandleMouseMove(e, wrap, drawCanvas, viewport));
  wrap.addEventListener('mouseup',    (e) => edHandleMouseUp(e, wrap, drawCanvas, pageNum, viewport));
  wrap.addEventListener('touchstart', (e) => edHandleTouch(e, 'start', wrap, drawCanvas, pageNum, viewport), {passive:false});
  wrap.addEventListener('touchmove',  (e) => edHandleTouch(e, 'move',  wrap, drawCanvas, pageNum, viewport), {passive:false});
  wrap.addEventListener('touchend',   (e) => edHandleTouch(e, 'end',   wrap, drawCanvas, pageNum, viewport), {passive:false});
}

// ── TOOL SELECTION ──
function setTool(tool) {
  edCurrentTool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('tool-' + tool);
  if (btn) btn.classList.add('active');

  // Set cursor
  const wrap = document.querySelector('.page-container');
  if (!wrap) return;
  const cursors = { select:'default', text:'text', sticky:'cell', highlight:'text', underline:'text', draw:'crosshair', erase:'not-allowed' };
  wrap.style.cursor = cursors[tool] || 'default';
}

// ── CLICK HANDLER ──
function edHandleCanvasClick(e, wrap, pageNum, viewport) {
  if (edCurrentTool === 'text') {
    edAddText(e, wrap, pageNum);
  } else if (edCurrentTool === 'sticky') {
    edAddStickyNote(e, wrap, pageNum);
  }
}

// ── ADD TEXT ──
function edAddText(e, wrap, pageNum) {
  const rect  = wrap.getBoundingClientRect();
  const x     = e.clientX - rect.left;
  const y     = e.clientY - rect.top;

  const ta = document.createElement('textarea');
  ta.className = 'annot-text-elem';
  ta.style.left     = x + 'px';
  ta.style.top      = y + 'px';
  ta.style.fontSize = (document.getElementById('font-size')?.value || 16) + 'px';
  ta.style.fontFamily = document.getElementById('font-family')?.value || 'Arial';
  ta.style.color    = document.getElementById('text-color-pick')?.value || '#000000';
  ta.style.background = 'transparent';
  ta.style.border   = '1px dashed rgba(59,130,246,0.5)';
  ta.rows = 1;
  ta.placeholder = 'Type here...';
  ta.setAttribute('data-annot', 'text');
  ta.setAttribute('data-page', pageNum);

  wrap.appendChild(ta);
  ta.focus();

  // Auto-resize
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  });

  // Make draggable
  makeDraggable(ta, wrap);

  // Click to select
  ta.addEventListener('mousedown', (ev) => {
    if (edCurrentTool === 'select' || edCurrentTool === 'erase') {
      ev.stopPropagation();
      if (edCurrentTool === 'erase') { ta.remove(); return; }
      selectElement(ta);
    }
  });

  getPageAnnots(pageNum).texts.push(ta);
  edPushHistory('add-text', { elem: ta });
}

// ── ADD STICKY NOTE ──
function edAddStickyNote(e, wrap, pageNum) {
  const rect = wrap.getBoundingClientRect();
  const x    = e.clientX - rect.left;
  const y    = e.clientY - rect.top;

  const note = document.createElement('div');
  note.className = 'sticky-note';
  note.style.left = x + 'px';
  note.style.top  = y + 'px';
  note.contentEditable = 'true';
  note.innerHTML = '<button class="sticky-close" onclick="this.parentNode.remove()">✕</button>📝 Note...';
  note.setAttribute('data-annot','sticky');
  note.setAttribute('data-page', pageNum);

  wrap.appendChild(note);
  makeDraggable(note, wrap);

  note.addEventListener('mousedown', (ev) => {
    if (edCurrentTool === 'erase') { ev.stopPropagation(); note.remove(); }
  });

  getPageAnnots(pageNum).stickies.push(note);
}

// ── ADD IMAGE ──
function triggerImageUpload() {
  document.getElementById('image-file-input').click();
}

function edAddImage(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const url  = URL.createObjectURL(file);
  const wrap = document.querySelector('.page-container');
  if (!wrap) { showToast('Open a PDF first', 'error'); return; }
  const pageNum = edCurrentPage;

  const container = document.createElement('div');
  container.className = 'annot-img-elem';
  container.style.left   = '80px';
  container.style.top    = '80px';
  container.style.width  = '200px';
  container.setAttribute('data-annot','image');
  container.setAttribute('data-page', pageNum);

  const img = document.createElement('img');
  img.src = url;
  img.style.width  = '100%';
  img.style.borderRadius = '4px';
  img.draggable = false;

  const handle = document.createElement('div');
  handle.className = 'resize-handle';

  container.appendChild(img);
  container.appendChild(handle);
  wrap.appendChild(container);

  makeDraggable(container, wrap);
  makeResizable(container, handle);

  container.addEventListener('mousedown', (ev) => {
    if (edCurrentTool === 'erase') { ev.stopPropagation(); container.remove(); return; }
    if (edCurrentTool === 'select') { ev.stopPropagation(); selectElement(container); }
  });

  getPageAnnots(pageNum).images.push({ container, url });
  edPushHistory('add-image', { elem: container });
}

// ── DRAWING ──
function edHandleMouseDown(e, wrap, pageNum, viewport) {
  if (edCurrentTool !== 'draw' && edCurrentTool !== 'highlight' && edCurrentTool !== 'underline') return;
  edIsDrawing = true;
  const rect = wrap.getBoundingClientRect();
  edStartX = e.clientX - rect.left;
  edStartY = e.clientY - rect.top;
  edDrawPath = [{ x: edStartX, y: edStartY }];
}

function edHandleMouseMove(e, wrap, drawCanvas, viewport) {
  if (!edIsDrawing) return;
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  edDrawPath.push({ x, y });

  const ctx = drawCanvas.getContext('2d');
  if (edCurrentTool === 'draw') {
    ctx.globalAlpha = brushOpacity;
    ctx.strokeStyle = edAnnotColor;
    ctx.lineWidth   = brushSize;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    if (edDrawPath.length >= 2) {
      const prev = edDrawPath[edDrawPath.length - 2];
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }
}

function edHandleMouseUp(e, wrap, drawCanvas, pageNum, viewport) {
  if (!edIsDrawing) return;
  edIsDrawing = false;

  const rect = wrap.getBoundingClientRect();
  const endX = e.clientX - rect.left;
  const endY = e.clientY - rect.top;

  if (edCurrentTool === 'highlight') {
    edAddHighlight(wrap, pageNum, edStartX, edStartY, endX - edStartX, endY - edStartY);
  } else if (edCurrentTool === 'underline') {
    edAddUnderline(wrap, pageNum, edStartX, edStartY, endX);
  } else if (edCurrentTool === 'draw' && edDrawPath.length > 1) {
    getPageAnnots(pageNum).draws.push({ path: [...edDrawPath], color: edAnnotColor, size: brushSize, opacity: brushOpacity });
    edPushHistory('draw', {});
  }
  edDrawPath = [];
}

// Touch support for drawing
function edHandleTouch(e, phase, wrap, drawCanvas, pageNum, viewport) {
  e.preventDefault();
  const t = e.touches[0] || e.changedTouches[0];
  const sim = new MouseEvent(phase === 'start' ? 'mousedown' : phase === 'move' ? 'mousemove' : 'mouseup', {
    clientX: t.clientX, clientY: t.clientY
  });
  if (phase === 'start') edHandleMouseDown(sim, wrap, pageNum, viewport);
  else if (phase === 'move') edHandleMouseMove(sim, wrap, drawCanvas, viewport);
  else edHandleMouseUp(sim, wrap, drawCanvas, pageNum, viewport);
}

// ── HIGHLIGHT ──
function edAddHighlight(wrap, pageNum, x, y, w, h) {
  if (Math.abs(w) < 5 || Math.abs(h) < 5) return;
  const svg  = wrap.querySelector('.annotation-layer');
  const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
  rect.setAttribute('x', Math.min(x, x+w));
  rect.setAttribute('y', Math.min(y, y+h));
  rect.setAttribute('width',  Math.abs(w));
  rect.setAttribute('height', Math.abs(h));
  rect.setAttribute('fill', edHLColor);
  rect.setAttribute('data-annot','highlight');
  rect.addEventListener('mousedown', ev => { if(edCurrentTool==='erase'){ev.stopPropagation();rect.remove();} });
  svg.appendChild(rect);
  getPageAnnots(pageNum).highlights.push({ x, y, w, h, color: edHLColor });
}

// ── UNDERLINE ──
function edAddUnderline(wrap, pageNum, x1, y, x2) {
  const svg  = wrap.querySelector('.annotation-layer');
  const line = document.createElementNS('http://www.w3.org/2000/svg','line');
  line.setAttribute('x1', x1); line.setAttribute('y1', y + 4);
  line.setAttribute('x2', x2); line.setAttribute('y2', y + 4);
  line.setAttribute('stroke', edAnnotColor);
  line.setAttribute('stroke-width', '2');
  line.setAttribute('data-annot','underline');
  line.addEventListener('mousedown', ev => { if(edCurrentTool==='erase'){ev.stopPropagation();line.remove();} });
  svg.appendChild(line);
  getPageAnnots(pageNum).underlines.push({ x1, y, x2, color: edAnnotColor });
}

// ── SIGNATURE MODAL ──
let sigCanvas, sigCtx, sigDrawing = false, sigLastX, sigLastY;

function openSignModal() {
  document.getElementById('sig-modal').classList.add('open');
  setTimeout(initSigCanvas, 100);
}

function closeSigModal() {
  document.getElementById('sig-modal').classList.remove('open');
}

function initSigCanvas() {
  sigCanvas = document.getElementById('sig-canvas');
  sigCtx    = sigCanvas.getContext('2d');
  sigCanvas.width  = sigCanvas.offsetWidth;
  sigCanvas.height = 180;
  sigCtx.fillStyle = '#ffffff';
  sigCtx.fillRect(0, 0, sigCanvas.width, sigCanvas.height);

  sigCanvas.onmousedown  = (e) => { sigDrawing=true; const r=sigCanvas.getBoundingClientRect(); sigLastX=e.clientX-r.left; sigLastY=e.clientY-r.top; };
  sigCanvas.onmousemove  = (e) => {
    if (!sigDrawing) return;
    const r=sigCanvas.getBoundingClientRect();
    const x=e.clientX-r.left, y=e.clientY-r.top;
    sigCtx.strokeStyle = document.getElementById('sig-ink-color').value;
    sigCtx.lineWidth   = 2.5; sigCtx.lineCap='round';
    sigCtx.beginPath(); sigCtx.moveTo(sigLastX,sigLastY); sigCtx.lineTo(x,y); sigCtx.stroke();
    sigLastX=x; sigLastY=y;
  };
  sigCanvas.onmouseup    = () => sigDrawing = false;
  sigCanvas.ontouchstart = (e) => { e.preventDefault(); const t=e.touches[0],r=sigCanvas.getBoundingClientRect(); sigDrawing=true; sigLastX=t.clientX-r.left; sigLastY=t.clientY-r.top; };
  sigCanvas.ontouchmove  = (e) => { e.preventDefault(); if(!sigDrawing)return; const t=e.touches[0],r=sigCanvas.getBoundingClientRect(),x=t.clientX-r.left,y=t.clientY-r.top; sigCtx.strokeStyle=document.getElementById('sig-ink-color').value; sigCtx.lineWidth=2.5; sigCtx.lineCap='round'; sigCtx.beginPath(); sigCtx.moveTo(sigLastX,sigLastY); sigCtx.lineTo(x,y); sigCtx.stroke(); sigLastX=x; sigLastY=y; };
  sigCanvas.ontouchend   = () => sigDrawing = false;
}

function sigSetMode(mode, btn) {
  edSigMode = mode;
  document.querySelectorAll('.sig-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('sig-draw-area').style.display = mode === 'draw' ? 'block' : 'none';
  document.getElementById('sig-type-area').style.display = mode === 'type' ? 'block' : 'none';
  if (mode === 'type') renderSigText();
}

function sigSetFont(font, btn) {
  edSigFont = font;
  document.querySelectorAll('#sig-type-area .sig-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSigText();
}

function renderSigText() {
  if (!sigCanvas || edSigMode !== 'type') return;
  const text  = document.getElementById('sig-text-input').value || 'Your Name';
  const color = document.getElementById('sig-ink-color').value;
  const bg    = document.getElementById('sig-bg-color').value;
  sigCtx.fillStyle = bg;
  sigCtx.fillRect(0, 0, sigCanvas.width, sigCanvas.height);
  sigCtx.fillStyle = color;
  sigCtx.font = `48px '${edSigFont}', cursive`;
  sigCtx.textAlign = 'center';
  sigCtx.textBaseline = 'middle';
  sigCtx.fillText(text, sigCanvas.width/2, sigCanvas.height/2);
}

function clearSig() {
  if (!sigCtx) return;
  sigCtx.fillStyle = '#ffffff';
  sigCtx.fillRect(0, 0, sigCanvas.width, sigCanvas.height);
  if (edSigMode === 'type') document.getElementById('sig-text-input').value = '';
}

function applySig() {
  if (!sigCanvas) return;
  const bgColor = document.getElementById('sig-bg-color').value;
  const url = sigCanvas.toDataURL('image/png');
  closeSigModal();

  const wrap = document.querySelector('.page-container');
  if (!wrap) { showToast('Open a PDF first', 'error'); return; }

  const container = document.createElement('div');
  container.className = 'annot-img-elem';
  container.style.left = '100px';
  container.style.top  = '400px';
  container.style.width = '220px';
  container.setAttribute('data-annot','signature');
  container.setAttribute('data-page', edCurrentPage);

  const img = document.createElement('img');
  img.src = url;
  img.style.width = '100%';
  // Apply background color matching
  img.style.backgroundColor = bgColor === '#ffffff' ? 'transparent' : bgColor;
  img.style.mixBlendMode = bgColor === '#ffffff' ? 'multiply' : 'normal';
  img.draggable = false;

  const handle = document.createElement('div');
  handle.className = 'resize-handle';

  container.appendChild(img);
  container.appendChild(handle);
  wrap.appendChild(container);

  makeDraggable(container, wrap);
  makeResizable(container, handle);

  container.addEventListener('mousedown', ev => {
    if (edCurrentTool === 'erase') { ev.stopPropagation(); container.remove(); }
    else if (edCurrentTool === 'select') { ev.stopPropagation(); selectElement(container); }
  });

  getPageAnnots(edCurrentPage).signatures.push({ container, url });
  showToast('✅ Signature placed — drag to position', 'success');
}

// ── DRAG & RESIZE HELPERS ──
function makeDraggable(elem, parent) {
  let startX, startY, startLeft, startTop, dragging = false;

  const onStart = (clientX, clientY) => {
    if (edCurrentTool === 'erase') return;
    dragging  = true;
    startX    = clientX;
    startY    = clientY;
    startLeft = parseInt(elem.style.left) || 0;
    startTop  = parseInt(elem.style.top)  || 0;
    selectElement(elem);
  };

  const onMove = (clientX, clientY) => {
    if (!dragging) return;
    elem.style.left = (startLeft + clientX - startX) + 'px';
    elem.style.top  = (startTop  + clientY - startY) + 'px';
  };

  const onEnd = () => { dragging = false; };

  elem.addEventListener('mousedown',  e => { if (edCurrentTool==='select'||edCurrentTool==='text') { e.stopPropagation(); onStart(e.clientX, e.clientY); }});
  document.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
  document.addEventListener('mouseup',   onEnd);

  elem.addEventListener('touchstart', e => { e.preventDefault(); const t=e.touches[0]; onStart(t.clientX,t.clientY); }, {passive:false});
  elem.addEventListener('touchmove',  e => { e.preventDefault(); const t=e.touches[0]; onMove(t.clientX,t.clientY); }, {passive:false});
  elem.addEventListener('touchend',   onEnd);
}

function makeResizable(container, handle) {
  let startW, startH, startX, startY, resizing = false;

  handle.addEventListener('mousedown', e => {
    e.stopPropagation();
    resizing = true;
    startX = e.clientX; startY = e.clientY;
    startW = container.offsetWidth;
    startH = container.offsetHeight;
  });

  document.addEventListener('mousemove', e => {
    if (!resizing) return;
    container.style.width  = Math.max(40, startW + e.clientX - startX) + 'px';
    container.style.height = Math.max(30, startH + e.clientY - startY) + 'px';
  });

  document.addEventListener('mouseup', () => resizing = false);
}

// ── SELECTION ──
function selectElement(elem) {
  if (edSelectedElem) edSelectedElem.classList.remove('selected');
  edSelectedElem = elem;
  if (elem) elem.classList.add('selected');
}

function deleteSelected() {
  if (edSelectedElem) {
    edSelectedElem.remove();
    edSelectedElem = null;
  }
}

// ── TEXT FORMATTING ──
function applyFontFamily(val) { if(edSelectedElem?.tagName==='TEXTAREA') edSelectedElem.style.fontFamily=val; }
function applyFontSize(val)   { if(edSelectedElem?.tagName==='TEXTAREA') edSelectedElem.style.fontSize=val+'px'; }
function applyTextColor(val)  { if(edSelectedElem?.tagName==='TEXTAREA') edSelectedElem.style.color=val; }
function applyTextBg(val)     { if(edSelectedElem?.tagName==='TEXTAREA') edSelectedElem.style.background=val; }
function applyTextBgNone()    { if(edSelectedElem?.tagName==='TEXTAREA') edSelectedElem.style.background='transparent'; }
function applyBold()   {
  if(edSelectedElem?.tagName==='TEXTAREA') {
    const isBold = edSelectedElem.style.fontWeight === 'bold';
    edSelectedElem.style.fontWeight = isBold ? 'normal' : 'bold';
    document.getElementById('btn-bold').classList.toggle('active', !isBold);
  }
}
function applyItalic() {
  if(edSelectedElem?.tagName==='TEXTAREA') {
    const isItalic = edSelectedElem.style.fontStyle === 'italic';
    edSelectedElem.style.fontStyle = isItalic ? 'normal' : 'italic';
    document.getElementById('btn-italic').classList.toggle('active', !isItalic);
  }
}

// ── COLOR SETTERS ──
function setAnnotColor(color, swatch) {
  edAnnotColor = color;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  if (swatch) swatch.classList.add('active');
  document.getElementById('text-color-pick').value = color;
}

function setHLColor(color, swatch) {
  edHLColor = color;
}

// ── PAGE NAVIGATION ──
function edGoPage(dir) {
  const newPage = edCurrentPage + dir;
  if (newPage < 1 || newPage > edTotalPages) return;
  edCurrentPage = newPage;
  edRenderPage(edCurrentPage);
  edUpdatePageInfo();
}

function edUpdatePageInfo() {
  const txt = `Page ${edCurrentPage} of ${edTotalPages}`;
  const el1 = document.getElementById('page-info-bottom');
  const el2 = document.getElementById('page-info-panel');
  if (el1) el1.textContent = txt;
  if (el2) el2.textContent = txt;
  document.getElementById('prev-pg').disabled = edCurrentPage <= 1;
  document.getElementById('next-pg').disabled = edCurrentPage >= edTotalPages;
}

// ── ZOOM ──
function setZoom(val) {
  edZoom = val / 100;
  document.getElementById('zoom-label').textContent = val + '%';
  edRenderPage(edCurrentPage);
}

// ── UNDO ──
function edPushHistory(type, data) {
  edHistory.push({ type, data });
  document.getElementById('btn-undo').disabled = false;
}

function edUndo() {
  const last = edHistory.pop();
  if (!last) return;
  if (last.data?.elem) last.data.elem.remove();
  if (edHistory.length === 0) document.getElementById('btn-undo').disabled = true;
}

// ── RESTORE ANNOTATIONS (page switch) ──
function edRestoreAnnotations(pageNum, wrap, W, H) {
  const annots = edAnnotations[pageNum];
  if (!annots) return;

  // Re-append DOM elements (texts, images, stickies, signatures)
  [...annots.texts, ...annots.stickies].forEach(el => {
    if (el.parentNode !== wrap) wrap.appendChild(el);
  });
  annots.images.forEach(({ container }) => {
    if (container.parentNode !== wrap) wrap.appendChild(container);
  });
  annots.signatures.forEach(({ container }) => {
    if (container.parentNode !== wrap) wrap.appendChild(container);
  });

  // Restore drawings on draw canvas
  const drawCanvas = document.getElementById('draw-canvas-' + pageNum);
  if (drawCanvas && annots.draws.length) {
    const ctx = drawCanvas.getContext('2d');
    annots.draws.forEach(({ path, color, size, opacity }) => {
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = color;
      ctx.lineWidth   = size;
      ctx.lineCap     = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      path.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
      ctx.stroke();
    });
  }

  // Restore SVG annotations
  const svg = document.getElementById('svg-layer-' + pageNum);
  if (svg) {
    annots.highlights.forEach(({ x, y, w, h, color }) => {
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x', Math.min(x,x+w)); rect.setAttribute('y', Math.min(y,y+h));
      rect.setAttribute('width', Math.abs(w)); rect.setAttribute('height', Math.abs(h));
      rect.setAttribute('fill', color);
      svg.appendChild(rect);
    });
    annots.underlines.forEach(({ x1, y, x2, color }) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',x1); line.setAttribute('y1',y+4);
      line.setAttribute('x2',x2); line.setAttribute('y2',y+4);
      line.setAttribute('stroke',color); line.setAttribute('stroke-width','2');
      svg.appendChild(line);
    });
  }
}

// ── SAVE PDF ──
async function edSavePDF() {
  if (!edPdfDoc) return;

  showToast('Generating PDF...', 'success');

  try {
    const font = await edPdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = edPdfDoc.getPages();

    for (let pg = 1; pg <= edTotalPages; pg++) {
      const pdfPage    = pages[pg - 1];
      const { width, height } = pdfPage.getSize();
      const pdfJsPage  = await edPdfJsDoc.getPage(pg);
      const viewport   = pdfJsPage.getViewport({ scale: edZoom * 1.5 });
      const scaleX     = width  / viewport.width;
      const scaleY     = height / viewport.height;
      const annots     = edAnnotations[pg];
      if (!annots) continue;

      // Embed text annotations
      for (const ta of annots.texts) {
        const txt  = ta.value?.trim();
        if (!txt) continue;
        const left = parseInt(ta.style.left) || 0;
        const top  = parseInt(ta.style.top)  || 0;
        const size = parseInt(ta.style.fontSize) || 16;
        const col  = hexToRgb(ta.style.color || '#000000');

        // PDF coords: y flipped
        pdfPage.drawText(txt, {
          x: left * scaleX,
          y: height - (top + size * 1.2) * scaleY,
          size: size * Math.min(scaleX, scaleY),
          font,
          color: rgb(col.r/255, col.g/255, col.b/255),
          maxWidth: width - left * scaleX,
          lineHeight: size * 1.4 * Math.min(scaleX, scaleY),
        });
      }

      // Embed highlights
      for (const hl of annots.highlights) {
        const col = parseRgba(hl.color);
        pdfPage.drawRectangle({
          x:      Math.min(hl.x, hl.x+hl.w) * scaleX,
          y:      height - (Math.min(hl.y, hl.y+hl.h) + Math.abs(hl.h)) * scaleY,
          width:  Math.abs(hl.w) * scaleX,
          height: Math.abs(hl.h) * scaleY,
          color:  rgb(col.r/255, col.g/255, col.b/255),
          opacity: col.a,
        });
      }

      // Embed underlines
      for (const ul of annots.underlines) {
        const col = hexToRgb(ul.color || '#ef4444');
        pdfPage.drawLine({
          start: { x: ul.x1 * scaleX, y: height - (ul.y + 4) * scaleY },
          end:   { x: ul.x2 * scaleX, y: height - (ul.y + 4) * scaleY },
          thickness: 1.5,
          color: rgb(col.r/255, col.g/255, col.b/255),
        });
      }

      // Embed images & signatures
      const imgElems = [...annots.images.map(i=>i.container), ...annots.signatures.map(s=>s.container)];
      for (const container of imgElems) {
        const imgEl = container.querySelector('img');
        if (!imgEl) continue;
        const imgBytes = await urlToBytes(imgEl.src);
        let embedded;
        try { embedded = await edPdfDoc.embedPng(imgBytes); }
        catch { try { embedded = await edPdfDoc.embedJpg(imgBytes); } catch { continue; } }

        const left = parseInt(container.style.left) || 0;
        const top  = parseInt(container.style.top)  || 0;
        const w    = container.offsetWidth  || 200;
        const h    = container.offsetHeight || 100;

        pdfPage.drawImage(embedded, {
          x:      left * scaleX,
          y:      height - (top + h) * scaleY,
          width:  w * scaleX,
          height: h * scaleY,
        });
      }

      // Embed drawings from canvas
      const drawCanvas = document.getElementById('draw-canvas-' + pg);
      if (drawCanvas && annots.draws.length) {
        const drawBytes = await canvasToBytes(drawCanvas);
        const drawEmbed = await edPdfDoc.embedPng(drawBytes);
        pdfPage.drawImage(drawEmbed, { x:0, y:0, width, height });
      }

      // Sticky notes as text
      for (const note of annots.stickies) {
        const txt  = note.innerText?.replace('✕','').trim();
        if (!txt) continue;
        const left = parseInt(note.style.left) || 0;
        const top  = parseInt(note.style.top)  || 0;
        pdfPage.drawRectangle({
          x: left*scaleX, y: height-(top+80)*scaleY,
          width:120*scaleX, height:80*scaleY,
          color:rgb(0.996,0.941,0.541), opacity:0.85,
          borderColor:rgb(0.831,0.706,0), borderWidth:1,
        });
        pdfPage.drawText(txt.slice(0,100), {
          x:(left+6)*scaleX, y:height-(top+18)*scaleY,
          size: 9*Math.min(scaleX,scaleY), font,
          color:rgb(0.1,0.1,0.1), maxWidth:110*scaleX,
        });
      }
    }

    const saved = await edPdfDoc.save();
    const blob  = new Blob([saved], { type:'application/pdf' });
    downloadBlob(blob, 'edited-document.pdf');
    showToast('✅ PDF saved successfully!', 'success');

  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
    console.error(err);
  }
}

// ── UTILS ──
function hexToRgb(hex) {
  const clean = (hex||'#000000').replace('#','');
  if (clean.length === 3) {
    return { r:parseInt(clean[0]+clean[0],16), g:parseInt(clean[1]+clean[1],16), b:parseInt(clean[2]+clean[2],16) };
  }
  return { r:parseInt(clean.substring(0,2),16)||0, g:parseInt(clean.substring(2,4),16)||0, b:parseInt(clean.substring(4,6),16)||0 };
}

function parseRgba(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return { r:255, g:240, b:138, a:0.35 };
  const [r,g,b,a=1] = m[1].split(',').map(Number);
  return { r, g, b, a };
}

async function urlToBytes(url) {
  const res  = await fetch(url);
  const buf  = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function canvasToBytes(canvas) {
  return new Promise(resolve => {
    canvas.toBlob(async blob => {
      const buf = await blob.arrayBuffer();
      resolve(new Uint8Array(buf));
    }, 'image/png');
  });
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); edUndo(); }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
      deleteSelected();
    }
  }
  if (e.key === 'Escape') setTool('select');
});