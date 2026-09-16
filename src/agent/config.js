// config.js — tak meydan-e tanzimat-e agent
// ------------------------------------------------
// Har file-e dige (brain, auto-model) inja ro import
// mikone ta hame ye tanzimat-e yekparche dashte bashan.
// "dotenv/config" dar aval: key-haye .env ro dar
// process.env mizare — pas hich ja dige .env nemikhune.
import 'dotenv/config';

// Tartib-e avalavali baraye hale "auto":
const PRIORITY = ['openai', 'anthropic', 'google'];

// Har provider key-ash kodum variable-e .env hast:
const KEY_VAR = {
  openai:    'AI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google:    'GEMINI_API_KEY',
};

// Har provider model-ash az kodum variable-e .env khoonde mishe:
const MODEL_VAR = {
  openai:    'AI_MODEL',
  anthropic: 'ANTHROPIC_MODEL',
  google:    'GEMINI_MODEL',
};

// ------------------------------------------------------------
// detectProviders(): hameye provider-haye "dar dastres" ro
// bargardune (sync — hich kar-e shabake-i nemikone).
// Qaede-ye asli: HICH JA HADS NEMIZANIM.
// - agar dar .env model DASHTI (mesal AI_MODEL=deepseek-chat)
//   -> hamin model estefade mishe (garantee, bi-probe)
// - agar "auto" bod (ya khali) -> model = null va brain.js az
//   auto-model.js miporse: list az SERVER + probe-e vaghei.
// ------------------------------------------------------------
export function detectProviders() {
  const list = [];
  for (const name of PRIORITY) {
    const apiKey = process.env[KEY_VAR[name]];
    if (!apiKey) continue; // key nist -> in provider ro rad kon

    const provider = { name, apiKey, model: null };

    if (name === 'openai') {
      provider.baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    }
    if (name === 'anthropic') {
      provider.baseUrl = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
    }
    if (name === 'google') {
      provider.baseUrl = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1').replace(/\/$/, '');
    }

    const envModel = process.env[MODEL_VAR[name]];
    if (envModel && envModel !== 'auto') provider.model = envModel;
    // dar gheyr-e in surat model null mimune -> auto-model (probe)

    list.push(provider);
  }
  return list;
}

// ------------------------------------------------------------
// Helper-haye URL
// ------------------------------------------------------------
export function stripVersion(baseUrl) {
  return baseUrl.replace(/\/v\d+(beta)?$/, ''); // /v1 ya /v1beta ro hazf kon
}

// Gemini ye rah-e "OpenAI-compatible" ham darad:
// GEMINI_BASE_URL mishe .../v1beta/openai
export function geminiOpenAiBaseUrl(baseUrl) {
  const b = baseUrl.replace(/\/+$/, '');
  if (b.endsWith('/openai')) return b; // user khodesh dade
  const root = stripVersion(b);
  return `${root}/v1beta/openai`;
}

// ------------------------------------------------------------
// Provider-e asli baraye test/debug (model hanooz null hast —
// resolve-e asli tu brain.js/auto-model.js ejra mishe)
// ------------------------------------------------------------
export function primaryProvider() {
  const list = detectProviders();
  if (list.length === 0) {
    throw new Error(
      'HICH provideri tanzim nashode! Ye API key dar .env bezar:\n' +
      '  - AI_API_KEY (OpenAI/DeepSeek/Groq/...) ya\n' +
      '  - ANTHROPIC_API_KEY (Claude) ya\n' +
      '  - GEMINI_API_KEY (Gemini)\n' +
      'ya baraye test-e mahali: Ollama (AI_BASE_URL=http://localhost:11434/v1)'
    );
  }
  return list[0];
}

// ------------------------------------------------------------
// Tanzimat-e XT Futures — client-e asli-e in proje (src/xt/client.js)
// .env variable-ha:
//   XT_API_KEY / XT_API_SECRET / XT_FUTURES_HOST
//   XT_DEFAULT_SYMBOL / XT_TIMEFRAMES / XT_DRY_RUN
//   XT_SIGN_PREFIX / XT_SIGN_BODY (override-e signing, default khub-e)
// ------------------------------------------------------------
export function xtConfig() {
  return {
    apiKey:  process.env.XT_API_KEY  || '',
    secret:  process.env.XT_API_SECRET || process.env.XT_SECRET_KEY || '',
    baseUrl: (process.env.XT_FUTURES_HOST || process.env.XT_BASE_URL || 'https://fapi.xt.com').replace(/\/$/, ''),
    defaultSymbol: process.env.XT_DEFAULT_SYMBOL || 'btc_usdt',
    timeframes: String(process.env.XT_TIMEFRAMES || '1m,3m,5m,15m').split(',').map((x) => x.trim()).filter(Boolean),
    dryRun: ['1', 'true', 'yes', 'on'].includes(String(process.env.XT_DRY_RUN || '').toLowerCase()),
  };
}

