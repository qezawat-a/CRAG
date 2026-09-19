// auto-model.js — entekhab-e model-e "vaghei-usable" (CryptoMind-XT port + rewrite)
// ---------------------------------------------------------------------------
//   1. listProviderModels() : az server list-e model-ha ro migir (GET /models)
//   2. rankModels()         : tartib: free (:free) -> arzoon -> baghi (family pref)
//   3. fallbackCandidates() : age /models nist/khali bud — list-e amade-ye
//                             motenavvo (OpenRouter-id-ha ham dakhel-e)
//   4. isBalanceError()     : "model baraye in account nist" -> model-e badi
//   5. shouldAdvanceModel() : balance YA model-not-found (404/...) -> badi
//   6. load/saveModelCache(): entekhab-e model dar data/model-cache.json mimune
//                             ta har restart dobare probe nashe (surat!).
// Probe-e vaghei (call-e kuchik be har model) tu brain.js ast — chon
// format-e request-haye har provider hamunja sakhte mishe.

import { stripVersion, geminiOpenAiBaseUrl } from './config.js';
import fs from 'node:fs';
import path from 'node:path';

// Fallback-e akhar (agar hich candidate-i javab nadad):
export const FALLBACK_MODEL = 'gpt-4o';

// List-e amade baraye vaghti ke /models khali/khata dad — tanavvo-ye family-ha.
// OpenRouter-id-ha (ba prefix) ham dakhel-e chon ID-hashun prefix-dar hastan.
export const DEFAULT_CANDIDATES = [
  'gpt-4o-mini',
  'gpt-4o',
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'deepseek/deepseek-chat',
  'deepseek-chat',
  'anthropic/claude-3.5-haiku',
  'google/gemini-2.0-flash-001',
  'google/gemini-flash-1.5',
  'meta-llama/llama-3.3-70b-instruct',
  'qwen/qwen-2.5-72b-instruct',
  'mistralai/mistral-small-24b-instruct-2501',
  'claude-3-5-haiku-20241022',
  'gemini-2.0-flash',
];

// Family-haye model ke tarjih midim (best-first):
export const PREFERRED_FAMILIES = [
  'gpt-4o', 'gpt-4.1', 'gpt-4', 'o1', 'o3', 'claude',
  'llama-3.1', 'llama-3', 'llama-4', 'mistral', 'mixtral',
  'gemma', 'deepseek-chat', 'deepseek', 'qwen', 'gemini', 'yi-',
];

// Marker-haye model-haye GHEYR-e chat (embedding/audio/...).
export const NON_CHAT_MARKERS = [
  'embed', 'whisper', 'tts', 'audio', 'dall', 'image',
  'moderation', 'rerank', 're-rank', 'realtime', 'omni',
  'ft:', 'fine-tune', 'guard', 'vl-',
];

// Marker-haye model-haye kuchiktar/arzoon-tar — ba'd az free-ha:
export const CHEAP_MARKERS = [
  'flash', 'mini', 'lite', 'nano', 'small', 'distil',
  '-8b', '-7b', '-4b', '-3b', '-2b', '-1b', '-0.5b',
];

// ------------------------------------------------------------
// 0) persistent cache — entekhab-e model beyne restart-ha mimune
// ------------------------------------------------------------
const CACHE_FILE = path.resolve('data', 'model-cache.json');

export function loadModelCache(key) {
  try {
    const all = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const entry = all[key];
    if (entry && entry.chosen) return entry;
  } catch {}
  return null;
}

export function saveModelCache(key, entry) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    let all = {};
    try { all = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}
    all[key] = { ...entry, at: Date.now() };
    const tmp = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
    fs.renameSync(tmp, CACHE_FILE);
  } catch {}
}

export function clearModelCache() {
  try { fs.rmSync(CACHE_FILE, { force: true }); } catch {}
}

// ------------------------------------------------------------
// 1) listProviderModels(): GET /models (ba cache — har provider
//    faghat YEK BAR server ro seda mizane).
//    item 15 (autoRefreshModels): age `ttlMs` bedeim, cache ba'd
//    az ttl **dobare** az server list migire. ttlMs=0/khali =
//    cache-e bi-payan (raftar-e ghabl).
// ------------------------------------------------------------
const _listCache = new Map(); // key: "name|baseUrl" => { ids, at }

export async function listProviderModels(provider, { ttlMs = 0 } = {}) {
  const key = `${provider.name}|${provider.baseUrl}`;
  const prev = _listCache.get(key);
  if (prev && !(ttlMs > 0 && Date.now() - prev.at > ttlMs)) return prev.ids;

  try {
    let modelsUrl;
    if (provider.name === 'anthropic') modelsUrl = `${stripVersion(provider.baseUrl)}/v1/models`;
    else if (provider.name === 'google') modelsUrl = `${geminiOpenAiBaseUrl(provider.baseUrl)}/models`;
    else modelsUrl = `${provider.baseUrl}/models`; // OpenAI-compatible-ha

    const headers = { 'Content-Type': 'application/json' };
    if (provider.name === 'anthropic') {
      headers['x-api-key'] = provider.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers.Authorization = `Bearer ${provider.apiKey}`;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(modelsUrl, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) { _listCache.set(key, { ids: [], at: Date.now() }); return prev ? prev.ids : []; }

    const data = await res.json().catch(() => ({}));
    const ids = (data.data || []).map(m => m.id).filter(Boolean);
    _listCache.set(key, { ids, at: Date.now() });
    return ids;
  } catch {
    // refresh shekast khord — age list-e ghadim dashtim, hamon ro
    // bargardun (bi-gham-tar az hichi) vagar-na khali.
    if (prev) return prev.ids;
    _listCache.set(key, { ids: [], at: Date.now() });
    return [];
  }
}

// ------------------------------------------------------------
// 2) rankModels(): model-haye chat ro best-first tartib midim:
//    free-tier (:free) -> arzoon (flash/mini/lite/...) -> baghi,
//    har dast az beyn family-haye PREFERRED_FAMILIES (tartib-e ma).
//    Dar zamān-e request, age model-e ghabli bedun-e etebar bud
//    (402), mire soragh-e model-e badi — ta akharan rooye yeki ke
//    account mitune pool-esh ro bede.
// ------------------------------------------------------------
function byFamily(models) {
  const famIndex = (mid) => {
    const low = mid.toLowerCase();
    for (let i = 0; i < PREFERRED_FAMILIES.length; i++) {
      if (low.includes(PREFERRED_FAMILIES[i])) return i;
    }
    return PREFERRED_FAMILIES.length;
  };
  return [...models].sort((a, b) => famIndex(a) - famIndex(b));
}

export function rankModels(ids) {
  const chatModels = ids.filter(id =>
    !NON_CHAT_MARKERS.some(m => id.toLowerCase().includes(m))
  );
  const pool = chatModels.length ? chatModels : ids;
  const poolLower = pool.map(id => id.toLowerCase());

  const isFree = low => low.endsWith(':free');
  const isCheap = low => !isFree(low) && CHEAP_MARKERS.some(m => low.includes(m));

  const free  = pool.filter((_, i) => isFree(poolLower[i]));
  const cheap = pool.filter((_, i) => isCheap(poolLower[i]));
  const rest  = pool.filter((_, i) => !isFree(poolLower[i]) && !isCheap(poolLower[i]));

  return [...byFamily(free), ...byFamily(cheap), ...byFamily(rest)];
}

// ------------------------------------------------------------
// 3) isBalanceError(): aya in error yani "in model baraye in
//    account ghabele estefade nist" (bayad model avaz she)?
//    429 (rate-limit) bala-NIST va hargez model ro avaz NAKON.
// ------------------------------------------------------------
export function isBalanceError(status, text) {
  const low = String(text || '').toLowerCase();
  return (
    status === 402 ||
    low.includes('insufficient_quota') ||
    low.includes('insufficient_balance') ||
    low.includes('balance is positive') ||
    low.includes('not enough') ||
    low.includes('payment required') ||
    low.includes('exceeded your current quota') ||
    low.includes('add credits') ||
    low.includes('credits required') ||
    low.includes('usage_limit_exceeded')
  );
}

// ------------------------------------------------------------
// 4) shouldAdvanceModel(): dar hale auto, in error yani "in model ro
//    rad kon va model-e badi ro try kon":
//    - balance errors (402, quota, ...)
//    - model-not-found (404, "no such model", "model_not_found", ...)
//    429 (rate-limit) bala-NIST — model ro avaz NAKON.
// ------------------------------------------------------------
export function shouldAdvanceModel(status, text) {
  if (isBalanceError(status, text)) return true;
  if (status === 404) return true;
  const low = String(text || '').toLowerCase();
  return (
    low.includes('model_not_found') ||
    low.includes('no such model') ||
    low.includes('not a valid model') ||
    low.includes('unknown model') ||
    low.includes('model does not exist') ||
    low.includes('invalid model') ||
    low.includes('no endpoints found') || // OpenRouter: model-e bi-endpoint/disable
    low.includes('is not available') ||
    low.includes('unsupported model')
  );
}

// ------------------------------------------------------------
// 5) fallbackCandidates(): age /models khali/khata bud, az in list
//    probe kon (ja-ye FALLBACK_MODEL-e yektai — 'gpt-4o' rooye
//    OpenRouter aslan vojood nadare, ID-hash prefix-dar-e).
// ------------------------------------------------------------
export function fallbackCandidates(provider) {
  const base = String(provider?.baseUrl || '').toLowerCase();
  // OpenRouter: faghat id-haye prefix-dar + free-haye mo'tabar
  if (base.includes('openrouter')) {
    return [
      'openai/gpt-4o-mini',
      'openai/gpt-4o',
      'google/gemini-2.0-flash-001',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek/deepseek-chat',
      'qwen/qwen-2.5-72b-instruct',
      'mistralai/mistral-small-24b-instruct-2501',
      'google/gemini-flash-1.5',
    ];
  }
  // Google OpenAI-compat: model-haye gemini
  if (provider?.name === 'google' || base.includes('generativelanguage')) {
    return ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash-8b', ...DEFAULT_CANDIDATES];
  }
  return [...DEFAULT_CANDIDATES];
}
