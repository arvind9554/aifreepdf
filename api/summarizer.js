// api/summarizer.js

export default async function handler(req, res) {
  // 1. Method check (Vercel Node.js style)
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Vercel automatically body ko parse kar deta hai
    const { prompt } = req.body;

    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) {
      throw new Error("AI_API_KEY is missing in Vercel environment variables.");
    }

    // Safety fallback agar prompt missing ho
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "No text or prompt provided for summarization." });
    }

    // 2. Correct Gemini API Endpoint (Gemini 1.5 Flash use kar rahe hain jo text summarization ke liye fastest hai)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.4 }
      })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    // Safe extraction string handling
    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "Could not generate summary.";

    // 3. Vercel success response return
    return res.status(200).json({ text: aiText });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}