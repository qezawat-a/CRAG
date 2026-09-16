// gateway.js — Telegram gateway (long-polling, bedune dependency)
// ----------------------------------------------------------------
// - Auth: faghat TELEGRAM_USER_ID (allowlist) javab migire; baghie "Unauthorized."
// - Command ha (/start /status /balance /signal /pnl /settings /check_ai /close /diag)
//   mostaghim ejra mishan (telegram-commands.js, port-e CryptoMind-XT).
// - Baghie payam ha miran be agent (onMessage = queuedSay-e TUI) — agent az
//   tool haye xt_* estefade mikone (scan/open/close/tpsl...).
// - Javab ha chunk (4096) mishan. Token az settings.gateway.token ya
//   env TELEGRAM_BOT_TOKEN. getMe + setMyCommands dar start.
//   settings.gateway = { enabled, messenger:'telegram', token, userId }

import { createTelegramApi } from './telegram.js';
import { handleTelegramCommand, TG_COMMANDS } from './telegram-commands.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// resolve token/userId: settings > env (CryptoMind-XT: TELEGRAM_BOT_TOKEN/TELEGRAM_USER_ID)
export function resolveTelegramConfig(s) {
  const g = (s && s.gateway) || {};
  const token = g.token || process.env.TELEGRAM_BOT_TOKEN || '';
  const userId = g.userId || process.env.TELEGRAM_USER_ID || '';
  return { token, userId: String(userId || '').trim() };
}

export function startGateway({ messenger = '', token = '', userId = '', onMessage, getModel, agentName = 'agent', log = console.log }) {
  const name = String(messenger || 'telegram').toLowerCase();

  if (name !== 'telegram') { log(`[gateway] messenger '${messenger}' support nist (faghat telegram).`); return null; }
  const tok = token || process.env.TELEGRAM_BOT_TOKEN || '';
  const allowId = String(userId || process.env.TELEGRAM_USER_ID || '').trim();
  if (!tok) { log('[gateway] token nist — settings.gateway.token ya TELEGRAM_BOT_TOKEN dar .env.'); return null; }
  if (typeof onMessage !== 'function') { log('[gateway] onMessage nadarim — hich'); return null; }

  const tg = createTelegramApi(tok);
  let running = true;
  let offset = 0;

  const isAuth = (fromId) => {
    if (!allowId) return true; // userId tanzim nashode = hame (ba hoshdar dar log)
    return String(fromId || '') === allowId;
  };

  async function handleUpdate(upd) {
    offset = upd.update_id + 1;
    const msg = upd.message || upd.edited_message;
    const text = msg && (msg.text || msg.caption);
    if (!text) return;
    const chatId = msg.chat && msg.chat.id;
    const fromId = msg.from && msg.from.id;
    if (!chatId) return;

    if (!isAuth(fromId)) {
      await tg.sendMessage(chatId, 'Unauthorized.');
      return;
    }

    // typing... (ta user befahme darim kar mikonim)
    tg.sendChatAction(chatId, 'typing').catch(() => {});

    // 1) command ha mostaghim (sari, bedune LLM)
    try {
      const cmd = await handleTelegramCommand(text, {
        say: onMessage, getModel, agentName,
      });
      if (cmd && cmd.handled) {
        await tg.sendMessage(chatId, cmd.reply);
        return;
      }
    } catch (e) {
      await tg.sendMessage(chatId, `Error: ${e.message}`);
      return;
    }

    // 2) chat-e tabii -> agent (ba tool haye XT)
    try {
      const out = await onMessage(text, { chatId, from: msg.from, source: 'telegram' });
      const reply = out && out.reply !== undefined ? out.reply : String(out);
      await tg.sendMessage(chatId, reply || '(javabi nabud)');
    } catch (e) {
      await tg.sendMessage(chatId, `Error: ${e.message}`);
    }
  }

  async function loop() {
    // check token
    try {
      const me = await tg.getMe();
      if (me && me.ok && me.result) {
        const uname = me.result.username || '';
        log(`[gateway] telegram roshan shod${uname ? ` (@${uname})` : ''} — montazer-e payam...`);
        if (!allowId) log('[gateway] HOSHDAR: TELEGRAM_USER_ID tanzim nist — hame mitunan payam bedan! (userId ro set kon)');
        else log(`[gateway] allowlist: user ${allowId} (baghie Unauthorized)`);
        try { await tg.setMyCommands(TG_COMMANDS); } catch {}
      } else if (me && me.ok === false) {
        log(`[gateway] token ghalat-e: ${me.description || ''}`);
        running = false;
        return;
      }
    } catch { /* offline — poll loop handle mikone */ }

    while (running) {
      try {
        const data = await tg.getUpdates(offset, 25);
        if (!data || !data.ok || !Array.isArray(data.result)) { await sleep(3000); continue; }
        for (const upd of data.result) {
          try { await handleUpdate(upd); }
          catch (e) { log(`[gateway] update error: ${e.message}`); }
        }
      } catch (e) {
        if (running) { log(`[gateway] poll error: ${e.message}`); await sleep(3000); }
      }
    }
  }

  loop(); // bi-block

  return {
    stop() {
      running = false;
      log('[gateway] khamush shod.');
    },
  };
}

