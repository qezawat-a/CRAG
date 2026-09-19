// telegram.js — Telegram Bot API client (long-polling, bedune dependency)
// ------------------------------------------------------------------
// Faghat fetch (node 18+). Hich library-e telegram lazem nist.
// - getMe() -> check token
// - getUpdates(offset) -> poll
// - sendMessage(chatId, text) -> ba chunk (4096) + parse_mode optional
// - setMyCommands(commands) -> menu-e bot
const TG_MAX = 4096;
export function splitMessage(text) {
  const s = String(text ?? '');
  if (s.length <= TG_MAX) return [s];
  const out = [];
  for (let i = 0; i < s.length; i += TG_MAX) out.push(s.slice(i, i + TG_MAX));
  return out;
}
export function createTelegramApi(token, { timeoutMs = 30000 } = {}) {
  const api = (m) => `https://api.telegram.org/bot${token}/${m}`;
  async function call(method, params = {}, { timeout = timeoutMs } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(api(method), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => null);
      return data;
    } finally { clearTimeout(timer); }
  }
  return {
    async getMe() { return call('getMe', {}, { timeout: 15000 }); },
    async getUpdates(offset, timeoutSec = 25) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), (timeoutSec + 10) * 1000);
      try {
        const res = await fetch(`${api('getUpdates')}?timeout=${timeoutSec}&offset=${offset}&allowed_updates=${encodeURIComponent(JSON.stringify(['message', 'edited_message']))}`, { signal: ctrl.signal });
        return await res.json().catch(() => null);
      } finally { clearTimeout(timer); }
    },
    async sendMessage(chatId, text) {
      for (const chunk of splitMessage(text)) {
        await call('sendMessage', { chat_id: chatId, text: chunk });
      }
    },
    async sendChatAction(chatId, action = 'typing') {
      try { await call('sendChatAction', { chat_id: chatId, action }, { timeout: 8000 }); } catch {}
    },
    async setMyCommands(commands) { return call('setMyCommands', { commands }); },
  };
}
