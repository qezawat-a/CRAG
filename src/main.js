// main.js — entry-e crypto-agent (Crypto2 + xt-agent merged, JS)
// ------------------------------------------------------------
// Ejra: node src/main.js   (ya: npm start)
//
// Chi roshan mishe:
//   1. Trader bot (auto-trade loop + mid-manager guardian + software stop)
//   2. Agent (soul/skills/prompt/loop az xt-agent) + 25 xt_* tool + trader_* tool
//   3. Telegram: command ha -> trader, chat-e mamuli -> agent
//   4. Health server (baraye Railway/Docker: PORT)
// Modes:
//   AUTO_TRADE=1 (default) -> scan -> signal -> open khodkar
//   AGENT_AUTONOMOUS=1     -> agent har interval khodesh analyze/report mikone
import 'dotenv/config';
import http from 'node:http';
import { Config } from './config.js';
import { LongTermMemory } from './store/memory.js';
import { XTTrader } from './trader/trader.js';
import { traderTools } from './trader/agent-tools.js';
import { createAgent } from './agent/loop.js';
import { buildTools } from './agent/tools.js';
import { Memory } from './agent/memory.js';
import { getSettings } from './settings.js';
import { buildSystemPrompt } from './prompt.js';
import { listSkills } from './agent/skills.js';
import { xtFuturesTools } from './xt/futures-tools.js';
import { loadMcpTools } from './agent/mcp.js';
import { startTelegramBot } from './telegram-bot.js';

const agentName = getSettings().identity.agentName || 'crypto-agent';
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- 1) config validation ----------
const missing = Config.validate();
if (missing.length) {
  log(`[main] WARNING missing config: ${missing.join(' | ')}`);
  if (!Config.XT_API_KEY || !Config.XT_API_SECRET) {
    log('[main] XT_API_KEY/XT_API_SECRET nist — trader kar nemikone. .env ro check kon.');
  }
}

// ---------- 2) memory store (seed defaults + legacy cleanup) ----------
const memory = new LongTermMemory();
try { await memory.init(); }
catch (e) {
  log(`[main] FATAL: store init failed (${memory.backend.kind}): ${e.message}`);
  log('[main] DATABASE_URL ro check kon — ya barash dar biar ta file-e mahali (data/trader-store.json) estefade beshe.');
  process.exit(1);
}
memory.seedDefaults();
Config.warnIfLegacyTradeEnv(log);
log(`[main] store ready: ${memory.persistence} (settings: ${Object.keys(memory.getAllSettings()).length}) — trade settings agent-only (az store, na .env)`);
if (memory.backend.kind === 'file') {
  log('[main] HOSHDAR: DATABASE_URL nist — state faghat tu file-e mahali mimune; ru deploy-e ephemeral (Railway/Heroku) har deploy PAK mishe. Neon Postgres vasl kon (README).');
}

// ---------- 3) trader ----------
const trader = new XTTrader(memory);

// ---------- 4) agent (agency: soul + skills + prompt options + tools) ----------
const s = getSettings();
const skills = s.skills.enabled ? listSkills(s.skills.dir, { exclude: s.skills.exclude }) : [];

const agentMemory = await new Memory().load();

let agent = null;
try {
  const xtTools = [
    ...xtFuturesTools({ getSetting: (k, d) => memory.getSetting(k, d) }),
    ...traderTools(trader, { agentName }),
  ];
  let mcpTools = [];
  if (s.mcp.enabled && s.mcp.servers) {
    try { mcpTools = await loadMcpTools(s.mcp.servers, s.tools.toolTimeoutMs); }
    catch (e) { log(`[main] mcp error: ${e.message}`); }
  }
  const tools = s.tools.enabled
    ? buildTools({ xtTools, mcpTools, memory: agentMemory, timeoutMs: s.tools.toolTimeoutMs })
    : [];
  const system = buildSystemPrompt({
    agentName,
    skills,
    tools,
    thinkingLevel: s.thinking.level,
    extra: `This build also runs the XT futures TRADER bot. Tools with prefix trader_ control the autonomous trading loop
(status, scan, auto_trade, open/close, settings, protect, midmanage, sync, diag). Trade summary is available via trader_trade_history.
Always respect XT_DRY_RUN: while it is 1, real orders are never sent.
TRADER SETTINGS ARE AGENT-ONLY: trade settings live ONLY in the store (LongTermMemory) and are managed ONLY via trader_settings_get/trader_settings_set (or Telegram /settings + /set, TUI /tsettings + /tset). NEVER read trade tuning from .env — .env trade vars are IGNORED. When the user asks for settings in ANY language (e.g. "/settings", "setting o neshun bede", "settings ro neshun bede"), ALWAYS call trader_settings_get and show ALL 26 keys — NEVER truncate to 4 keys + base url.`,
  });
  agent = createAgent({
    system,
    tools,
    memory: agentMemory,
    maxRounds: Config.AGENT_MAX_STEPS,
    autoCompact: s.session.autoCompact,
    compactAfterRounds: s.session.compactAfterRounds,
    thinkingLevel: s.thinking.level,
  });
  log(`[main] agent ready: ${agentName} (skills: ${skills.map((k) => k.name).join(', ') || 'none'}, thinking: ${s.thinking.level})`);
} catch (e) {
  log(`[main] agent init failed (trader still runs): ${e.message}`);
}

// ---------- 5) startup checks (XT connection + adoption) ----------
try {
  const balances = await trader.xt.getBalances();
  const usdt = balances.find((b) => String(b.coin || '').toUpperCase() === 'USDT');
  if (usdt) log(`[main] XT connection OK. USDT wallet balance: ${usdt.walletBalance}`);
  else log('[main] XT connection OK but no USDT balance found. Is the futures account opened?');
} catch (e) {
  log(`[main] XT API check failed: ${e.message}`);
  log('[main] Verify XT_API_KEY/XT_API_SECRET, futures permissions, and IP whitelist.');
}

try {
  const adopted = await trader.positionMgr.adoptExchangePositions();
  for (const a of adopted) {
    log(`[main] adopted untracked position: ${a.symbol} ${a.position_side} ${a.size}c @ ${a.entry_price} ${a.leverage}x, stop=${a.has_stop ? 'yes' : 'NO'}`);
  }
  if (!adopted.length) log('[main] no untracked exchange positions found');
} catch (e) {
  log(`[main] position adoption failed at startup: ${e.message}`);
}

// ---------- 6) trader loops ----------
trader.startMidManager(); // always-on guardian: breakeven + trailing + TP/SL protection

const autoTradeEnv = String(process.env.AUTO_TRADE ?? '1').trim().toLowerCase();
if (['1', 'true', 'yes', 'on'].includes(autoTradeEnv)) {
  log(`[main] auto-trade ON (scan interval ${memory.getInt('scan_interval_sec', Config.SCAN_INTERVAL_SEC)}s, guard ${memory.getInt('guard_interval_sec', Config.GUARD_INTERVAL_SEC)}s)`);
  trader.startAutoTrade();
} else {
  log('[main] auto-trade OFF (AUTO_TRADE=0) — trade ha dasti ya az tool-e trader_auto_trade.');
}

// optional: autonomous agent loop (agent khodesh scan/report/analyze mikone)
if (['1', 'true', 'yes', 'on'].includes(String(process.env.AGENT_AUTONOMOUS || '0').toLowerCase()) && agent) {
  const intervalSec = Config.AGENT_AUTONOMOUS_INTERVAL_SEC;
  log(`[main] agent autonomous loop ON every ${intervalSec}s`);
  setInterval(async () => {
    try {
      const out = await agent.say(
        `Autonomous tick: baraye symbol-e ${memory.getSetting('symbol', Config.DEFAULT_SYMBOL)} scan kon (trader_scan), ` +
        `position ha ro check kon (trader_status) va age khatari bud report bedeh. Kutah javab bedeh.`,
      );
      const reply = out && out.reply !== undefined ? out.reply : String(out);
      log(`[agent-loop] ${String(reply).slice(0, 200).replace(/\n/g, ' | ')}`);
    } catch (e) {
      log(`[agent-loop] tick error: ${e.message}`);
    }
  }, intervalSec * 1000);
}

// ---------- 7) telegram (commands -> trader, chat -> agent) ----------
try {
  await startTelegramBot({ trader, agent, agentName, log });
  log('[main] Telegram -> merged mode (trader commands + agent chat)');
} catch (e) {
  log(`[main] Telegram failed: ${e.message} (bot bedune telegram edame midahad)`);
}

// ---------- 8) health server (Railway/Docker) ----------
const rawPort = process.env.PORT || '8080';
const port = parseInt(rawPort, 10) || 8080;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
}).listen(port, '0.0.0.0', () => log(`[main] health check server listening on port ${port}`));

log(`[main] ${agentName} started. Send /start to your Telegram bot to begin.`);

// shutdowne monghe: write-haye pending store ro await mikone (Railway SIGTERM mifreste)
let shuttingDown = false;
const shutdown = async (sig) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`[main] shutting down (${sig})...`);
  try { trader.stopAutoTrade(); trader.stopMidManager(); } catch { /* hichi */ }
  try { await memory.close(); log('[main] store flush shod.'); } catch (e) { log(`[main] store close error: ${e.message}`); }
  process.exit(0);
};
process.on('SIGINT', () => { shutdown('SIGINT'); });
process.on('SIGTERM', () => { shutdown('SIGTERM'); });
