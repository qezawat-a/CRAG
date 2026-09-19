// serve.js — HTTP API-e mahali (item 13)
// ----------------------------------------------------------------
// Ye server-e HTTP-e sade (node:http — bi dependency) ke agent ro
// ghabele seda zadan mikone:
//
//   GET  /            -> etela'at-e sade (+ /health)
//   GET  /health      -> { ok:true, agent, model }
//   POST /chat        -> body: {"message":"...","sessionId":"..."}
//                        javab: { ok:true, reply, rounds, provider }
//   POST /say         -> alias-e /chat
//
// (har request az `say(message)` ke behemoon mide estefade mikone —
//  pas TUI mitune ye say-e queue-dar bede ke taskhir-e history
//  nadāshe bashe.)

import http from 'node:http';

export function startServe({ port = 8787, say, agentName = 'agent', getModel, log = console.log }) {
  const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname;

    if (req.method === 'GET' && (path === '/' || path === '/health')) {
      return json(res, 200, { ok: true, agent: agentName, model: getModel ? getModel() : undefined, endpoints: ['GET /health', 'POST /chat {message}'] });
    }

    if (req.method === 'POST' && (path === '/chat' || path === '/say')) {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 1_000_000) req.destroy(); // sefr-e amniati
      });
      req.on('end', async () => {
        let message = '';
        try { message = String((JSON.parse(body || '{}').message || '')).trim(); } catch {
          return json(res, 400, { ok: false, error: 'JSON-e kharab' });
        }
        if (!message) return json(res, 400, { ok: false, error: 'message khali-e (mesal: {"message":"salam"})' });
        try {
          const out = await say(message);
          json(res, 200, { ok: true, reply: out && out.reply !== undefined ? out.reply : String(out), rounds: out && out.rounds, provider: out && out.provider });
        } catch (e) {
          json(res, 500, { ok: false, error: e.message });
        }
      });
      return;
    }

    json(res, 404, { ok: false, error: 'in path nist', paths: ['/', '/health', '/chat', '/say'] });
  });

  server.on('error', (e) => log(`[serve] error: ${e.message}`));
  server.listen(port, () => log(`[serve] roshan — http://127.0.0.1:${port} (POST /chat {"message":"..."})`));

  return {
    stop() {
      try { server.close(); } catch { /* hichi */ }
      log('[serve] khamush shod.');
    },
  };
}
