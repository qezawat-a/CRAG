// trader/agent-tools.js — tool-haye trader baraye agent (agency mode)
// ------------------------------------------------------------
// Ba in tool-ha agent-e xt-agent (soul/skills/prompt) mitune bot-e
// trader ro control kone: status, autotrade on/off, open/close trade,
// settings, protect/midmanage/sync. Name ha ba prefix trader_ hastand.
const S = (desc, props, req = []) => ({ type: 'object', properties: props, required: req, additionalProperties: false });
const STR = (d) => ({ type: 'string', description: d });
const INT = (d) => ({ type: 'integer', description: d });

export function traderTools(trader, { agentName = 'crypto-agent' } = {}) {
  return [
    {
      name: 'trader_status',
      description: `Status-e kamel-e ${agentName} trader: balance, PnL, trades, settings, cooldowns, open positions.`,
      parameters: S('s', {}),
      async run() { return trader.getStatusReport(); },
    },
    {
      name: 'trader_scan',
      description: 'Scan-e signal multi-timeframe (report-e kamel ba timeframe results).',
      parameters: S('sc', { symbol: STR('symbol (optional, default az settings)') }),
      async run(a) {
        const r = await trader.scanAndReport(a.symbol || null);
        return trader.formatSignalReport(r);
      },
    },
    {
      name: 'trader_auto_trade',
      description: 'Auto-trade ro on/off kon (1=on, 0=off). Vaghti on-e: scan -> signal -> open -> guard -> midmanage khodkar.',
      parameters: S('a', { enabled: STR('1|0|true|false') }, ['enabled']),
      async run(a) {
        const on = ['1', 'true', 'yes', 'on'].includes(String(a.enabled).toLowerCase());
        return on ? trader.startAutoTrade() : trader.stopAutoTrade();
      },
    },
    {
      name: 'trader_open_trade',
      description: 'Open trade dasti (signal gate ha check mishan: confidence, min_agree, cooldown, max_positions).',
      parameters: S('o', { direction: STR('LONG/SHORT'), orderType: STR('MARKET/LIMIT (default MARKET)') }, ['direction']),
      async run(a) {
        const dir = String(a.direction || '').toUpperCase();
        const ot = String(a.orderType || 'MARKET').toUpperCase();
        return trader.executeTrade(dir, ot, null);
      },
    },
    {
      name: 'trader_close',
      description: 'Close-e position/trade: trader_close {tradeId} ya {symbol, positionSide}. trader_close {all:true} = hame.',
      parameters: S('c', { tradeId: INT('trade id (optional)'), symbol: STR('symbol (optional)'), positionSide: STR('LONG/SHORT (optional)'), all: STR('true = close hame (optional)') }),
      async run(a) {
        if (String(a.all).toLowerCase() === 'true') return trader.closeAllPositions();
        if (a.tradeId) return trader.closeSpecificTrade(parseInt(a.tradeId, 10));
        if (a.symbol && a.positionSide) {
          const t = trader.memory.getOpenTrades(String(a.symbol).toLowerCase()).find((x) => x.position_side === String(a.positionSide).toUpperCase());
          if (!t) return `No open ${a.positionSide} trade for ${a.symbol} in local store. /sync konid.`;
          return trader.closeSpecificTrade(t.id);
        }
        return 'trader_close: tradeId YA (symbol + positionSide) YA all:true bedehid.';
      },
    },
    {
      name: 'trader_settings_get',
      description: 'Tamame settings-e trading (symbol, leverage, timeframes, min_confidence, ...).',
      parameters: S('g', {}),
      async run() { return JSON.stringify(trader.memory.getAllSettings(), null, 2); },
    },
    {
      name: 'trader_settings_set',
      description: 'Setting set kon. Mesal: {key:"min_confidence", value:"75"} ya {key:"symbol", value:"eth_usdt"}.',
      parameters: S('st', { key: STR('setting key'), value: STR('value (string)') }, ['key', 'value']),
      async run(a) {
        if (!a.key || a.value === undefined) return 'key va value lazem ast.';
        trader.memory.setSetting(a.key, a.value);
        return `set ${a.key} = ${a.value}`;
      },
    },
    {
      name: 'trader_protect',
      description: 'Be har position-e baz ke TP/SL nadare, exchange TP/SL attach kon.',
      parameters: S('p', {}),
      async run() { return trader.protectOpenPositions(); },
    },
    {
      name: 'trader_midmanage',
      description: 'Yek cycle-e mid-management ejra kon (breakeven + trailing + TPSL recovery) + report.',
      parameters: S('m', {}),
      async run() { return trader.runMidManagement(); },
    },
    {
      name: 'trader_sync',
      description: 'Position-haye XT ro ba local store sync kon (adopt + stale cleanup).',
      parameters: S('sy', {}),
      async run() { return trader.syncPositions(); },
    },
    {
      name: 'trader_diag',
      description: 'Diagnose-e mid-management: chera breakeven/trailing act nakarde.',
      parameters: S('d', {}),
      async run() { return trader.diagnose(); },
    },
    {
      name: 'trader_trade_history',
      description: 'Trade summary (PnL, winrate, recent trades) baraye AI.',
      parameters: S('h', {}),
      async run() { return trader.memory.getTradeSummaryForAi(); },
    },
  ];
}
