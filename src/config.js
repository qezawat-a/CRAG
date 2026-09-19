// config.js — port az CryptoMind-XT/config.py (JS)
// ------------------------------------------------------------
// AGENT-ONLY SETTINGS: tanzimat-e trading FAGHAT az tarigh-e agent
// avaz mishan (TUI / Telegram / trader_* tools) va dar store
// (data/trader-store.json ya DATABASE_URL) zakhire mishan.
// .env FAGHAT baraye secrets/infra-e:
//   XT_API_KEY / XT_API_SECRET / XT_FUTURES_HOST
//   TELEGRAM_BOT_TOKEN / TELEGRAM_USER_ID
//   AI_* / ANTHROPIC_* / GEMINI_* / DATABASE_URL / STORE_* / PORT ...
// Trade tuning (symbol, leverage, confidence, ...) dar .env
// KHANDE NEMISHE (ignored) — lotfan az /settings + /set estefade kon.
// LLM/agent config dar src/agent/config.js ast (AI_API_KEY, ...).

const env = (k, d = '') => (process.env[k] ?? d);
const envInt = (k, d) => { const n = parseInt(env(k, ''), 10); return Number.isFinite(n) ? n : d; };
const envBool = (k, d) => {
  const raw = String(env(k, '')).trim().toLowerCase();
  if (!raw) return d;
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

// --- Static trader defaults (SOURCE OF TRUTH = store, na .env) ---
// In meghdar-ha faghat baraye seed-e avvalin (store khali) hastand.
// Bad az seed, hame chiz az store mikhunim (memory.getSetting).
const STATIC_TRADER_DEFAULTS = {
  symbol: 'btc_usdt',
  leverage: 75,
  margin_mode: 'CROSSED',
  position_type: 'CROSSED',
  timeframes: '1m,3m,5m,15m',
  margin_amount_pct: 25,
  margin_risk_pct: 1,
  min_confidence: 80,
  tf_min_confidence: 70,
  min_agreeing_strategies: 2,
  signal_confirm_scans: 1,
  cooldown_minutes: 3,
  max_positions: 1,
  position_mode: 'margin',
  scan_interval_sec: 15,
  guard_interval_sec: 15,
  breakeven_threshold_pct: 15,
  trailing_stop_pct: 20,
  trailing_trigger_roi_pct: 20,
  trailing_distance_pct: 1,
  sl_liquidation_safety: 0.5,
  on_tpsl_failure: 'close',
  reversal_enabled: 'true',
  reversal_confidence: 85,
  reversal_scope: 'symbol',
  report_interval_sec: 300,
  mid_manage_interval_sec: 30,
};

// Env var-haye ghadimi-e trading ke ALAN IGNORE mishan (agent-only).
// Age user hanuz set karde, dar log hoshdar midim (vali ejra NEMISHAN).
const IGNORED_TRADE_ENV = [
  'XT_DEFAULT_SYMBOL', 'DEFAULT_SYMBOL',
  'DEFAULT_LEVERAGE', 'DEFAULT_MARGIN_MODE', 'DEFAULT_POSITION_TYPE',
  'XT_TIMEFRAMES', 'DEFAULT_TIMEFRAMES',
  'DEFAULT_MARGIN_AMOUNT_PCT', 'DEFAULT_RISK_PCT',
  'MIN_CONFIDENCE', 'TF_MIN_CONFIDENCE', 'MIN_AGREEING_STRATEGIES',
  'SIGNAL_CONFIRM_SCANS', 'SIGNAL_COOLDOWN_MINUTES', 'MAX_POSITIONS',
  'SCAN_INTERVAL_SEC', 'GUARD_INTERVAL_SEC', 'REPORT_INTERVAL_SEC',
  'BREAKEVEN_THRESHOLD_PCT', 'TRAILING_STOP_PCT',
  'TRAILING_TRIGGER_ROI_PCT', 'TRAILING_DISTANCE_PCT',
  'SL_LIQUIDATION_SAFETY', 'ON_TPSL_FAILURE',
  'REVERSAL_ENABLED', 'REVERSAL_CONFIDENCE',
];

const ALLOWED_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w'];

function desc(s) { return s; }

const TRADER_SETTING_DEFS = {
  symbol: { type: 'symbol', label: 'Trading symbol (mesal btc_usdt)', ...{ d: desc('symbol-e futures, lowercase + _usdt') } },
  leverage: { type: 'int', min: 1, max: 125, label: 'Leverage (1..125)' },
  margin_mode: { type: 'alias', label: 'Alias-e position_type (CROSSED/ISOLATED)' },
  position_type: { type: 'enum', values: ['CROSSED', 'ISOLATED'], label: 'Margin mode (CROSSED/ISOLATED)' },
  timeframes: { type: 'timeframes', label: 'Timeframes (comma, mesal 1m,3m,5m,15m)' },
  margin_amount_pct: { type: 'num', min: 1, max: 100, label: 'Margin % per trade (1..100)' },
  margin_risk_pct: { type: 'num', min: 0.1, max: 10, label: 'Risk % per trade (0.1..10)' },
  min_confidence: { type: 'int', min: 50, max: 100, label: 'Min confidence baraye open (50..100)' },
  tf_min_confidence: { type: 'int', min: 0, max: 100, label: 'Min confidence per timeframe (0..100)' },
  min_agreeing_strategies: { type: 'int', min: 1, max: 5, label: 'Chand strategy bayad movafegh bashan (1..5)' },
  signal_confirm_scans: { type: 'int', min: 1, max: 5, label: 'Tedad scan-e taeed (1..5)' },
  cooldown_minutes: { type: 'int', min: 0, max: 10, label: 'Cooldown bad az close (0..10 min)' },
  max_positions: { type: 'int', min: 1, max: 5, label: 'Max open positions (1..5)' },
  position_mode: { type: 'enum', values: ['margin', 'risk'], label: 'Sizing mode (margin/risk)' },
  scan_interval_sec: { type: 'int', min: 5, max: 3600, label: 'Scan interval sec (5..3600)' },
  guard_interval_sec: { type: 'int', min: 5, max: 3600, label: 'Guard interval sec (5..3600)' },
  breakeven_threshold_pct: { type: 'num', min: 1, max: 25, label: 'Breakeven trigger ROI% (1..25)' },
  trailing_stop_pct: { type: 'num', min: 0.1, max: 20, label: 'Legacy trailing % (0.1..20)' },
  trailing_trigger_roi_pct: { type: 'num', min: 1, max: 100, label: 'Trailing trigger ROI% (1..100)' },
  trailing_distance_pct: { type: 'num', min: 0.1, max: 20, label: 'Trailing distance % (0.1..20)' },
  sl_liquidation_safety: { type: 'num', min: 0.01, max: 1, label: 'SL liquidation safety (0.01..1)' },
  on_tpsl_failure: { type: 'enum', values: ['close', 'warn'], label: 'Age TP/SL gozashte nashod (close/warn)' },
  reversal_enabled: { type: 'bool', label: 'Reversal on/off (true/false ya 1/0)' },
  reversal_confidence: { type: 'int', min: 50, max: 100, label: 'Reversal min confidence (50..100)' },
  reversal_scope: { type: 'enum', values: ['symbol', 'all'], label: 'Reversal scope (symbol=same symbol only, all=any symbol)' },
  report_interval_sec: { type: 'int', min: 0, max: 3600, label: 'Report interval sec (0=off, ta 3600)' },
  mid_manage_interval_sec: { type: 'int', min: 15, max: 3600, label: 'Mid-manage interval sec (15..3600)' },
};

export const Config = {
  XT_API_KEY: env('XT_API_KEY'),
  XT_API_SECRET: env('XT_API_SECRET'),
  XT_FUTURES_HOST: env('XT_FUTURES_HOST', 'https://fapi.xt.com'),

  TELEGRAM_BOT_TOKEN: env('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_USER_ID: env('TELEGRAM_USER_ID'),

  // data/store (memory: DATABASE_URL -> Postgres/MySQL-e DAEMI, vagar-na file)
  DATA_DIR: env('DATA_DIR', 'data'),
  STORE_FILE: env('STORE_FILE', `${env('DATA_DIR', 'data')}/trader-store.json`),
  DATABASE_URL: env('DATABASE_URL'), // mesal (Neon): postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require
  STORE_ID: env('STORE_ID', 'default'), // chand bot ru yek DB-e moshtarak? in ro joda kon

  // --- trading defaults (STATIC — agent-only, .env ignore mishe) ---
  // Baraye backward-compat ba trader.js (fallback vaghti store khali-e),
  // in field-ha hanuz hastand vali STATIC hastand (az .env KHANDE NEMISHAN).
  DEFAULT_SYMBOL: STATIC_TRADER_DEFAULTS.symbol,
  DEFAULT_LEVERAGE: STATIC_TRADER_DEFAULTS.leverage,
  DEFAULT_MARGIN_MODE: STATIC_TRADER_DEFAULTS.margin_mode,
  DEFAULT_POSITION_TYPE: STATIC_TRADER_DEFAULTS.position_type,
  DEFAULT_TIMEFRAMES: String(STATIC_TRADER_DEFAULTS.timeframes).split(',').map((x) => x.trim()).filter(Boolean),
  DEFAULT_MARGIN_AMOUNT_PCT: STATIC_TRADER_DEFAULTS.margin_amount_pct,
  DEFAULT_RISK_PCT: STATIC_TRADER_DEFAULTS.margin_risk_pct,
  SIGNAL_COOLDOWN_MINUTES: STATIC_TRADER_DEFAULTS.cooldown_minutes,
  MAX_POSITIONS: STATIC_TRADER_DEFAULTS.max_positions,
  MIN_CONFIDENCE: STATIC_TRADER_DEFAULTS.min_confidence,

  TF_MIN_CONFIDENCE: STATIC_TRADER_DEFAULTS.tf_min_confidence,
  MIN_AGREEING_STRATEGIES: STATIC_TRADER_DEFAULTS.min_agreeing_strategies,
  SIGNAL_CONFIRM_SCANS: STATIC_TRADER_DEFAULTS.signal_confirm_scans,

  SCAN_INTERVAL_SEC: STATIC_TRADER_DEFAULTS.scan_interval_sec,
  GUARD_INTERVAL_SEC: STATIC_TRADER_DEFAULTS.guard_interval_sec,
  REPORT_INTERVAL_SEC: STATIC_TRADER_DEFAULTS.report_interval_sec,

  // ROI-on-margin thresholds for stop management (see README)
  BREAKEVEN_THRESHOLD_PCT: STATIC_TRADER_DEFAULTS.breakeven_threshold_pct,
  TRAILING_STOP_PCT: STATIC_TRADER_DEFAULTS.trailing_stop_pct, // legacy knob
  TRAILING_TRIGGER_ROI_PCT: STATIC_TRADER_DEFAULTS.trailing_trigger_roi_pct,
  TRAILING_DISTANCE_PCT: STATIC_TRADER_DEFAULTS.trailing_distance_pct,
  SL_LIQUIDATION_SAFETY: STATIC_TRADER_DEFAULTS.sl_liquidation_safety,
  ON_TPSL_FAILURE: STATIC_TRADER_DEFAULTS.on_tpsl_failure, // close | warn

  // Reversal: close an open position when a strong opposite signal appears
  REVERSAL_ENABLED: true,
  REVERSAL_CONFIDENCE: STATIC_TRADER_DEFAULTS.reversal_confidence,

  // Agent behaviour (merged with xt-agent loop: maxRounds)
  AGENT_MAX_STEPS: envInt('AGENT_MAX_STEPS', 8),
  AGENT_AUTONOMOUS_INTERVAL_SEC: envInt('AGENT_AUTONOMOUS_INTERVAL_SEC', 60),
  AGENT_DRY_RUN: envBool('AGENT_DRY_RUN', false),

  XT_DRY_RUN: envBool('XT_DRY_RUN', false),

  // Keys that are legacy and should never be shown/used again
  LEGACY_SETTINGS: ['max_loss_pct', 'max_profit_pct'],
  SETTING_ALIASES: { margin_mode: 'position_type' },
  TRADER_SETTING_DEFS,
  IGNORED_TRADE_ENV,
  STATIC_DEFAULTS: STATIC_TRADER_DEFAULTS,
};

Config.validate = function () {
  const missing = [];
  if (!this.XT_API_KEY || !this.XT_API_SECRET) missing.push('XT_API_KEY / XT_API_SECRET');
  if (!this.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!this.TELEGRAM_USER_ID) missing.push('TELEGRAM_USER_ID');
  if (this.TELEGRAM_USER_ID && !/^\d+$/.test(this.TELEGRAM_USER_ID.trim())) {
    missing.push('TELEGRAM_USER_ID (must be a numeric Telegram user id)');
  }
  // Trade tuning dige az .env khande NEMISHE — pas validation-e trade
  // az static defaults (hamishe valid) + validateSetting() dar store.
  return missing;
};

Config.defaultSettings = function () {
  // STATIC copy — hich env khande NEMISHE (agent-only).
  return { ...STATIC_TRADER_DEFAULTS };
};

// normalize key: alias + lowercase (margin_mode -> position_type)
Config.normalizeSettingKey = function (key) {
  const k = String(key || '').trim().toLowerCase();
  if (!k) return k;
  if (this.SETTING_ALIASES && this.SETTING_ALIASES[k]) return this.SETTING_ALIASES[k];
  return k;
};

Config.traderSettingKeys = function () {
  return Object.keys(TRADER_SETTING_DEFS);
};

Config.isTraderSetting = function (key) {
  const k = this.normalizeSettingKey(key);
  if (this.LEGACY_SETTINGS.includes(k)) return false;
  return Object.prototype.hasOwnProperty.call(TRADER_SETTING_DEFS, k);
};

// validate + normalize value. Return {ok, normalized, error, key}
Config.validateSetting = function (rawKey, rawValue) {
  const origKey = String(rawKey || '').trim();
  const k = this.normalizeSettingKey(origKey);
  if (!k) return { ok: false, key: k, error: 'key khali-e' };
  if (this.LEGACY_SETTINGS.includes(k) || this.LEGACY_SETTINGS.includes(origKey.toLowerCase())) {
    return { ok: false, key: k, error: `'${origKey}' legacy-e va dige estefade NEMISHE (hazf shode).` };
  }
  const def = TRADER_SETTING_DEFS[k];
  if (!def) {
    return { ok: false, key: k, error: `unknown setting '${origKey}'. Valid keys: ${Object.keys(TRADER_SETTING_DEFS).join(', ')}` };
  }
  const vStr = String(rawValue ?? '').trim();
  if (!vStr && vStr !== '0') return { ok: false, key: k, error: `'${k}' value khali-e` };

  const rangeErr = (label, min, max) => `'${k}' bayad ${min}..${max} bashe (dadi: ${vStr})`;
  switch (def.type) {
    case 'alias': {
      // margin_mode -> position_type
      return this.validateSetting('position_type', vStr);
    }
    case 'symbol': {
      const s = vStr.toLowerCase();
      if (!/^[a-z0-9]+_usdt$/.test(s)) return { ok: false, key: k, error: `'${k}' bayad mesl-e btc_usdt bashe (lowercase + _usdt). Dadi: ${vStr}` };
      return { ok: true, key: k, normalized: s };
    }
    case 'int': {
      const n = parseInt(vStr, 10);
      if (!Number.isFinite(n)) return { ok: false, key: k, error: `'${k}' bayad adad-e sahih bashe. Dadi: ${vStr}` };
      if (n < def.min || n > def.max) return { ok: false, key: k, error: rangeErr(k, def.min, def.max) };
      return { ok: true, key: k, normalized: String(n) };
    }
    case 'num': {
      const n = parseFloat(vStr);
      if (!Number.isFinite(n)) return { ok: false, key: k, error: `'${k}' bayad adad bashe. Dadi: ${vStr}` };
      if (n < def.min || n > def.max) return { ok: false, key: k, error: rangeErr(k, def.min, def.max) };
      return { ok: true, key: k, normalized: String(n) };
    }
    case 'enum': {
      const up = vStr.toUpperCase();
      const low = vStr.toLowerCase();
      // position_type: CROSSED/ISOLATED (CROSS -> CROSSED)
      if (k === 'position_type') {
        let norm = up === 'CROSS' ? 'CROSSED' : up;
        if (!def.values.includes(norm)) return { ok: false, key: k, error: `'${k}' bayad yeki az ${def.values.join('/')} bashe. Dadi: ${vStr}` };
        return { ok: true, key: k, normalized: norm };
      }
      // position_mode + on_tpsl_failure are lowercase enums
      if (def.values.includes(low)) return { ok: true, key: k, normalized: low };
      if (def.values.includes(up)) return { ok: true, key: k, normalized: up };
      return { ok: false, key: k, error: `'${k}' bayad yeki az ${def.values.join('/')} bashe. Dadi: ${vStr}` };
    }
    case 'bool': {
      const l = vStr.toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(l)) return { ok: true, key: k, normalized: 'true' };
      if (['0', 'false', 'no', 'off'].includes(l)) return { ok: true, key: k, normalized: 'false' };
      return { ok: false, key: k, error: `'${k}' bayad true/false (ya 1/0) bashe. Dadi: ${vStr}` };
    }
    case 'timeframes': {
      const parts = vStr.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (!parts.length) return { ok: false, key: k, error: `'${k}' khali-e. Mesal: 1m,3m,5m,15m` };
      for (const tf of parts) {
        if (!ALLOWED_TIMEFRAMES.includes(tf)) return { ok: false, key: k, error: `'${k}': timeframe '${tf}' namotabar-e. Mojaz: ${ALLOWED_TIMEFRAMES.join(', ')}` };
      }
      return { ok: true, key: k, normalized: parts.join(',') };
    }
    default:
      return { ok: true, key: k, normalized: vStr };
  }
};

// Age user hanuz trade env set karde, list kon ta hoshdar bedim (ignored).
Config.ignoredTradeEnvSet = function () {
  return IGNORED_TRADE_ENV.filter((n) => process.env[n] !== undefined && process.env[n] !== '');
};

let _warnedLegacyEnv = false;
Config.warnIfLegacyTradeEnv = function (log = console.log) {
  if (_warnedLegacyEnv) return [];
  _warnedLegacyEnv = true;
  const set = this.ignoredTradeEnvSet();
  if (set.length) {
    log(`[config] HOSHDAR: ${set.length} trade env IGNORE mishan (agent-only): ${set.join(', ')}. Tanzimat FAGHAT az /settings + /set (store).`);
  }
  return set;
};

export function xtClientConfig() {
  return {
    host: Config.XT_FUTURES_HOST,
    accessKey: Config.XT_API_KEY,
    secretKey: Config.XT_API_SECRET,
  };
}
