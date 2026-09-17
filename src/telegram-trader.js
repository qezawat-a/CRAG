// telegram-trader.js — shared trader commands baraye Telegram (bot + gateway)
// ------------------------------------------------------------------
// Hadaf: Telegram unknown commands NABAYAD dashte bashim.
// - Hameye command-haye trader YEK JA tarif mishan (TRADER_COMMANDS)
// - handleTraderCommand() ham dar telegram-bot.js ham dar gateway.js
//   estefade mishe (yeksan).
// - /settings HAMEYE settings ro neshun mide (agent-only, az store)
// - /set ba validation (Config.validateSetting) + alias (margin_mode->position_type)
// - /reseed DEPRECATED: alan = reset be defaults (chon .env ignore mishe)
// - /get: yek setting ro neshun bede
// - /reset_settings: reset hame be defaults
import { Config } from './config.js';

export const TRADER_COMMANDS = [
  { command: 'autotrade_on', description: 'Auto-trade ro roshan kon' },
  { command: 'autotrade_off', description: 'Auto-trade ro khamush kon' },
  { command: 'open', description: 'Open trade: /open LONG' },
  { command: 'close_all', description: 'Close hameye position ha' },
  { command: 'protect', description: 'TP/SL be position-haye bi-stop attach kon' },
  { command: 'midmanage', description: 'Breakeven + trailing ejra kon' },
  { command: 'sync', description: 'Sync position ha ba local store' },
  { command: 'trades', description: 'Trade summary (PnL/winrate)' },
  { command: 'reset_cooldown', description: 'Cooldown ha ro pak kon' },
  { command: 'set', description: 'Setting: /set min_confidence 75 (HAME: /settings)' },
  { command: 'get', description: 'Yek setting: /get leverage' },
  { command: 'reset_settings', description: 'Reset HAMEYE settings be defaults' },
  { command: 'reseed', description: '(deprecated: mesl-e /reset_settings)' },
  { command: 'dryrun', description: 'DRY_RUN: /dryrun 1|0 (1=preview, 0=vaghei)' },
];

export function traderCommandNames() {
  return TRADER_COMMANDS.map((c) => c.command);
}

function needTrader(trader) {
  if (!trader) return 'trader nist (bot dar hale init-e ya XT key moshkel dare).';
  return null;
}

// handleTraderCommand(cmd, args, ctx) -> {handled, reply}
// ctx: {trader, send?} — send baraye سازگاری, reply bar migarde (caller send mikone)
export async function handleTraderCommand(cmd, args, { trader } = {}) {
  const c = String(cmd || '').toLowerCase();
  switch (c) {
    case 'autotrade_on': {
      const e = needTrader(trader);
      if (e) return { handled: true, reply: e };
      return { handled: true, reply: trader.startAutoTrade() };
    }
    case 'autotrade_off': {
      const e = needTrader(trader);
      if (e) return { handled: true, reply: e };
      return { handled: true, reply: trader.stopAutoTrade() };
    }
    case 'open': {
      const e = needTrader(trader);
      if (e) return { handled: true, reply: e };
      const dir = String(args[0] || '').toUpperCase();
      if (dir !== 'LONG' && dir !== 'SHORT') {
        return { handled: true, reply: 'Estefade: /open LONG ya /open SHORT' };
      }
      return { handled: true, reply: await trader.executeTrade(dir, 'MARKET', null) };
    }
    case 'close_all': {
      const e = needTrader(trader);
      if (e) return { handled: true, reply: e };
      return { handled: true, reply: await trader.closeAllPositions() };
    }
    case 'protect': {
      const e = needTrader(trader);
      if (e) return { handled: true, reply: e };
      return { handled: true, reply: await trader.protectOpenPositions() };
    }
    case 'midmanage': {
      const e = needTrader(trader);
      if (e) return { handled: true, reply: e };
      return { handled: true, reply: await trader.runMidManagement() };
    }
    case 'sync': {
      const e = needTrader(trader);
      if (e) return { handled: true, reply: e };
      return { handled: true, reply: await trader.syncPositions() };
    }
    case 'trades': {
      const e = needTrader(trader);
      if (e) return { handled: true, reply: e };
      return { handled: true, reply: trader.memory.getTradeSummaryForAi() };
    }
    case 'reset_cooldown': {
      const e = needTrader(trader);
      if (e) return { handled: true, reply: e };
      // /reset_cooldown [symbol] [side]
      const sym = args[0] ? String(args[0]).toLowerCase() : null;
      const side = args[1] ? String(args[1]).toUpperCase() : null;
      const n = trader.memory.clearCooldown(sym, side);
      return { handled: true, reply: `${n} cooldown pak shod.` };
    }
    case 'get': {
      const e = needTrader(trader);
      if (e) return { handled: true, reply: e };
      const keyRaw = args[0];
      if (!keyRaw) {
        return { handled: true, reply: 'Estefade: /get key (mesal /get leverage). /settings baraye HAME.' };
      }
      const key = Config.normalizeSettingKey(keyRaw);
      const all = trader.memory.getAllSettings();
      const defs = Config.defaultSettings();
      if (!(key in defs) && !(key in all)) {
        return { handled: true, reply: `unknown setting '${keyRaw}'. Valid: ${Object.keys(defs).join(', ')}\n/settings baraye HAME.` };
      }
      const val = trader.memory.getSetting(key, defs[key] ?? '(nist)');
      const def = defs[key] ?? '(nist)';
      return { handled: true, reply: `${key}=${val} (default: ${def})` };
    }
    case 'set': {
      const e = needTrader(trader);
      if (e) return { handled: true, reply: e };
      const keyRaw = args[0];
      const valueRaw = args.slice(1).join(' ').trim();
      if (!keyRaw || !valueRaw) {
        return { handled: true, reply: 'Estefade: /set key value (mesal /set min_confidence 75)\n/settings baraye didan-e HAME.' };
      }
      const v = Config.validateSetting(keyRaw, valueRaw);
      if (!v.ok) {
        return { handled: true, reply: `set failed: ${v.error}\n/settings baraye HAME.` };
      }
      trader.memory.setSetting(v.key, v.normalized);
      return { handled: true, reply: `set ${v.key} = ${v.normalized} (OK, zakhire shod — ba restart NEMIPARE)` };
    }
    case 'reset_settings':
    case 'reseed': {
      const e = needTrader(trader);
      if (e) return { handled: true, reply: e };
      const changed = trader.memory.resetToDefaults();
      const isReseed = c === 'reseed';
      const head = isReseed
        ? `/reseed deprecated-e (chon .env baraye trade IGNORE mishe). Reset be defaults:`
        : `Reset be defaults:`;
      if (!changed.length) return { handled: true, reply: `${head}\nhich farghi nabud — store hamun defaults-e.` };
      return {
        handled: true,
        reply: `${head} (${changed.length} key):\n${changed.slice(0, 20).map((x) => `${x.key}: ${x.from} -> ${x.to}`).join('\n')}\n\n/settings baraye check.`,
      };
    }
    case 'dryrun': {
      const v = String(args[0] || '').toLowerCase();
      if (!v) {
        const cur = String(process.env.XT_DRY_RUN || '0');
        return { handled: true, reply: `XT_DRY_RUN=${cur} (${cur === '1' ? 'preview — order VAGHEI ejra NEMISHE' : 'VAGHEI — movazeb bash'})\nEstefade: /dryrun 1|0` };
      }
      if (!['0', '1', 'true', 'false', 'on', 'off'].includes(v)) {
        return { handled: true, reply: 'Estefade: /dryrun 1 (preview/amn) ya /dryrun 0 (VAGHEI)' };
      }
      const nv = ['1', 'true', 'on'].includes(v) ? '1' : '0';
      process.env.XT_DRY_RUN = nv;
      return { handled: true, reply: `XT_DRY_RUN=${nv} (${nv === '1' ? 'order ha preview mishan, ejra NEMISHAN' : 'order ha VAGHEI ejra mishan — movazeb bash'})` };
    }
    default:
      return { handled: false };
  }
}
