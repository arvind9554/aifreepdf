// ── SWIFTMIND™ PDF SUMMARIZER — ai-summarizer.js ──
// FREE SETUP: Get Gemini API key FREE at https://aistudio.google.com → "Get API Key"
// No credit card needed. Just paste your key below and change provider to 'gemini'.

// ── CONFIGURATION ──
const SUMMARIZER_CONFIG = {
  provider: 'gemini',              // FREE: 'gemini' | paid: 'anthropic' | paid: 'openai'
  apiKey: 'YOUR_GEMINI_API_KEY',  // Get free key at: https://aistudio.google.com
};

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
    // Step 1: Extract text from PDF (always works)
    if (!sumPDFText) {
      sumPDFText = await extractPDFText(sumFile);
    }

    if (!sumPDFText || sumPDFText.length < 50) {
      showToast('This PDF appears to be a scanned image. Try TextLens™ OCR instead.', 'error');
      loader.classList.remove('visible');
      btn.disabled = false;
      return;
    }

    // Step 2: Send to AI API (needs API key)
    if (!SUMMARIZER_CONFIG.apiKey || SUMMARIZER_CONFIG.apiKey === 'YOUR_GEMINI_API_KEY' || SUMMARIZER_CONFIG.apiKey === 'YOUR_API_KEY') {
      // Demo mode — show what the prompt would look like
      showDemoMode(sumPDFText.slice(0, 300), lang);
      loader.classList.remove('visible');
      btn.disabled = false;
      return;
    }

    const summary = await callAIAPI(sumPDFText, lang);

    document.getElementById('sum-result-text').textContent = summary;
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

// ── AI API CALL (configure when ready) ──
async function callAIAPI(pdfText, language) {
  const prompt = `You are a professional document summarizer. Summarize the following PDF document content clearly and concisely in ${language}. 
  
Format your response as:
📌 MAIN TOPIC: (one line)

🔑 KEY POINTS:
• (point 1)
• (point 2)
• (point 3)
• (point 4)
• (point 5)

💡 CONCLUSION: (2-3 lines)

Document Content:
${pdfText.slice(0, 12000)}`; // Limit to ~12k chars

  if (SUMMARIZER_CONFIG.provider === 'gemini') {
    const model = 'gemini-2.5-flash'; // fastest free model
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${SUMMARIZER_CONFIG.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0.4 }
        })
      }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.candidates[0].content.parts[0].text;

  } else if (SUMMARIZER_CONFIG.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': SUMMARIZER_CONFIG.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.content[0].text;

  } else if (SUMMARIZER_CONFIG.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUMMARIZER_CONFIG.apiKey}` },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  }

  throw new Error('No API provider configured. See SUMMARIZER_CONFIG in ai-summarizer.js');
}

// ── DEMO MODE (shown when no API key) ──
function showDemoMode(textPreview, lang) {
  const demoText = `⚙️ API KEY NOT CONFIGURED

This tool is ready to work — it just needs an AI API key.

📄 We successfully extracted text from your PDF!
Preview: "${textPreview.slice(0, 200)}..."

🔧 To activate:
1. Open js/ai-summarizer.js
2. Set SUMMARIZER_CONFIG.apiKey = 'your-key-here'
3. Set SUMMARIZER_CONFIG.provider = 'anthropic' or 'openai'

✅ The text extraction part is already working in your browser.
    Once connected to an AI API, summaries will appear here.`;

  document.getElementById('sum-result-text').textContent = demoText;
  document.getElementById('sum-result').classList.add('visible');
  document.getElementById('sum-api-notice').style.display = 'block';
  document.getElementById('sum-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function copyResult(id) {
  const text = document.getElementById(id)?.textContent || '';
  navigator.clipboard.writeText(text).then(() => showToast('✅ Copied!', 'success'))
    .catch(() => { showToast('Copy failed — try selecting text manually', 'error'); });
}