// brain.js — seda zadan-e LLM (har 3 provider) + tool-calling
// ----------------------------------------------------------------
// In file faghat "telefon" hast: message-ha o tool-ha ro be API-e
// provider mifrestune o javab ro bargardune. "Hosh" tu loop.js-e.
//
// Format-e dakheli-e message-ha (canonical — mesl-e OpenAI):
//   { role: 'system'|'user'|'assistant'|'tool', content, tool_calls?, tool_call_id? }
// brain in format ro baraye har provider be format-e khodesh tabdil mikone.
//
// Entekhab-e model (auto): mantegh-e CryptoMind-XT — age AI_MODEL
// "auto"/khali bashe, model-ha az server list mishan, be tartib
// free->arzoon->baghi radef mishan va ba ye probe-e kuchik (tool-call)
// avalin modeli ke VAGHEAN javab mide entekhab mishe. Age tu kar
// 402 / insufficient_quota begirim, khodkar mire soragh-e badi.

import { detectProviders, geminiOpenAiBaseUrl } from './config.js';
import {
  listProviderModels, rankModels, isBalanceError, shouldAdvanceModel,
  fallbackCandidates, loadModelCache, saveModelCache, FALLBACK_MODEL,
} from './auto-model.js';
import { openaiReasoning, anthropicThinking } from './thinking.js';

const MAX_TOKENS = 2048;        // had-e toole javab (anthropic lazeme)
const TIMEOUT_MS  = 60000;      // har request max 60 sanie
const PROBE_TIMEOUT_MS = 12000; // probe-e model max 12 sanie (sari-tar)
const PROBE_MAX_MODELS = 10;    // hadaksar in-ta candidate probe mishe (ta daghight-ha tal Nash-e)

// ----------------------------------------------------------------
// item 15 — auto-refresh model-ha (TTL): az env mikhunim ta brain
// bedun-e vasl shodan be settings.js mostaghel bemune. TUI in
// variable-ha ro (ba /model refresh) tu .env + process.env set
// mikone — pas inja hamishe taze did-e mishe.
//   AI_AUTO_REFRESH=1|0        (autoRefreshModels)
//   AI_MODEL_TTL=<ms>          (cacheTtlMs — default 10 min)
// ----------------------------------------------------------------
function autoRefreshEnabled() {
  const v = String(process.env.AI_AUTO_REFRESH || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
function modelTtlMs() {
  const n = parseInt(process.env.AI_MODEL_TTL || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 600000;
}

// parse-e JSON-e amn: agar LLM JSON-e kharab bede, be jaye crash
// yek object-e khali bargardun (agent bara-ye in error naft-e nakhore)
function safeParse(str) {
  try { return JSON.parse(str); } catch { return {}; }
}

// ----------------------------------------------------------------
// 1) OPENAI-COMPATIBLE (OpenAI / DeepSeek / Ollama / Groq / ...)
// ----------------------------------------------------------------
function buildOpenAIReq(provider, { system, messages, tools, thinking }) {
  const body = { model: provider.model, messages: [] };
  if (system) body.messages.push({ role: 'system', content: system });
  body.messages.push(...messages);
  if (tools.length) {
    // tools dar format-e OpenAI: array-e { type:'function', function:{...} }
    body.tools = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  // item 10 — thinking: faghat baraye o-series/gpt-5 (vagarna null)
  if (thinking) {
    const rp = openaiReasoning(thinking.level, provider.model);
    if (rp) Object.assign(body, rp);
  }
  return {
    url: `${provider.baseUrl}/chat/completions`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
    body,
  };
}

function parseOpenAIResp(data) {
  const m = data?.choices?.[0]?.message;
  if (!m) return { content: null, toolCalls: [] };
  const toolCalls = (m.tool_calls || [])
    .filter(tc => tc.type === 'function')
    .map(tc => ({ id: tc.id, name: tc.function.name, args: safeParse(tc.function.arguments) }));
  return { content: m.content ?? null, toolCalls };
}

// ----------------------------------------------------------------
// 2) ANTHROPIC (Claude) — format-e messages-ash fargh dare
// ----------------------------------------------------------------
// Message-ha-ye ma ro be format-e Anthropic tabdil mikonim:
// - system az messages birun mikeshim (parameter-e joda)
// - tool-call-haye OpenAI => content block-e "tool_use"
// - natije-ye tool (role:'tool') => block-e "tool_result" tu ye
//   user message; chand natije-ye motevāli yeja jam mishan.
function toAnthropicMessages(messages) {
  const out = [];
  let pending = []; // tool_result block-haye montazer

  const flush = () => {
    if (!pending.length) return;
    const blocks = pending.map(r => ({
      type: 'tool_result',
      tool_use_id: r.tool_call_id,
      content: String(r.content),
    }));
    const last = out[out.length - 1];
    if (last && last.role === 'user') last.content.push(...blocks);
    else out.push({ role: 'user', content: blocks });
    pending = [];
  };

  for (const msg of messages) {
    if (msg.role === 'tool') { pending.push(msg); continue; }

    flush(); // tool_result-ha bayad ghablesh biad

    if (msg.role === 'assistant') {
      const content = [];
      if (msg.content) content.push({ type: 'text', text: String(msg.content) });
      for (const tc of msg.tool_calls || []) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: safeParse(tc.function.arguments) });
      }
      if (!content.length) continue; // assistant-e khali — andakhtan
      const last = out[out.length - 1];
      if (last && last.role === 'assistant') last.content.push(...content);
      else out.push({ role: 'assistant', content });
    }

    if (msg.role === 'user') {
      const last = out[out.length - 1];
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (last && last.role === 'user') last.content.push({ type: 'text', text });
      else out.push({ role: 'user', content: [{ type: 'text', text }] });
    }
  }
  flush();
  return out;
}

function buildAnthropicReq(provider, { system, messages, tools, thinking }) {
  const body = { model: provider.model, max_tokens: MAX_TOKENS };
  // item 10 — extended thinking (claude 3.7/4): budget max_tokens ro
  // ziād mikone; temperature/top_p hichkodum set nashodan (lazeme).
  if (thinking) {
    const tp = anthropicThinking(thinking.level, provider.model);
    if (tp) {
      body.thinking = tp.thinking;
      body.max_tokens = tp.budget + 4096; // max_tokens bayad > budget bashe
    }
  }
  if (system) body.system = system;
  const msgs = toAnthropicMessages(messages);
  if (!msgs.length) msgs.push({ role: 'user', content: [{ type: 'text', text: 'hello' }] });
  body.messages = msgs;
  if (tools.length) {
    body.tools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters, // dar Anthropic be in esm mirese
    }));
  }
  const base = stripVersionLocal(provider.baseUrl); // /v1 ro tekrar nazanim
  return {
    url: `${base}/v1/messages`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body,
  };
}

function stripVersionLocal(baseUrl) {
  return baseUrl.replace(/\/v\d+(beta)?$/, '');
}

function parseAnthropicResp(data) {
  const content = data?.content || [];
  const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const toolCalls = content
    .filter(b => b.type === 'tool_use')
    .map(b => ({ id: b.id, name: b.name, args: b.input || {} }));
  return { content: text || null, toolCalls };
}

// ----------------------------------------------------------------
// 3) AUTO MODEL (mantegh-e CryptoMind-XT)
// ----------------------------------------------------------------
const probeTool = {
  name: 'get_status',
  description: 'Return the current status.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
};

const _modelState = new Map(); // key: "name|baseUrl" => { source, candidates, index, chosen, at }

// Ye bar baraye har provider: list + rank + probe. Natije zakhir mishe.
// item 15: age AI_AUTO_REFRESH=1 bashe va cache-e ma kohne-tar az
// AI_MODEL_TTL bashad, khodkar refresh mishe (list + probe-e dobare).
async function ensureModelState(p) {
  const key = `${p.name}|${p.baseUrl}`;
  const refresh = autoRefreshEnabled();
  const ttl = modelTtlMs();

  const cached = _modelState.get(key);
  if (cached) {
    if (!refresh || Date.now() - cached.at < ttl) {
      p.model = cached.chosen;
      return cached;
    }
    _modelState.delete(key); // ttl gozasht — dobare list + probe (item 15)
  }

  // cache-e persisted (restart-haye ghabl) — bi-probe, faghat be-surat
  // az data/model-cache.json. Agar refresh TTL gozashte bashe dobare probe
  // mishe, vagar-na hamin mishe.
  if (!p.model) {
    const persisted = loadModelCache(key);
    if (persisted) {
      if (!refresh || Date.now() - (persisted.at || 0) < ttl) {
        const state = {
          source: 'cache', candidates: persisted.candidates || [persisted.chosen],
          index: persisted.index || 0, chosen: persisted.chosen, at: Date.now(),
        };
        _modelState.set(key, state);
        p.model = state.chosen;
        console.log(`[auto-model] ${p.name}: model az cache = '${state.chosen}' (data/model-cache.json)`);
        return state;
      }
    }
  }

  let state;
  if (p.model) {
    // user model ro DASTI tu .env gozashte — bi-probe, garantee:
    state = { source: 'explicit', candidates: [p.model], index: 0, chosen: p.model };
  } else {
    const ids = await listProviderModels(p, { ttlMs: refresh ? ttl : 0 });
    // /models khali/khata -> list-e amade (OpenRouter-id-ha, gemini-ha, ...)
    const ranked = ids.length ? rankModels(ids) : fallbackCandidates(p);
    const candidates = ranked.length ? ranked : [FALLBACK_MODEL];
    const probed = await probeModels(p, candidates); // avalin modeli ke VAGHEAN javab mide
    const chosen = probed || candidates[0]; // hichi nakard -> avalin candidate (fallback dar chat)
    state = {
      source: 'auto',
      candidates,
      index: candidates.indexOf(chosen) >= 0 ? candidates.indexOf(chosen) : 0,
      chosen,
    };
    console.log(`[auto-model] ${p.name}: model-e entekhab shode = '${chosen}' ` +
      `(az ${candidates.length} candidate, ${p.baseUrl}/models ${ids.length ? 'OK' : 'NIST -> fallback list'})`);
    if (chosen) saveModelCache(key, { chosen, candidates, index: state.index });
  }

  state.at = Date.now();
  _modelState.set(key, state);
  p.model = state.chosen;
  return state;
}

// Probe-e 2-marhalei baraye har provider:
//   Tier 1: tool-call probe — faghat modeli ke NATIVE tool_call bede ghabul
//           (behtarin baraye agent). Ta PROBE_MAX_MODELS candidate.
//   Tier 2: age hichkodum tool_call nadad, plain-text probe — avalin
//           modeli ke faghat JAVAB bede ghabul mishe (agent-abi bidun-e tool
//           az badtar nist... vali agar tool dashtim Tier1 barande-e).
//   Hich kodum: '' bargardun (chat() khodesh be fallback candidate miravad).
async function probeModels(p, candidates) {
  const cap = candidates.slice(0, PROBE_MAX_MODELS);

  // ---- Tier 1: native tool-call ----
  for (const mid of cap) {
    try {
      const provider = { ...p, model: mid };
      const req = p.name === 'anthropic'
        ? buildAnthropicReq(provider, { system: '', messages: [{ role: 'user', content: 'What is the bot status? Use the get_status function to check.' }], tools: [probeTool] })
        : buildOpenAIReq(provider, { system: '', messages: [{ role: 'user', content: 'What is the bot status? Use the get_status function to check.' }], tools: [probeTool] });

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) { console.log(`[auto-model] probe ${mid}: HTTP ${res.status} — rad`); continue; }
      const parsed = p.name === 'anthropic' ? parseAnthropicResp(data) : parseOpenAIResp(data);
      if (parsed.toolCalls.length) return mid; // tool_call-e native -> behtarin entekhab
      console.log(`[auto-model] probe ${mid}: javab dad vali tool_call nadasht — Tier 2 barresi mishe`);
    } catch (e) {
      console.log(`[auto-model] probe ${mid}: ${String(e.message || e).slice(0, 80)}`);
    }
  }

  // ---- Tier 2: plain-text probe (model-e "javab-dahande") ----
  for (const mid of cap) {
    try {
      const provider = { ...p, model: mid };
      const req = p.name === 'anthropic'
        ? buildAnthropicReq(provider, { system: '', messages: [{ role: 'user', content: 'ping' }], tools: [] })
        : buildOpenAIReq(provider, { system: '', messages: [{ role: 'user', content: 'ping' }], tools: [] });

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) continue;
      const data = await res.json().catch(() => ({}));
      const parsed = p.name === 'anthropic' ? parseAnthropicResp(data) : parseOpenAIResp(data);
      if (parsed.content && String(parsed.content).trim()) {
        console.log(`[auto-model] probe ${mid}: tool_call nadarad vali javab midahad (Tier 2 — ghabul shod)`);
        return mid;
      }
    } catch { /* candidate-e badi */ }
  }

  return ''; // hichi kar nakard (key/baseURL ghalat, ya account bedun-e etebar)
}

// ----------------------------------------------------------------
// 4) main chat(): try candidate-ha be tartib (fallback + balance)
// ----------------------------------------------------------------
export async function chat({ system = '', messages = [], tools = [], thinkingLevel = null }) {
  const candidates = detectProviders();
  if (candidates.length === 0) {
    throw new Error('HICH provideri tanzim nashode — ye API key dar .env bezar.');
  }

  const errors = [];
  // thinking (item 10): loop.js level-e ma ro mifreste; probe-ha bi-thinking
  const ctx = { system, messages, tools, thinking: thinkingLevel ? { level: thinkingLevel } : null };
  for (const p of candidates) {
    const st = await ensureModelState(p);
    p.model = st.chosen;

    // dar hale auto: agar model-e fe'li 402/quota bokhore, mire soragh-e
    // candidate-e badi (balance-aware fallback, mesl-e CryptoMind-XT).
    let attempts = 0;
    const maxAttempts = st.source === 'auto' ? st.candidates.length + 1 : 1;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        const req = buildRequest(p, ctx);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        let res;
        try {
          res = await fetch(req.url, {
            method: 'POST',
            headers: req.headers,
            body: JSON.stringify(req.body),
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        const data = await res.json().catch(() => ({}));
        const bodyText = JSON.stringify(data);
        if (!res.ok) {
          // in model-e account-e ma nist (bedun-e etebar) -> model-e badi
          if (isBalanceError(res.status, bodyText) && st.source === 'auto' && st.index + 1 < st.candidates.length) {
            const prev = st.chosen;
            st.index++;
            st.chosen = st.candidates[st.index];
            p.model = st.chosen;
            errors.push(`${p.name}: model '${prev}' baraye in account nist (HTTP ${res.status}) — raftam rooye '${st.chosen}'`);
            continue;
          }
          errors.push(`${p.name}: HTTP ${res.status} — ${bodyText.slice(0, 300)}`);
          break;
        }
        const parsed = parseResp(p, data);
        return { ...parsed, provider: p.name, model: p.model };
      } catch (e) {
        const msg = String(e.message || e);
        if (isBalanceError(0, msg) && st.source === 'auto' && st.index + 1 < st.candidates.length) {
          const prev = st.chosen;
          st.index++;
          st.chosen = st.candidates[st.index];
          p.model = st.chosen;
          errors.push(`${p.name}: model '${prev}' nist (${msg.slice(0, 120)}) — raftam rooye '${st.chosen}'`);
          continue;
        }
        errors.push(`${p.name}: ${msg}`);
        break;
      }
    }
  }

  throw new Error(
    'Hameye provider-ha shekast khordand (fallback tamoom shod):\n  - ' +
    errors.join('\n  - ') +
    '\n(Hint: hich model-i ba in key kar nakard — key/baseURL ro check kon, ya AI_MODEL ro dasti bezar.)'
  );
}

// baraye har provider: request va response-e khodesh
function buildRequest(p, ctx) {
  if (p.name === 'anthropic') return buildAnthropicReq(p, ctx);
  if (p.name === 'google') {
    return buildOpenAIReq(
      { ...p, baseUrl: geminiOpenAiBaseUrl(p.baseUrl) },
      ctx
    ); // URL hala .../v1beta/openai/chat/completions-e
  }
  return buildOpenAIReq(p, ctx);
}

function parseResp(p, data) {
  if (p.name === 'anthropic') return parseAnthropicResp(data);
  return parseOpenAIResp(data); // openai + google (hame openai-compatible)
}
