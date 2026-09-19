// client.js — XT USDT-M Futures REST client (kamel, port az CryptoMind-XT/bot/xt_client.py)
import { XTBase, XTError, MARKET, USER, TRADE, TP_SL_DEFAULT_EXPIRY_MS } from './client-part1.js';
export { XTError, TP_SL_DEFAULT_EXPIRY_MS };
export class XTClient extends XTBase {
  getSymbolDetail(symbol) { return this._public('GET', `${MARKET}/v1/public/symbol/detail`, { symbol }); }
  getKlines(symbol, interval, o = {}) { return this._public('GET', `${MARKET}/v1/public/q/kline`, { symbol, interval, limit: o.limit ?? null, startTime: o.startTime ?? null, endTime: o.endTime ?? null }).then((r) => r || []); }
  getAggTicker(symbol) { return this._public('GET', `${MARKET}/v1/public/q/agg-ticker`, { symbol }).then((r) => r || {}); }
  getMarkPrice(symbol) { return this._public('GET', `${MARKET}/v1/public/q/symbol-mark-price`, { symbol }).then((r) => r || {}); }
  getLeverageBrackets(symbol) { return this._public('GET', `${MARKET}/v1/public/leverage/bracket/detail`, { symbol }).then((d) => (d || {}).leverageBrackets || []); }
  getFundingRate(symbol) { return this._public('GET', `${MARKET}/v1/public/q/funding-rate`, { symbol }).then((r) => r || {}); }
  async getBalances() {
    let firstErr = null;
    try { const d = await this._private('GET', `${USER}/v1/balance/list`); if (Array.isArray(d)) return d; } catch (e) { firstErr = e; }
    try { const s = await this._private('GET', `${USER}/v1/compat/balance/usdt`); const n = XTBase.normalizeBalancePayload(s); if (n.length) return n; } catch {}
    try { const c = await this._private('GET', `${USER}/v1/compat/balance/list`); const n = XTBase.normalizeBalancePayload(c); if (n.length) return n; } catch {}
    if (firstErr) throw firstErr;
    return [];
  }
  getContractAccountAssets(qid = null) { return this._private('GET', `${USER}/v1/compat/balance/list`, { queryAccountId: qid }).then((d) => (Array.isArray(d) ? d : [])); }
  getAccountInfo() { return this._private('GET', `${USER}/v1/account/info`).then((r) => r || {}); }
  async getListenKey() { const d = await this._private('GET', `${USER}/v1/user/listen-key`); if (d && typeof d === 'object') return d.listenKey || d.accessToken || ''; return d || ''; }
  getPositions(symbol = null) { return this._private('GET', `${USER}/v1/position`, { symbol }).then((d) => (Array.isArray(d) ? d : [])); }
  getPositionsList(symbol = null) { return this._private('GET', `${USER}/v1/position/list`, { symbol }).then((d) => (Array.isArray(d) ? d : [])); }
  setLeverage(symbol, positionSide, leverage) { return this._private('POST', `${USER}/v1/position/adjust-leverage`, { symbol, positionSide, leverage }); }
  setPositionType(symbol, positionSide, positionType) {
    let pt = String(positionType).toUpperCase();
    if (pt === 'CROSS') pt = 'CROSSED';
    if (pt !== 'CROSSED' && pt !== 'ISOLATED') throw new XTError(`setPositionType invalid ${JSON.stringify(positionType)}`);
    return this._private('POST', `${USER}/v1/position/change-type`, { symbol, positionSide, positionType: pt });
  }
  adjustMargin(symbol, positionSide, margin, direction) {
    const dir = String(direction).toUpperCase();
    if (dir !== 'ADD' && dir !== 'SUB') throw new XTError(`adjustMargin direction ADD/SUB`);
    return this._private('POST', `${USER}/v1/position/margin`, { symbol, positionSide, margin, type: dir });
  }
  setAutoMargin(symbol, positionSide, enabled) { return this._private('POST', `${USER}/v1/position/auto-margin`, { symbol, positionSide, autoMargin: Boolean(enabled) }); }
  getLeverageInfo(symbol) { return this._private('GET', `${TRADE}/v1/position/leverage/list`, { symbol }).then((d) => { if (d && typeof d === 'object' && !Array.isArray(d)) return d.items || []; return Array.isArray(d) ? d : []; }); }
  createOrder(o) {
    const p = { symbol: o.symbol, positionSide: o.positionSide, orderSide: o.orderSide, orderType: o.orderType, origQty: parseInt(o.origQty, 10) };
    if (o.price != null) p.price = o.price;
    if (o.timeInForce) p.timeInForce = o.timeInForce;
    if (o.clientOrderId) p.clientOrderId = o.clientOrderId;
    if (o.reduceOnly != null) p.reduceOnly = Boolean(o.reduceOnly);
    return this._private('POST', `${TRADE}/v1/order/create`, p);
  }
  cancelOrder(orderId) { return this._private('POST', `${TRADE}/v1/order/cancel`, { orderId }); }
  cancelAllOrders(symbol) { return this._private('POST', `${TRADE}/v1/order/cancel-all`, { symbol }); }
  getOrder(orderId) { return this._private('GET', `${TRADE}/v1/order/detail`, { orderId }); }
  getOrders(o = {}) { return this._private('GET', `${TRADE}/v1/order-entrust/list`, { state: o.state || 'NEW', page: o.page || 1, size: o.size || 50, symbol: o.symbol ?? null }).then((d) => (d || {}).items || []); }
  createTpsl(o) {
    const p = { symbol: o.symbol, positionSide: o.positionSide, origQty: parseInt(o.origQty, 10), triggerProfitPrice: o.triggerProfitPrice, triggerStopPrice: o.triggerStopPrice, expireTime: parseInt(o.expireTimeMs ?? TP_SL_DEFAULT_EXPIRY_MS, 10), profitDelegateOrderType: o.profitOrderType || 'MARKET', profitDelegateTimeInForce: o.profitTif || 'IOC', stopDelegateOrderType: o.stopOrderType || 'MARKET', stopDelegateTimeInForce: o.stopTif || 'IOC' };
    if (o.profitPrice != null) p.profitDelegatePrice = o.profitPrice;
    if (o.stopPrice != null) p.stopDelegatePrice = o.stopPrice;
    return this._private('POST', `${TRADE}/v1/entrust/create-profit`, p);
  }
  updateTpsl(profitId, o = {}) { const p = { profitId }; if (o.triggerProfitPrice != null) p.triggerProfitPrice = o.triggerProfitPrice; if (o.triggerStopPrice != null) p.triggerStopPrice = o.triggerStopPrice; return this._private('POST', `${TRADE}/v1/entrust/update-profit-stop`, p); }
  cancelTpsl(profitId) { return this._private('POST', `${TRADE}/v1/entrust/cancel-profit-stop`, { profitId }); }
  cancelAllTpsl(symbol) { return this._private('POST', `${TRADE}/v1/entrust/cancel-all-profit-stop`, { symbol }); }
  getTpslOrders(symbol, o = {}) { return this._private('GET', `${TRADE}/v1/entrust/profit-list`, { state: o.state || 'NOT_TRIGGERED', page: o.page || 1, size: o.size || 50, symbol }).then((d) => (d || {}).items || []); }
  getTpslHistory(o = {}) { return this._private('GET', `${TRADE}/v1/entrust/profit-list-history`, { page: o.page || 1, size: o.size || 10, symbol: o.symbol ?? null, startTime: o.startTime ?? null, endTime: o.endTime ?? null }).then((r) => r || {}); }
  getActivePositionsNew(symbol = null) { return this._private('GET', `${TRADE}/v1/position/list/active`, { symbol }).then((d) => { if (d && typeof d === 'object' && !Array.isArray(d)) return d.items || d.list || []; return Array.isArray(d) ? d : []; }); }
  getPositionHistory(o = {}) { return this._private('GET', `${TRADE}/v1/position/list-history`, { page: o.page || 1, size: o.size || 10, symbol: o.symbol ?? null }).then((r) => r || {}); }
  getCrossMargin(symbol) { return this._private('GET', `${TRADE}/v1/position/cross-margin/${symbol}`).then((r) => r || {}); }
  getReversePlanOrders(o = {}) { return this._private('GET', `${TRADE}/v1/entrust/reverse-plan-list`, { page: o.page || 1, size: o.size || 10, symbol: o.symbol ?? null }).then((r) => r || {}); }
  getReversePlanHistory(o = {}) { return this._private('GET', `${TRADE}/v1/entrust/reverse-plan-list-history`, { page: o.page || 1, size: o.size || 10, symbol: o.symbol ?? null }).then((r) => r || {}); }
  getOrderTradeHistory(o = {}) { return this._private('GET', `${TRADE}/v1/order/trade-history`, { page: o.page || 1, size: o.size || 10, symbol: o.symbol ?? null }).then((r) => r || {}); }
  getAllTrades(symbol = null) { return this._private('GET', `${TRADE}/v1/order/trade-list-all`, { symbol }).then((d) => (Array.isArray(d) ? d : [])); }
  getSingleCoinBalance(coin) { return this._private('GET', `${USER}/v1/compat/balance/${String(coin).toLowerCase()}`).then((r) => r || {}); }
  getAutoDeleverageHistory(o = {}) { return this._private('GET', `${USER}/v1/auto-deleverage/history`, { page: o.page || 1, size: o.size || 10, symbol: o.symbol ?? null, startTime: o.startTime ?? null, endTime: o.endTime ?? null }).then((r) => r || {}); }
  async getStepRate() { try { return (await this._private('GET', `${USER}/v1/step-rate`)) || {}; } catch { return (await this._private('GET', `${USER}/v1/user/step-rate`)) || {}; } }
  getMarginCallInfo(symbol = null) { return this._private('GET', `${USER}/v1/position/break-list`, { symbol }).then((d) => (Array.isArray(d) ? d : [])); }
}
export function createXTClient(opts) { return new XTClient(opts); }
