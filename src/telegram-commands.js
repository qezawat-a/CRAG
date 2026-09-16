// telegram-commands.js — command haye Telegram (port-e mantigh-e CryptoMind-XT/bot/telegram_bot.py)
// ------------------------------------------------------------------
// /start /status /balance /signal /pnl /settings /check_ai /timeframes
// /margin_amount_pct /margin_risk_pct /close /diag /sync /protect /midmanage
// Baghie payam ha (ghayr-command) miran be agent (chat tabii).
import { XTClient } from './xt/client.js';
import { RiskManager } from './xt/risk.js';
import { PositionManager } from './xt/positions.js';
import { scanMultiTimeframe, getCurrentPrice, getCurrentPriceDetailed } from './xt/scanner.js';
import { Config } from './config.js';
function xtCfg() {
  return { host: process.env.XT_FUTURES_HOST || 'https://fapi.xt.com', accessKey: process.env.XT_API_KEY || '', secretKey: process.env.XT_API_SECRET || '' };
}
// symbol-e mo'aser: store (ke trader estefade mikone) -> env -> 'btc_usdt'
function defSym(ctx = null) {
  if (ctx && ctx.memory) { const s = ctx.memory.getSetting('symbol', null); if (s) return s; }
  return process.env.XT_DEFAULT_SYMBOL || process.env.DEFAULT_SYMBOL || 'btc_usdt';
}
function tfs() { return String(process.env.XT_TIMEFRAMES || '1m,3m,5m,15m').split(',').map((x) => x.trim()).filter(Boolean); }
export const TG_COMMANDS = [
  { command: 'start', description: 'Help + list-e command ha' },
  { command: 'status', description: 'Balance + positions + price' },
  { command: 'balance', description: 'Balance-e futures' },
  { command: 'signal', description: 'Scan-e signal multi-timeframe' },
  { command: 'pnl', description: 'PnL-e position haye baz' },
  { command: 'settings', description: 'Tanzimat-e trading' },
  { command: 'check_ai', description: 'Test-e AI connection' },
  { command: 'close', description: 'Close position: /close SYMBOL SIDE' },
  { command: 'diag', description: 'Diagnose: key/setting ha' },
];
export function startText(agentName) {
  return `${agentName} Ready!\n\nCommands:\n/status - Balance + positions + price\n/balance - Balance\n/signal [symbol] - Scan signals\n/pnl [symbol] - PnL baz\n/settings - Tanzimat\n/check_ai - Test AI\n/close SYMBOL SIDE - Bastan-e position (mesal /close btc_usdt LONG)\n/diag - Check key/setting ha\n\nMituni normal chat koni — mesal: "btc ro scan kon" ya "balance cheghadr-e?" (agent az tool haye xt_* estefade mikone).`;
}
// handleTelegramCommand(text, ctx) -> { handled: bool, reply: string }
// ctx: { say, getModel, agentName }
export async function handleTelegramCommand(text, { say, getModel, agentName = 'agent', memory = null, trader = null, traderCommands = null } = {}) {
  const ctx = { say, getModel, agentName, memory, trader, traderCommands };
  const t = String(text || '').trim();
  if (!t.startsWith('/')) return { handled: false };
  const parts = t.slice(1).split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase().split('@')[0];
  const args = parts.slice(1);
  const xt = new XTClient(xtCfg());
  const risk = new RiskManager(xt);
  const pm = new PositionManager(xt, risk);
  try {
    switch (cmd) {
      case 'start': case 'help': {
        const extra = Array.isArray(traderCommands) && traderCommands.length
          ? '\n\nTrader commands:\n' + traderCommands.map((c) => `/${c.command} - ${c.description}`).join('\n')
          : '';
        return { handled: true, reply: startText(agentName) + extra };
      }
      case 'status': {
        const s = args[0] || defSym(ctx);
        const [bal, pos, px] = await Promise.all([
          xt.getBalances().catch((e) => ({ error: e.message })),
          xt.getPositions().catch((e) => ({ error: e.message })),
          getCurrentPriceDetailed(xt, s).catch((e) => ({ price: 0, error: e.message })),
        ]);
        let out = `=== STATUS [${s}] ===\n`;
        out += px.error ? `Price: error (${px.error})\n` : `Price: ${px.price}\n`;
        if (bal.error) out += `Balance: error (${bal.error})\n`;
        else { const u = (Array.isArray(bal) ? bal : []).find((r) => String(r.coin || '').toUpperCase() === 'USDT') || {}; out += `Balance: ${u.walletBalance ?? '?'} USDT | Available: ${u.availableBalance ?? '?'} USDT\n`; }
        if (pos.error) out += `Positions: error (${pos.error})`;
        else if (!pos.length) out += 'Positions: (hich position-e baz nist)';
        else out += `Positions (${pos.length}):\n` + pos.map((p) => `  ${p.symbol} ${p.positionSide} size=${p.positionSize} entry=${p.entryPrice} lev=${p.leverage}x uPnL=${p.floatingPL ?? '?'}`).join('\n');
        return { handled: true, reply: out };
      }
      case 'balance': {
        const bal = await xt.getBalances();
        if (!bal.length) return { handled: true, reply: 'Balance khali ya key eshtebah-e.' };
        return { handled: true, reply: 'Balance:\n' + bal.map((r) => `  ${r.coin}: wallet=${r.walletBalance} avail=${r.availableBalance}`).join('\n') };
      }
      case 'signal': {
        const s = args[0] || defSym();
        const r = await scanMultiTimeframe(xt, s, tfs(), { minConfidence: 70, tfMinConfidence: 60, minAgree: 1 });
        r.price = await getCurrentPrice(xt, s).catch(() => 0);
        let out = `=== SIGNAL [${s}] ===\nDirection: ${r.direction}\nConfidence: ${r.confidence}%\nPrice: ${r.price}\nLongW: ${r.longWeight.toFixed(2)} ShortW: ${r.shortWeight.toFixed(2)}\n`;
        if (r.strategiesUsed && r.strategiesUsed.length) out += `Strategies: ${r.strategiesUsed.join(',')}\n`;
        for (const [tf, x] of Object.entries(r.timeframeResults || {})) {
          if (x.error) { out += `  ${tf}: no data\n`; continue; }
          out += `  ${tf}: ${x.direction} (${x.confidence}%)\n`;
        }
        return { handled: true, reply: out };
      }
      case 'pnl': {
        const s = args[0] || null;
        const list = await xt.getPositions(s);
        if (!list.length) return { handled: true, reply: 'Hich position-e baz nist (PnL=0).' };
        let out = 'Open PnL:\n';
        for (const p of list) {
          const info = await pm.getPositionPnl(p.symbol, p.positionSide).catch(() => null);
          out += `  ${p.symbol} ${p.positionSide}: uPnL=${info ? Number(info.unrealizedPnl || 0).toFixed(4) : (p.floatingPL ?? '?')} USDT size=${p.positionSize}\n`;
        }
        return { handled: true, reply: out };
      }
      case 'settings': {
        // /settings = meghdar-e MOASER (hamun ke trader estefade mikone) + fargh ba .env.
        // Store avvalavi-e: seedDefaults faghat ja-haye khali ro por mikone, pas
        // .env-e avaz-shode khod-be-khod ejra NEMISHE (bekhun: /reseed).
        const envDefs = Config.defaultSettings();
        const diff = memory && memory.envDiff ? memory.envDiff() : null;
        const lines = ['=== SETTINGS (effective) ==='];
        let mism = 0;
        for (const [k, envVal] of Object.entries(envDefs)) {
          const d = diff ? diff[k] : { stored: null, env: String(envVal), diff: false };
          const eff = d.stored === null ? String(envVal) : d.stored;
          const src = d.stored === null ? 'env' : 'store';
          let line = `${k}=${eff} [${src}]`;
          if (d.diff) { mism++; line += `  (env: ${envVal} — ejra NEMISHE)`; }
          lines.push(line);
        }
        // env-haye aliasing ke hamzaman set mishan (avvali avvalavi-e)
        const ALIASES = { symbol: ['XT_DEFAULT_SYMBOL', 'DEFAULT_SYMBOL'], timeframes: ['XT_TIMEFRAMES', 'DEFAULT_TIMEFRAMES'] };
        for (const [k, names] of Object.entries(ALIASES)) {
          const set = names.filter((n) => process.env[n] !== undefined && process.env[n] !== '');
          if (set.length > 1) lines.push(`! ${k}: chand env set-e (${set.map((n) => `${n}=${process.env[n]}`).join(' , ')}) — avvali avvalavi-e`);
        }
        lines.push(`host=${xtCfg().host} dryRun=${process.env.XT_DRY_RUN || '0'} key=${process.env.XT_API_KEY ? 'set (' + String(process.env.XT_API_KEY).slice(0, 4) + '...)' : '(nist)'}`);
        if (memory) lines.push(`store=${memory.persistence}`);
        if (mism) lines.push(`\n${mism} key ba .env fargh dare vali store avvalavi-e → /reseed bezan ta .env ejra beshe.`);
        lines.push('Tanzim: /set key value (mesal /set leverage 10)');
        return { handled: true, reply: lines.join('\n') };
      }
      case 'check_ai': {
        try {
          const out = await say('Hello, respond with a brief confirmation that you are online.');
          const reply = out && out.reply !== undefined ? out.reply : String(out);
          return { handled: true, reply: `AI model: ${getModel ? getModel() : '(auto)'}\n\nAI Response:\n${reply}` };
        } catch (e) { return { handled: true, reply: `AI check failed: ${e.message}` }; }
      }
      case 'close': {
        const s = args[0]; const side = String(args[1] || '').toUpperCase();
        if (!s || (side !== 'LONG' && side !== 'SHORT')) return { handled: true, reply: 'Estefade: /close SYMBOL SIDE (mesal /close btc_usdt LONG)' };
        if (String(process.env.XT_DRY_RUN || '').toLowerCase() === '1') return { handled: true, reply: `DRY_RUN=1 — close ejra NEMISHE. Preview: ${s} ${side}. (XT_DRY_RUN=0 kon baraye vaghei)` };
        const r = await pm.closePosition(s, side);
        return { handled: true, reply: r.ok ? `Closed ${s} ${side} qty=${r.qty}` : `Close failed: ${r.error}` };
      }
      case 'diag': {
        const lines = [];
        lines.push(`XT_API_KEY: ${process.env.XT_API_KEY ? 'set' : 'NIST!'}`);
        lines.push(`XT_API_SECRET: ${process.env.XT_API_SECRET ? 'set' : 'NIST!'}`);
        lines.push(`XT_FUTURES_HOST: ${xtCfg().host}`);
        lines.push(`AI key: ${process.env.AI_API_KEY ? 'set' : 'NIST!'}`);
        lines.push(`AI model: ${getModel ? getModel() : '(auto)'}`);
        if (memory) lines.push(`store: ${memory.persistence} (settings: ${Object.keys(memory.getAllSettings()).length})`);
        try { await xt.getAccountInfo(); lines.push('XT connect: OK'); }
        catch (e) { lines.push(`XT connect: FAIL (${e.message.slice(0, 120)})`); }
        if (trader && typeof trader.diagnose === 'function') {
          try { lines.push('', await trader.diagnose()); } catch (e) { lines.push(`trader diagnose failed: ${e.message}`); }
        }
        return { handled: true, reply: lines.join('\n') };
      }
      // NOTE: command-haye trader (/autotrade_on /open /set /sync /protect /trades
      // /reset_cooldown /close_all /reseed ...) inja handle NEMISHAN — bayad
      // handled:false bargardoonim ta telegram-bot.js be handleTraderCommand
      // berese. (ghabl-an hamin ja 'Unknown command' midad va 10 command-e
      // trader hich vaght ejra nemishod.)
      default:
        return { handled: false };
    }
  } catch (e) { return { handled: true, reply: `Error: ${e.message}` }; }
}
