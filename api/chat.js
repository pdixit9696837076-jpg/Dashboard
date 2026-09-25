const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function cleanMessages(messages) {
  return messages
    .filter(m => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content.slice(0, 16000) }));
}

async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, configured: Boolean(process.env.GROQ_API_KEY), model: MODEL });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AI service is not configured: GROQ_API_KEY is missing' });

  const body = req.body || {};
  const messages = cleanMessages(Array.isArray(body.messages) ? body.messages : []);
  if (!messages.length) return res.status(400).json({ error: 'Messages are required' });

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.25,
        max_tokens: 4096,
        stream: false
      })
    });

    const raw = await response.text();
    let data = {};
    try { data = JSON.parse(raw); } catch {}
    if (!response.ok) {
      const provider = data?.error?.message || `Groq returned HTTP ${response.status}`;
      console.error('Groq error:', provider);
      return res.status(502).json({ error: provider });
    }

    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) return res.status(502).json({ error: 'Groq returned an empty response' });
    return res.status(200).json({ reply: String(reply).trim() });
  } catch (error) {
    console.error('Groq request failed:', error);
    return res.status(502).json({ error: 'AI provider request failed. Check GROQ_API_KEY, GROQ_MODEL and deployment settings.' });
  }
}

module.exports = handler;
