// api/chat-pdf.js

export default async function handler(req, res) {
  // 1. Method check (Vercel way)
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Vercel automatically body ko parse kar deta hai agar JSON header ho
    const { question, pdfText, history } = req.body;
    
    const apiKey = process.env.AI_API_KEY; 
    if (!apiKey) {
      throw new Error("AI_API_KEY is missing in Vercel environment variables.");
    }

    // Safety check agar pdfText na aaya ho
    const safePdfText = pdfText ? pdfText.slice(0, 10000) : "";

    const systemPrompt = `You are a helpful AI assistant that answers questions about a PDF document. Only answer based on the document content. If the answer isn't in the document, say so clearly.

Document Content:
${safePdfText}`;

    // Chat history text format (jaise aapne banaya tha, bilkul sahi)
    const conversationText = history && Array.isArray(history)
      ? history.map(h => `${h.role === 'assistant' ? 'Assistant' : 'User'}: ${h.content}`).join('\n')
      : '';
    
    const fullPrompt = systemPrompt + (conversationText ? '\n\nConversation so far:\n' + conversationText : '') + `\n\nUser: ${question}\nAssistant:`;

    // 2. Correct Gemini API Endpoint (Gemini 1.5 Flash recommended for fast text tasks)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.4 }
      })
    });

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }

    // Response structure extraction
    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";

    // 3. Vercel response return structure
    return res.status(200).json({ text: aiText });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}