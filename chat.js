const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';

function cleanMessages(messages) {
  return messages
    .filter(
      m =>
        m &&
        ['system', 'user', 'assistant'].includes(m.role) &&
        typeof m.content === 'string'
    )
    .slice(-20)
    .map(m => ({
      role: m.role,
      content: m.content.slice(0, 16000)
    }));
}

async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      configured: Boolean(process.env.OPENAI_API_KEY),
      model: MODEL
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'AI service is not configured: OPENAI_API_KEY is missing'
    });
  }

  const body = req.body || {};

  const messages = cleanMessages(
    Array.isArray(body.messages) ? body.messages : []
  );

  if (!messages.length) {
    return res.status(400).json({
      error: 'Messages are required'
    });
  }

  try {
    const systemMessage = messages.find(m => m.role === 'system');

    const input = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role,
        content: m.content
      }));

    const requestBody = {
      model: MODEL,
      input,
      max_output_tokens: 4096
    };

    if (systemMessage) {
      requestBody.instructions = systemMessage.content;
    }

    const response = await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      }
    );

    const raw = await response.text();

    let data = {};

    try {
      data = JSON.parse(raw);
    } catch {}

    if (!response.ok) {
      const provider =
        data?.error?.message ||
        `OpenAI returned HTTP ${response.status}`;

      console.error('OpenAI error:', provider);

      return res.status(502).json({
        error: provider
      });
    }

    const reply = data?.output_text;

    if (!reply) {
      return res.status(502).json({
        error: 'OpenAI returned an empty response'
      });
    }

    return res.status(200).json({
      reply: String(reply).trim()
    });

  } catch (error) {
    console.error('OpenAI request failed:', error);

    return res.status(502).json({
      error:
        'AI provider request failed. Check OPENAI_API_KEY, OPENAI_MODEL and deployment settings.'
    });
  }
}

module.exports = handler;
