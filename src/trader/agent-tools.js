// trader/agent-tools.js — tool-haye trader baraye agent (agency mode)
// ------------------------------------------------------------
// Ba in tool-ha agent-e xt-agent (soul/skills/prompt) mitune bot-e
// trader ro control kone: status, autotrade on/off, open/close trade,
// settings, protect/midmanage/sync. Name ha ba prefix trader_ hastand.
// AGENT-ONLY: trade settings FAGHAT via in tool-ha (store), .env ignore.
// HAMEYE settings bayad neshun dade beshan (na faghat 4 key + base url).
import { Config } from '../config.js';

const S = (desc, props, req = []) => ({ type: 'object', properties: props, required: req, additionalProperties: false });
const STR = (d) => ({ type: 'string', description: d });
const INT = (d) => ({ type: 'integer', description: d });

function formatAllSettings(memory) {
  const defs = Config.defaultSettings();
  const stored = memory ? memory.getAllSettings() : {};
  const lines = ['=== TRADER SETTINGS (az store — agent-only, HAME) ==='];
  for (const [k, defVal] of Object.entries(defs)) {
    const cur = stored[k] !== undefined ? String(stored[k]) : String(defVal);
    const meta = Config.TRADER_SETTING_DEFS?.[k];
    const label = meta?.label ? ` — ${meta.label}` : '';
    const isDef = String(cur) === String(defVal);
    lines.push(`${k}=${cur}${isDef ? '' : ` (default: ${defVal})`}${label}`);
  }
  lines.push('');
  lines.push('Trade settings FAGHAT az inja avaz mishan (trader_settings_set) — .env ignore mishe.');
  return lines.join('\n');
}

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
      description: 'HAMEYE settings-e trading ro neshun bede (26 key: symbol, leverage, timeframes, min_confidence, ...). Vaghti user mige "/settings" ya "setting o neshun bede" (hatta Farsi), HATMAN in tool ro seda bezan va HAMEYE khuruji ro be user neshun bede — hich key ro hazf ya kholase NAKON (na faghat 4 key).',
      parameters: S('g', {}),
      async run() { return formatAllSettings(trader.memory); },
    },
    {
      name: 'trader_settings_set',
      description: 'Yek setting-e trading set kon (agent-only, dar store zakhire mishe, ba restart NEMIPARE). Valid keys: symbol, leverage, position_type, timeframes, margin_amount_pct, margin_risk_pct, min_confidence, tf_min_confidence, min_agreeing_strategies, signal_confirm_scans, cooldown_minutes, max_positions, position_mode, scan_interval_sec, guard_interval_sec, breakeven_threshold_pct, trailing_stop_pct, trailing_trigger_roi_pct, trailing_distance_pct, sl_liquidation_safety, on_tpsl_failure, reversal_enabled, reversal_confidence, report_interval_sec, mid_manage_interval_sec. Mesal: {key:"min_confidence", value:"75"} ya {key:"leverage", value:"10"}. Alias: margin_mode -> position_type.',
      parameters: S('st', { key: STR('setting key (mesal leverage)'), value: STR('value (string, mesal "10")') }, ['key', 'value']),
      async run(a) {
        if (!a.key || a.value === undefined) return 'key va value lazem ast. Mesal: {key:"leverage", value:"10"}. Baraye didan-e HAME: trader_settings_get.';
        const v = Config.validateSetting(a.key, a.value);
        if (!v.ok) return `set failed: ${v.error}\nBaraye didan-e HAME: trader_settings_get.`;
        trader.memory.setSetting(v.key, v.normalized);
        return `set ${v.key} = ${v.normalized} (OK, zakhire shod — ba restart NEMIPARE)`;
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
