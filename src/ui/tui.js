#!/usr/bin/env node
// tui.js — chat dar terminal + menu-e 18 option (item 1..18)
// ----------------------------------------------------------------
// In "soorat-e" agent-e (J-Rock). Hosh (loop.js) az UI joda-st:
// UI faghat agent.say() ro seda mizane va session-ha ro save mikone.
//
// Dastur-ha-ye TUI:
//   /help | /menu           -> rahnamayi + list-e 18 option (item-har)
//   /new [title]            -> session-e jadid (item 17)
//   /sessions | /resume [#n|id] | /delete [#n|id]
//   /compact [n]            -> compact-e dasti-ye history (item 16)
//   /model [name|auto|refresh]  -> model-e .env ro neshoon/avaz kon (item 5)
//   /providers              -> provider-haye dar dastres + key/model-ashon (item 6)
//   /soul [file]            -> reload/avaz kardan-e SOUL (item 3)
//   /style [file|on|off]    -> reload/avaz kardan-e STYLE (options)
//   /skills [list|read <id>|on <id>|off <id>|reload]   (item 2)
//   /prompt                 -> system prompt-e assemble shode ro neshoon bede
//   /thinking <level>       -> low|mid|high|xhigh|max (item 10)
//   /settings [a.b.c val]   -> didan/avaz kardan-e tanzimat (item 7)
//   /tools                  -> list-e tool-ha (item 14)
//   /mcp | /gateway | /serve | /harness | /dream | /agents [on|off]  (4,8=11,12,13,9,18)
//   /tg [status|on|off|token <t>|user <id>]  -> Telegram gateway (item 12, mostaghim)
//   exit / quit             -> save va khoruj

import readline from 'node:readline/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createAgent } from '../agent/loop.js';
import { buildTools } from '../agent/tools.js';
import { loadMcpTools, shutdownMcp } from '../agent/mcp.js';
import { xtFuturesTools } from '../xt/futures-tools.js';
import { Services } from '../services.js';
import { Memory } from '../agent/memory.js';
import { SessionStore } from '../session-store.js';
import { getSettings, setSetting } from '../settings.js';
import { detectProviders } from '../agent/config.js';
import { buildSystemPrompt, THINKING_GUIDE } from '../prompt.js';
import { listSkills } from '../agent/skills.js';

// ==================== tanzimat-e asli ====================
let s = getSettings();
let AGENT_NAME = s.identity.agentName;
const memory = await new Memory().load();
const store = new SessionStore();
await store.load();

let skillsCache = listSkills(s.skills.dir, { exclude: s.skills.exclude || [] });

// --- MCP (item 4): tool-haye server-ha-ye vasl shode ---
let mcpTools = []; // tool-haye MCP be format-e ma (az loadMcpTools)
let mcpMsg = '';   // status-e vasl-e MCP (baraye /tools va log)

// --- service-ha (item 8=11, 12, 13): serve + gateway ---
let services = null;              // Services (HTTP + messenger) — dar start sakhte mishe
let sayQueue = Promise.resolve(); // single-writer: TUI/serve/gateway hame az inja

// say-e queue-dar: har request be tartib ejra mishe ta history-e agent
// hamzaman az chand kanal gharbe-gherb nashe (item 12/13)
function queuedSay(text, meta) {
  const run = sayQueue.then(() => agent.say(text));
  sayQueue = run.then(() => {}, () => {}); // error-e yeki be ba'di nareseh
  return run;
}

// tool-haye kamel-e agent: registry-e markazi (basic + memory + XT futures + MCP) ba timeout (item 14)
function xtTools() {
  if (s.xt && s.xt.enabled === false) return []; // user dar settings.json xt.enabled=false gozashte
  try {
    return xtFuturesTools({ getSetting: (k, d) => (memory && memory.get ? null : null) ?? d });
  } catch {
    return [];
  }
}

// tool-haye kamel-e agent: registry-e markazi (basic + memory + XT futures + MCP) ba timeout (item 14)
function activeTools() {
  if (!s.tools.enabled) return [];
  return buildTools({ xtTools: xtTools(), mcpTools, memory, timeoutMs: s.tools.toolTimeoutMs });
}

// vasl kardan-e MCP server-ha (item 4): settings.mcp.servers -> tool-haye agent
async function initMcpTools() {
  mcpTools = [];
  mcpMsg = '';
  if (!s.mcp.enabled || !s.mcp.servers) return;
  try {
    mcpTools = await loadMcpTools(s.mcp.servers, s.tools.toolTimeoutMs);
    mcpMsg = mcpTools.length ? `${mcpTools.length} tool-e MCP vasl shod` : 'MCP roshan-e vali hich server-i tool nadad';
  } catch (e) {
    mcpMsg = `MCP error: ${e.message}`;
  }
}

function makeSystem() {
  return buildSystemPrompt({
    agentName: AGENT_NAME,
    skills: skillsCache,
    tools: activeTools(),
    thinkingLevel: s.thinking.level,
  });
}

function createAgentNow(history) {
  return createAgent({
    system: makeSystem(),
    tools: activeTools(),
    memory,
    history: history || [],
    autoCompact: s.session.autoCompact,            // item 16
    compactAfterRounds: s.session.compactAfterRounds,
    thinkingLevel: s.thinking.level,               // item 10 (brain reasoning)
  });
}

let agent = createAgentNow([]);

// avaz dar SOUL/Style/Skills/Thinking -> agent-e jadid (ba hamin history)
function rebuildAgent() {
  const hist = agent.history().slice();
  agent = createAgentNow(hist);
}

// ==================== session-ha ====================
let current = null; // { id, title, createdAt, updatedAt }

function saveCurrent() {
  if (!current) return;
  current.updatedAt = Date.now();
  current.history = agent.history().slice();
  store.upsert(current);
}

async function flush() {
  saveCurrent();
  await store.save();
  await store.prune(s.session.maxSessions);
  try { await memory.save(); } catch { /* memory nist — moshkeli nist */ }
}

function startNew(title = '') {
  const now = Date.now();
  const id = String(now);
  current = { id, title: title.trim() || `Session ${now}`, createdAt: now, updatedAt: now, history: [] };
  agent = createAgentNow([]);
  console.log(`\n[${AGENT_NAME}] Session-e jadid: ${current.title} (id: ${id})`);
}

function resumeSession(idOrIndex) {
  let target = null;
  if (idOrIndex.startsWith('#')) {
    const idx = parseInt(idOrIndex.slice(1), 10);
    if (!Number.isNaN(idx) && store.list[idx]) target = store.list[idx];
  } else {
    target = store.get(idOrIndex);
  }
  if (!target) { console.log(`[${AGENT_NAME}] Session peyda nashod: ${idOrIndex}`); return; }

  saveCurrent();
  current = { ...target, history: [] };
  agent = createAgentNow(target.history || []);
  console.log(`\n[${AGENT_NAME}] Resume shod: ${current.title} (${(target.history || []).length} payam)`);
}

function listSessions() {
  if (!store.list.length) { console.log('Hich session-i nist.'); return; }
  const sorted = [...store.list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  sorted.forEach((sess) => {
    const mark = current && sess.id === current.id ? ' *' : '';
    console.log(`#${store.list.indexOf(sess)} [${sess.id}] ${sess.title}${mark} — ${(sess.history || []).length} payam`);
  });
  console.log("(* = session-e fe'li. /resume #<shomare> ya /resume <id>)");
}

function deleteSession(idOrIndex) {
  let id = idOrIndex;
  if (id.startsWith('#')) {
    const idx = parseInt(id.slice(1), 10);
    const target = !Number.isNaN(idx) ? store.list[idx] : null;
    if (!target) { console.log('peyda nashod.'); return; }
    id = target.id;
  }
  if (current && current.id === id) {
    console.log('Nemishi session-e fe\'li ro pak kard — avval /new bezan.');
    return;
  }
  store.remove(id);
  console.log(`Session ${id} pak shod.`);
}

// compact-e dasti (item 16): tanha n turn-e akhar-e user mimune
function doCompact(keepTurns = 10) {
  const h = agent.history();
  const userIdx = [];
  h.forEach((m, i) => { if (m.role === 'user') userIdx.push(i); });
  if (userIdx.length <= keepTurns) {
    console.log(`History kootah-e (${userIdx.length} turn) — compact niaz nist.`);
    return;
  }
  const cut = userIdx[userIdx.length - keepTurns];
  const kept = h.slice(cut);
  kept.unshift({ role: 'user', content: '[manual-compact] Goftogu-haye ghadimi hazf shod.' });
  agent.replaceHistory(kept);
  console.log(`[compact] ${cut} message-e ghadimi hazf shod. (hala ${kept.length} message)`);
}

// ==================== helpers-e tool-haye jadid ====================
const ENV_PROV = {
  openai:    { key: 'AI_API_KEY',          model: 'AI_MODEL',          base: 'AI_BASE_URL' },
  anthropic: { key: 'ANTHROPIC_API_KEY',   model: 'ANTHROPIC_MODEL',   base: 'ANTHROPIC_BASE_URL' },
  google:    { key: 'GEMINI_API_KEY',      model: 'GEMINI_MODEL',      base: 'GEMINI_BASE_URL' },
};

function maskKey(k) { return k ? k.slice(0, 6) + '...' + k.slice(-4) : '(nist)'; }

function envGet(varName) {
  if (process.env[varName]) return process.env[varName];
  try {
    const txt = readFileSync(path.resolve('.env'), 'utf8');
    const m = txt.match(new RegExp(`^${varName}=(.*)$`, 'm'));
    return m ? m[1] : '';
  } catch { return ''; }
}

function envSet(varName, value) {
  const p = path.resolve('.env');
  let txt = '';
  try { txt = readFileSync(p, 'utf8'); } catch {}
  const re = new RegExp(`^${varName}=.*$`, 'm');
  if (re.test(txt)) txt = txt.replace(re, `${varName}=${value}`);
  else txt += (txt && !txt.endsWith('\n') ? '\n' : '') + `${varName}=${value}\n`;
  writeFileSync(p, txt);
  process.env[varName] = value;
}

function parseValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v.startsWith('[')) { try { return JSON.parse(v); } catch {} }
  return v;
}

function showProviders() {
  const list = detectProviders();
  if (!list.length) {
    console.log('HICH provideri tanzim nashode — key dar .env bezar (AI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY).');
    return;
  }
  for (const p of list) {
    const env = ENV_PROV[p.name];
    const modelEnv = envGet(env.model);
    console.log(`- ${p.name}\n    baseUrl : ${p.baseUrl}\n    apiKey  : ${maskKey(envGet(env.key))}\n    model   : ${modelEnv || '(auto → probe)'}`);
  }
  console.log('(model ro ba /model <name> ya dar .env set kon)');
}

// ==================== dastur-ha (18 item) ====================
const THINK_LEVELS = ['low', 'mid', 'high', 'xhigh', 'max'];
const FLAG_CMDS = {
  mcp:      { path: 'mcp.enabled',      label: 'MCP server support (item 4)' },
  gateway:  { path: 'gateway.enabled',  label: 'Messenger Gateway (item 12)' },
  serve:    { path: 'serve.enabled',    label: 'Local HTTP server (item 13)' },
  harness:  { path: 'harness.enabled',  label: 'Harness (item 8/11)' },
  dream:    { path: 'dream.enabled',    label: 'Dream deep-research (item 9)' },
  agents:   { path: 'agents.enabled',   label: 'Agents plan/build (item 18)' },
};

const MENU = `== Menu-e 18 option ==
  1. Sessions (resume/switch)  -> /sessions /resume /new        [OK]
  2. Skills                    -> /skills                       [OK]
  3. Soul (persona prompt)     -> /soul                         [OK]
  4. MCP servers               -> /mcp on|off                   [OK]
  5. Model                     -> /model [name|auto|refresh]    [OK]
  6. Providers                 -> /providers                    [OK]
  7. Settings                  -> /settings [key val]           [OK]
  8. Harness                   -> npm run harness (mostaqel)    [OK]
  9. Dream (deep research)     -> /dream on|off                 [flag]
 10. Thinking level            -> /thinking <low..max>          [OK]
 11. Harness (= 8)             -> npm run harness               [OK]
 12. Messenger gateway         -> /gateway on|off               [OK]
 13. Serve localhost           -> /serve on|off                 [OK]
 14. Tools                     -> /tools                        [OK]
 15. Auto-refresh models/token -> /model refresh | /settings model.autoRefreshModels true [OK]
 16. Auto-compact session      -> /compact | /settings session.autoCompact true [OK]
 17. New session               -> /new                          [OK]
 18. Agents plan/build         -> /agents on|off                [flag]
[OK] = code kare mikone | [flag] = hanooz code nist (item 9 Dream, 18 Agents)`;

const HELP = `Dastur-ha:
  /menu                        -> list-e 18 option
  /new [title] | /sessions | /resume [#n|id] | /delete [#n|id]
  /compact [n]                 -> compact-e dasti (item 16)
  /model [name|auto|refresh]   -> model-e .env (item 5) — bad az restart effect dare
  /providers                   -> provider-ha + key/model (item 6)
  /soul [file]                 -> SOUL-e fe'li ya avaz (item 3)
  /style [file|on|off]         -> STYLE (default: soul/STYLE.md)
  /skills [read <id>|on <id>|off <id>|reload]  (item 2)
  /prompt                      -> system prompt-e assemble shode
  /thinking <low|mid|high|xhigh|max>           (item 10)
  /settings [a.b.c value]      -> didan/avaz-e tanzimat (item 7)
  /tools                       -> list-e tool-ha (item 14)
  /mcp|/gateway|/serve|/harness|/dream|/agents [on|off]
  exit / quit                  -> save va khoruj`;

// ==================== Suggestion-e "/" ====================
// Vakhti "/" mizani (va Enter), list-e dastur-ha-ye mojood ro
// neshoon midim. "/se" bezan => faghat dastur-haye filter shode.
// "/1".."/18" ham shortcut-e shomare-i-ye menu-e 18 item-e.
const CMD_TIPS = {
  help:      '/help — rahnamayi',
  menu:      '/menu — list-e 18 option',
  new:       '/new [title] — session-e jadid (17)',
  sessions:  '/sessions — list-e session-ha (1)',
  resume:    '/resume [#n|id] — edame-ye session-e ghabli (1)',
  delete:    '/delete [#n|id] — pak kardan-e ye session',
  compact:   '/compact [n] — compact-e dasti-ye history (16)',
  model:     '/model [name|auto|refresh] — model-e .env (5)',
  providers: '/providers — provider-ha + key/model (6)',
  soul:      '/soul [file] — persona/shakhsiyat (3)',
  style:     '/style [file|on|off] — sabk-e goftogu',
  skills:    '/skills [read|on|off|reload] — skill-ha (2)',
  prompt:    '/prompt — system prompt-e assemble shode',
  thinking:  '/thinking <low|mid|high|xhigh|max> (10)',
  settings:  '/settings [a.b.c val] — tanzimat (7)',
  tools:     '/tools — list-e tool-ha (14)',
  mcp:       '/mcp [on|off] — support-e MCP (4)',
  gateway:   '/gateway [on|off] — messenger gateway (12)',
  tg:        '/tg [status|on|off|token <t>|user <id>] — Telegram mostaghim (12)',
  serve:     '/serve [on|off] — HTTP server-e mahali (13)',
  harness:   '/harness [on|off] — harness (8/11)',
  dream:     '/dream [on|off] — deep-research (9)',
  agents:    '/agents [on|off] — agents plan/build (18)',
};

const NUM_CMD = {
  1: 'sessions', 2: 'skills', 3: 'soul', 4: 'mcp', 5: 'model', 6: 'providers',
  7: 'settings', 8: 'harness', 9: 'dream', 10: 'thinking', 11: 'harness',
  12: 'gateway', 13: 'serve', 14: 'tools', 15: 'model refresh', 16: 'compact',
  17: 'new', 18: 'agents',
};

// "/5" -> "/model" (shortcut-e shomare-i)
function mapNumAlias(raw) {
  const m = raw.trim().match(/^\/(\d+)(?:\s+(.*))?$/);
  if (m && NUM_CMD[m[1]]) return '/' + NUM_CMD[m[1]] + (m[2] ? ' ' + m[2] : '');
  return raw;
}

// list-e suggestion-ha ru safhe (filter-e prefiks)
function showSuggestions(prefix) {
  prefix = (prefix || '').toLowerCase();
  const names = Object.keys(CMD_TIPS).filter(n =>
    !prefix || n.startsWith(prefix) || CMD_TIPS[n].startsWith('/' + prefix)
  );
  if (!names.length) {
    console.log(`Hich dasturi ba "/${prefix}" peyda nashod. (/menu hame ro neshoon mide)`);
    return;
  }
  console.log(`== Suggestions (${names.length}) — "/${prefix}" ==`);
  names.forEach(n => console.log('  ' + CMD_TIPS[n]));
  console.log('(ya /1..18 bezan — shomare-ha dar /menu; Tab ham completion mide)');
}

// Tab completion (vaghti khate "/..." nist, hichi suggestion nemide)
function cmpl(line) {
  const m = line.match(/^(\/\w*)/);
  if (!m) return [[], line];
  const tok = m[1].slice(1).toLowerCase();
  const cands = Object.keys(CMD_TIPS).filter(n => n.startsWith(tok)).map(n => '/' + n);
  return cands.length ? [cands, line] : [[], line];
}

// handleCmd: dastur-haye /... — chizi ke / nadashte be agent.say mire
async function handleCmd(rawInput) {
  const parts = rawInput.trim().split(/\s+/);
  const cmd = parts[0].slice(1).toLowerCase();
  const arg = parts.slice(1).join(' ');

  switch (cmd) {
    case 'help': case 'h': case '?': console.log(HELP); break;
    case 'menu': case 'm': console.log(MENU); break;

    case 'new': { saveCurrent(); startNew(arg); await flush(); break; }
    case 'sessions': listSessions(); break;
    case 'resume': {
      if (!arg) listSessions();
      else { resumeSession(arg); await flush(); }
      break;
    }
    case 'delete': { if (!arg) console.log('mesal: /delete #2'); else { deleteSession(arg); await flush(); } break; }
    case 'compact': { doCompact(arg ? parseInt(arg, 10) || 10 : 10); await flush(); break; }

    // ---- item 5: Model ----
    case 'model': {
      if (arg === 'refresh') {
        const v = !s.model.autoRefreshModels;
        s = setSetting('model.autoRefreshModels', v);
        envSet('AI_AUTO_REFRESH', v ? '1' : '0');             // brain env-esh ro inja mikhune (item 15)
        envSet('AI_MODEL_TTL', String(s.model.cacheTtlMs));   // ms (default 600000)
        console.log(`model.autoRefreshModels -> ${v} (env: AI_AUTO_REFRESH=${v ? '1' : '0'}, TTL=${s.model.cacheTtlMs}ms)`);
        break;
      }
      if (arg && arg !== 'show') {
        const name = arg === 'auto' ? 'auto' : arg;
        envSet('AI_MODEL', name);
        console.log(`AI_MODEL dar .env sabt shod: ${name}\n(restart kon ta effect konad — session-ha resume mishan)`);
      } else {
        const m = envGet('AI_MODEL');
        console.log(`Model-e openai (.env AI_MODEL): ${m || '(auto → probe dar run)'}`);
        console.log(`  baseUrl: ${envGet('AI_BASE_URL') || 'https://api.openai.com/v1'}`);
        const envAr = envGet('AI_AUTO_REFRESH');
        console.log(`  autoRefreshModels: ${s.model.autoRefreshModels} (env AI_AUTO_REFRESH=${envAr || '0'}, TTL=${envGet('AI_MODEL_TTL') || s.model.cacheTtlMs}ms)`);
        console.log('mesal: /model deepseek-chat | /model auto | /model refresh');
      }
      break;
    }

    // ---- item 6: Providers ----
    case 'providers': case 'provider': { showProviders(); break; }

    // ---- item 3: Soul ----
    case 'soul': {
      if (arg) {
        const file = arg === 'default' ? 'soul/SOUL.md' : arg;
        s = setSetting('identity.soulFile', file);
        rebuildAgent();
        console.log(`SOUL -> ${file} (rebuild shod)`);
      } else {
        const p = path.resolve(s.identity.soulFile);
        let head = '';
        try { head = readFileSync(p, 'utf8').split('\n').slice(0, 8).join('\n'); } catch {}
        console.log(`SOUL file: ${s.identity.soulFile}\n---\n${head || '(peyda nashod — default prompt estefade mishe)'}\n---\n/soul <file-e-jadid> baraye avaz, /soul default baraye SOUL.md-e asli.`);
      }
      break;
    }

    // ---- style (options) ----
    case 'style': {
      if (arg === 'on' || arg === 'off') {
        s = setSetting('style.enabled', arg === 'on');
        rebuildAgent();
        console.log(`STYLE -> ${arg}`);
      } else if (arg) {
        s = setSetting('style.file', arg);
        rebuildAgent();
        console.log(`STYLE file -> ${arg} (rebuild shod)`);
      } else {
        console.log(`STYLE: enabled=${s.style.enabled}, file=${s.style.file}`);
        console.log('mesal: /style off | /style soul/STYLE.md | /style on');
      }
      break;
    }

    // ---- item 2: Skills ----
    case 'skills': {
      const [sub, ...rest] = arg.split(/\s+/);
      const id = rest.join(' ');
      if (!sub) {
        if (!skillsCache.length) { console.log('Hich skill-i peyda nashod (folder: skills/).'); break; }
        skillsCache.forEach((k) => console.log(`- ${k.name} — ${k.description}`));
        console.log('(/skills read <id> | /skills on|off <id>)');
      } else if (sub === 'read' && id) {
        const k = skillsCache.find(x => x.name === id || x.id === id);
        if (!k) console.log(`Skill '${id}' peyda nashod.`);
        else console.log(`## ${k.name}\n${k.description}\n---\n${k.body}`);
      } else if ((sub === 'on' || sub === 'off') && id) {
        const exclude = [...(s.skills.exclude || [])];
        if (sub === 'on') { const i = exclude.indexOf(id); if (i >= 0) exclude.splice(i, 1); }
        else if (!exclude.includes(id)) exclude.push(id);
        s = setSetting('skills.exclude', exclude);
        skillsCache = listSkills(s.skills.dir, { exclude });
        rebuildAgent();
        console.log(`Skill '${id}' -> ${sub} (list: ${skillsCache.map(k => k.name).join(', ') || 'khali'})`);
      } else if (sub === 'reload') {
        skillsCache = listSkills(s.skills.dir, { exclude: s.skills.exclude || [] });
        rebuildAgent();
        console.log(`Skills reload shod: ${skillsCache.length} skill`);
      } else {
        console.log('mesal: /skills | /skills read <id> | /skills off <id> | /skills reload');
      }
      break;
    }

    // ---- prompt assemble shode ----
    case 'prompt': {
      const p = makeSystem();
      console.log(`=== System Prompt (${p.length} char) ===`);
      console.log(p);
      break;
    }

    // ---- item 10: Thinking ----
    case 'thinking': case 'think': {
      const lvl = arg.toLowerCase();
      if (THINK_LEVELS.includes(lvl)) {
        s = setSetting('thinking.level', lvl);
        rebuildAgent();
        console.log(`Thinking level -> ${lvl}\n${THINKING_GUIDE[lvl]}`);
      } else {
        console.log(`Level-e fe'li: ${s.thinking.level}`);
        console.log('Gozine-ha: ' + THINK_LEVELS.join(' | ') + '  (mesal: /thinking high)');
      }
      break;
    }

    // ---- item 7: Settings ----
    case 'settings': {
      if (!arg) {
        console.log(JSON.stringify(s, null, 2));
      } else {
        const sp = arg.lastIndexOf(' ');
        const key = sp > 0 ? arg.slice(0, sp).trim() : arg;
        const val = sp > 0 ? arg.slice(sp + 1).trim() : '';
        if (!val || val === '__delete__') {
          s = setSetting(key, '__delete__');
          console.log(`'${key}' pak shod (reset be default).`);
        } else {
          s = setSetting(key, parseValue(val));
          console.log(`'${key}' -> ${JSON.stringify(parseValue(val))}`);
        }
      }
      console.log('mesal: /settings session.autoCompact true | /settings serve.port 9999 | /settings mcp.enabled true');
      break;
    }

    // ---- item 14: Tools ----
    case 'tools': {
      const list = activeTools();
      console.log(`Tools (${list.length}):`);
      for (const t of list) console.log(`- ${t.name}: ${(t.description || '').slice(0, 90)}`);
      console.log(`tools.enabled = ${s.tools.enabled} | toolTimeoutMs = ${s.tools.toolTimeoutMs}`);
      console.log(`MCP: enabled=${s.mcp.enabled}, servers=${Object.keys(s.mcp.servers || {}).length} — ${mcpMsg || '(khāmush)'}`);
      console.log('(/mcp on|off — vasl-e server-ha az settings.mcp.servers | /settings tools.enabled true|false)');
      break;
    }

    // ---- Telegram mostaghim (item 12): /tg status|on|off|token <t>|user <id> ----
    case 'tg': case 'telegram': {
      const [sub, ...rest] = arg.split(/\s+/).filter(Boolean);
      const val = rest.join(' ').trim();
      const masked = (t) => (t && t.length > 8 ? t.slice(0, 4) + '...' + t.slice(-4) : '(nist)');
      if (!sub || sub === 'status') {
        const tok = s.gateway.token || process.env.TELEGRAM_BOT_TOKEN || '';
        const uid = s.gateway.userId || process.env.TELEGRAM_USER_ID || '';
        console.log(`Telegram: ${s.gateway.enabled ? 'ON' : 'OFF'} | token=${masked(tok)} | userId=${uid || '(nist — hame javab migiran!)'} | running=${services && services.gatewayHandle ? 'yes' : 'no'}`);
        console.log('mesal: /tg token 123:ABC | /tg user 123456789 | /tg on | /tg off');
      } else if (sub === 'on') {
        s = setSetting('gateway.enabled', true);
        s = setSetting('gateway.messenger', 'telegram');
        services.gatewayOn();
        console.log(`Telegram gateway -> ON (running=${services.gatewayHandle ? 'yes' : 'NO — token/userId ro check kon (/tg status)'})`);
      } else if (sub === 'off') {
        s = setSetting('gateway.enabled', false);
        services.gatewayOff();
        console.log('Telegram gateway -> OFF');
      } else if (sub === 'token' && val) {
        s = setSetting('gateway.token', val);
        s = setSetting('gateway.messenger', 'telegram');
        console.log(`Telegram token set shod (${masked(val)}).`);
        if (s.gateway.enabled) { services.gatewayOff(); services.gatewayOn(); console.log(`reconnect: running=${services.gatewayHandle ? 'yes' : 'NO — token ro check kon'}`); }
        else console.log('(/tg on baraye roshan kardan)');
      } else if ((sub === 'user' || sub === 'userid') && val) {
        if (!/^\d+$/.test(val)) { console.log('userId bayad adad bashe (numeric Telegram ID — az @userinfobot begir).'); break; }
        s = setSetting('gateway.userId', val);
        console.log(`Telegram allowlist user -> ${val} (faghat in user javab migire).`);
        if (s.gateway.enabled) { services.gatewayOff(); services.gatewayOn(); }
      } else {
        console.log('mesal: /tg status | /tg on | /tg off | /tg token <bot-token> | /tg user <numeric-id>');
      }
      break;
    }

    // ---- flag-haye item 4, 8=11, 9, 12, 13, 18 ----
    default: {
      const fc = FLAG_CMDS[cmd];
      if (fc) {
        const cur = s; // meghdar-e ghabl baraye namayesh
        const curVal = cur.mcp ? (cmd === 'mcp' ? cur.mcp.enabled : (cur[cmd] ? cur[cmd].enabled : false)) : false;
        if (arg === 'on' || arg === 'off') {
          s = setSetting(fc.path, arg === 'on');
          console.log(`${fc.label} -> ${arg}`);
        } else {
          const v = arg === '' ? curVal : (parseValue(arg));
          if (arg !== '') { s = setSetting(fc.path, v); console.log(`${fc.label} -> ${JSON.stringify(v)}`); }
          else console.log(`${fc.label}: fe'lan ${curVal ? 'ON' : 'OFF'}`);
        }
        console.log('(flag zakhire shod — /serve va /gateway hamin alan ON/OFF mishan)');
        if (cmd === 'mcp') {
          // item 4: mcp roshan/khāmush shod -> server-ha ro vasl/ghate kon
          await initMcpTools();
          rebuildAgent();
          console.log(`[mcp] ${mcpMsg || '(hich server-i kar nakard — settings.mcp.servers ro check kon)'}`);
        }
        if (cmd === 'serve') {
          // item 13: HTTP API-e mahali
          if (s.serve.enabled) services.serveOn(); else services.serveOff();
        }
        if (cmd === 'gateway') {
          // item 12: messenger gateway
          if (s.gateway.enabled) services.gatewayOn(); else services.gatewayOff();
        }
        if (cmd === 'harness') {
          // item 8=11: harness-e mostaqel (stdin-e TUI eshghal-e)
          console.log('[harness] harness mostaqel-e: `npm run harness` (ya `node src/harness.js`) — az tu TUI run nemishe.');
        }
      } else {
        showSuggestions(cmd || '');
      }
    }
  }
}

// ==================== start ====================
await initMcpTools(); // MCP server-ha (item 4) — ghabl az sakht-e agent (agar enabled)

// service-ha (item 8/11/12/13): har chi dar settings roshan-e start mishe
services = new Services({
  getSettings,
  say: queuedSay,
  agentName: AGENT_NAME,
  getModel: () => envGet('AI_MODEL') || '(auto)',
  log: console.log,
});
services.syncFromSettings();

if (s.session.resumeLast && store.last()) {
  resumeSession(store.last().id); // item 1: resume-e auto
} else {
  startNew();
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, completer: cmpl });
console.log('==============================================');
console.log(`  ${AGENT_NAME} zende-e! (prompt-e SOUL+Style+Skills+Thinking)`);
console.log('  /help | /menu | /new | /sessions | /prompt | /model | exit');
console.log('==============================================');

// agar process har joor crash kard ham: service-ha + MCP pak shan
process.on('exit', () => {
  try { if (services) services.stopAll(); } catch { /* hichi */ }
  shutdownMcp();
});

while (true) {
  const raw = (await rl.question(`\n${AGENT_NAME} (${current.id})> `)).trim();
  if (!raw) continue;
  const input = mapNumAlias(raw); // "/5" -> "/model"

  const lower = input.toLowerCase();
  if (lower === 'exit' || lower === 'quit') { await flush(); if (services) services.stopAll(); shutdownMcp(); break; }

  if (input.startsWith('/')) {
    try { await handleCmd(input); } catch (e) { console.error(`\n[Error] ${e.message}`); }
    continue;
  }

  // avalin payam-e session-e jadid -> title
  if (current && (!current.title || current.title.startsWith('Session '))) {
    current.title = input.slice(0, 48);
  }

  try {
    const res = await agent.say(input);
    await flush(); // payam-ha hamishe save mishan
    console.log(`\n${AGENT_NAME}> ${res.reply}`);
  } catch (e) {
    console.error(`\n[Error] ${e.message}`);
  }
}

rl.close();
console.log('Bye! (session-ha dar data/sessions.json save shod)');
