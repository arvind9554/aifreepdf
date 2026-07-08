// ── DOCUTALK™ CHAT WITH PDF — ai-chat-pdf.js ──
// SECURE SETUP: API Key is now hidden safely in Vercel Environment Variables.

let chatFile = null;
let chatPDFText = '';
const chatHistory = [];

// ── DRAG & DROP ──
function handleChatDrop(e) {
  e.preventDefault();
  document.getElementById('chat-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadChatFileObj(file);
}

function loadChatFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) loadChatFileObj(file);
}

async function loadChatFileObj(file) {
  if (file.type !== 'application/pdf') return showToast('Please upload a PDF file', 'error');
  chatFile = file;

  document.getElementById('chat-file-info').classList.add('visible');
  document.getElementById('chat-file-name').textContent = file.name;
  document.getElementById('chat-file-size').textContent = formatBytes(file.size);
  document.getElementById('chat-load-btn').disabled = false;
}

function clearChatFile() {
  chatFile = null; chatPDFText = ''; chatHistory.length = 0;
  document.getElementById('chat-file-info').classList.remove('visible');
  document.getElementById('chat-load-btn').disabled = true;
  document.getElementById('chat-interface').style.display = 'none';
  document.getElementById('chat-upload-section').style.display = 'block';
  document.getElementById('chat-messages').innerHTML =
    '<div class="chat-bubble ai">👋 Hi! I\'ve read your document. Ask me anything about it.</div>';
}

// ── INIT CHAT (extract PDF text) ──
async function initChat() {
  if (!chatFile) return;
  const btn = document.getElementById('chat-load-btn');
  btn.textContent = 'Reading PDF...';
  btn.disabled = true;

  try {
    chatPDFText = await extractChatPDFText(chatFile);
    if (!chatPDFText || chatPDFText.length < 30) {
      showToast('This PDF appears to be a scanned image. Try TextLens™ OCR for image-based PDFs.', 'error');
      btn.textContent = '💬 Start Chatting';
      btn.disabled = false;
      return;
    }
    document.getElementById('chat-upload-section').style.display = 'none';
    document.getElementById('chat-interface').style.display = 'block';
    document.getElementById('chat-doc-label').textContent = `📄 ${chatFile.name}`;
    document.getElementById('chat-question').focus();
    showToast('✅ PDF loaded! Ask me anything.', 'success');
  } catch (err) {
    showToast('Failed to read PDF: ' + err.message, 'error');
    btn.textContent = '💬 Start Chatting';
    btn.disabled = false;
  }
}

async function extractChatPDFText(file) {
  const buf = await file.arrayBuffer();
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  for (let i = 1; i <= Math.min(pdf.numPages, 25); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += `\n[Page ${i}]\n` + content.items.map(it => it.str).join(' ');
  }
  return text.trim();
}

// ── SEND MESSAGE ──
function sendSuggestion(text) {
  document.getElementById('chat-question').value = text;
  sendChatMessage();
}

async function sendChatMessage() {
  const input = document.getElementById('chat-question');
  const question = input.value.trim();
  if (!question) return;

  input.value = '';
  input.style.height = 'auto';

  addChatBubble(question, 'user');
  document.getElementById('chat-send').disabled = true;
  document.getElementById('chat-suggestions').style.display = 'none';

  // Typing indicator
  const typingId = 'typing-' + Date.now();
  addChatBubble('Thinking...', 'ai', typingId);

  try {
    // FIXED: Ab yeh correct Vercel endpoint call karega
    const answer = await callSecureChatAPI(question, chatPDFText, chatHistory);

    // Remove typing indicator and add real answer
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();

    chatHistory.push({ role: 'user', content: question });
    chatHistory.push({ role: 'assistant', content: answer });

    addChatBubble(answer, 'ai');
  } catch (err) {
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();
    addChatBubble('Sorry, something went wrong. Please try again.', 'ai');
    console.error(err);
  }

  document.getElementById('chat-send').disabled = false;
  input.focus();
}

// Simple Helper to handle Markdown styles from Gemini
// Simple Helper to handle chat formatting from Gemini response
function formatChatMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/•\s*(.*?)(?=\n|$)/g, '<div style="margin-left: 15px; margin-bottom: 5px;">• $1</div>') // Robust bullet fix
    .replace(/\n/g, '<br>');
}

function addChatBubble(text, type, id) {
  const messages = document.getElementById('chat-messages');
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${type}`;
  
  if (id) bubble.id = id;
  
  // UI Improvement: Formatting handle karne ke liye innerHTML fallback
  if (type === 'ai' && text !== 'Thinking...') {
    bubble.innerHTML = formatMarkdown(text);
  } else {
    bubble.textContent = text;
  }
  
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
}

// ── SECURE CALL TO VERCEL BACKEND ──
async function callSecureChatAPI(question, pdfText, history) {
  // FIXED: Endpoint URL clean up kiya (.vercel hatakar direct /api)
  const res = await fetch('/api/chat-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: question,
      pdfText: pdfText,
      history: history
    })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return data.text;
}