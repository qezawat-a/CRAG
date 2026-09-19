// trader/position-manager.js — port-e kamel az CryptoMind-XT/bot/position_manager.py
// ------------------------------------------------------------
// - getPositionPnl: ROI on margin + fallback PnL (floatingPL gahi 0-e tu XT)
// - adoptExchangePositions: position-e XT ke tu DB nist -> record (ADOPTED)
// - calculateDynamicTpsl: ATR-based + liq-safety clamp
// - attachTpslToPosition / ensureTpsl / findTpsl / moveStop
// - checkTpslBreakeven / trailStopLoss / midManagePositions
// - closePosition / reconcileOpenTrades / explainMidManagement
import { XTError } from '../xt/errors.js';
import { Config } from '../config.js';

export const TPSL_ACTIVE_STATES = ['NOT_TRIGGERED', 'TRIGGERING'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class PositionManager {
  constructor(xt, memory, risk) {
    this.xt = xt;
    this.memory = memory;
    this.risk = risk;
    this._atrCache = new Map(); // key -> { value, at } (TTL 120s)
  }

  async getPositions(symbol = null) {
    try { return await this.xt.getPositions(symbol); }
    catch (e) { console.warn(`[position] fetch failed for ${symbol}: ${e.message}`); return []; }
  }

  async getPosition(symbol, positionSide) {
    for (const pos of await this.getPositions(symbol)) {
      if (pos.positionSide !== positionSide) continue;
      if (Number(pos.positionSize || 0) <= 0) continue;
      return pos;
    }
    return null;
  }

  async _publicMarkPrice(symbol) {
    try { return Number((await this.xt.getMarkPrice(symbol)).p || 0); }
    catch { return 0; }
  }

  async getPositionPnl(symbol, positionSide) {
    const pos = await this.getPosition(symbol, positionSide);
    if (!pos) {
      return { exists: false, unrealized_pnl: 0, roi: 0, entry_price: 0, mark_price: 0, leverage: 1, position_size: 0, margin: 0, profit_id: null, trigger_profit_price: 0, trigger_stop_price: 0 };
    }
    const entry = Number(pos.entryPrice || 0);
    let mark = Number(pos.calMarkPrice || pos.markPrice || 0);
    if (mark <= 0) mark = await this._publicMarkPrice(symbol);
    const size = Number(pos.positionSize || 0);
    const leverage = parseInt(Number(pos.leverage || 1), 10) || 1;
    const rawPnl = Number(pos.floatingPL || pos.unrealizedProfit || pos.profit || 0);
    const margin = Number(pos.isolatedMargin || 0);
    let cs = 1;
    try { cs = Number(await this.risk.getContractSize(symbol)) || 1; } catch {}

    // ROI on margin: price move fraction amplified by leverage
    let roi = 0;
    if (entry > 0 && mark > 0) {
      let move = (mark - entry) / entry;
      if (positionSide === 'SHORT') move = -move;
      roi = move * leverage * 100;
    }
    // Fallback PnL when exchange returns 0 but ROI is clearly non-zero
    let pnl = rawPnl;
    if (Math.abs(pnl) < 1e-9 && Math.abs(roi) > 0.1 && size > 0 && cs > 0) {
      const diff = positionSide === 'LONG' ? mark - entry : entry - mark;
      pnl = diff * size * cs;
    }
    return {
      exists: true, unrealized_pnl: pnl, roi, entry_price: entry, mark_price: mark,
      leverage, position_size: size, position_value: size * cs * mark, margin,
      profit_id: pos.profitId || null,
      trigger_profit_price: Number(pos.triggerProfitPrice || 0),
      trigger_stop_price: Number(pos.triggerStopPrice || 0),
      position_type: pos.positionType || '',
      available_close_size: Number(pos.availableCloseSize || 0),
    };
  }

  async adoptExchangePositions() {
    const adopted = [];
    let positions;
    try { positions = await this.xt.getPositions(); }
    catch (e) { console.warn(`[position] could not enumerate exchange positions: ${e.message}`); return adopted; }

    const known = new Set(this.memory.getOpenTrades().map((t) => `${t.symbol}|${t.position_side}`));
    for (const pos of positions) {
      const size = Number(pos.positionSize || 0);
      if (size <= 0) continue;
      const symbol = pos.symbol;
      const side = pos.positionSide;
      if (!symbol || !side || known.has(`${String(symbol).toLowerCase()}|${side}`)) continue;
      const entry = Number(pos.entryPrice || 0);
      const leverage = parseInt(Number(pos.leverage || 1), 10) || 1;
      const tradeId = this.memory.recordTrade({
        symbol, positionSide: side, orderId: null, entryPrice: entry, amount: Math.floor(size),
        leverage, confidence: 0, strategy: 'ADOPTED', signalStrength: 0, timeframe: '',
      });
      console.warn(`[position] adopted untracked position ${symbol} ${side} ${Math.floor(size)}c @ ${entry} as trade ${tradeId}`);
      adopted.push({ trade_id: tradeId, symbol, position_side: side, size: Math.floor(size), entry_price: entry, leverage, has_stop: Boolean(pos.profitId) });
    }
    return adopted;
  }

  // ---------- TP/SL ----------
  extractProfitId(created) {
    if (!created) return null;
    if (typeof created === 'boolean') return null; // XT success flag — no id here
    if (typeof created === 'string') return created;
    if (typeof created === 'object') return created.profitId || created.profit_id || null;
    return null;
  }

  async getActiveTpsl(symbol) {
    const orders = [];
    for (const state of TPSL_ACTIVE_STATES) {
      try { orders.push(...(await this.xt.getTpslOrders(symbol, { state }))); }
      catch (e) { console.warn(`[position] TP/SL list failed ${symbol} state=${state}: ${e.message}`); }
    }
    return orders;
  }

  async findTpsl(symbol, positionSide) {
    for (const order of await this.getActiveTpsl(symbol)) {
      if (order.positionSide === positionSide) return order;
    }
    return {};
  }

  // Live TP/SL entrust WITH real prices (position object gahi 0 mide — bug XT)
  async _getProfitEntrust(symbol, positionSide, pos) {
    if (pos.profit_id && (pos.trigger_profit_price || 0) > 0) {
      return { profitId: pos.profit_id, triggerProfitPrice: pos.trigger_profit_price, triggerStopPrice: pos.trigger_stop_price };
    }
    return this.findTpsl(symbol, positionSide);
  }

  async _getProfitId(symbol, positionSide, pos) {
    if (pos.profit_id) return pos.profit_id;
    return (await this.findTpsl(symbol, positionSide)).profitId || null;
  }

  liquidationDistance(entryPrice, leverage) {
    // Approximate adverse price move that wipes the margin
    return entryPrice / Math.max(1, leverage);
  }

  async _calculateAtr(symbol, interval = '5m', period = 14) {
    const key = `${symbol}_${interval}`;
    const cached = this._atrCache.get(key);
    if (cached && Date.now() - cached.at < 120000) return cached.value;
    let rows;
    try { rows = await this.xt.getKlines(symbol, interval, { limit: period + 10 }); }
    catch (e) { console.warn(`[position] ATR kline fetch failed ${symbol}: ${e.message}`); return 0; }
    if (!rows || !rows.length) return 0;
    const candles = rows.map((r) => ({ h: Number(r.h), l: Number(r.l), c: Number(r.c) }))
      .filter((c) => Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c));
    if (candles.length < period) return 0;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const pc = candles[i - 1].c;
      trs.push(Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - pc), Math.abs(candles[i].l - pc)));
    }
    const atr = trs.slice(-period).reduce((a, b) => a + b, 0) / Math.min(period, trs.length);
    this._atrCache.set(key, { value: atr, at: Date.now() });
    return atr;
  }

  async calculateDynamicTpsl(symbol, positionSide, entryPrice, signalStrength, confidence, leverage = 1) {
    let atr = await this._calculateAtr(symbol, '5m');
    if (atr <= 0) atr = entryPrice * 0.01;
    const strengthFactor = 0.5 + Math.max(0, Math.min(1, signalStrength));
    const tpMultiplier = 1.5 + (confidence / 100) * 2.0;
    const slMultiplier = 1.0 + ((100 - confidence) / 100) * 1.5;
    // No hard ceiling for TP (up to 50% price move) — dynamic ROI
    let tpDistance = atr * tpMultiplier * strengthFactor;
    tpDistance = Math.min(tpDistance, entryPrice * 0.5);
    let slDistance = Math.max(atr * slMultiplier / strengthFactor, entryPrice * 0.005);
    // A pure ATR stop can sit beyond liquidation at high leverage — clamp
    const safety = this.memory.getNum('sl_liquidation_safety', Config.SL_LIQUIDATION_SAFETY);
    const maxSl = this.liquidationDistance(entryPrice, leverage) * safety;
    if (slDistance > maxSl) {
      console.info(`[position] clamping ${symbol} SL distance ${slDistance.toFixed(8)} -> ${maxSl.toFixed(8)} (liq at ${leverage}x)`);
      slDistance = maxSl;
    }
    if (positionSide === 'LONG') {
      return [await this.risk.roundPrice(symbol, entryPrice + tpDistance), await this.risk.roundPrice(symbol, entryPrice - slDistance)];
    }
    return [await this.risk.roundPrice(symbol, entryPrice - tpDistance), await this.risk.roundPrice(symbol, entryPrice + slDistance)];
  }

  async attachTpslToPosition(symbol, positionSide, triggerProfitPrice, triggerStopPrice) {
    const pos = await this.getPositionPnl(symbol, positionSide);
    if (!pos.exists) return [false, 0, null, 'no open position'];
    const contracts = Math.floor(pos.available_close_size || pos.position_size);
    if (!(contracts > 0)) return [false, 0, null, 'nothing to protect'];
    let created = null;
    try {
      created = await this.xt.createTpsl({
        symbol, positionSide, origQty: contracts,
        triggerProfitPrice: String(triggerProfitPrice), triggerStopPrice: String(triggerStopPrice),
      });
    } catch (e) {
      return [false, 0, null, e.message];
    }
    let profitId = this.extractProfitId(created);
    for (let attempt = 0; attempt < 3 && !profitId; attempt++) {
      profitId = (await this.findTpsl(symbol, positionSide)).profitId || null;
      if (attempt < 2 && !profitId) await sleep(1000);
    }
    console.info(`[position] attached TP/SL to existing ${symbol} ${positionSide}: ${contracts}c TP=${triggerProfitPrice} SL=${triggerStopPrice} profit_id=${profitId}`);
    return [true, contracts, profitId, `created TP=${triggerProfitPrice} SL=${triggerStopPrice} on ${contracts} contracts`];
  }

  // Guarantees the position has a live exchange TP/SL (creates one when rejected)
  async ensureTpsl(symbol, positionSide, { triggerStopPrice = null, triggerProfitPrice = null, signalStrength = 0.6, confidence = 70 } = {}) {
    const pos = await this.getPositionPnl(symbol, positionSide);
    if (!pos.exists) return [null, 'no open position'];
    const existing = await this._getProfitId(symbol, positionSide, pos);
    if (existing) return [existing, 'already protected'];
    const entry = pos.entry_price;
    const leverage = pos.leverage;
    if (entry <= 0) return [null, 'position has no entry price'];

    const [autoTp, autoSl] = await this.calculateDynamicTpsl(symbol, positionSide, entry, signalStrength, confidence, leverage);
    let tp = triggerProfitPrice || autoTp;
    let sl = triggerStopPrice || autoSl;

    // A stop beyond the mark price would trigger instantly — pull it to safe side
    const mark = pos.mark_price || entry;
    const safety = this.memory.getNum('sl_liquidation_safety', 0.5);
    const maxDist = this.liquidationDistance(entry, leverage) * safety;
    if (positionSide === 'LONG') {
      const safeSl = await this.risk.roundPrice(symbol, entry - maxDist); // minimum SL (liquidation safety)
      const safeSlPrice = await this.risk.roundPrice(symbol, mark * 0.999); // maximum SL (0.1% below mark to avoid instant trigger)
      // FIX: check if valid SL range exists (safeSl <= safeSlPrice). Also check if mark already past safeSl.
      if (mark <= safeSl || safeSl > safeSlPrice) {
        return [null, `position is already past the safe stop level (mark ${mark}, safe_sl ${safeSl}) or no valid SL range exists; close it or widen sl_liquidation_safety.`];
      }
      sl = Math.min(Math.max(sl, safeSl), safeSlPrice);
      tp = Math.max(tp, await this.risk.roundPrice(symbol, mark * 1.001));
    } else {
      const safeSl = await this.risk.roundPrice(symbol, entry + maxDist); // minimum SL distance (liquidation safety)
      const safeSlPrice = await this.risk.roundPrice(symbol, mark * 1.001); // maximum SL (0.1% above mark)
      // FIX: check if valid SL range exists (safeSlPrice <= safeSl). Also check if mark already past safeSl.
      if (mark >= safeSl || safeSlPrice > safeSl) {
        return [null, `position is already past the safe stop level (mark ${mark}, safe_sl ${safeSl}) or no valid SL range exists; close it or widen sl_liquidation_safety.`];
      }
      sl = Math.max(Math.min(sl, safeSl), safeSlPrice);
      tp = Math.min(tp, await this.risk.roundPrice(symbol, mark * 0.999));
    }
    const [ok, , profitId, note] = await this.attachTpslToPosition(symbol, positionSide, tp, sl);
    if (!ok) return [null, `could not create TP/SL: ${note}`];
    return [profitId, note];
  }

  async cancelAllTpsl(symbol) {
    try { await this.xt.cancelAllTpsl(symbol); return true; }
    catch (e) { console.warn(`[position] cancel TP/SL failed ${symbol}: ${e.message}`); return false; }
  }

  async _moveStop(symbol, profitId, newSl, keepTp = null) {
    console.info(`[position] MOVE_STOP ${symbol}: profit_id=${profitId} new_sl=${newSl} keep_tp=${keepTp}`);
    try {
      const patch = { triggerStopPrice: String(newSl) };
      if (keepTp != null) patch.triggerProfitPrice = String(keepTp);
      await this.xt.updateTpsl(profitId, patch);
      console.info(`[position] MOVE_STOP OK: ${symbol} profit_id=${profitId}`);
      return true;
    } catch (e) {
      console.warn(`[position] move stop failed ${symbol} (profitId=${profitId}): ${e.message}`);
      return false;
    }
  }

  // ---------- breakeven & trailing ----------
  _breakevenThreshold() {
    // Stored value trusted only inside a sane band 1..25% ROI
    const raw = this.memory.getNum('breakeven_threshold_pct', Config.BREAKEVEN_THRESHOLD_PCT);
    if (raw <= 0 || raw > 25) return Config.BREAKEVEN_THRESHOLD_PCT;
    return raw;
  }

  async checkTpslBreakeven(symbol, positionSide) {
    const pos = await this.getPositionPnl(symbol, positionSide);
    if (!pos.exists) return false;
    const threshold = this._breakevenThreshold();
    if (pos.roi < threshold) return false;
    const entry = pos.entry_price;
    if (entry <= 0) return false;
    const entrust = await this._getProfitEntrust(symbol, positionSide, pos);
    const profitId = entrust.profitId;
    if (!profitId) {
      console.warn(`[position] breakeven blocked ${symbol} ${positionSide}: no active TP/SL entrust found`);
      return false;
    }
    // Real entrust prices (position object reports 0 — XT bug)
    const currentSl = Number(entrust.triggerStopPrice || 0);
    const currentTp = Number(entrust.triggerProfitPrice || 0);
    // Only ever tighten. LONG stop sits below entry -> move to entry*1.0005
    // (a step ABOVE entry); SHORT -> entry*0.9995 (a step BELOW).
    let newSl;
    if (positionSide === 'LONG') {
      newSl = await this.risk.roundPrice(symbol, entry * 1.0005);
      if (currentSl >= newSl) return false;
    } else {
      newSl = await this.risk.roundPrice(symbol, entry * 0.9995);
      if (0 < currentSl && currentSl <= newSl) return false;
    }
    console.info(`[position] breakeven ${symbol} ${positionSide}: ROI=${pos.roi.toFixed(2)}% current_sl=${currentSl} -> new_sl=${newSl} profit_id=${profitId}`);
    const keepTp = currentTp > 0 ? currentTp : null;
    if (await this._moveStop(symbol, profitId, newSl, keepTp)) {
      console.info(`[position] breakeven: ${symbol} ${positionSide} ROI ${pos.roi.toFixed(2)}% SL ${currentSl} -> ${newSl}`);
      return true;
    }
    console.warn(`[position] breakeven move REJECTED ${symbol} ${positionSide}: new_sl=${newSl} profit_id=${profitId}`);
    return false;
  }

  async trailStopLoss(symbol, positionSide) {
    const pos = await this.getPositionPnl(symbol, positionSide);
    if (!pos.exists) return [false, 'no open position', null];
    // Trigger is ROI on margin; distance is a raw price percentage (separate knobs)
    // FIX: legacy trailing_stop_pct is a PRICE % move — only valid as fallback for distancePct.
    // triggerRoi (ROI %) needs its own sensible default, not the legacy price % value.
    let triggerRoi = this.memory.getNum('trailing_trigger_roi_pct', 0);
    let distancePct = this.memory.getNum('trailing_distance_pct', 0);
    let legacy = this.memory.getNum('trailing_stop_pct', 2.0);
    if (!(legacy > 0 && legacy < 20)) legacy = Config.TRAILING_STOP_PCT;
    if (triggerRoi <= 0 || triggerRoi > 100) triggerRoi = Config.TRAILING_TRIGGER_ROI_PCT; // ROI% default, not legacy price%
    if (distancePct <= 0 || distancePct >= 20) distancePct = legacy || Config.TRAILING_DISTANCE_PCT; // legacy is price%, OK here
    if (pos.roi < triggerRoi) return [false, `ROI ${pos.roi.toFixed(2)}% below trailing trigger ${triggerRoi}%`, null];
    const entrust = await this._getProfitEntrust(symbol, positionSide, pos);
    const profitId = entrust.profitId;
    if (!profitId) return [false, 'no active TP/SL entrust found (cannot move the stop)', null];
    const mark = pos.mark_price;
    if (mark <= 0) return [false, 'no mark price available', null];
    const currentSl = Number(entrust.triggerStopPrice || 0);
    const currentTp = Number(entrust.triggerProfitPrice || 0);
    let newSl, improved;
    if (positionSide === 'LONG') {
      newSl = await this.risk.roundPrice(symbol, mark * (1 - distancePct / 100));
      improved = newSl > currentSl;
    } else {
      newSl = await this.risk.roundPrice(symbol, mark * (1 + distancePct / 100));
      improved = currentSl <= 0 || newSl < currentSl;
    }
    if (!improved) return [false, `no improvement (SL already ${currentSl})`, null];
    const keepTp = currentTp > 0 ? currentTp : null;
    if (await this._moveStop(symbol, profitId, newSl, keepTp)) {
      return [true, `Trailing SL ${currentSl} -> ${newSl}`, newSl];
    }
    return [false, 'stop update rejected by exchange', null];
  }

  async explainMidManagement(symbol, positionSide) {
    const pos = await this.getPositionPnl(symbol, positionSide);
    if (!pos.exists) return `${symbol} ${positionSide}: no open position on the exchange.`;
    let beThreshold = this.memory.getNum('breakeven_threshold_pct', Config.BREAKEVEN_THRESHOLD_PCT);
    const legacy = this.memory.getNum('trailing_stop_pct', Config.TRAILING_STOP_PCT);
    // FIX: legacy trailing_stop_pct is a PRICE % move — only valid as fallback for distancePct.
    // triggerRoi (ROI %) needs its own sensible default.
    let triggerRoi = this.memory.getNum('trailing_trigger_roi_pct', 0) || Config.TRAILING_TRIGGER_ROI_PCT;
    let distancePct = this.memory.getNum('trailing_distance_pct', 0) || legacy || Config.TRAILING_DISTANCE_PCT;
    if (beThreshold <= 0 || beThreshold > 25) beThreshold = Config.BREAKEVEN_THRESHOLD_PCT;
    if (triggerRoi <= 0 || triggerRoi > 100) triggerRoi = Config.TRAILING_TRIGGER_ROI_PCT;
    if (distancePct <= 0 || distancePct >= 20) distancePct = Config.TRAILING_DISTANCE_PCT;
    const entrust = await this._getProfitEntrust(symbol, positionSide, pos);
    const profitId = entrust.profitId;
    const entrustSl = Number(entrust.triggerStopPrice || 0);
    const entrustTp = Number(entrust.triggerProfitPrice || 0);
    const lines = [
      `${symbol} ${positionSide}`,
      `  entry=${pos.entry_price} mark=${pos.mark_price} lev=${pos.leverage}x size=${Math.floor(pos.position_size)}c`,
      `  ROI on margin = ${pos.roi.toFixed(2)}%`,
      `  exchange SL=${entrustSl} TP=${entrustTp} profitId=${profitId}`,
      `  breakeven fires at ROI >= ${beThreshold}% -> ${pos.roi >= beThreshold ? 'READY' : 'not yet'}`,
      `  trailing fires at ROI >= ${triggerRoi}% (distance ${distancePct}% of price) -> ${pos.roi >= triggerRoi ? 'READY' : 'not yet'}`,
    ];
    if (!profitId) lines.push('  BLOCKED: no active TP/SL entrust found, so no stop can be moved.');
    if (pos.mark_price <= 0) lines.push('  BLOCKED: exchange returned no mark price, so ROI reads 0.');
    return lines.join('\n');
  }

  // One mid-management pass: adoption + tpsl recovery + breakeven + trailing
  async midManagePositions() {
    const actions = [];
    for (const event of await this.adoptExchangePositions()) {
      actions.push({
        trade_id: event.trade_id, symbol: event.symbol, action: 'position_adopted',
        details: `${event.position_side} ${event.size}c @ ${event.entry_price} ${event.leverage}x was open on XT but untracked; now managed${event.has_stop ? '' : ' (NO exchange stop)'}`,
      });
    }
    for (const trade of this.memory.getOpenTrades()) {
      const symbol = trade.symbol;
      const side = trade.position_side;
      const [profitId, note] = await this.ensureTpsl(symbol, side, {
        signalStrength: trade.signal_strength || 0.6,
        confidence: trade.confidence || 70,
      });
      if (profitId && note.startsWith('created')) {
        actions.push({ trade_id: trade.id, symbol, action: 'tpsl_recovered', details: note });
      } else if (!profitId && note !== 'no open position') {
        actions.push({ trade_id: trade.id, symbol, action: 'tpsl_missing', details: note });
      }
      if (await this.checkTpslBreakeven(symbol, side)) {
        actions.push({ trade_id: trade.id, symbol, action: 'breakeven_activated', details: 'Stop loss moved to entry' });
      }
      const [trailed, msg] = await this.trailStopLoss(symbol, side);
      if (trailed) actions.push({ trade_id: trade.id, symbol, action: 'trailing_updated', details: msg });
    }
    return actions;
  }

  // ---------- closing ----------
  async closePosition(symbol, positionSide, tradeId, contracts = null) {
    // Reads PnL BEFORE closing (position disappears afterwards)
    const pos = await this.getPositionPnl(symbol, positionSide);
    if (!pos.exists) {
      console.info(`[position] ${symbol} ${positionSide} already gone on exchange; marking trade ${tradeId} closed`);
      this.memory.closeTrade(tradeId, pos.mark_price, 0, 'position not found on exchange');
      return [false, null, 'position not found on exchange'];
    }
    const realizedPnl = pos.unrealized_pnl;
    const exitPrice = pos.mark_price;
    const qty = Math.floor(contracts || pos.available_close_size || pos.position_size);
    if (qty <= 0) return [false, null, 'nothing available to close'];

    // Cancel only THIS position's TP/SL (cancel_all destroys hedged sides' stops)
    const posInfo = await this.getPositionPnl(symbol, positionSide);
    if (posInfo.profit_id) {
      try { await this.xt.cancelTpsl(posInfo.profit_id); }
      catch (e) { console.warn(`[position] could not cancel TP/SL ${posInfo.profit_id}: ${e.message}`); }
    }
    const closeSide = positionSide === 'LONG' ? 'SELL' : 'BUY';
    let data;
    try {
      data = await this.xt.createOrder({
        symbol, positionSide, orderSide: closeSide, orderType: 'MARKET',
        origQty: qty, timeInForce: 'IOC',
      });
    } catch (e) {
      console.error(`[position] close order failed ${symbol} ${positionSide}: ${e.message}`);
      return [false, null, e.message];
    }
    this.risk.invalidateBalanceCache();
    this.memory.closeTrade(tradeId, exitPrice, realizedPnl);
    // Cooldown covers BOTH sides (a signal flip must not open the opposite instantly)
    const cooldownMin = this.memory.getInt('cooldown_minutes', Config.SIGNAL_COOLDOWN_MINUTES);
    this.memory.setCooldown(symbol, 'LONG', cooldownMin);
    this.memory.setCooldown(symbol, 'SHORT', cooldownMin);
    return [true, data, null];
  }

  async reconcileOpenTrades() {
    // Detects positions closed outside the bot (liquidation, ADL, manual, TP/SL hit)
    const closed = [];
    for (const trade of this.memory.getOpenTrades()) {
      const symbol = trade.symbol;
      const side = trade.position_side;
      const pos = await this.getPositionPnl(symbol, side);
      if (pos.exists) continue;
      console.warn(`[position] trade ${trade.id} (${symbol} ${side}) has no matching exchange position — closed externally`);
      let estPnl = 0;
      let estExit = 0;
      const entry = trade.entry_price || 0;
      const amount = trade.amount || 0;
      if (entry > 0 && amount > 0) {
        try {
          const ticker = await this.xt.getAggTicker(symbol);
          estExit = Number(ticker.c || 0);
          if (estExit > 0) {
            const cs = await this.risk.getContractSize(symbol);
            const diff = side === 'LONG' ? estExit - entry : entry - estExit;
            estPnl = diff * amount * cs;
          }
        } catch {}
      }
      this.memory.closeTrade(trade.id, estExit, estPnl, 'closed externally (liquidation/TPSL/manual)');
      const cooldownMin = this.memory.getInt('cooldown_minutes', Config.SIGNAL_COOLDOWN_MINUTES);
      this.memory.setCooldown(symbol, 'LONG', cooldownMin);
      this.memory.setCooldown(symbol, 'SHORT', cooldownMin);
      closed.push({ trade_id: trade.id, symbol, position_side: side, reason: 'closed_externally' });
    }
    return closed;
  }
}
