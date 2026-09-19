// positions.js — position manager (port az CryptoMind-XT/bot/position_manager.py)
// PnL: (mark-entry)*size*contractSize (LONG) / baraks (SHORT). TPSL states: NOT_TRIGGERED/TRIGGERING.
// closePosition: cancel TPSL-e hamoon side + MARKET IOC reduce-only close.
export const TPSL_ACTIVE_STATES = ['NOT_TRIGGERED', 'TRIGGERING'];
export class PositionManager {
  constructor(xt, risk) { this.xt = xt; this.risk = risk; }
  async getPositions(symbol = null) { try { return await this.xt.getPositions(symbol); } catch { return []; } }
  async getPosition(symbol, side) {
    for (const p of await this.getPositions(symbol)) {
      if (p.positionSide !== side) continue;
      if (Number(p.positionSize || 0) <= 0) continue;
      return p;
    }
    return null;
  }
  async getMarkPrice(symbol) {
    try { return Number((await this.xt.getMarkPrice(symbol)).p || 0); }
    catch { return 0; }
  }
  async getPositionPnl(symbol, side) {
    const pos = await this.getPosition(symbol, side);
    if (!pos) return { exists: false, symbol, positionSide: side };
    const size = Number(pos.positionSize || 0);
    const entry = Number(pos.entryPrice || 0);
    let mark = Number(pos.markPrice || pos.calMarkPrice || 0);
    if (!(mark > 0)) mark = await this.getMarkPrice(symbol);
    let cs = 0;
    try { cs = Number(await this.risk.getContractSize(symbol)) || 0; } catch {}
    const diff = side === 'LONG' ? mark - entry : entry - mark;
    const upnl = diff * size * cs;
    let tpsl = [];
    try { tpsl = await this.xt.getTpslOrders(symbol, { state: 'NOT_TRIGGERED' }); } catch {}
    const mine = tpsl.filter((t) => t.positionSide === side || !t.positionSide);
    return { exists: true, symbol, positionSide: side, positionSize: size, entryPrice: entry, markPrice: mark, leverage: pos.leverage, unrealizedPnl: upnl, profitId: pos.profitId || (mine[0] ? mine[0].profitId : null), hasStop: Boolean(pos.profitId || mine.length), raw: pos };
  }
  async closePosition(symbol, side, { contracts = null, exitPrice = null } = {}) {
    const info = await this.getPositionPnl(symbol, side);
    if (!info.exists) return { ok: false, error: 'no open position' };
    const qty = parseInt(contracts || info.positionSize, 10);
    if (!(qty > 0)) return { ok: false, error: 'nothing to close' };
    if (info.profitId) { try { await this.xt.cancelTpsl(info.profitId); } catch {} }
    const closeSide = side === 'LONG' ? 'SELL' : 'BUY';
    const data = await this.xt.createOrder({ symbol, positionSide: side, orderSide: closeSide, orderType: 'MARKET', origQty: qty, timeInForce: 'IOC', reduceOnly: true });
    try { this.risk.invalidateBalanceCache(); } catch {}
    return { ok: true, data, qty, exitPrice };
  }
}
