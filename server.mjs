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

async function handleChat(req, res) {
  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      configured: Boolean(process.env.GROQ_API_KEY),
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
    });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!process.env.GROQ_API_KEY) {
    return send(res, 500, { error: 'AI service is not configured: GROQ_API_KEY is missing' });
  }

  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return send(res, 400, { error: 'Invalid JSON body' });
  }
  const messages = Array.isArray(body.messages)
    ? body.messages
      .filter(m => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content.slice(0, 16000) }))
    : [];
  if (!messages.length) return send(res, 400, { error: 'Messages are required' });

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.25,
        max_tokens: 4096,
        stream: false
      })
    });
    const rawResponse = await response.text();
    let data = {};
    try { data = JSON.parse(rawResponse); } catch {}
    if (!response.ok) {
      return send(res, 502, { error: data.error?.message || `Groq returned HTTP ${response.status}` });
    }
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) return send(res, 502, { error: 'Groq returned an empty response' });
    return send(res, 200, { reply: String(reply).trim() });
  } catch (error) {
    console.error('Groq request failed:', error);
    return send(res, 502, { error: 'AI provider request failed. Check GROQ_API_KEY, GROQ_MODEL and deployment settings.' });
  }
}

const server = createServer(async (req, res) => {
  if (req.url === '/api/chat') return handleChat(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, { error: 'Method not allowed' });
  }

  const requested = req.url === '/' ? 'index.html' : req.url.split('?')[0].replace(/^\/+/, '');
  const file = normalize(join(root, requested));
  if (!file.startsWith(root)) return send(res, 403, { error: 'Forbidden' });
  try {
    const content = await readFile(file);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    if (req.method === 'HEAD') return res.end();
    res.end(content);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
});

server.listen(port, () => {
  console.log(`GuruAgent running at http://localhost:${port}`);
});
