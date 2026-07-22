// ── PDF EDITOR — pdf-editor.js ──
// Synced with new pdf-editor.html structure

const { PDFDocument, rgb, StandardFonts } = PDFLib;

// ── STATE ──
let edPdfDoc      = null;
let edPdfJsDoc    = null;
let edCurrentPage = 1;
let edTotalPages  = 1;
let edZoom        = 1.0;
let edCurrentTool = 'select';
let edAnnotColor  = '#000000';
let edHLColor     = 'rgba(254,240,138,0.45)';
let edOrigBytes   = null;
let edHistory     = [];
let edSelectedEl  = null;
let brushSize     = 3;
let brushOpacity  = 1;
let edSigMode     = 'draw';
let edSigFont     = 'Dancing Script';
let edIsDrawing   = false;
let edDrawPath    = [];
let edStartX      = 0;
let edStartY      = 0;

const edAnnotations = {};
function getAnnots(pg) {
  if (!edAnnotations[pg])
    edAnnotations[pg] = { texts:[], images:[], stickies:[], draws:[], highlights:[], underlines:[], sigs:[] };
  return edAnnotations[pg];
}

// ── FILE LOADING ──
function edLoadPDF(inp) {
  const file = inp.files[0];
  inp.value = '';
  if (file) edLoadFile(file);
}

function handlePageDrop(e) {
  e.preventDefault();
  const el = document.getElementById('ed-page-upload-zone');
  if (el) { el.style.borderColor = 'var(--border)'; }
  const file = [...e.dataTransfer.files].find(f => f.type === 'application/pdf');
  if (file) edLoadFile(file);
  else showToast('Please drop a PDF file', 'error');
}

async function edLoadFile(file) {
  try {
    showToast('Loading PDF...', 'success');
    const bytes = await file.arrayBuffer();
    edOrigBytes = bytes.slice(0);

    // pdf-lib for saving
    edPdfDoc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });

    // pdf.js for rendering
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    edPdfJsDoc    = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
    edTotalPages  = edPdfJsDoc.numPages;
    edCurrentPage = 1;

    // Switch UI: hide page content, show editor shell
    document.getElementById('page-content').style.display = 'none';
    document.getElementById('editor-shell').classList.add('active');
    document.getElementById('ed-file-name').textContent = file.name;
    document.getElementById('btn-save').disabled = false;

    await edRenderPage(1);
    edUpdatePageInfo();
    showToast(`✅ PDF loaded — ${edTotalPages} page(s)`, 'success');
  } catch(err) {
    showToast('Failed to load PDF: ' + err.message, 'error');
    console.error(err);
  }
}

function exitEditor() {
  document.getElementById('editor-shell').classList.remove('active');
  document.getElementById('page-content').style.display = 'block';
}

// ── RENDER PAGE ──
async function edRenderPage(pageNum) {
  const container = document.getElementById('pages-container');
  container.innerHTML = '';

  const page     = await edPdfJsDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: edZoom * 1.5 });

  const wrap = document.createElement('div');
  wrap.className  = 'page-container';
  wrap.style.width  = viewport.width  + 'px';
  wrap.style.height = viewport.height + 'px';

  // PDF render canvas
  const pdfCanvas   = document.createElement('canvas');
  pdfCanvas.width   = viewport.width;
  pdfCanvas.height  = viewport.height;

  // Draw layer canvas
  const drawCanvas  = document.createElement('canvas');
  drawCanvas.id     = 'draw-canvas-' + pageNum;
  drawCanvas.width  = viewport.width;
  drawCanvas.height = viewport.height;
  drawCanvas.className = 'draw-canvas-layer';

  // SVG annotation layer
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.id    = 'svg-layer-' + pageNum;
  svg.classList.add('svg-annot-layer');

  wrap.appendChild(pdfCanvas);
  wrap.appendChild(drawCanvas);
  wrap.appendChild(svg);
  container.appendChild(wrap);

  await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise;

  // Restore saved annotations
  edRestoreAnnots(pageNum, wrap);

  // Events
  wrap.addEventListener('click',      e => edHandleClick(e, wrap, pageNum));
  wrap.addEventListener('mousedown',  e => edHandleDown(e, wrap, pageNum));
  wrap.addEventListener('mousemove',  e => edHandleMove(e, wrap, drawCanvas));
  wrap.addEventListener('mouseup',    e => edHandleUp(e, wrap, drawCanvas, pageNum));
  wrap.addEventListener('touchstart', e => edTouch(e,'start',wrap,drawCanvas,pageNum),{passive:false});
  wrap.addEventListener('touchmove',  e => edTouch(e,'move', wrap,drawCanvas,pageNum),{passive:false});
  wrap.addEventListener('touchend',   e => edTouch(e,'end',  wrap,drawCanvas,pageNum),{passive:false});
}

// ── TOOL ──
function setTool(t) {
  edCurrentTool = t;
  document.querySelectorAll('.ed-btn[id^="tool-"]').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('tool-' + t);
  if (btn) btn.classList.add('active');
  const wrap = document.querySelector('.page-container');
  if (!wrap) return;
  const cursors = { select:'default', text:'text', sticky:'cell', highlight:'crosshair', underline:'crosshair', draw:'crosshair', erase:'not-allowed' };
  wrap.style.cursor = cursors[t] || 'default';
}

// ── CLICK ──
function edHandleClick(e, wrap, pageNum) {
  if (edCurrentTool === 'text')   edAddText(e, wrap, pageNum);
  if (edCurrentTool === 'sticky') edAddSticky(e, wrap, pageNum);
}

// ── ADD TEXT ──
function edAddText(e, wrap, pageNum) {
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const ta = document.createElement('textarea');
  ta.className = 'annot-text';
  ta.style.left       = x + 'px';
  ta.style.top        = y + 'px';
  ta.style.fontSize   = (document.getElementById('font-size')?.value || 16) + 'px';
  ta.style.fontFamily = document.getElementById('font-family')?.value || 'Arial';
  ta.style.color      = document.getElementById('text-color-pick')?.value || '#000000';
  ta.style.background = 'transparent';
  ta.placeholder      = 'Type here...';
  ta.rows = 1;

  wrap.appendChild(ta);
  ta.focus();
  ta.addEventListener('input', () => { ta.style.height='auto'; ta.style.height=ta.scrollHeight+'px'; });

  makeDraggable(ta, wrap);
  ta.addEventListener('mousedown', ev => {
    if (edCurrentTool === 'erase') { ev.stopPropagation(); ta.remove(); return; }
    if (edCurrentTool === 'select') { ev.stopPropagation(); edSelect(ta); }
  });

  getAnnots(pageNum).texts.push(ta);
  edPushHistory();
}

// ── ADD STICKY ──
function edAddSticky(e, wrap, pageNum) {
  const rect = wrap.getBoundingClientRect();
  const note = document.createElement('div');
  note.className    = 'sticky-note';
  note.style.left   = (e.clientX - rect.left) + 'px';
  note.style.top    = (e.clientY - rect.top)  + 'px';
  note.contentEditable = 'true';
  note.innerHTML = '<button class="sticky-close" onclick="this.parentNode.remove()">✕</button>📝 Note...';

  wrap.appendChild(note);
  makeDraggable(note, wrap);
  note.addEventListener('mousedown', ev => { if(edCurrentTool==='erase'){ev.stopPropagation();note.remove();} });
  getAnnots(pageNum).stickies.push(note);
}

// ── ADD IMAGE ──
function edAddImageFile(inp) {
  const file = inp.files[0];
  inp.value = '';
  if (!file) return;

  const url  = URL.createObjectURL(file);
  const wrap = document.querySelector('.page-container');
  if (!wrap) { showToast('Open a PDF first', 'error'); return; }

  const div = document.createElement('div');
  div.className  = 'annot-img-wrap';
  div.style.left = '80px'; div.style.top = '80px'; div.style.width = '200px';

  const img = document.createElement('img');
  img.src = url; img.draggable = false;

  const handle = document.createElement('div');
  handle.className = 'resize-handle';

  div.appendChild(img); div.appendChild(handle);
  wrap.appendChild(div);

  makeDraggable(div, wrap);
  makeResizable(div, handle);
  div.addEventListener('mousedown', ev => {
    if (edCurrentTool === 'erase') { ev.stopPropagation(); div.remove(); return; }
    if (edCurrentTool === 'select') { ev.stopPropagation(); edSelect(div); }
  });

  getAnnots(edCurrentPage).images.push({ container: div, url });
  edPushHistory();
}

// ── DRAWING ──
function edHandleDown(e, wrap, pageNum) {
  if (!['draw','highlight','underline'].includes(edCurrentTool)) return;
  edIsDrawing = true;
  const rect = wrap.getBoundingClientRect();
  edStartX = e.clientX - rect.left;
  edStartY = e.clientY - rect.top;
  edDrawPath = [{ x: edStartX, y: edStartY }];
}

function edHandleMove(e, wrap, drawCanvas) {
  if (!edIsDrawing) return;
  const rect = wrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  edDrawPath.push({ x, y });

  if (edCurrentTool === 'draw') {
    const ctx = drawCanvas.getContext('2d');
    ctx.globalAlpha = brushOpacity;
    ctx.strokeStyle = edAnnotColor;
    ctx.lineWidth   = brushSize;
    ctx.lineCap     = 'round'; ctx.lineJoin = 'round';
    const prev = edDrawPath[edDrawPath.length - 2];
    ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(x, y); ctx.stroke();
  }
}

function edHandleUp(e, wrap, drawCanvas, pageNum) {
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
    getAnnots(pageNum).draws.push({ path:[...edDrawPath], color:edAnnotColor, size:brushSize, opacity:brushOpacity });
    edPushHistory();
  }
  edDrawPath = [];
}

function edTouch(e, phase, wrap, drawCanvas, pageNum) {
  e.preventDefault();
  const t = e.touches[0] || e.changedTouches[0];
  const sim = { clientX: t.clientX, clientY: t.clientY };
  if (phase==='start') edHandleDown(sim, wrap, pageNum);
  else if (phase==='move') edHandleMove(sim, wrap, drawCanvas);
  else edHandleUp(sim, wrap, drawCanvas, pageNum);
}

// ── HIGHLIGHT & UNDERLINE ──
function edAddHighlight(wrap, pageNum, x, y, w, h) {
  if (Math.abs(w) < 5 || Math.abs(h) < 5) return;
  const svg  = wrap.querySelector('.svg-annot-layer');
  const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
  rect.setAttribute('x', Math.min(x, x+w));
  rect.setAttribute('y', Math.min(y, y+h));
  rect.setAttribute('width', Math.abs(w));
  rect.setAttribute('height', Math.abs(h));
  rect.setAttribute('fill', edHLColor);
  rect.addEventListener('mousedown', ev => { if(edCurrentTool==='erase'){ev.stopPropagation();rect.remove();} });
  svg.appendChild(rect);
  getAnnots(pageNum).highlights.push({ x, y, w, h, color: edHLColor });
}

function edAddUnderline(wrap, pageNum, x1, y, x2) {
  const svg  = wrap.querySelector('.svg-annot-layer');
  const line = document.createElementNS('http://www.w3.org/2000/svg','line');
  line.setAttribute('x1', x1); line.setAttribute('y1', y+4);
  line.setAttribute('x2', x2); line.setAttribute('y2', y+4);
  line.setAttribute('stroke', edAnnotColor); line.setAttribute('stroke-width','2');
  line.addEventListener('mousedown', ev => { if(edCurrentTool==='erase'){ev.stopPropagation();line.remove();} });
  svg.appendChild(line);
  getAnnots(pageNum).underlines.push({ x1, y, x2, color: edAnnotColor });
}

// ── SIGNATURE ──
let sigCanvas, sigCtx, sigDrawing = false, sigLX, sigLY;

function openSigModal() {
  document.getElementById('sig-overlay').classList.add('open');
  setTimeout(() => {
    sigCanvas = document.getElementById('sig-canvas');
    sigCtx    = sigCanvas.getContext('2d');
    sigCanvas.width  = sigCanvas.offsetWidth  || 400;
    sigCanvas.height = 160;
    clearSig();

    const draw = (x, y) => {
      if (!sigDrawing) return;
      sigCtx.strokeStyle = document.getElementById('sig-ink').value;
      sigCtx.lineWidth = 2.5; sigCtx.lineCap = 'round';
      sigCtx.beginPath(); sigCtx.moveTo(sigLX,sigLY); sigCtx.lineTo(x,y); sigCtx.stroke();
      sigLX=x; sigLY=y;
    };
    sigCanvas.onmousedown = e => { const r=sigCanvas.getBoundingClientRect(); sigDrawing=true; sigLX=e.clientX-r.left; sigLY=e.clientY-r.top; };
    sigCanvas.onmousemove = e => { const r=sigCanvas.getBoundingClientRect(); draw(e.clientX-r.left,e.clientY-r.top); };
    sigCanvas.onmouseup   = () => sigDrawing=false;
    sigCanvas.ontouchstart= e => { e.preventDefault(); const t=e.touches[0],r=sigCanvas.getBoundingClientRect(); sigDrawing=true; sigLX=t.clientX-r.left; sigLY=t.clientY-r.top; };
    sigCanvas.ontouchmove = e => { e.preventDefault(); const t=e.touches[0],r=sigCanvas.getBoundingClientRect(); draw(t.clientX-r.left,t.clientY-r.top); };
    sigCanvas.ontouchend  = () => sigDrawing=false;
  }, 100);
}

function closeSigModal() { document.getElementById('sig-overlay').classList.remove('open'); }

function sigSetMode(mode, btn) {
  edSigMode = mode;
  document.querySelectorAll('.sig-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('sig-draw-area').style.display = mode==='draw' ? 'block' : 'none';
  document.getElementById('sig-type-area').style.display = mode==='type' ? 'block' : 'none';
  if (mode==='type') renderSigText();
}

function setSigFont(font, btn) {
  edSigFont = font;
  document.querySelectorAll('#sig-type-area .sig-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSigText();
}

function renderSigText() {
  if (!sigCanvas || edSigMode !== 'type') return;
  const text  = document.getElementById('sig-text-input').value || 'Your Name';
  const color = document.getElementById('sig-ink').value;
  const bg    = document.getElementById('sig-bg').value;
  sigCtx.fillStyle = bg; sigCtx.fillRect(0,0,sigCanvas.width,sigCanvas.height);
  sigCtx.fillStyle = color;
  sigCtx.font = `48px '${edSigFont}', cursive`;
  sigCtx.textAlign = 'center'; sigCtx.textBaseline = 'middle';
  sigCtx.fillText(text, sigCanvas.width/2, sigCanvas.height/2);
}

function clearSig() {
  if (!sigCtx) return;
  sigCtx.fillStyle = '#ffffff';
  sigCtx.fillRect(0, 0, sigCanvas.width, sigCanvas.height);
}

function applySig() {
  if (!sigCanvas) return;
  const bg  = document.getElementById('sig-bg').value;
  const url = sigCanvas.toDataURL('image/png');
  closeSigModal();

  const wrap = document.querySelector('.page-container');
  if (!wrap) { showToast('Open a PDF first','error'); return; }

  const div = document.createElement('div');
  div.className  = 'annot-img-wrap';
  div.style.left = '100px'; div.style.top = '400px'; div.style.width = '220px';

  const img = document.createElement('img');
  img.src = url; img.draggable = false;
  if (bg === '#ffffff') { img.style.mixBlendMode = 'multiply'; }

  const handle = document.createElement('div');
  handle.className = 'resize-handle';

  div.appendChild(img); div.appendChild(handle);
  wrap.appendChild(div);

  makeDraggable(div, wrap);
  makeResizable(div, handle);
  div.addEventListener('mousedown', ev => {
    if (edCurrentTool==='erase') { ev.stopPropagation(); div.remove(); }
    else if (edCurrentTool==='select') { ev.stopPropagation(); edSelect(div); }
  });

  getAnnots(edCurrentPage).sigs.push({ container:div, url });
  showToast('✅ Signature placed — drag to position','success');
}

// ── DRAG & RESIZE ──
function makeDraggable(el, parent) {
  let sX, sY, sL, sT, dragging=false;
  const start = (cx,cy) => { if(edCurrentTool==='erase')return; dragging=true; sX=cx; sY=cy; sL=parseInt(el.style.left)||0; sT=parseInt(el.style.top)||0; edSelect(el); };
  const move  = (cx,cy) => { if(!dragging)return; el.style.left=(sL+cx-sX)+'px'; el.style.top=(sT+cy-sY)+'px'; };
  const end   = () => dragging=false;
  el.addEventListener('mousedown', e => { if(edCurrentTool==='select'||el.tagName==='TEXTAREA'){e.stopPropagation();start(e.clientX,e.clientY);} });
  document.addEventListener('mousemove', e => move(e.clientX,e.clientY));
  document.addEventListener('mouseup', end);
  el.addEventListener('touchstart', e=>{e.preventDefault();const t=e.touches[0];start(t.clientX,t.clientY);},{passive:false});
  el.addEventListener('touchmove',  e=>{e.preventDefault();const t=e.touches[0];move(t.clientX,t.clientY);},{passive:false});
  el.addEventListener('touchend', end);
}

function makeResizable(container, handle) {
  let sW, sH, sX, sY, resizing=false;
  handle.addEventListener('mousedown', e=>{e.stopPropagation();resizing=true;sX=e.clientX;sY=e.clientY;sW=container.offsetWidth;sH=container.offsetHeight;});
  document.addEventListener('mousemove', e=>{if(!resizing)return;container.style.width=Math.max(40,sW+e.clientX-sX)+'px';container.style.height=Math.max(30,sH+e.clientY-sY)+'px';});
  document.addEventListener('mouseup', ()=>resizing=false);
}

// ── SELECT & FORMAT ──
function edSelect(el) {
  if (edSelectedEl) edSelectedEl.classList.remove('selected');
  edSelectedEl = el;
  if (el) el.classList.add('selected');
}

function deleteSelected() { if(edSelectedEl){edSelectedEl.remove();edSelectedEl=null;} }
function applyFontFamily(v){ if(edSelectedEl?.tagName==='TEXTAREA') edSelectedEl.style.fontFamily=v; }
function applyFontSize(v)  { if(edSelectedEl?.tagName==='TEXTAREA') edSelectedEl.style.fontSize=v+'px'; }
function applyTextColor(v) { if(edSelectedEl?.tagName==='TEXTAREA') edSelectedEl.style.color=v; }
function applyTextBg(v)    { if(edSelectedEl?.tagName==='TEXTAREA') edSelectedEl.style.background=v; }
function applyTextBgNone() { if(edSelectedEl?.tagName==='TEXTAREA') edSelectedEl.style.background='transparent'; }
function applyBold()   { if(edSelectedEl?.tagName==='TEXTAREA'){const b=edSelectedEl.style.fontWeight==='bold';edSelectedEl.style.fontWeight=b?'normal':'bold';document.getElementById('btn-bold')?.classList.toggle('active',!b);} }
function applyItalic() { if(edSelectedEl?.tagName==='TEXTAREA'){const i=edSelectedEl.style.fontStyle==='italic';edSelectedEl.style.fontStyle=i?'normal':'italic';document.getElementById('btn-italic')?.classList.toggle('active',!i);} }

function setAnnotColor(color, swatch) {
  edAnnotColor = color;
  document.querySelectorAll('.cswatch').forEach(s=>s.classList.remove('active'));
  if(swatch) swatch.classList.add('active');
  const cp = document.getElementById('text-color-pick');
  if(cp) cp.value = color;
}
function setHLColor(color) { edHLColor = color; }

// ── PAGE NAV & ZOOM ──
function edGoPage(dir) {
  const p = edCurrentPage + dir;
  if (p<1||p>edTotalPages) return;
  edCurrentPage = p;
  edRenderPage(p);
  edUpdatePageInfo();
}

function edUpdatePageInfo() {
  const txt = `Page ${edCurrentPage} of ${edTotalPages}`;
  const el1 = document.getElementById('pg-info');
  if(el1) el1.textContent = txt;
  const prev = document.getElementById('prev-pg');
  const next = document.getElementById('next-pg');
  if(prev) prev.disabled = edCurrentPage<=1;
  if(next) next.disabled = edCurrentPage>=edTotalPages;
}

function setZoom(val) {
  edZoom = val/100;
  const lbl = document.getElementById('zoom-label');
  if(lbl) lbl.textContent = val+'%';
  edRenderPage(edCurrentPage);
}

// ── UNDO ──
function edPushHistory() {
  edHistory.push(Date.now());
  const btn = document.getElementById('btn-undo');
  if(btn) btn.disabled = false;
}

function edUndo() {
  edHistory.pop();
  if(edHistory.length===0){const btn=document.getElementById('btn-undo');if(btn)btn.disabled=true;}
  showToast('Undo — remove the last annotation manually','error');
}

// ── RESTORE ANNOTATIONS ON PAGE SWITCH ──
function edRestoreAnnots(pageNum, wrap) {
  const a = edAnnotations[pageNum];
  if (!a) return;

  [...a.texts, ...a.stickies].forEach(el => { if(el.parentNode!==wrap) wrap.appendChild(el); });
  [...a.images, ...a.sigs].forEach(({container}) => { if(container.parentNode!==wrap) wrap.appendChild(container); });

  const drawCanvas = document.getElementById('draw-canvas-'+pageNum);
  if (drawCanvas && a.draws.length) {
    const ctx = drawCanvas.getContext('2d');
    a.draws.forEach(({path,color,size,opacity}) => {
      ctx.globalAlpha=opacity; ctx.strokeStyle=color; ctx.lineWidth=size; ctx.lineCap='round'; ctx.lineJoin='round';
      ctx.beginPath(); path.forEach((pt,i)=>i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y)); ctx.stroke();
    });
  }

  const svg = document.getElementById('svg-layer-'+pageNum);
  if (svg) {
    a.highlights.forEach(({x,y,w,h,color}) => {
      const r=document.createElementNS('http://www.w3.org/2000/svg','rect');
      r.setAttribute('x',Math.min(x,x+w)); r.setAttribute('y',Math.min(y,y+h));
      r.setAttribute('width',Math.abs(w)); r.setAttribute('height',Math.abs(h));
      r.setAttribute('fill',color); svg.appendChild(r);
    });
    a.underlines.forEach(({x1,y,x2,color}) => {
      const l=document.createElementNS('http://www.w3.org/2000/svg','line');
      l.setAttribute('x1',x1); l.setAttribute('y1',y+4); l.setAttribute('x2',x2); l.setAttribute('y2',y+4);
      l.setAttribute('stroke',color); l.setAttribute('stroke-width','2'); svg.appendChild(l);
    });
  }
}

// ── SAVE PDF ──
async function edSavePDF() {
  if (!edPdfDoc) return showToast('No PDF loaded','error');
  showToast('Generating PDF...','success');

  try {
    const font  = await edPdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = edPdfDoc.getPages();

    for (let pg=1; pg<=edTotalPages; pg++) {
      const pdfPage = pages[pg-1];
      const { width, height } = pdfPage.getSize();
      const pdfJsPg = await edPdfJsDoc.getPage(pg);
      const vp      = pdfJsPg.getViewport({ scale: edZoom * 1.5 });
      const sx      = width  / vp.width;
      const sy      = height / vp.height;
      const a       = edAnnotations[pg];
      if (!a) continue;

      // Text annotations
      for (const ta of a.texts) {
        const txt = ta.value?.trim(); if (!txt) continue;
        const l   = parseInt(ta.style.left)||0;
        const t   = parseInt(ta.style.top) ||0;
        const sz  = parseInt(ta.style.fontSize)||16;
        const col = hexToRgb(ta.style.color||'#000000');
        pdfPage.drawText(txt, {
          x: l*sx, y: height-(t+sz*1.4)*sy,
          size: sz*Math.min(sx,sy), font,
          color: rgb(col.r/255, col.g/255, col.b/255),
          maxWidth: width - l*sx,
          lineHeight: sz*1.5*Math.min(sx,sy),
        });
      }

      // Highlights
      for (const hl of a.highlights) {
        const c = parseRgba(hl.color);
        pdfPage.drawRectangle({
          x: Math.min(hl.x,hl.x+hl.w)*sx,
          y: height-(Math.min(hl.y,hl.y+hl.h)+Math.abs(hl.h))*sy,
          width: Math.abs(hl.w)*sx, height: Math.abs(hl.h)*sy,
          color: rgb(c.r/255,c.g/255,c.b/255), opacity: c.a,
        });
      }

      // Underlines
      for (const ul of a.underlines) {
        const c = hexToRgb(ul.color||'#ef4444');
        pdfPage.drawLine({
          start:{x:ul.x1*sx,y:height-(ul.y+4)*sy},
          end:  {x:ul.x2*sx,y:height-(ul.y+4)*sy},
          thickness:1.5, color:rgb(c.r/255,c.g/255,c.b/255),
        });
      }

      // Images & signatures
      const imgEls = [...a.images.map(i=>i.container), ...a.sigs.map(s=>s.container)];
      for (const div of imgEls) {
        const imgEl = div.querySelector('img'); if (!imgEl) continue;
        const imgBytes = await fetchAsBytes(imgEl.src);
        let emb;
        try { emb = await edPdfDoc.embedPng(imgBytes); }
        catch { try { emb = await edPdfDoc.embedJpg(imgBytes); } catch { continue; } }
        const l=parseInt(div.style.left)||0, t=parseInt(div.style.top)||0;
        const w=div.offsetWidth||200,        h=div.offsetHeight||100;
        pdfPage.drawImage(emb,{x:l*sx,y:height-(t+h)*sy,width:w*sx,height:h*sy});
      }

      // Free drawings
      const dc = document.getElementById('draw-canvas-'+pg);
      if (dc && a.draws.length) {
        const bytes = await canvasToBytes(dc);
        const emb   = await edPdfDoc.embedPng(bytes);
        pdfPage.drawImage(emb,{x:0,y:0,width,height});
      }

      // Sticky notes
      for (const note of a.stickies) {
        const txt = note.innerText?.replace('✕','').trim(); if(!txt) continue;
        const l=parseInt(note.style.left)||0, t=parseInt(note.style.top)||0;
        pdfPage.drawRectangle({x:l*sx,y:height-(t+80)*sy,width:120*sx,height:80*sy,color:rgb(0.996,0.941,0.541),opacity:0.85,borderColor:rgb(0.831,0.706,0),borderWidth:1});
        pdfPage.drawText(txt.slice(0,100),{x:(l+6)*sx,y:height-(t+18)*sy,size:9*Math.min(sx,sy),font,color:rgb(0.1,0.1,0.1),maxWidth:110*sx});
      }
    }

    const saved = await edPdfDoc.save();
    downloadBlob(new Blob([saved],{type:'application/pdf'}), 'edited-' + (document.getElementById('ed-file-name')?.textContent || 'document.pdf'));
    showToast('✅ PDF saved successfully!','success');
  } catch(err) {
    showToast('Save failed: '+err.message,'error');
    console.error(err);
  }
}

// ── UTILS ──
function hexToRgb(hex) {
  const c=(hex||'#000').replace('#','');
  if(c.length===3) return{r:parseInt(c[0]+c[0],16),g:parseInt(c[1]+c[1],16),b:parseInt(c[2]+c[2],16)};
  return{r:parseInt(c.slice(0,2),16)||0,g:parseInt(c.slice(2,4),16)||0,b:parseInt(c.slice(4,6),16)||0};
}

function parseRgba(str) {
  const m=str.match(/rgba?\(([^)]+)\)/);
  if(!m)return{r:254,g:240,b:138,a:0.45};
  const [r,g,b,a=1]=m[1].split(',').map(Number);
  return{r,g,b,a};
}

async function fetchAsBytes(url) {
  const res=await fetch(url); const buf=await res.arrayBuffer(); return new Uint8Array(buf);
}

async function canvasToBytes(canvas) {
  return new Promise(resolve=>{
    canvas.toBlob(async blob=>{const buf=await blob.arrayBuffer();resolve(new Uint8Array(buf));},'image/png');
  });
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();edUndo();}
  if((e.key==='Delete'||e.key==='Backspace')&&document.activeElement.tagName!=='TEXTAREA'&&document.activeElement.tagName!=='INPUT') deleteSelected();
  if(e.key==='Escape') setTool('select');
});