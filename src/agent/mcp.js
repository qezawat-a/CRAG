// mcp.js — MCP client-e sade (Model Context Protocol), item 4
// ------------------------------------------------------------
// Be MCP server-ha-ye stdio vasl mishe (initialize -> tools/list) va
// tool-haye-ashon ro be format-e basic-tools-e ma tabdil mikone:
//   { name, description, parameters, run(args) }
// Hich dependency-e jadidi nist: protocol-e MCP roye stdio = JSON-RPC
// 2.0 ke har payam-esh ye khat-e JSON hast (newline-delimited).
//
// Config dar settings.json -> settings.mcp.servers (key = name-e server):
//   {
//     "mcp": {
//       "enabled": true,
//       "servers": {
//         "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"], "env": {} },
//         "github":     { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "..." } }
//       }
//     }
//   }
// (server-haye HTTP/SSE ke faghat `url` daran hanooz support nemishan —
//  in client stdio-e. Ye server-e stdio mishe ba `npx -y <pkg>` shoru kard.)

import { spawn } from 'node:child_process';

const PROTOCOL_VERSION = '2024-11-05'; // versiyon-e protocol-e ma (server-e maqbool dast-e ma ro mide)

// ------------------------------------------------------------
// Ye connection be ye server: spawn + JSON-RPC (line-delimited)
// ------------------------------------------------------------
class McpConnection {
  constructor(name, cfg) {
    this.name = name;
    this.cfg = cfg;
    this.proc = null;
    this.ready = false;
    this.tools = [];        // tool-haye kham az server (MCP format)
    this.nextId = 1;
    this.buf = '';
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.stderrLog = [];      // akharin khat-haye stderr (baraye error-report)
  }

  async connect() {
    const { command, args = [], env = {}, cwd } = this.cfg;
    this.proc = spawn(command, args, {
      env: { ...process.env, ...env },
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.on('data', (chunk) => this._onData(chunk));
    this.proc.stderr.on('data', (d) => {
      const lines = d.toString().split('\n').map((x) => x.trim()).filter(Boolean);
      this.stderrLog.push(...lines);
      if (this.stderrLog.length > 8) this.stderrLog.splice(0, this.stderrLog.length - 8);
    });
    this.proc.on('error', (err) => this._failAll(err));
    this.proc.on('exit', (code) => this._failAll(new Error(`process exit (code=${code})`)));

    try {
      // handshake-e asli (initialize -> notifications/initialized)
      await this._request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'j-rock', version: '0.1.0' },
      }, 10000);
      this._notify('notifications/initialized', {});

      const res = await this._request('tools/list', {}, 15000);
      this.tools = (res && Array.isArray(res.tools) ? res.tools : []).filter((t) => t && t.name);
      this.ready = true;
      return this.tools.length;
    } catch (e) {
      this.shutdown();
      const tail = this.stderrLog.slice(-3).join(' | ');
      throw new Error(`${e.message}${tail ? ` — stderr: ${tail}` : ''}`);
    }
  }

  _onData(chunk) {
    this.buf += chunk.toString();
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (line) this._handleLine(line);
    }
  }

  _handleLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (!msg || msg.id === undefined || msg.id === null) return; // notification/server-init — bekhun nasho
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message || `MCP error (code ${msg.error.code})`));
    else p.resolve(msg.result);
  }

  _request(method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[mcp:${this.name}] '${method}' timeout (${timeoutMs}ms)`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this._send({ jsonrpc: '2.0', id, method, params: params || {} });
    });
  }

  _notify(method, params) {
    this._send({ jsonrpc: '2.0', method, params: params || {} });
  }

  _send(obj) {
    if (this.proc && this.proc.stdin && this.proc.stdin.writable) {
      this.proc.stdin.write(JSON.stringify(obj) + '\n');
    }
  }

  _failAll(err) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.ready = false;
  }

  // natijeh-e tools/call: content block-ha ro be text tabdil kon
  async callTool(name, args, timeoutMs) {
    const res = await this._request('tools/call', { name, arguments: args || {} }, timeoutMs);
    const blocks = (res && Array.isArray(res.content) ? res.content : []);
    const text = blocks
      .map((b) => {
        if (b.type === 'text') return b.text;
        if (b.type === 'image') return `[image: ${(b.mimeType || 'image/png').split('/')[1] || 'png'} (${(b.data || '').length} chars base64)]`;
        return JSON.stringify(b);
      })
      .join('\n')
      .trim();
    if (res && res.isError) return `Error (MCP): ${text || 'server error'}`;
    return text || '(natije-i nabud)';
  }

  shutdown() {
    try { if (this.proc) this.proc.kill(); } catch { /* hichi */ }
    this.proc = null;
    this.ready = false;
    this._failAll(new Error('connection closed'));
  }
}

// ------------------------------------------------------------
// Tabdil-e MCP tool -> tool-e ma ({ name, description, parameters, run })
// ------------------------------------------------------------
const _nameSafe = (x) => String(x).replace(/[^a-zA-Z0-9_-]/g, '_');

function toAgentTool(conn, t, timeoutMs) {
  const fullName = `${_nameSafe(conn.name)}_${_nameSafe(t.name)}`;
  return {
    name: fullName,
    description: (t.description ? `${t.description} ` : '') + `(MCP server: ${conn.name})`,
    // inputSchema-e MCP hamun JSON Schema-e — doost-e OpenAI/Anthropic
    parameters: t.inputSchema && t.inputSchema.type === 'object'
      ? t.inputSchema
      : { type: 'object', properties: {}, additionalProperties: false },
    timeoutMs,
    async run(args) {
      return conn.callTool(t.name, args || {}, timeoutMs);
    },
  };
}

const _active = []; // connection-haye baz (baraye shutdown-e nahayi)

// ------------------------------------------------------------
// loadMcpTools(servers, timeoutMs): hame server-haye config shode ro
// vasl mikone va array-e tool-haye amade baraye buildTools bargardune.
// Ye server-e kharab hich digari ro shekast nemide — faghat log mishe.
// ------------------------------------------------------------
export async function loadMcpTools(servers, timeoutMs = 20000) {
  const entries = servers && typeof servers === 'object' ? Object.entries(servers) : [];
  const out = [];
  for (const [name, cfg] of entries) {
    if (!cfg || typeof cfg !== 'object') continue;
    if (!cfg.command) {
      console.warn(`[mcp] '${name}' config-e stdio nadarad (command/args) — rad shod. (HTTP/SSE hanooz nist)`);
      continue;
    }
    const conn = new McpConnection(name, cfg);
    try {
      const n = await conn.connect();
      for (const t of conn.tools) out.push(toAgentTool(conn, t, timeoutMs));
      _active.push(conn);
      console.log(`[mcp] '${name}' vasl shod — ${n} tool (be sorat-e ${out.length} tool-e agent)`);
    } catch (e) {
      console.warn(`[mcp] '${name}' shekast khord: ${e.message}`);
    }
  }
  return out;
}

// hame server-ha ro bekesh (vaqti agent khoruj mishe)
export function shutdownMcp() {
  for (const c of _active.splice(0)) c.shutdown();
}
