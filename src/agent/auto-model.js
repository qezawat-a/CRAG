// auto-model.js — entekhab-e model-e "vaghei-usable" (port az CryptoMind-XT)
// ---------------------------------------------------------------------------
// Mantegh-e hamin file tu CryptoMind-XT (bot/ai_chat.py) hast va ja bord-e
// JS-e hamun-e:
//   1. listProviderModels() : az server list-e model-ha ro migir (GET /models)
//   2. rankModels()         : tartib midim: free (:free) -> arzoon -> baghi,
//                             har dastiye be tartib-e family-haye mored-e tarjih
//   3. isBalanceError()     : aya in error yani "model-e ghabele estefade nist
//                             baraye in account" (402 / insufficient_quota / ...)
// Probe-e vaghei (ye call-e kuchik be har model) tu brain.js ast — chon
// format-e request-haye har provider hamunja sākhte mishe.

import { stripVersion, geminiOpenAiBaseUrl } from './config.js';

// Fallback vaghti /models vojood nadare (mesl-e CryptoMind-XT):
export const FALLBACK_MODEL = 'gpt-4o';

// Family-haye model ke tarjih midim (best-first):
export const PREFERRED_FAMILIES = [
  'gpt-4o', 'gpt-4.1', 'gpt-4', 'o1', 'o3', 'claude',
  'llama-3.1', 'llama-3', 'llama-4', 'mistral', 'mixtral',
  'gemma', 'deepseek-chat', 'deepseek', 'qwen', 'gemini', 'yi-',
];

// Marker-haye model-haye GHEYR-e chat (embedding/audio/...).
// NOTE: "instruct" va "vision" ro NAGIR — ina hamun chat model-hastan!
export const NON_CHAT_MARKERS = [
  'embed', 'whisper', 'tts', 'audio', 'dall', 'image',
  'moderation', 'rerank', 're-rank', 'realtime', 'omni',
  'ft:', 'fine-tune',
];

// Marker-haye model-haye kuchiktar/arzoon-tar — ba'd az free-ha:
export const CHEAP_MARKERS = [
  'flash', 'mini', 'lite', 'nano', 'small', 'distil',
  '-8b', '-7b', '-4b', '-3b', '-2b', '-1b', '-0.5b',
];

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