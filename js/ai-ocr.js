// ── TEXTLENS™ AI OCR — ai-ocr.js ──
// SECURE SETUP: Sends extracted text to Netlify Function for AI Formatting.

let ocrFile = null;
let ocrImageDataUrl = null;

// ── FILE LOADING ──
function handleOCRDrop(e) {
  e.preventDefault();
  document.getElementById('ocr-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processOCRFile(file);
}

function loadOCRFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) processOCRFile(file);
}

async function processOCRFile(file) {
  ocrFile = file;

  const info = document.getElementById('ocr-file-info');
  info.classList.add('visible');
  document.getElementById('ocr-file-name').textContent = file.name;
  document.getElementById('ocr-file-size').textContent = formatBytes(file.size);

  document.getElementById('ocr-lang-group').style.display = 'block';

  const previewWrap = document.getElementById('ocr-preview-wrap');
  const previewImg = document.getElementById('ocr-preview-img');

  if (file.type.startsWith('image/')) {
    ocrImageDataUrl = await readFileAsDataURL(file);
    previewImg.src = ocrImageDataUrl;
    previewWrap.style.display = 'block';
  } else if (file.type === 'application/pdf') {
    try {
      ocrImageDataUrl = await pdfFirstPageToImage(file);
      previewImg.src = ocrImageDataUrl;
      previewWrap.style.display = 'block';
      showToast('PDF loaded — will OCR page 1. For multi-page, convert to images first.', 'success');
    } catch (err) {
      showToast('Could not render PDF for OCR: ' + err.message, 'error');
      return;
    }
  } else {
    showToast('Please upload a JPG, PNG, WEBP, or PDF file.', 'error');
    return;
  }

  document.getElementById('ocr-btn').disabled = false;
  document.getElementById('ocr-result').classList.remove('visible');
  document.getElementById('ocr-result-text').textContent = '';
}

function clearOCRFile() {
  ocrFile = null;
  ocrImageDataUrl = null;
  document.getElementById('ocr-file-info').classList.remove('visible');
  document.getElementById('ocr-lang-group').style.display = 'none';
  document.getElementById('ocr-preview-wrap').style.display = 'none';
  document.getElementById('ocr-btn').disabled = true;
  document.getElementById('ocr-result').classList.remove('visible');
  document.getElementById('ocr-loader').classList.remove('visible');
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function pdfFirstPageToImage(file) {
  const buf = await file.arrayBuffer();
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas.toDataURL('image/png');
}

// ── MAIN OCR FUNCTION ──
async function runOCR() {
  if (!ocrImageDataUrl) return showToast('Please upload a file first', 'error');

  const lang = document.getElementById('ocr-lang').value;
  const btn  = document.getElementById('ocr-btn');
  const loader = document.getElementById('ocr-loader');
  const result = document.getElementById('ocr-result');
  const progressBar = document.getElementById('ocr-progress-bar');
  const progressLabel = document.getElementById('ocr-progress-label');

  btn.disabled = true;
  loader.classList.add('visible');
  result.classList.remove('visible');
  progressBar.style.width = '0%';

  try {
    const { createWorker } = Tesseract;
    const worker = await createWorker(lang, 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
      corePath:   'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const pct = Math.round(m.progress * 100);
          progressBar.style.width = pct + '%';
          progressLabel.innerHTML = `Extracting text — ${pct}%`;
        }
      }
    });

    const { data: { text } } = await worker.recognize(ocrImageDataUrl);
    await worker.terminate();

    const cleanedText = text.trim();
    if (!cleanedText) {
      showToast('No text found. Try a clearer image.', 'error');
      loader.classList.remove('visible');
      btn.disabled = false;
      return;
    }

    // AI Enhancing step via Netlify Function
    progressLabel.innerHTML = `AI is polishing and formatting text...<span class="ai-loader-dots"></span>`;
    const aiPolishedText = await callSecureOCRBackend(cleanedText);

    document.getElementById('ocr-result-text').textContent = aiPolishedText;
    result.classList.add('visible');
    loader.classList.remove('visible');
    btn.disabled = false;
    showToast('✅ Text extracted and enhanced by AI!', 'success');
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (err) {
    showToast('OCR failed: ' + err.message, 'error');
    loader.classList.remove('visible');
    btn.disabled = false;
  }
}

async function callSecureOCRBackend(rawText) {
  const res = await fetch('/.netlify/functions/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawText: rawText })
  });
  if (!res.ok) return rawText; // अगर AI फेल हो तो बैकअप में ओरिजिनल टेक्स्ट दिखा दें
  const data = await res.json();
  return data.text || rawText;
}

function copyResult(id) {
  const el = document.getElementById(id);
  const text = el.textContent || el.innerText || '';
  navigator.clipboard.writeText(text).then(() => {
    showToast('✅ Text copied!', 'success');
  });
}

function downloadOCRText() {
  const text = document.getElementById('ocr-result-text').textContent || '';
  if (!text) return showToast('Nothing to download yet', 'error');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, (ocrFile?.name?.replace(/\.[^.]+$/, '') || 'extracted') + '-text.txt');
}
