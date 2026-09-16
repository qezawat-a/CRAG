// telegram-commands.js — command haye Telegram (port-e mantigh-e CryptoMind-XT/bot/telegram_bot.py)
// ------------------------------------------------------------------
// /start /status /balance /signal /pnl /settings /check_ai /timeframes
// /margin_amount_pct /margin_risk_pct /close /diag /sync /protect /midmanage
// Baghie payam ha (ghayr-command) miran be agent (chat tabii).
import { XTClient } from './xt/client.js';
import { RiskManager } from './xt/risk.js';
import { PositionManager } from './xt/positions.js';
import { scanMultiTimeframe, getCurrentPrice } from './xt/scanner.js';
function xtCfg() {
  return { host: process.env.XT_FUTURES_HOST || 'https://fapi.xt.com', accessKey: process.env.XT_API_KEY || '', secretKey: process.env.XT_API_SECRET || '' };
}
function defSym() { return process.env.XT_DEFAULT_SYMBOL || 'btc_usdt'; }
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
export async function handleTelegramCommand(text, { say, getModel, agentName = 'agent' } = {}) {
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
      case 'start': case 'help':
        return { handled: true, reply: startText(agentName) };
      case 'status': {
        const s = args[0] || defSym();
        const [bal, pos, px] = await Promise.all([
          xt.getBalances().catch((e) => ({ error: e.message })),
          xt.getPositions().catch((e) => ({ error: e.message })),
          getCurrentPrice(xt, s).catch(() => 0),
        ]);
        let out = `=== STATUS [${s}] ===\nPrice: ${px}\n`;
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
        return { handled: true, reply: `symbol=${defSym()}\ntimeframes=${tfs().join(',')}\nhost=${xtCfg().host}\ndryRun=${process.env.XT_DRY_RUN || '0'}\nkey=${process.env.XT_API_KEY ? 'set (' + String(process.env.XT_API_KEY).slice(0, 4) + '...)' : '(nist)'}` };
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
        try { await xt.getAccountInfo(); lines.push('XT connect: OK'); }
        catch (e) { lines.push(`XT connect: FAIL (${e.message.slice(0, 120)})`); }
        return { handled: true, reply: lines.join('\n') };
      }
      default:
        return { handled: true, reply: `Unknown command /${cmd}. /start baraye list.` };
    }
  } catch (e) { return { handled: true, reply: `Error: ${e.message}` }; }
}
