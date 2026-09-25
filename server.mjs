import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 5500);

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

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

async function handleChat(req, res) {
  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      configured: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_MODEL || 'gpt-5.6-luna'
    });
  }

  if (req.method !== 'POST') {
    return send(res, 405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-5.6-luna';

  if (!apiKey) {
    return send(res, 500, {
      error: 'AI service is not configured: OPENAI_API_KEY is missing'
    });
  }

  let raw = '';
  for await (const chunk of req) raw += chunk;

  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return send(res, 400, { error: 'Invalid JSON body' });
  }

  const messages = cleanMessages(
    Array.isArray(body.messages) ? body.messages : []
  );

  if (!messages.length) {
    return send(res, 400, { error: 'Messages are required' });
  }

  try {
    const systemMessage = messages.find(m => m.role === 'system');
    const input = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content }));

    const requestBody = {
      model,
      input,
      max_output_tokens: 4096
    };

    if (systemMessage) requestBody.instructions = systemMessage.content;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    const rawResponse = await response.text();
    let data = {};
    try {
      data = JSON.parse(rawResponse);
    } catch {}

    if (!response.ok) {
      const message =
        data?.error?.message || `OpenAI returned HTTP ${response.status}`;
      console.error('OpenAI error:', message);
      return send(res, 502, { error: message });
    }

    const reply = data?.output_text;
    if (!reply) {
      return send(res, 502, { error: 'OpenAI returned an empty response' });
    }

    return send(res, 200, { reply: String(reply).trim() });
  } catch (error) {
    console.error('OpenAI request failed:', error);
    return send(res, 502, {
      error:
        'AI provider request failed. Check OPENAI_API_KEY, OPENAI_MODEL and deployment settings.'
    });
  }
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;

  if (pathname === '/api/chat') return handleChat(req, res);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, { error: 'Method not allowed' });
  }

  const requested = pathname === '/'
    ? 'index.html'
    : pathname.replace(/^\/+/, '');
  const file = normalize(join(root, requested));

  if (!file.startsWith(root)) {
    return send(res, 403, { error: 'Forbidden' });
  }

  try {
    const content = await readFile(file);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp'
    };

    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream'
    });

    if (req.method === 'HEAD') return res.end();
    res.end(content);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
});

server.listen(port, () => {
  console.log(`GuruAgent running at http://localhost:${port}`);
});
