// risk.js — mohasebe-e size/leverage/balance (port az CryptoMind-XT/bot/risk_manager.py)
// - contracts_to_notional / size_by_margin_pct / size_by_risk_pct
// - calculate_position_size (margin/risk mode) + validate (min/max qty/notional)
// - get_max_leverage az leverageBrackets + validate_leverage (clamp)
// - balance cache 3s (asset endpoint ha 3 req/s)
import { XTError } from './errors.js';
export class RiskManager {
  constructor(xt, { getSetting = () => undefined } = {}) {
    this.xt = xt;
    this.getSetting = getSetting;
    this._symbolConfigs = new Map();
    this._balCache = null; this._balAt = 0;
    this.BAL_TTL = 3000;
  }
  async getSymbolConfig(symbol) {
    if (!this._symbolConfigs.has(symbol)) this._symbolConfigs.set(symbol, (await this.xt.getSymbolDetail(symbol)) || {});
    return this._symbolConfigs.get(symbol);
  }
  async getContractSize(s) { return Number((await this.getSymbolConfig(s)).contractSize || 0); }
  async getMinQty(s) { return parseInt(Number((await this.getSymbolConfig(s)).minQty || 1), 10); }
  async getMinNotional(s) { return Number((await this.getSymbolConfig(s)).minNotional || 0); }
  async getMaxNotional(s) { return Number((await this.getSymbolConfig(s)).maxNotional || 0); }
  async getMaxOrderQty(s, t) { const c = await this.getSymbolConfig(s); const v = c[t === 'MARKET' ? 'maxMarketOrderQty' : 'maxLimitOrderQty']; return v ? parseInt(Number(v), 10) : 0; }
  async getPricePrecision(s) { return parseInt((await this.getSymbolConfig(s)).pricePrecision ?? 2, 10); }
  async getPriceStep(s) { return Number((await this.getSymbolConfig(s)).minStepPrice || 0); }
  async roundPrice(s, px) { const step = await this.getPriceStep(s); const pr = await this.getPricePrecision(s); let p = Number(px); if (step > 0) p = Math.floor(p / step) * step; return Number(p.toFixed(pr)); }
  async supportsOrderType(s, t) { const raw = String((await this.getSymbolConfig(s)).supportOrderType || ''); return raw.split(',').map((x) => x.trim()).includes(t); }
  async supportsTif(s, t) { const raw = String((await this.getSymbolConfig(s)).supportTimeInForce || ''); return raw.split(',').map((x) => x.trim()).includes(t); }
  async _usdt(force = false) {
    const now = Date.now();
    if (!force && this._balCache && now - this._balAt < this.BAL_TTL) return this._balCache;
    const rows = await this.xt.getBalances();
    const item = rows.find((r) => String(r.coin || '').toUpperCase() === 'USDT') || {};
    this._balCache = item; this._balAt = now;
    return item;
  }
  invalidateBalanceCache() { this._balCache = null; }
  async getTotalBalance() { return Number((await this._usdt()).walletBalance || 0); }
  async getAvailableBalance() { return Number((await this._usdt()).availableBalance || 0); }
  async contractsToNotional(s, qty, price) { return Number(qty) * Number(price) * Number(await this.getContractSize(s)); }
  async sizeByMarginPct(s, price, lev) {
    const pct = Number(this.getSetting('margin_amount_pct', 25));
    const bal = await this.getAvailableBalance();
    const cs = await this.getContractSize(s);
    if (bal <= 0 || price <= 0 || cs <= 0 || lev <= 0) return 0;
    return Math.floor((bal * (pct / 100) * lev) / (price * cs));
  }
  async sizeByRiskPct(s, entry, sl) {
    const pct = Number(this.getSetting('margin_risk_pct', 1));
    const bal = await this.getAvailableBalance();
    const cs = await this.getContractSize(s);
    const diff = Math.abs(Number(entry) - Number(sl));
    if (bal <= 0 || diff <= 0 || cs <= 0) return 0;
    return Math.floor((bal * (pct / 100)) / (diff * cs));
  }
  async calculatePositionSize(s, price, lev, { stopLossPrice = null, orderType = 'MARKET' } = {}) {
    const mode = this.getSetting('position_mode', 'margin');
    let qty, smode;
    if (mode === 'risk' && stopLossPrice) { qty = await this.sizeByRiskPct(s, price, stopLossPrice); smode = 'risk_based'; }
    else { qty = await this.sizeByMarginPct(s, price, lev); smode = 'margin_based'; }
    return this._validateSize(s, qty, price, smode, orderType);
  }
  async _validateSize(s, qty, price, mode, orderType) {
    qty = parseInt(qty, 10) || 0;
    if (qty <= 0) return { qty: 0, mode, reason: 'computed size 0 (balance too small for one contract)' };
    const minQ = await this.getMinQty(s);
    if (qty < minQ) return { qty: 0, mode, reason: `size ${qty} below exchange minimum ${minQ}` };
    const maxQ = await this.getMaxOrderQty(s, orderType);
    let reason = 'ok';
    if (maxQ && qty > maxQ) { reason = `capped ${qty} -> ${maxQ} (${orderType} max)`; qty = maxQ; }
    // After all qty adjustments (maxQ cap, maxN cap), validate notional against minN
    let notional = await this.contractsToNotional(s, qty, price);
    const maxN = await this.getMaxNotional(s);
    if (maxN && notional > maxN) {
      const cs = await this.getContractSize(s);
      qty = Math.floor(maxN / (price * cs));
      if (qty < minQ) return { qty: 0, mode, reason: 'max notional cap pushes size below minimum' };
      notional = await this.contractsToNotional(s, qty, price); // recalc after maxN adjustment
    }
    const minN = await this.getMinNotional(s);
    if (minN && notional < minN) return { qty: 0, mode, reason: `notional ${notional.toFixed(2)} < minimum ${minN} (size ${qty})` };
    return { qty, mode, reason };
  }
  async getMaxLeverage(s, notional = null) {
    let brackets;
    try { brackets = await this.xt.getLeverageBrackets(s); } catch (e) { if (e instanceof XTError) return 1; throw e; }
    if (!brackets || !brackets.length) return 1;
    brackets = [...brackets].sort((a, b) => Number(a.maxNominalValue || 0) - Number(b.maxNominalValue || 0));
    if (notional != null) for (const b of brackets) if (notional <= Number(b.maxNominalValue || 0)) return parseInt(Number(b.maxLeverage || 1), 10);
    return Math.max(...brackets.map((b) => parseInt(Number(b.maxLeverage || 1), 10)));
  }
  async validateLeverage(s, lev, notional = null) {
    const m = await this.getMaxLeverage(s, notional);
    return Math.max(1, Math.min(parseInt(lev, 10) || 1, m));
  }
}
