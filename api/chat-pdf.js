// vercel/api/chat-pdf.js
export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { question, pdfText, history } = JSON.parse(event.body);
    const apiKey = process.env.AI_API_KEY; // नेटलिफाई की सीक्रेट की

    const systemPrompt = `You are a helpful AI assistant that answers questions about a PDF document. Only answer based on the document content. If the answer isn't in the document, say so clearly.

Document Content:
${pdfText.slice(0, 10000)}`;

    // चैट हिस्ट्री का टेक्स्ट फॉर्मेट बनाएं
    const conversationText = history.map(h =>
      `${h.role === 'assistant' ? 'Assistant' : 'User'}: ${h.content}`
    ).join('\n');
    
    // पूरा प्रॉम्ट कंबाइन करें
    const fullPrompt = systemPrompt + (conversationText ? '\n\nConversation so far:\n' + conversationText : '') + `\n\nUser: ${question}\nAssistant:`;

    // जेमिनी एपीआई रिक्वेस्ट
    const response = await fetch(
      `https://googleapis.com{apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0.4 }
        })
      }
    );

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const aiText = data.candidates[0].content.parts[0].text;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: aiText })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message })
    };
  }
};
