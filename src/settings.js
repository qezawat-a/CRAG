// settings.js — meydan-e markazi-e tanzimat-e agent "J-Rock"
// ------------------------------------------------------------
// Hameye option-ha (18 gune) inja yek DEFAULTS daran. User mitune
// ye file-e settings.json kenar-e package.json besazad va faghat
// chiz-hayi ke mikhād ro override kone (ba hamin KEY-ha).
//
// Tarz-e estefade dar dige file-ha:
//   import { getSettings, setSetting } from './settings.js';
//   const s = getSettings();          // object-e yekparche (cache)
//   s.model.autoRefreshModels         // true/false
//   s.thinking.level                  // 'low'|'mid'|'high'|'xhigh'|'max'
//
// setSetting('session.autoCompact', true)   -> meghdar ro tu settings.json
//   hamishe negah midare va cache ro update mikone (baraye dastur-haye
//   TUI mesl-e /style /thinking /settings).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  // ---- Identity (item 3) ----
  identity: {
    agentName: 'J-Rock',          // name-e agent (UI/session-ha neshoon midan)
    soulFile: 'soul/SOUL.md',     // shakhsiyat-e agent (item 3) — file-e markdown
  },

  // ---- Style (item: style/options) ----
  style: {
    enabled: true,                // STYLE.md ro be system prompt ezafe kon
    file: 'soul/STYLE.md',        // sabk-e goftogu — user mitune editesh kone
  },

  // ---- Session (item 1, 16, 17) ----
  session: {
    resumeLast: false,            // dar start, akharin session ro edame bede (item 1)
    autoCompact: false,           // session-e tool shode ro khodkar compact kon (item 16)
    compactAfterRounds: 40,       // ba'd az chand round tool-calling compact beshe
    maxSessions: 20,              // chand session-e ghadimi negah dashte shim
  },

  // ---- Model / Providers (item 5, 6, 15) ----
  model: {
    autoRefreshModels: false,     // list-e model-ha ro har session dobare az server begir (item 15)
    cacheTtlMs: 600000,           // 10 min — agar autoRefreshModels=true
    fallbackModel: 'gpt-4o',      // vaghti /models nist
  },
  providers: {
    priority: ['openai', 'anthropic', 'google'], // tartib-e try (item 6)
  },

  // ---- Thinking (item 10) ----
  thinking: {
    level: 'mid',                 // 'low' | 'mid' | 'high' | 'xhigh' | 'max'
  },

  // ---- Tools / MCP / XT (item 4, 14) ----
  tools: {
    enabled: true,                // tool-calling roshan (item 14)
    toolTimeoutMs: 20000,         // had-e zaman-e ejra-ye har tool
  },
  xt: {
    enabled: true,                // 25 tool-e XT USDT-M Futures (futures-tools.js)
    dryRun: true,                 // default amn: order/tpsl/close preview (ejra nemishe)
  },
  mcp: {
    enabled: false,               // support-e MCP server-ha (item 4)
    servers: {},                  // mesal: { "xt": { "url": "..." } }
  },

  // ---- Skills / Soul / Dream (item 2, 3, 9) ----
  skills: {
    enabled: true,                // load-e skill az skills/ (item 2)
    dir: 'skills',                // har skill = ye .md ya folder ba SKILL.md
    exclude: [],                  // id-hayi ke tu prompt nayand
  },
  dream: {
    enabled: false,               // "Dream": deep-research ruye memory/session-ha
    outputFile: 'data/dream.md',  // natije -> ye memory-e jadid baraye upgrade-e khod
  },

  // ---- Harness / Gateway / Serve (item 8=11, 12, 13) ----
  harness: {
    enabled: false,               // hale "harness": agent UI-e host ro control kone
  },
  gateway: {
    enabled: false,               // connect be messenger (Telegram) (item 12)
    messenger: 'telegram',        // 'telegram' (faghat telegram)
    token: '',                    // bot token (ya env TELEGRAM_BOT_TOKEN)
    userId: '',                   // numeric Telegram user ID (ya env TELEGRAM_USER_ID) — allowlist
  },
  serve: {
    enabled: false,               // HTTP API-e mahali (item 13)
    port: 8787,
  },

  // ---- Agents (item 18) ----
  agents: {
    enabled: false,               // plan/build-e agent-haye fori (sub-agent)
    maxWorkers: 2,
  },
};

const SETTINGS_FILE = path.resolve('settings.json');
let _user = null;    // override-haye user (settings.json)
let _cache = null;   // DEFAULTS + _user (merge shode)

// merge-e amigh (nested): value-haye user override-e default-ha mishan
function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function loadUser() {
  if (_user) return _user;
  _user = {};
  if (existsSync(SETTINGS_FILE)) {
    try {
      _user = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) || {};
    } catch (e) {
      console.warn(`[settings] settings.json kharab-e (${e.message}) — faghat default-ha estefade mishan.`);
    }
  }
  return _user;
}

export function getSettings() {
  if (_cache) return _cache;
  _cache = deepMerge(DEFAULTS, loadUser());
  return _cache;
}

// Baraye test/debug: hame chiz ro az avval bekhoon
export function reloadSettings() { _cache = null; _user = null; }

// ------------------------------------------------------------
// setSetting('a.b.c', value): meghdar ro tu override-haye user
// set karde va dar settings.json zakhirat mikone; cache-e jadid
// ro bargardune (hala s.thinking.level = ... hamishe inja be
// sorat-e daem taghir mikone — TUI az in estefade mikone).
// ------------------------------------------------------------
export function setSetting(pathStr, value) {
  const keys = String(pathStr).split('.').map(k => k.trim()).filter(Boolean);
  if (!keys.length) return getSettings();

  const user = loadUser();
  let cur = user;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (value === '__delete__') delete cur[last];
  else cur[last] = value;

  writeFileSync(SETTINGS_FILE, JSON.stringify(user, null, 2) + '\n');
  _cache = deepMerge(DEFAULTS, user);
  return _cache;
}
