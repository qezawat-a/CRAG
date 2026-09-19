// trader/trader.js — port-e kamel az CryptoMind-XT/bot/trader.py
// ------------------------------------------------------------
// XTTrader: scan -> signal gate -> open (leverage/size/dynamic TP/SL) ->
// guard (software stop) -> mid-manager guardian (breakeven/trailing/TPSL) ->
// auto-trade loop (adoption + reconcile + reports).
// Strategies/Scanner: az xt-agent (src/xt/scanner.js + indicators.js).
import { XTClient } from '../xt/client.js';
import { RiskManager } from '../xt/risk.js';
import { PositionManager } from './position-manager.js';
import { scanMultiTimeframe, getCurrentPrice } from '../xt/scanner.js';
import { Config, xtClientConfig } from '../config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class XTTrader {
  constructor(memory = null) {
    this.memory = memory;
    this.xt = new XTClient(xtClientConfig());
    this.risk = new RiskManager(this.xt, { getSetting: (k, d) => this.memory.getSetting(k, d) });
    this.positionMgr = new PositionManager(this.xt, this.memory, this.risk);
    this._autoTradeEnabled = false;
    this._midManageRunning = false;
    this._stopMonitor = false;
    this._stopMidManager = false;
    this._midBusy = false; // serializes guardian vs manual midmanage
    this._notifyCallback = null;
    this.MID_MANAGE_DEFAULT_INTERVAL_SEC = 30;
    this._timers = [];
  }

  setNotifyCallback(cb) { this._notifyCallback = cb; }

  _notify(message) {
    console.info(`[trader] NOTIFY: ${String(message).split('\n')[0]}...`);
    if (this._notifyCallback) {
      try { this._notifyCallback(message); }
      catch (e) { console.error(`[trader] notification dispatch failed: ${e.message}`); }
    }
  }

  _intervals() {
    return String(this.memory.getSetting('timeframes', Config.DEFAULT_TIMEFRAMES.join(',')))
      .split(',').map((x) => x.trim()).filter(Boolean);
  }

  // ---------- scanner wrapper (record + format) ----------
  async scanAndReport(symbol = null) {
    symbol = symbol || this.memory.getSetting('symbol', Config.DEFAULT_SYMBOL);
    const minConf = this.memory.getInt('min_confidence', Config.MIN_CONFIDENCE);
    const intervals = this._intervals();
    const result = await scanMultiTimeframe(this.xt, symbol, intervals, {
      minConfidence: minConf,
      tfMinConfidence: this.memory.getInt('tf_min_confidence', Config.TF_MIN_CONFIDENCE),
      minAgree: this.memory.getInt('min_agreeing_strategies', Config.MIN_AGREEING_STRATEGIES),
    });
    result.price = await getCurrentPrice(this.xt, symbol);
    result.symbol = symbol;
    result.timestamp = Date.now() / 1000;
    if (result.direction !== 'NEUTRAL' && result.confidence >= minConf) {
      // dedupe: identical signal in the last 120s is not recorded again
      const recent = this.memory.getRecentSignals(symbol, 5);
      const now = Date.now() / 1000;
      const dup = recent.some((s) => s.direction === result.direction
        && s.timeframe === intervals.join(',')
        && now - Number(s.timestamp) < 120);
      if (!dup) {
        this.memory.recordSignal({
          symbol, direction: result.direction,
          strategy: (result.strategiesUsed || []).join(',') || 'MULTI',
          timeframe: intervals.join(','), confidence: result.confidence,
          signalStrength: result.signalStrength, price: result.price,
        });
      }
    }
    return result;
  }

  formatSignalReport(result) {
    if (result.error && !result.direction) return `Signal Scan Error: ${result.error}`;
    let r = `=== SIGNAL SCAN [${result.symbol || 'N/A'}] ===\n`;
    r += `Direction: ${result.direction}\n`;
    r += `Confidence: ${result.confidence}%\n`;
    r += `Signal Strength: ${Number(result.signalStrength || 0).toFixed(2)}\n`;
    r += `Price: ${result.price ?? 0}\n`;
    if (result.strategiesUsed && result.strategiesUsed.length) r += `Strategies: ${result.strategiesUsed.join(', ')}\n`;
    const gate = this.memory.getInt('tf_min_confidence', Config.TF_MIN_CONFIDENCE);
    for (const [tf, x] of Object.entries(result.timeframeResults || {})) {
      if (x.error) { r += `  ${tf}: no data (${x.error})\n`; continue; }
      const fired = [];
      const below = [];
      for (const s of x.allSignals || []) {
        if (!s.side || s.side === 'NEUTRAL') continue;
        const entry = `${s.strategy}=${s.side}(${s.conf}%)`;
        (s.conf < gate ? below : fired).push(entry);
      }
      const parts = [];
      if (fired.length) parts.push(fired.join(', '));
      if (below.length) parts.push(`below ${gate}% gate: ${below.join(', ')}`);
      if (!parts.length) parts.push('no strategy fired');
      r += `  ${tf}: ${x.direction} (${x.confidence}%) [${parts.join(' | ')}]\n`;
    }
    r += `\nLong: ${Number(result.longWeight || 0).toFixed(2)} | Short: ${Number(result.shortWeight || 0).toFixed(2)} | Voted: ${Number(result.votedWeight || 0).toFixed(2)}`;
    if (result.vetoReason) r += `\nVeto: ${result.vetoReason}`;
    return r;
  }

  // ---------- status ----------
  _cooldownStatus(symbol) {
    const status = [];
    for (const side of ['LONG', 'SHORT']) {
      if (this.memory.isInCooldown(symbol, side)) {
        status.push(`${side}: ${this.memory.getCooldownRemaining(symbol, side).toFixed(0)}s remaining`);
      }
    }
    return status.join(', ') || 'none';
  }

  async getStatusReport() {
    const symbol = this.memory.getSetting('symbol', Config.DEFAULT_SYMBOL);
    let balanceLine;
    try {
      const balance = await this.risk.getTotalBalance();
      const available = await this.risk.getAvailableBalance();
      balanceLine = `Balance: ${balance.toFixed(2)} USDT | Available: ${available.toFixed(2)} USDT\n`;
    } catch (e) {
      balanceLine = `Balance: unavailable (${e.message})\n`;
    }
    const pnl = this.memory.getTotalPnl();
    const stats = this.memory.getTradeCount();
    const settings = this.memory.getAllSettings();

    let report = '=== XT AI TRADER STATUS ===\n';
    report += `Symbol: ${symbol}\n`;
    report += balanceLine;
    report += `Total PnL: ${pnl.toFixed(4)} USDT\n`;
    report += `Trades: ${stats.total} total | ${stats.open} open | ${stats.closed} closed | ${stats.winrate}% WR\n`;
    report += `Auto-Trade: ${this._autoTradeEnabled ? 'ON' : 'OFF'}\n`;
    report += `Mid-Management: ${this._midManageRunning ? 'ON' : 'OFF'}\n`;
    report += `Cooldowns: ${this._cooldownStatus(symbol)}\n\n`;
    report += '--- SETTINGS ---\n';
    report += `Leverage: ${settings.leverage ?? Config.DEFAULT_LEVERAGE}x\n`;
    report += `Margin Mode: ${settings.position_type ?? settings.margin_mode ?? Config.DEFAULT_MARGIN_MODE}\n`;
    report += `Timeframes: ${settings.timeframes ?? Config.DEFAULT_TIMEFRAMES.join(',')}\n`;
    report += `Margin Amount: ${settings.margin_amount_pct ?? Config.DEFAULT_MARGIN_AMOUNT_PCT}%\n`;
    report += `Risk: ${settings.margin_risk_pct ?? Config.DEFAULT_RISK_PCT}%\n`;
    report += `Min Confidence: ${settings.min_confidence ?? Config.MIN_CONFIDENCE}%\n`;
    report += `Position Mode: ${settings.position_mode ?? 'margin'}\n`;
    try {
      const cs = await this.risk.getContractSize(symbol);
      report += `\n--- CONTRACT (${symbol}) ---\n`;
      report += `Contract Size: ${cs} | Min Qty: ${await this.risk.getMinQty(symbol)} contracts\n`;
      report += `Min Notional: ${await this.risk.getMinNotional(symbol)} USDT | Max Leverage: ${await this.risk.getMaxLeverage(symbol)}x\n`;
    } catch (e) {
      report += `Contract info unavailable: ${e.message}\n`;
    }
    const openTrades = this.memory.getOpenTrades();
    if (openTrades.length) {
      report += '\n--- OPEN POSITIONS ---\n';
      for (const t of openTrades) {
        const pos = await this.positionMgr.getPositionPnl(t.symbol, t.position_side);
        if (!pos.exists) {
          report += `ID:${t.id} ${t.symbol} ${t.position_side} NOT FOUND ON EXCHANGE (stale)\n`;
          continue;
        }
        report += `ID:${t.id} ${t.symbol} ${t.position_side} Entry:${pos.entry_price} Mark:${pos.mark_price} Size:${Math.floor(pos.position_size)}c PnL:${pos.unrealized_pnl.toFixed(4)} ROI:${pos.roi.toFixed(2)}% Lev:${pos.leverage}x | ${t.strategy} Conf:${t.confidence}%\n`;
      }
    }
    return report;
  }

  // ---------- signal gate ----------
  async _gateChecks(symbol, direction) {
    const maxPositions = this.memory.getInt('max_positions', Config.MAX_POSITIONS);
    const openTrades = this.memory.getOpenTrades(symbol);
    if (openTrades.length >= maxPositions) return `max positions (${maxPositions}) reached for ${symbol}`;
    if (this.memory.isInCooldown(symbol, direction)) {
      const rem = this.memory.getCooldownRemaining(symbol, direction);
      if (rem > 600) return `stale cooldown row active — ${rem.toFixed(0)}s remaining (over the 10-min cap, written before the fix). Ask for /reset_cooldown`;
      const mins = this.memory.getInt('cooldown_minutes', Config.SIGNAL_COOLDOWN_MINUTES);
      return `cooldown active — ${rem.toFixed(0)}s remaining (setting is ${mins} min after every close — protection against revenge-trading)`;
    }
    for (const trade of openTrades) {
      if (trade.position_side === direction) return `already have an open ${direction} position for ${symbol}`;
    }
    return null;
  }

  // ---------- scan + reversal ----------
  _reversalCheck(result) {
    const enabled = this.memory.getBool('reversal_enabled', Config.REVERSAL_ENABLED);
    if (!enabled) return;
    const threshold = this.memory.getInt('reversal_confidence', Config.REVERSAL_CONFIDENCE);
    // FIX: add reversal_scope setting ('symbol' = only same symbol, 'all' = any symbol)
    // Default to 'symbol' to avoid accidentally closing positions on other symbols
    const scope = this.memory.getSetting('reversal_scope', 'symbol');
    const direction = result.direction;
    const confidence = result.confidence;
    const symbol = this.memory.getSetting('symbol', Config.DEFAULT_SYMBOL);
    if (direction === 'NEUTRAL' || confidence < threshold) return;
    for (const trade of this.memory.getOpenTrades()) {
      if (trade.position_side === direction) continue; // aligned
      if (scope === 'symbol' && trade.symbol !== symbol) continue; // different symbol, skip
      console.info(`[trader] reversal: closing ${trade.position_side} ${trade.symbol} (signal ${direction} @ ${confidence}% >= ${threshold}%)`);
      this._notify(`REVERSAL: signal flipped to ${direction} at ${confidence}% — closing ${trade.position_side} ${trade.symbol}`);
      this.closeSpecificTrade(trade.id).catch((e) => console.error(`[trader] reversal close failed: ${e.message}`));
    }
  }

  async _scanCycle() {
    // One scan reused for entry gating AND reversal detection (halves kline calls)
    const symbol = this.memory.getSetting('symbol', Config.DEFAULT_SYMBOL);
    const minConf = this.memory.getInt('min_confidence', Config.MIN_CONFIDENCE);
    const result = await this.scanAndReport(symbol);
    const direction = result.direction;
    const confidence = result.confidence;

    this._reversalCheck(result);

    if (direction === 'NEUTRAL' || confidence < minConf) {
      console.info(`[trader] no actionable entry signal for ${symbol}: ${direction} at ${confidence}%`);
      return result;
    }
    const reason = await this._gateChecks(symbol, direction);
    if (reason) {
      console.info(`[trader] entry suppressed for ${symbol}: ${reason}`);
      return result;
    }
    console.info(`[trader] signal to ${direction} ${symbol} at ${confidence}% confidence`);
    this._notify(`Signal: ${direction} ${symbol} at ${confidence}% [strength ${Number(result.signalStrength).toFixed(2)}]`);
    const outcome = await this.executeTrade(direction, this._decideOrderType(result), this._decideTimeInForce(result));
    console.info(`[trader] auto-trade result: ${String(outcome).split('\n')[0]}`);
    return result;
  }

  _decideOrderType(scan) {
    const configured = String(this.memory.getSetting('ai_order_type', 'auto')).toLowerCase();
    if (configured !== 'auto') return configured.toUpperCase();
    return 'MARKET'; // micro-entry scalping wants MARKET fills (1m/3m timeframes)
  }

  _decideTimeInForce() {
    return null; // auto: IOC for MARKET, GTC for LIMIT (decided in executeTrade)
  }

  _extractOrderId(orderData) {
    if (orderData && typeof orderData === 'object') return orderData.orderId || orderData.id || null;
    if (typeof orderData === 'string' && orderData) return orderData;
    if (Array.isArray(orderData) && orderData[0] && typeof orderData[0] === 'object') return orderData[0].orderId || null;
    return null;
  }

  // ---------- trade execution ----------
  async executeTrade(direction, orderType = 'MARKET', timeInForce = null, requestedLeverage = null) {
    const symbol = this.memory.getSetting('symbol', Config.DEFAULT_SYMBOL);
    const minConf = this.memory.getInt('min_confidence', Config.MIN_CONFIDENCE);
    const leverageSetting = requestedLeverage || this.memory.getInt('leverage', Config.DEFAULT_LEVERAGE);
    const marginMode = this.memory.getSetting('position_type', this.memory.getSetting('margin_mode', Config.DEFAULT_MARGIN_MODE));

    if (direction !== 'LONG' && direction !== 'SHORT') return `Invalid direction: ${direction}`;
    const gateReason = await this._gateChecks(symbol, direction);
    if (gateReason) return `Cannot open trade: ${gateReason}`;

    if (!(await this.risk.supportsOrderType(symbol, orderType))) {
      return `${symbol} does not support ${orderType} orders`;
    }

    const scan = await this.scanAndReport(symbol);
    if (scan.confidence < minConf) {
      return `Confidence ${scan.confidence}% is below threshold ${minConf}%.\n${this.formatSignalReport(scan)}`;
    }
    if (scan.direction !== direction) {
      return `Current signal direction is ${scan.direction}, not ${direction}. Check /signal`;
    }

    // min_agreeing_strategies gate (agent path bypasses _scanCycle, so enforce here)
    const minAgree = this.memory.getInt('min_agreeing_strategies', Config.MIN_AGREEING_STRATEGIES);
    const strategiesUsed = scan.strategiesUsed || [];
    if (strategiesUsed.length < minAgree) {
      const rsiOnly = strategiesUsed.length === 1 && (strategiesUsed[0] === 'RSI_REVERSAL' || strategiesUsed[0] === 'RSI');
      if (!(rsiOnly && scan.confidence >= 88)) {
        return `Only ${strategiesUsed.length} strategy agrees (${strategiesUsed.join(', ') || 'none'}), need ${minAgree}. Signal too weak.\n${this.formatSignalReport(scan)}`;
      }
    }

    if (String(process.env.XT_DRY_RUN || '').toLowerCase() === '1') {
      return `DRY_RUN=1 — order preview (ejra NEMISHAN): ${direction} ${symbol} @ ${scan.price}, lev=${leverageSetting}, conf=${scan.confidence}%`;
    }

    const price = scan.price;
    if (!(price > 0)) return 'Could not get current price from XT. Aborting.';
    const confidence = scan.confidence;
    const strength = scan.signalStrength;

    // provisional leverage -> provisional TP/SL (for risk-based sizing) -> size
    const provisionalLeverage = await this.risk.validateLeverage(symbol, leverageSetting);
    const [, provisionalSlPrice] = await this.positionMgr.calculateDynamicTpsl(symbol, direction, price, strength, confidence, provisionalLeverage);
    let { qty, mode: sizeMode, reason: sizeReason } = await this.risk.calculatePositionSize(symbol, price, provisionalLeverage, { stopLossPrice: provisionalSlPrice, orderType });
    if (qty <= 0) return `Cannot size position: ${sizeReason}`;

    let notional = await this.risk.contractsToNotional(symbol, qty, price);
    const leverage = await this.risk.validateLeverage(symbol, leverageSetting, notional);
    // margin mode: size depends on leverage -> recalc with correct leverage
    if (this.memory.getSetting('position_mode', 'margin') === 'margin') {
      ({ qty, mode: sizeMode, reason: sizeReason } = await this.risk.calculatePositionSize(symbol, price, leverage, { stopLossPrice: provisionalSlPrice, orderType }));
      if (qty <= 0) return `Cannot size position: ${sizeReason}`;
    }
    notional = await this.risk.contractsToNotional(symbol, qty, price);

    const [tpPrice, slPrice] = await this.positionMgr.calculateDynamicTpsl(symbol, direction, price, strength, confidence, leverage);

    if (marginMode === 'CROSSED' || marginMode === 'ISOLATED') {
      try { await this.xt.setPositionType(symbol, direction, marginMode); }
      catch (e) { console.info(`[trader] margin mode unchanged for ${symbol} ${direction}: ${e.message}`); }
    }
    try { await this.xt.setLeverage(symbol, direction, leverage); }
    catch (e) { return `Could not set leverage to ${leverage}x: ${e.message}`; }

    if (!timeInForce) timeInForce = orderType === 'MARKET' ? 'IOC' : 'GTC';
    if (!(await this.risk.supportsTif(symbol, timeInForce))) {
      return `${symbol} does not support timeInForce=${timeInForce}`;
    }
    const limitPrice = orderType === 'LIMIT' ? await this.risk.roundPrice(symbol, price) : null;

    console.info(`[trader] opening ${direction} ${symbol}: ${qty} contracts (~${notional.toFixed(2)} USDT) at ${price} lev=${leverage}x tp=${tpPrice} sl=${slPrice} conf=${confidence}% mode=${sizeMode}`);

    let orderData;
    try {
      orderData = await this.xt.createOrder({
        symbol, positionSide: direction,
        orderSide: direction === 'LONG' ? 'BUY' : 'SELL',
        orderType, origQty: qty, price: limitPrice, timeInForce,
      });
    } catch (e) {
      if (e.orderOutcomeUnknown) {
        const message = `Natije-ye order NAMALUM ast: ${e.message}. Retry nashod; momkene order dar XT sabt shode bashe. Ghabl az talash-e dobare, positions va orders-e XT ro check kon.`;
        this._notify(message);
        return message;
      }
      return `Order rejected by XT: ${e.message}`;
    }
    this.risk.invalidateBalanceCache();
    const orderId = this._extractOrderId(orderData);
    return this._finalizeOpen({ symbol, direction, orderType, orderId, qty, price, confidence, strength, leverage, tpPrice, slPrice, marginMode, sizeMode, scan });
  }

  async _finalizeOpen({ symbol, direction, orderType, orderId, qty, price, confidence, strength, leverage, tpPrice, slPrice, marginMode, sizeMode, scan }) {
    // XT create-order response carries no fill price — read back from position
    let entryPrice = price;
    let filledQty = 0;
    for (let i = 0; i < 3; i++) {
      const pos = await this.positionMgr.getPositionPnl(symbol, direction);
      if (pos.exists && pos.position_size > 0) {
        if (pos.entry_price > 0) entryPrice = pos.entry_price;
        filledQty = Math.floor(pos.position_size);
        break;
      }
      await sleep(1000);
    }
    if (filledQty <= 0) {
      // A LIMIT order can rest unfilled — never leave it unprotected
      let cancelNote;
      try {
        if (orderId) { await this.xt.cancelOrder(orderId); cancelNote = 'unfilled order cancelled'; }
        else { await this.xt.cancelAllOrders(symbol); cancelNote = 'open orders cancelled'; }
      } catch (e) { cancelNote = `could not cancel order: ${e.message}`; }
      const msg = `${orderType} ${direction} ${symbol} did not fill (${qty} contracts requested). ${cancelNote}. No position opened.`;
      this._notify(msg);
      return msg;
    }

    // Recompute TP/SL against the real fill if it drifted
    let finalTp = tpPrice;
    let finalSl = slPrice;
    if (Math.abs(entryPrice - price) / price > 0.001) {
      [finalTp, finalSl] = await this.positionMgr.calculateDynamicTpsl(symbol, direction, entryPrice, strength, confidence, leverage);
    }

    const strategiesStr = (scan.strategiesUsed || []).join(',');
    const tradeId = this.memory.recordTrade({
      symbol, positionSide: direction, orderId, entryPrice, amount: filledQty,
      leverage, confidence, strategy: strategiesStr, signalStrength: strength,
      timeframe: this.memory.getSetting('timeframes', Config.DEFAULT_TIMEFRAMES.join(',')),
    });

    const [ok, protectedQty, , tpslError] = await this.positionMgr.attachTpslToPosition(symbol, direction, finalTp, finalSl);
    const tpslStatus = ok ? `set on ${protectedQty} contracts` : `FAILED: ${tpslError}`;

    const liqDistance = this.positionMgr.liquidationDistance(entryPrice, leverage);
    const slDistance = Math.abs(entryPrice - finalSl);
    let summary = `Trade ID:${tradeId} OPENED ${direction} ${symbol}\n`;
    summary += `Entry: ${entryPrice} | Size: ${filledQty} contracts (~${(await this.risk.contractsToNotional(symbol, filledQty, entryPrice)).toFixed(2)} USDT)\n`;
    summary += `Leverage: ${leverage}x | TP: ${finalTp} | SL: ${finalSl}\n`;
    summary += `SL is ${(slDistance / entryPrice * 100).toFixed(2)}% away | liquidation ~${(liqDistance / entryPrice * 100).toFixed(2)}% away\n`;
    summary += `Confidence: ${confidence}% | Strength: ${Number(strength).toFixed(2)}\n`;
    summary += `Strategy: ${strategiesStr || 'n/a'}\n`;
    summary += `TP/SL: ${tpslStatus} | Sizing: ${sizeMode}\n`;
    summary += `Margin Mode: ${marginMode}`;
    this._notify(summary);

    if (!ok) {
      const failAction = this.memory.getSetting('on_tpsl_failure', Config.ON_TPSL_FAILURE);
      if (failAction === 'close') {
        this._notify(`No stop loss could be placed on ${direction} ${symbol}. Closing the position immediately rather than leaving ${leverage}x exposure unprotected.`);
        const [closed, , closeErr] = await this.positionMgr.closePosition(symbol, direction, tradeId);
        if (closed) return `${summary}\n\nPOSITION CLOSED: no stop loss could be placed (${tpslError}).`;
        this._notify(`URGENT: ${symbol} ${direction} has no stop loss AND could not be closed (${closeErr}). Close it manually on XT now.`);
        return `${summary}\n\nURGENT: unprotected and could not close: ${closeErr}`;
      }
      this._notify(`WARNING: ${symbol} ${direction} has NO exchange stop loss. The software stop is the only protection, and it only checks every ${this.memory.getInt('guard_interval_sec', 15)}s.`);
    }
    return summary;
  }

  // ---------- closing ----------
  async closeSpecificTrade(tradeId) {
    const target = this.memory.getTrade(tradeId);
    if (!target || !target.id) return `Trade ID ${tradeId} not found.`;
    if (target.status === 'CLOSED') return `Trade ID ${tradeId} is already closed.`;
    const [ok, , error] = await this.positionMgr.closePosition(target.symbol, target.position_side, tradeId);
    if (!ok) return `Failed to close trade ${tradeId}: ${error}`;
    const closed = this.memory.getTrade(tradeId);
    const pnl = Number(closed.pnl || 0);
    this._notify(`CLOSED ${target.position_side} ${target.symbol}\nEntry: ${target.entry_price} | Exit: ${closed.exit_price}\nRealized PnL: ${pnl.toFixed(4)} USDT | Total: ${this.memory.getTotalPnl().toFixed(4)} USDT`);
    return `Closed trade ID:${tradeId} ${target.position_side} ${target.symbol} | PnL: ${pnl.toFixed(4)} USDT`;
  }

  async closeAllPositions() {
    const openTrades = this.memory.getOpenTrades();
    if (!openTrades.length) return 'No open positions to close.';
    const out = [];
    for (const t of openTrades) out.push(await this.closeSpecificTrade(t.id));
    return out.join('\n');
  }

  async runMidManagement() {
    let actions;
    try { actions = await this._runMidCycle(); }
    catch (e) { return `Mid-management failed: ${e.message}`; }
    if (!actions.length) return 'No mid-position management actions needed.';
    let report = 'MID-POSITION MANAGEMENT:\n';
    for (const a of actions) report += `Trade ${a.trade_id} ${a.symbol}: ${a.details}\n`;
    return report;
  }

  async protectOpenPositions() {
    const openTrades = this.memory.getOpenTrades();
    if (!openTrades.length) return 'No open trades recorded.';
    const lines = [];
    for (const t of openTrades) {
      const [profitId, note] = await this.positionMgr.ensureTpsl(t.symbol, t.position_side, {
        signalStrength: t.signal_strength || 0.6,
        confidence: t.confidence || 70,
      });
      lines.push(`${profitId ? 'OK' : 'FAILED'} trade ${t.id} ${t.symbol} ${t.position_side}: ${note}`);
    }
    return lines.join('\n');
  }

  async syncPositions() {
    const lines = [];
    const adopted = await this.positionMgr.adoptExchangePositions();
    for (const a of adopted) {
      lines.push(`adopted trade ${a.trade_id}: ${a.symbol} ${a.position_side} ${a.size}c @ ${a.entry_price} ${a.leverage}x (${a.has_stop ? 'has stop' : 'NO STOP'})`);
    }
    for (const c of await this.positionMgr.reconcileOpenTrades()) {
      lines.push(`closed stale trade ${c.trade_id}: ${c.symbol} ${c.position_side} no longer on the exchange`);
    }
    if (!lines.length) return 'In sync: no untracked exchange positions, no stale local trades.';
    return lines.join('\n');
  }

  async diagnose() {
    const out = ['=== MID-MANAGEMENT DIAGNOSTIC ==='];
    try {
      const live = await this.xt.getPositions();
      const liveOpen = live.filter((p) => Number(p.positionSize || 0) > 0);
      out.push(`Exchange reports ${liveOpen.length} open position(s).`);
      for (const p of liveOpen) {
        out.push(`  XT: ${p.symbol} ${p.positionSide} ${Math.floor(Number(p.positionSize || 0))}c profitId=${p.profitId}`);
      }
    } catch (e) {
      out.push(`Could not read exchange positions: ${e.message}`);
    }
    const openTrades = this.memory.getOpenTrades();
    out.push(`Local store tracks ${openTrades.length} open trade(s).`);
    if (!openTrades.length) {
      out.push('Nothing is managed, because every guard iterates the local store. Run /sync to adopt exchange positions.');
      return out.join('\n');
    }
    for (const t of openTrades) {
      out.push(await this.positionMgr.explainMidManagement(t.symbol, t.position_side));
    }
    return out.join('\n');
  }

  // ---------- software stop (safety net) ----------
  async checkPositionsForClose() {
    const closed = [];
    for (const trade of this.memory.getOpenTrades()) {
      const symbol = trade.symbol;
      const side = trade.position_side;
      const pos = await this.positionMgr.getPositionPnl(symbol, side);
      if (!pos.exists) continue;
      const entry = pos.entry_price || trade.entry_price || 0;
      const leverage = pos.leverage || trade.leverage || Config.DEFAULT_LEVERAGE;
      // dynamic limits: 80% of liq distance capped 10-60% as SL; TP left to exchange
      let slPct = 40;
      try {
        const liqDist = this.positionMgr.liquidationDistance(entry, leverage);
        const liqPct = entry ? (liqDist / entry) * 100 : 40;
        slPct = Math.max(10, Math.min(liqPct * 0.8, 60));
      } catch {}
      const roi = pos.roi;
      let reason = null;
      if (roi <= -slPct) reason = 'max_loss';
      if (!reason) continue;
      console.info(`[trader] ${reason} triggered for trade ${trade.id}: ROI ${roi.toFixed(2)}%`);
      const [ok, , err] = await this.positionMgr.closePosition(symbol, side, trade.id);
      if (ok) {
        closed.push({ trade_id: trade.id, reason, roi });
        this._notify(`${reason.toUpperCase().replace('_', ' ')} triggered — closed ${side} ${symbol} at ROI ${roi.toFixed(2)}%`);
      } else {
        this._notify(`Failed to close ${side} ${symbol} on ${reason}: ${err}`);
      }
    }
    return closed;
  }

  // ---------- periodic report ----------
  async periodicPnlReport() {
    const stats = this.memory.getTradeCount();
    const pnl = this.memory.getTotalPnl();
    let report = `=== PERIODIC REPORT ===\nTotal PnL: ${pnl.toFixed(4)} USDT | Trades: ${stats.closed} closed | WR: ${stats.winrate}%\n`;
    const openTrades = this.memory.getOpenTrades();
    if (openTrades.length) {
      for (const t of openTrades) {
        const pos = await this.positionMgr.getPositionPnl(t.symbol, t.position_side);
        if (pos.exists) {
          report += `${t.symbol} ${t.position_side} ID:${t.id} ROI:${pos.roi.toFixed(2)}% PnL:${pos.unrealized_pnl.toFixed(4)} USDT\n`;
        }
      }
    } else {
      report += 'No open positions.\n';
    }
    return report;
  }

  // ---------- automatic mid-management guardian ----------
  async startMidManager() {
    if (this._midManageRunning) return false;
    this._midManageRunning = true;
    this._stopMidManager = false;
    console.info('[trader] automatic mid-management guardian started (breakeven + trailing + TP/SL protection)');
    (async () => {
      while (!this._stopMidManager) {
        try {
          for (const action of await this._runMidCycle()) this._notifyMidAction(action);
        } catch (e) {
          console.error(`[trader] mid-management cycle error: ${e.message}`);
        }
        const interval = Math.max(15, Math.min(
          this.memory.getInt('mid_manage_interval_sec', this.MID_MANAGE_DEFAULT_INTERVAL_SEC), 3600));
        await sleep(interval * 1000);
      }
      this._midManageRunning = false;
      console.info('[trader] automatic mid-management guardian stopped');
    })();
    return true;
  }

  stopMidManager() {
    this._stopMidManager = true;
    console.info('[trader] automatic mid-management guardian stop requested');
  }

  async _runMidCycle() {
    // Serialized: guardian and manual /midmanage never run concurrently
    while (this._midBusy) await sleep(200);
    this._midBusy = true;
    try {
      return await this.positionMgr.midManagePositions();
    } finally {
      this._midBusy = false;
    }
  }

  _notifyMidAction(action) {
    const labels = {
      breakeven_activated: 'BREAKEVEN',
      trailing_updated: 'TRAILING STOP',
      tpsl_recovered: 'TP/SL RE-ATTACHED',
      tpsl_missing: 'TP/SL PROBLEM',
      position_adopted: 'POSITION ADOPTED',
    };
    const label = labels[action.action];
    if (!label) return;
    if (action.action === 'position_adopted' && this._autoTradeEnabled) return; // auto-trade loop already announced
    this._notify(`${label} ${action.symbol} trade ${action.trade_id}: ${action.details}`);
  }

  // ---------- auto trade loop ----------
  startAutoTrade() {
    if (this._autoTradeEnabled) return 'Auto-trade is already running.';
    this._autoTradeEnabled = true;
    this._stopMonitor = false;
    console.info('[trader] auto-trade monitoring loop started');
    (async () => {
      let lastScan = 0;
      let lastReport = 0;
      let lastAdoption = 0;
      const adoptionInterval = 60; // catch untracked positions fast
      while (!this._stopMonitor) {
        const scanInterval = this.memory.getInt('scan_interval_sec', Config.SCAN_INTERVAL_SEC);
        const guardInterval = this.memory.getInt('guard_interval_sec', Config.GUARD_INTERVAL_SEC);
        const now = Date.now() / 1000;
        try {
          // adoption first: everything below keys off the local store
          if (now - lastAdoption >= adoptionInterval) {
            lastAdoption = now;
            for (const event of await this.positionMgr.adoptExchangePositions()) {
              const warn = event.has_stop ? '' : ' It has NO exchange stop loss.';
              this._notify(`Found untracked position on XT: ${event.symbol} ${event.position_side} ${event.size}c @ ${event.entry_price} ${event.leverage}x. Now managed as trade ${event.trade_id}.${warn}`);
            }
          }
          for (const event of await this.positionMgr.reconcileOpenTrades()) {
            this._notify(`Position ${event.symbol} ${event.position_side} disappeared from the exchange (trade ${event.trade_id}). Likely liquidation, external close, or TP/SL fill. Marked closed locally.`);
          }
          await this.checkPositionsForClose();
          if (now - lastScan >= scanInterval) {
            lastScan = now;
            await this._scanCycle();
          }
          const reportInterval = this.memory.getInt('report_interval_sec', Config.REPORT_INTERVAL_SEC);
          if (reportInterval > 0 && now - lastReport >= reportInterval) {
            lastReport = now;
            this._notify(await this.periodicPnlReport());
          }
        } catch (e) {
          console.error(`[trader] auto-trade loop error: ${e.message}`);
        }
        await sleep(guardInterval * 1000);
      }
      this._autoTradeEnabled = false;
      console.info('[trader] auto-trade monitoring loop stopped');
    })();
    this._notify('Auto-Trade ENABLED');
    return 'Auto-trade started. Bot will scan signals and execute trades automatically.';
  }

  stopAutoTrade() {
    if (!this._autoTradeEnabled) return 'Auto-trade is not running.';
    this._autoTradeEnabled = false;
    this._stopMonitor = true;
    this._notify('Auto-Trade DISABLED');
    return 'Auto-trade stopped.';
  }

  isAutoTrading() { return this._autoTradeEnabled; }
}
