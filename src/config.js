// config.js — port az CryptoMind-XT/config.py (JS)
// ------------------------------------------------------------
// Tamame tanzimat-e trading (futures) inja ast. Env variables:
//   XT_API_KEY / XT_API_SECRET / XT_FUTURES_HOST / XT_DEFAULT_SYMBOL
//   TELEGRAM_BOT_TOKEN / TELEGRAM_USER_ID
//   SCAN_INTERVAL_SEC / GUARD_INTERVAL_SEC / REPORT_INTERVAL_SEC ...
// LLM/agent config dar src/agent/config.js ast (AI_API_KEY, ...).

const env = (k, d = '') => (process.env[k] ?? d);
const envInt = (k, d) => { const n = parseInt(env(k, ''), 10); return Number.isFinite(n) ? n : d; };
const envNum = (k, d) => { const n = parseFloat(env(k, '')); return Number.isFinite(n) ? n : d; };
const envBool = (k, d) => {
  const raw = String(env(k, '')).trim().toLowerCase();
  if (!raw) return d;
  return ['1', 'true', 'yes', 'on'].includes(raw);
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

  // --- trading defaults (tuned with user) ---
  DEFAULT_SYMBOL: env('XT_DEFAULT_SYMBOL', env('DEFAULT_SYMBOL', 'btc_usdt')),
  DEFAULT_LEVERAGE: envInt('DEFAULT_LEVERAGE', 75),
  DEFAULT_MARGIN_MODE: env('DEFAULT_MARGIN_MODE', 'CROSSED'), // XT: CROSSED/ISOLATED
  DEFAULT_POSITION_TYPE: env('DEFAULT_POSITION_TYPE', 'CROSSED'),
  DEFAULT_TIMEFRAMES: String(env('XT_TIMEFRAMES', env('DEFAULT_TIMEFRAMES', '1m,3m,5m,15m')))
    .split(',').map((x) => x.trim()).filter(Boolean),
  DEFAULT_MARGIN_AMOUNT_PCT: envNum('DEFAULT_MARGIN_AMOUNT_PCT', 25.0),
  DEFAULT_RISK_PCT: envNum('DEFAULT_RISK_PCT', 1.0),
  SIGNAL_COOLDOWN_MINUTES: envInt('SIGNAL_COOLDOWN_MINUTES', 3),
  MAX_POSITIONS: envInt('MAX_POSITIONS', 1),
  MIN_CONFIDENCE: envInt('MIN_CONFIDENCE', 80),

  TF_MIN_CONFIDENCE: envInt('TF_MIN_CONFIDENCE', 70),
  MIN_AGREEING_STRATEGIES: envInt('MIN_AGREEING_STRATEGIES', 2),
  SIGNAL_CONFIRM_SCANS: envInt('SIGNAL_CONFIRM_SCANS', 1),

  SCAN_INTERVAL_SEC: envInt('SCAN_INTERVAL_SEC', 15),
  GUARD_INTERVAL_SEC: envInt('GUARD_INTERVAL_SEC', 15),
  REPORT_INTERVAL_SEC: envInt('REPORT_INTERVAL_SEC', 300),

  // ROI-on-margin thresholds for stop management (see README)
  BREAKEVEN_THRESHOLD_PCT: envNum('BREAKEVEN_THRESHOLD_PCT', 15.0),
  TRAILING_STOP_PCT: envNum('TRAILING_STOP_PCT', 20.0), // legacy knob
  TRAILING_TRIGGER_ROI_PCT: envNum('TRAILING_TRIGGER_ROI_PCT', 20.0),
  TRAILING_DISTANCE_PCT: envNum('TRAILING_DISTANCE_PCT', 1.0),
  SL_LIQUIDATION_SAFETY: envNum('SL_LIQUIDATION_SAFETY', 0.5),
  ON_TPSL_FAILURE: env('ON_TPSL_FAILURE', 'close'), // close | warn

  // Reversal: close an open position when a strong opposite signal appears
  REVERSAL_ENABLED: envBool('REVERSAL_ENABLED', true),
  REVERSAL_CONFIDENCE: envInt('REVERSAL_CONFIDENCE', 85),

  // Agent behaviour (merged with xt-agent loop: maxRounds)
  AGENT_MAX_STEPS: envInt('AGENT_MAX_STEPS', 8),
  AGENT_AUTONOMOUS_INTERVAL_SEC: envInt('AGENT_AUTONOMOUS_INTERVAL_SEC', 60),
  AGENT_DRY_RUN: envBool('AGENT_DRY_RUN', false),

  XT_DRY_RUN: envBool('XT_DRY_RUN', false),

  // Keys that are legacy and should never be shown/used again
  LEGACY_SETTINGS: ['max_loss_pct', 'max_profit_pct'],
  SETTING_ALIASES: { margin_mode: 'position_type' },
};

Config.validate = function () {
  const missing = [];
  if (!this.XT_API_KEY || !this.XT_API_SECRET) missing.push('XT_API_KEY / XT_API_SECRET');
  if (!this.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!this.TELEGRAM_USER_ID) missing.push('TELEGRAM_USER_ID');
  if (this.TELEGRAM_USER_ID && !/^\d+$/.test(this.TELEGRAM_USER_ID.trim())) {
    missing.push('TELEGRAM_USER_ID (must be a numeric Telegram user id)');
  }
  if (this.DEFAULT_LEVERAGE < 1 || this.DEFAULT_LEVERAGE > 125) missing.push('DEFAULT_LEVERAGE must be 1..125');
  if (this.DEFAULT_MARGIN_AMOUNT_PCT < 1 || this.DEFAULT_MARGIN_AMOUNT_PCT > 100) missing.push('DEFAULT_MARGIN_AMOUNT_PCT must be 1..100');
  if (this.DEFAULT_RISK_PCT < 0.1 || this.DEFAULT_RISK_PCT > 10) missing.push('DEFAULT_RISK_PCT must be 0.1..10');
  if (this.MIN_CONFIDENCE < 50 || this.MIN_CONFIDENCE > 100) missing.push('MIN_CONFIDENCE must be 50..100');
  if (this.SL_LIQUIDATION_SAFETY <= 0 || this.SL_LIQUIDATION_SAFETY > 1) missing.push('SL_LIQUIDATION_SAFETY must be 0..1');
  if (this.TRAILING_DISTANCE_PCT <= 0 || this.TRAILING_DISTANCE_PCT > 20) missing.push('TRAILING_DISTANCE_PCT must be 0..20');
  return missing;
};

Config.defaultSettings = function () {
  return {
    symbol: this.DEFAULT_SYMBOL,
    leverage: this.DEFAULT_LEVERAGE,
    margin_mode: this.DEFAULT_MARGIN_MODE,
    position_type: this.DEFAULT_POSITION_TYPE,
    timeframes: this.DEFAULT_TIMEFRAMES.join(','),
    margin_amount_pct: this.DEFAULT_MARGIN_AMOUNT_PCT,
    margin_risk_pct: this.DEFAULT_RISK_PCT,
    min_confidence: this.MIN_CONFIDENCE,
    tf_min_confidence: this.TF_MIN_CONFIDENCE,
    min_agreeing_strategies: this.MIN_AGREEING_STRATEGIES,
    signal_confirm_scans: this.SIGNAL_CONFIRM_SCANS,
    cooldown_minutes: this.SIGNAL_COOLDOWN_MINUTES,
    max_positions: this.MAX_POSITIONS,
    position_mode: 'margin',
    scan_interval_sec: this.SCAN_INTERVAL_SEC,
    guard_interval_sec: this.GUARD_INTERVAL_SEC,
    breakeven_threshold_pct: this.BREAKEVEN_THRESHOLD_PCT,
    trailing_stop_pct: this.TRAILING_STOP_PCT,
    trailing_trigger_roi_pct: this.TRAILING_TRIGGER_ROI_PCT,
    trailing_distance_pct: this.TRAILING_DISTANCE_PCT,
    sl_liquidation_safety: this.SL_LIQUIDATION_SAFETY,
    on_tpsl_failure: this.ON_TPSL_FAILURE,
    reversal_enabled: String(this.REVERSAL_ENABLED),
    reversal_confidence: this.REVERSAL_CONFIDENCE,
    report_interval_sec: this.REPORT_INTERVAL_SEC,
    mid_manage_interval_sec: 30,
  };
};

export function xtClientConfig() {
  return {
    host: Config.XT_FUTURES_HOST,
    accessKey: Config.XT_API_KEY,
    secretKey: Config.XT_API_SECRET,
  };
}
