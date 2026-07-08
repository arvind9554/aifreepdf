// api/ocr.js

export default async function handler(req, res) {
  // 1. Method check (Vercel Node.js style)
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Vercel body ko automatically parse kar deta hai
    const { rawText } = req.body;

    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) {
      throw new Error("AI_API_KEY is missing in Vercel environment variables.");
    }

    // Safety fallback agar rawText undefined ya null ho
    const safeRawText = rawText ? rawText.trim() : "";
    if (!safeRawText) {
      return res.status(400).json({ error: "No text provided for OCR cleanup." });
    }

    const prompt = `You are an AI OCR assistant. Clean up, correct any clear typo mistakes, and professionally format the following raw text extracted from a document. Keep the original meaning exactly same and do not add extra explanations:\n\n${safeRawText}`;

    // 2. Correct Gemini API Endpoint (Gemini 2.5 Flash text tasks ke liye best aur fast hai)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0.2 } // Kam temperature text formatting ke liye perfect hai
      })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    // Safe extraction string handling
    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "Could not format the text.";

    // 3. Vercel success response delivery
    return res.status(200).json({ text: aiText });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}