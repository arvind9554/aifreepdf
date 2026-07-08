// ── SWIFTMIND™ PDF SUMMARIZER — ai-summarizer.js ──
// SECURE SETUP: Key is hidden in Vercel Environment Variables. No keys needed here!

let sumFile = null;
let sumPDFText = '';

// ── FILE LOADING ──
function handleSumDrop(e) {
  e.preventDefault();
  document.getElementById('sum-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadSumFileObj(file);
}

function loadSumFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) loadSumFileObj(file);
}

async function loadSumFileObj(file) {
  if (file.type !== 'application/pdf') return showToast('Please upload a PDF file', 'error');
  sumFile = file;
  sumPDFText = '';

  document.getElementById('sum-file-info').classList.add('visible');
  document.getElementById('sum-file-name').textContent = file.name;
  document.getElementById('sum-file-size').textContent = formatBytes(file.size);
  document.getElementById('sum-lang-group').style.display = 'block';
  document.getElementById('sum-btn').disabled = false;
  document.getElementById('sum-result').classList.remove('visible');
}

function clearSumFile() {
  sumFile = null; sumPDFText = '';
  document.getElementById('sum-file-info').classList.remove('visible');
  document.getElementById('sum-lang-group').style.display = 'none';
  document.getElementById('sum-btn').disabled = true;
  document.getElementById('sum-result').classList.remove('visible');
  document.getElementById('sum-loader').classList.remove('visible');
}

// ── EXTRACT PDF TEXT (browser-side, no API needed for this step) ──
async function extractPDFText(file) {
  const buf = await file.arrayBuffer();
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const maxPages = Math.min(pdf.numPages, 30); // limit to 30 pages to avoid huge prompts
  let fullText = '';

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += `\n--- Page ${i} ---\n${pageText}`;
  }

  return fullText.trim();
}

// Simple Helper to handle Markdown styles (like bullets and bold headers) from Gemini response
function formatSummaryMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/•\s*(.*?)(?=\n|$)/g, '<div style="margin-left: 15px; margin-bottom: 5px;">• $1</div>') // Robust bullet fix
    .replace(/\n/g, '<br>');
}

// ── MAIN SUMMARIZE FUNCTION ──
async function summarizePDF() {
  if (!sumFile) return showToast('Please upload a PDF first', 'error');

  const lang = document.getElementById('sum-lang').value;
  const btn = document.getElementById('sum-btn');
  const loader = document.getElementById('sum-loader');

  btn.disabled = true;
  loader.classList.add('visible');
  document.getElementById('sum-result').classList.remove('visible');

  try {
    // Step 1: Extract text from PDF
    if (!sumPDFText) {
      sumPDFText = await extractPDFText(sumFile);
    }

    if (!sumPDFText || sumPDFText.length < 50) {
      showToast('This PDF appears to be a scanned image. Try TextLens™ OCR instead.', 'error');
      loader.classList.remove('visible');
      btn.disabled = false;
      return;
    }

    // Step 2: Send to Vercel Serverless API
    const summary = await callSecureSummaryBackend(sumPDFText, lang);

    // FIXED: textContent ko innerHTML se badla taaki bold tags aur structure break na ho
    document.getElementById('sum-result-text').innerHTML = formatSummaryMarkdown(summary);
    document.getElementById('sum-result').classList.add('visible');
    loader.classList.remove('visible');
    btn.disabled = false;
    document.getElementById('sum-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (err) {
    showToast('Summarization failed: ' + err.message, 'error');
    loader.classList.remove('visible');
    btn.disabled = false;
  }
}

// ── SECURE CALL TO VERCEL BACKEND ──
async function callSecureSummaryBackend(pdfText, language) {
  const prompt = `You are a professional document summarizer. Summarize the following PDF document content clearly and concisely in ${language}. 

Format your response exactly as:
📌 MAIN TOPIC: (one line)

🔑 KEY POINTS:
- (point 1)
- (point 2)
- (point 3)
- (point 4)
- (point 5)

💡 CONCLUSION: (2-3 lines)

Document Content:
${pdfText.slice(0, 12000)}`;

  // Fetching from Vercel endpoint directly
  const res = await fetch('/api/summarizer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: prompt })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.text;
}

function copyResult(id) {
  const el = document.getElementById(id);
  const text = el?.innerText || el?.textContent || '';
  navigator.clipboard.writeText(text).then(() => showToast('✅ Copied!', 'success'))
    .catch(() => { showToast('Copy failed — try selecting text manually', 'error'); });
}