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
  // Balance-e rasmi-e XT baraye formula-e OrigQty (doc: Create Orders):
  // Balance = walletBalance - openOrderMarginFrozen
  // API: /future/user/v1/compat/balance/list
  async getTradeBalance() {
    const b = await this._usdt();
    const w = Number(b.walletBalance || 0);
    const frozen = Number(b.openOrderMarginFrozen || 0);
    if (Number.isFinite(w) && Number.isFinite(frozen) && (w > 0 || frozen > 0)) {
      return Math.max(0, w - frozen);
    }
    // fallback age exchange frozen ro nadad
    return Number(b.availableBalance || 0);
  }
  // Mark price baraye sizing (doc mige Mark_price, na last/agg).
  async getMarkPriceForSizing(s, fallbackPrice) {
    try {
      const m = await this.xt.getMarkPrice(s);
      const p = Number(m.p ?? m.markPrice ?? m.price ?? 0);
      if (p > 0) return p;
    } catch {}
    return Number(fallbackPrice);
  }
  async contractsToNotional(s, qty, price) { return Number(qty) * Number(price) * Number(await this.getContractSize(s)); }
  // Buffer ha baraye inke XT insufficient_balance nade:
  // - FEE_RATE: taker ~0.05% (ba hashiye-ye emn 0.06%)
  // - SLIPPAGE: MARKET 0.1% (fill behtar/az price-e scan), LIMIT 0.02%
  // - SAFETY: 1.5% hashiye-ye kolli (rounding, mark-price drift, frozen)
  // - MAX_USABLE_PCT: hata age user 100% set kone, bishtar az 95% estefade nemishe
  //   ta hamishe ~5% + fee buffer azad bemune.
  static FEE_RATE = 0.0006;
  static SAFETY_MARGIN = 0.015;
  static MAX_USABLE_PCT = 95;
  _slippageFor(orderType) { return String(orderType || 'MARKET').toUpperCase() === 'MARKET' ? 0.001 : 0.0002; }
  // Hadaksar qty ke ba balance-e feli (margin + fee) ghabel-e pardakhte.
  // Base = formula-e rasmi-e XT: Truncate((Balance * Percent * Lev) / (Mark * CS))
  // ba Balance = wallet - frozen. Buffer-e fee/slippage/safety baraye
  // insufficient_balance ezafe شده (vagarna 95/100% hamishe reject mikhore).
  async maxAffordableQty(s, price, lev, { orderType = 'MARKET' } = {}) {
    const bal = await this.getTradeBalance();
    const cs = await this.getContractSize(s);
    const mark = await this.getMarkPriceForSizing(s, price);
    const px = Number(mark);
    const lv = Number(lev);
    if (!(bal > 0) || !(px > 0) || !(cs > 0) || !(lv > 0)) return 0;
    const slip = this._slippageFor(orderType);
    const unitCost = px * (1 + slip) * cs * ((1 / lv) + RiskManager.FEE_RATE);
    if (!(unitCost > 0)) return 0;
    return Math.floor((bal / unitCost) * (1 - RiskManager.SAFETY_MARGIN));
  }
  async sizeByMarginPct(s, price, lev, { orderType = 'MARKET' } = {}) {
    const rawPct = Number(this.getSetting('margin_amount_pct', 25));
    const pct = Math.min(Math.max(rawPct, 0), 100);
    // Cap: 100%-e vaghei hamishe reject mishe (fee + rounding), پس cap be 95%
    const effPct = Math.min(pct, RiskManager.MAX_USABLE_PCT);
    const bal = await this.getTradeBalance();
    const cs = await this.getContractSize(s);
    const mark = await this.getMarkPriceForSizing(s, price);
    if (bal <= 0 || mark <= 0 || cs <= 0 || lev <= 0) return 0;
    const slip = this._slippageFor(orderType);
    const effPrice = Number(mark) * (1 + slip);
    // margin + fee bayad <= bal*effPct% bashe:
    // qty = Truncate(bal*effPct% / (mark*(1+slip)*cs*(1/lev + FEE)) * (1-SAFETY))
    const unitCost = effPrice * cs * ((1 / Number(lev)) + RiskManager.FEE_RATE);
    if (!(unitCost > 0)) return 0;
    return Math.floor(((bal * (effPct / 100)) / unitCost) * (1 - RiskManager.SAFETY_MARGIN));
  }
  async sizeByRiskPct(s, entry, sl, { orderType = 'MARKET' } = {}) {
    const pct = Number(this.getSetting('margin_risk_pct', 1));
    const bal = await this.getTradeBalance();
    const cs = await this.getContractSize(s);
    const diff = Math.abs(Number(entry) - Number(sl));
    if (bal <= 0 || diff <= 0 || cs <= 0) return 0;
    const qty = Math.floor((bal * (pct / 100)) / (diff * cs));
    // Hata dar risk mode, qty nabayad az tavan-e pardakht (margin+fee) bishtar bashe
    try {
      const lev = parseInt(this.getSetting('leverage', 1), 10) || 1;
      const afford = await this.maxAffordableQty(s, entry, lev, { orderType });
      if (afford > 0 && qty > afford) return afford;
    } catch {}
    return qty;
  }
  async calculatePositionSize(s, price, lev, { stopLossPrice = null, orderType = 'MARKET' } = {}) {
    const mode = this.getSetting('position_mode', 'margin');
    let qty, smode;
    if (mode === 'risk' && stopLossPrice) { qty = await this.sizeByRiskPct(s, price, stopLossPrice, { orderType }); smode = 'risk_based'; }
    else { qty = await this.sizeByMarginPct(s, price, lev, { orderType }); smode = 'margin_based'; }
    return this._validateSize(s, qty, price, smode, orderType, lev);
  }
  async _validateSize(s, qty, price, mode, orderType, lev = null) {
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
    // Affordability: margin + fee bayad tu available جا بشه، وگرنه auto-shrink
    // (in daghighan fix-e insufficient_balance baraye margin_amount_pct=95/100-e)
    try {
      const lv = Number(lev) || parseInt(this.getSetting('leverage', 1), 10) || 1;
      const afford = await this.maxAffordableQty(s, price, lv, { orderType });
      if (afford <= 0) return { qty: 0, mode, reason: 'insufficient balance for even 1 contract (margin+fee)' };
      if (qty > afford) {
        const before = qty;
        qty = afford;
        if (qty < minQ) return { qty: 0, mode, reason: `affordable size ${qty} below exchange minimum ${minQ} (balance too small)` };
        // minNotional ro dobare check kon bad az shrink
        notional = await this.contractsToNotional(s, qty, price);
        if (minN && notional < minN) return { qty: 0, mode, reason: `notional ${notional.toFixed(2)} < minimum ${minN} after affordability shrink (size ${qty})` };
        reason = reason === 'ok'
          ? `shrunk ${before} -> ${qty} to fit available balance (margin+fee buffer)`
          : `${reason}; shrunk ${before} -> ${qty} to fit available balance`;
      }
    } catch {}
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
