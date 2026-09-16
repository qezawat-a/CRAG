// telegram-bot.js — Telegram runner (port az CryptoMind-XT/bot/telegram_agent.py + telegram_bot.py)
// ------------------------------------------------------------
// Merged mode: command ha -> trader (xt-agent telegram-commands + trader commands)
//               chat-e mamuli -> agent (soul/skills/prompt loop)
// Long-polling ba fetch (dependency nadare). Faghat TELEGRAM_USER_ID javab migire.
// AGENT-ONLY: trade settings FAGHAT az store (TUI/Telegram/agent), .env ignore.
// Unknown commands: aval be agent forward mishan (ta agent ba tools javab bede),
//   na "Unknown command" — faghat age agent ham natunest, list neshun dade mishe.
import { createTelegramApi } from './telegram.js';
import { handleTelegramCommand, TG_COMMANDS, startText } from './telegram-commands.js';
import { TRADER_COMMANDS, handleTraderCommand as sharedTraderCommand } from './telegram-trader.js';

export { TRADER_COMMANDS };

export async function startTelegramBot({ trader, agent, agentName = 'crypto-agent', log = console.log }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const userId = String(process.env.TELEGRAM_USER_ID || '').trim();
  if (!token || !userId) throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_USER_ID dar .env nist');

  const api = createTelegramApi(token);
  const me = await api.getMe();
  if (!me || !me.ok) throw new Error(`Telegram getMe failed: ${JSON.stringify(me).slice(0, 200)}`);
  log(`[telegram] bot @${me.result.username} online — chat ha az user ${userId} ghabul mishan`);

  try {
    await api.setMyCommands([...TG_COMMANDS, ...TRADER_COMMANDS]);
  } catch (e) { log(`[telegram] setMyCommands failed: ${e.message}`); }

  // trader events -> telegram
  if (trader) {
    trader.setNotifyCallback((msg) => {
      api.sendMessage(userId, msg).catch((e) => log(`[telegram] notify failed: ${e.message}`));
    });
  }

  let offset = 0;
  let running = true;

  async function handleUpdate(update) {
    const msg = update.message || update.edited_message;
    if (!msg || !msg.text) return;
    const chatId = String(msg.chat && msg.chat.id || '');
    if (chatId !== userId) return; // faqat saheb-e bot
    const text = msg.text.trim();
    log(`[telegram] <- ${text.slice(0, 120)}`);
    await api.sendChatAction(chatId, 'typing').catch(() => {});

    const parts = text.slice(1).split(/\s+/);
    const cmd = text.startsWith('/') ? (parts[0] || '').toLowerCase().split('@')[0] : '';
    const args = parts.slice(1);

    try {
      // 1) xt-agent telegram-commands (/status /balance /signal /pnl /settings /check_ai /close /diag ...)
      const base = await handleTelegramCommand(text, {
        say: (m) => (agent ? agent.say(m) : Promise.resolve({ reply: 'agent nist' })),
        getModel: () => process.env.AI_MODEL || '(auto)',
        agentName,
        memory: trader ? trader.memory : null,
        trader,
        traderCommands: TRADER_COMMANDS,
      });
      if (base.handled) { await api.sendMessage(chatId, base.reply); return; }

      // 2) trader commands (shared — hamun ke gateway ham estefade mikone)
      if (cmd === 'start' || cmd === 'help') {
        await api.sendMessage(chatId, startText(agentName) + '\n\nTrader commands:\n' + TRADER_COMMANDS.map((c) => `/${c.command} - ${c.description}`).join('\n'));
        return;
      }
      const tr = await sharedTraderCommand(cmd, args, { trader });
      if (tr.handled) { await api.sendMessage(chatId, tr.reply); return; }

      // 3) Unknown /command -> aval be agent bede (agent ba trader_* tools mitune handle kone).
      //    Mesal: user "/settings" ro bejaye command, be onvane chat be agent mige,
      //    ya Farsi mige "setting o neshun bede" — agent bayad HAME ro neshun bede.
      if (cmd) {
        if (agent) {
          try {
            const out = await agent.say(text);
            const reply = out && out.reply !== undefined ? out.reply : String(out);
            await api.sendMessage(chatId, reply || '(javabi nabud)');
            return;
          } catch (e) {
            log(`[telegram] agent fallback failed: ${e.message}`);
            // oftad be payin -> Unknown + list
          }
        }
        await api.sendMessage(chatId, `Unknown command /${cmd}. /start baraye list.\n\nYa be zaban-e sade bego, mesal: "setting o neshun bede" ya "leverage ro 10 kon"`);
        return;
      }

      // 4) chat-e mamuli -> agent
      if (agent) {
        const out = await agent.say(text);
        await api.sendMessage(chatId, out.reply ?? String(out));
      } else {
        await api.sendMessage(chatId, 'Agent online nist (AI key ra dar .env set konid).');
      }
    } catch (e) {
      log(`[telegram] handle error: ${e.message}`);
      await api.sendMessage(chatId, `Error: ${e.message}`).catch(() => {});
    }
  }

  (async () => {
    while (running) {
      try {
        const data = await api.getUpdates(offset, 25);
        if (data && data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            offset = Math.max(offset, update.update_id + 1);
            await handleUpdate(update);
          }
        }
      } catch (e) {
        log(`[telegram] poll error: ${e.message}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  })();

  return {
    stop() { running = false; },
    api,
  };
}
