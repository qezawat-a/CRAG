// store/memory.js — LongTermMemory (port az CryptoMind-XT/bot/memory.py)
// ------------------------------------------------------------
// SQLAlchemy -> JSON-file store (data/trader-store.json). API hamun-e
// Python-e: settings / signals / trades / cooldowns / ai_context / chat.
// Data-e process koochak ast (settings + trades + signals), pas write
// atomic (tmp + rename) kafi va amn-e. Baraye Postgres/MySQL deploy
// DATABASE_URL dar Python bood; inja STORE_FILE ro be ye volume mount
// eshare konid.
import fs from 'node:fs';
import path from 'node:path';
import { Config } from '../config.js';

const EMPTY = () => ({ chat: [], trades: [], signals: [], settings: {}, cooldowns: {}, aiContext: {}, seq: { trades: 0, signals: 0 } });

function num(v, d = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : d; }

export class LongTermMemory {
  constructor(storeFile = null) {
    this.file = path.resolve(storeFile || Config.STORE_FILE);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.data = this._load();
    this._saveTimer = null;
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...EMPTY(), ...parsed };
    } catch {
      return EMPTY();
    }
  }

  _saveNow() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  _save() {
    // debounce-e koochak ta loop-haye seriDB ro block nakonan
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; try { this._saveNow(); } catch (e) { console.error('[memory] save failed:', e.message); } }, 25);
  }

  flush() { if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; } this._saveNow(); }
  close() { this.flush(); }

  // ---------- chat history ----------
  addChatMessage(role, content) {
    this.data.chat.push({ role, content, timestamp: Date.now() / 1000 });
    if (this.data.chat.length > 500) this.data.chat = this.data.chat.slice(-500);
    this._save();
  }

  getChatHistory(limit = 50) {
    return this.data.chat.slice(-limit).map((r) => ({ role: r.role, content: r.content }));
  }

  // ---------- trades ----------
  recordTrade({ symbol, positionSide, orderId = null, entryPrice = 0, amount = 0, leverage = 1, confidence = 0, strategy = '', signalStrength = 0, timeframe = '' }) {
    const id = ++this.data.seq.trades;
    this.data.trades.push({
      id, symbol: String(symbol).toLowerCase(), position_side: positionSide,
      order_id: orderId == null ? null : String(orderId),
      entry_price: num(entryPrice), exit_price: null, amount: num(amount),
      leverage: parseInt(leverage, 10) || 1, pnl: 0, confidence: parseInt(confidence, 10) || 0,
      strategy: strategy || '', signal_strength: num(signalStrength), timeframe: timeframe || '',
      opened_at: Date.now() / 1000, closed_at: null, status: 'OPEN', notes: null,
    });
    this._save();
    return id;
  }

  closeTrade(tradeId, exitPrice, pnl = 0, notes = null) {
    const t = this.data.trades.find((x) => x.id === parseInt(tradeId, 10));
    if (!t) return;
    t.exit_price = num(exitPrice);
    t.pnl = num(pnl);
    t.closed_at = Date.now() / 1000;
    t.status = 'CLOSED';
    if (notes) t.notes = notes;
    this._save();
  }

  getOpenTrades(symbol = null) {
    return this.data.trades.filter((t) => t.status === 'OPEN' && (!symbol || t.symbol === String(symbol).toLowerCase()));
  }

  getTrade(tradeId) {
    const t = this.data.trades.find((x) => x.id === parseInt(tradeId, 10));
    return t ? { ...t } : {};
  }

  getTradeHistory(limit = 20) {
    return [...this.data.trades].reverse().slice(0, limit).map((t) => ({ ...t }));
  }

  getTotalPnl() {
    return this.data.trades.filter((t) => t.status === 'CLOSED').reduce((a, t) => a + (num(t.pnl)), 0);
  }

  getTradeCount() {
    const all = this.data.trades;
    const closed = all.filter((t) => t.status === 'CLOSED');
    const wins = closed.filter((t) => num(t.pnl) > 0).length;
    const losses = closed.filter((t) => num(t.pnl) < 0).length;
    const decided = wins + losses;
    return {
      total: all.length,
      open: all.filter((t) => t.status === 'OPEN').length,
      closed: closed.length,
      wins, losses,
      flat_or_unknown: closed.length - wins - losses,
      winrate: decided > 0 ? Math.round((wins / decided) * 100 * 100) / 100 : 0,
    };
  }

  // ---------- signals ----------
  recordSignal({ symbol, direction, strategy, timeframe, confidence, signalStrength, price }) {
    const id = ++this.data.seq.signals;
    this.data.signals.push({
      id, symbol: String(symbol).toLowerCase(), direction, strategy,
      timeframe, confidence: parseInt(confidence, 10) || 0,
      signal_strength: num(signalStrength), price: num(price),
      timestamp: Date.now() / 1000, acted: false,
    });
    if (this.data.signals.length > 2000) this.data.signals = this.data.signals.slice(-2000);
    this._save();
    return id;
  }

  getRecentSignals(symbol = null, limit = 50) {
    return this.data.signals
      .filter((s) => !symbol || s.symbol === String(symbol).toLowerCase())
      .slice(-limit).reverse().map((s) => ({ ...s }));
  }

  // ---------- cooldowns ----------
  // Normalize: symbols lowercase, sides UPPER. Cap 10 min (phantom-cooldown fix).
  _ck(symbol, side) { return `${String(symbol || '').toLowerCase().trim()}|${String(side || '').toUpperCase().trim()}`; }

  setCooldown(symbol, side, durationMinutes) {
    side = String(side || '').toUpperCase().trim();
    if (side !== 'LONG' && side !== 'SHORT') return;
    let mins = parseInt(parseFloat(durationMinutes), 10);
    if (!Number.isFinite(mins)) mins = 0;
    mins = Math.max(0, Math.min(mins, 10));
    this.data.cooldowns[this._ck(symbol, side)] = Date.now() / 1000 + mins * 60;
    this._save();
  }

  clearCooldown(symbol = null, side = null) {
    let n = 0;
    for (const key of Object.keys(this.data.cooldowns)) {
      const [s, sd] = key.split('|');
      if (symbol && s !== String(symbol).toLowerCase().trim()) continue;
      if (side && sd !== String(side).toUpperCase().trim()) continue;
      delete this.data.cooldowns[key];
      n++;
    }
    this._save();
    return n;
  }

  clearExpiredCooldowns() {
    const now = Date.now() / 1000;
    let n = 0;
    for (const [key, until] of Object.entries(this.data.cooldowns)) {
      if (until <= now) { delete this.data.cooldowns[key]; n++; }
    }
    if (n) this._save();
    return n;
  }

  isInCooldown(symbol, side) { return this.getCooldownRemaining(symbol, side) > 0; }

  getCooldownRemaining(symbol, side) {
    const until = this.data.cooldowns[this._ck(symbol, side)];
    if (!until) return 0;
    return Math.max(0, until - Date.now() / 1000);
  }

  // ---------- settings ----------
  setSetting(key, value) {
    this.data.settings[key] = String(value);
    this._save();
  }

  setSettingDefault(key, value) {
    if (this.data.settings[key] !== undefined) return false;
    this.data.settings[key] = String(value);
    this._save();
    return true;
  }

  getSetting(key, defaultValue = null) {
    const v = this.data.settings[key];
    return v === undefined ? defaultValue : v;
  }

  getInt(key, defaultValue) { const n = parseInt(this.getSetting(key, ''), 10); return Number.isFinite(n) ? n : defaultValue; }
  getNum(key, defaultValue) { const n = parseFloat(this.getSetting(key, '')); return Number.isFinite(n) ? n : defaultValue; }
  getBool(key, defaultValue) {
    const v = String(this.getSetting(key, '')).trim().toLowerCase();
    if (!v) return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(v);
  }

  getAllSettings() { return { ...this.data.settings }; }

  // ---------- ai context ----------
  setAiContext(key, value) {
    this.data.aiContext[key] = String(value);
    this._save();
  }

  getAiContext(key = null) {
    if (key) return this.data.aiContext[key] ?? null;
    return { ...this.data.aiContext };
  }

  // ---------- summary for AI ----------
  getTradeSummaryForAi() {
    const trades = this.getTradeHistory(30);
    const stats = this.getTradeCount();
    const pnl = this.getTotalPnl();
    const openTrades = this.getOpenTrades();
    const settings = this.getAllSettings();

    let s = '=== TRADE SUMMARY ===\n';
    s += `Total PnL: ${pnl.toFixed(4)} USDT\n`;
    s += `Total Trades: ${stats.total} | Open: ${stats.open} | Closed: ${stats.closed}\n`;
    s += `Wins: ${stats.wins} | Losses: ${stats.losses} | Winrate: ${stats.winrate}%\n\n`;
    if (openTrades.length) {
      s += '--- OPEN POSITIONS ---\n';
      for (const t of openTrades) {
        s += `ID:${t.id} ${t.symbol} ${t.position_side} Entry:${t.entry_price} Amt:${t.amount} Lev:${t.leverage}x | ${t.strategy} Conf:${t.confidence}%\n`;
      }
    }
    if (trades.length) {
      s += '\n--- RECENT TRADES ---\n';
      for (const t of trades.slice(0, 5)) {
        s += `${t.symbol} ${t.position_side} Entry:${t.entry_price} Exit:${t.exit_price ?? '-'} PnL:${num(t.pnl).toFixed(4)} | ${t.strategy}\n`;
      }
    }
    if (Object.keys(settings).length) {
      s += '\n--- ACTIVE SETTINGS ---\n';
      for (const [k, v] of Object.entries(settings)) s += `${k}: ${v}\n`;
    }
    return s;
  }

  // seed defaults + legacy cleanup (main.py: _clean_legacy_and_buggy_cooldowns)
  seedDefaults() {
    for (const [k, v] of Object.entries(Config.defaultSettings())) this.setSettingDefault(k, v);
    for (const legacy of Config.LEGACY_SETTINGS) {
      if (this.data.settings[legacy] !== undefined) { delete this.data.settings[legacy]; }
    }
    // stale cooldowns > 10 min are pre-cap bugs — delete
    const now = Date.now() / 1000;
    for (const [key, until] of Object.entries(this.data.cooldowns)) {
      if (until - now > 600) delete this.data.cooldowns[key];
    }
    this._save();
  }
}
