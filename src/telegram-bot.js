// telegram-bot.js — Telegram runner (port az CryptoMind-XT/bot/telegram_agent.py + telegram_bot.py)
// ------------------------------------------------------------
// Merged mode: command ha -> trader (xt-agent telegram-commands + trader commands)
//               chat-e mamuli -> agent (soul/skills/prompt loop)
// Long-polling ba fetch (dependency nadare). Faghat TELEGRAM_USER_ID javab migire.
import { createTelegramApi } from './telegram.js';
import { handleTelegramCommand, TG_COMMANDS, startText } from './telegram-commands.js';

const TRADER_COMMANDS = [
  { command: 'autotrade_on', description: 'Auto-trade ro roshan kon' },
  { command: 'autotrade_off', description: 'Auto-trade ro khamush kon' },
  { command: 'open', description: 'Open trade: /open LONG' },
  { command: 'close_all', description: 'Close hameye position ha' },
  { command: 'protect', description: 'TP/SL be position-haye bi-stop attach kon' },
  { command: 'midmanage', description: 'Breakeven + trailing ejra kon' },
  { command: 'sync', description: 'Sync position ha ba local store' },
  { command: 'trades', description: 'Trade summary (PnL/winrate)' },
  { command: 'reset_cooldown', description: 'Cooldown ha ro pak kon' },
  { command: 'set', description: 'Setting: /set min_confidence 75' },
  { command: 'reseed', description: '.env ro rooye store ejra kon (setting haye .env haminja dide mishan)' },
];

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
      // 1) xt-agent telegram-commands (/status /balance /signal /pnl /settings /check_ai /close ...)
      const base = await handleTelegramCommand(text, {
        say: (m) => (agent ? agent.say(m) : Promise.resolve({ reply: 'agent nist' })),
        getModel: () => process.env.AI_MODEL || '(auto)',
        agentName,
        memory: trader ? trader.memory : null,
        trader,
        traderCommands: TRADER_COMMANDS,
      });
      if (base.handled) { await api.sendMessage(chatId, base.reply); return; }

      // 2) trader commands
      const handled = await handleTraderCommand(cmd, args, chatId);
      if (handled) return;

      // 3) chat-e mamuli -> agent
      if (cmd) { await api.sendMessage(chatId, `Unknown command ${cmd}. /start baraye list.`); return; }
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

  async function handleTraderCommand(cmd, args, chatId) {
    switch (cmd) {
      case 'start': case 'help':
        await api.sendMessage(chatId, startText(agentName) + '\n\n' + TRADER_COMMANDS.map((c) => `/${c.command} - ${c.description}`).join('\n'));
        return true;
      case 'autotrade_on': await api.sendMessage(chatId, trader ? trader.startAutoTrade() : 'trader nist'); return true;
      case 'autotrade_off': await api.sendMessage(chatId, trader ? trader.stopAutoTrade() : 'trader nist'); return true;
      case 'open': {
        if (!trader) { await api.sendMessage(chatId, 'trader nist'); return true; }
        const dir = String(args[0] || '').toUpperCase();
        await api.sendMessage(chatId, await trader.executeTrade(dir, 'MARKET', null));
        return true;
      }
      case 'close_all': await api.sendMessage(chatId, trader ? await trader.closeAllPositions() : 'trader nist'); return true;
      case 'protect': await api.sendMessage(chatId, trader ? await trader.protectOpenPositions() : 'trader nist'); return true;
      case 'midmanage': await api.sendMessage(chatId, trader ? await trader.runMidManagement() : 'trader nist'); return true;
      case 'sync': await api.sendMessage(chatId, trader ? await trader.syncPositions() : 'trader nist'); return true;
      case 'trades': await api.sendMessage(chatId, trader ? trader.memory.getTradeSummaryForAi() : 'trader nist'); return true;
      case 'reseed': {
        if (!trader) { await api.sendMessage(chatId, 'trader nist'); return true; }
        const changed = trader.memory.applyEnvDefaults();
        await api.sendMessage(chatId, changed.length
          ? `env rooye store ejra shod (${changed.length} key avaz shod):\n${changed.slice(0, 15).map((c) => `${c.key}: ${c.from} -> ${c.to}`).join('\n')}\n\n/settings baraye check.`
          : 'hich farghi nabud — store hamun .env-e.');
        return true;
      }
      case 'reset_cooldown': {
        if (!trader) { await api.sendMessage(chatId, 'trader nist'); return true; }
        const n = trader.memory.clearCooldown();
        await api.sendMessage(chatId, `${n} cooldown pak shod.`);
        return true;
      }
      case 'set': {
        if (!trader) { await api.sendMessage(chatId, 'trader nist'); return true; }
        const key = args[0];
        const value = args.slice(1).join(' ');
        if (!key || !value) { await api.sendMessage(chatId, 'Estefade: /set key value (mesal /set min_confidence 75)'); return true; }
        trader.memory.setSetting(key, value);
        await api.sendMessage(chatId, `set ${key} = ${value}`);
        return true;
      }
      default: return false;
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
