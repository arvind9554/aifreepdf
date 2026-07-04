// netlify/functions/ocr.js
export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  try {
    const { rawText } = JSON.parse(event.body);
    const apiKey = process.env.AI_API_KEY;

    const prompt = `You are an AI OCR assistant. Clean up, correct any clear typo mistakes, and professionally format the following raw text extracted from a document. Keep the original meaning exactly same and do not add extra explanations:\n\n${rawText}`;

    const response = await fetch(
      `https://googleapis.com{apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 2048, temperature: 0.2 }
        })
      }
    );

    const data = await response.json();
    const aiText = data.candidates[0].content.parts[0].text;

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: aiText }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
