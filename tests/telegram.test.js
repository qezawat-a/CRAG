// Test Telegram gateway (bedune network — mock fetch)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitMessage, createTelegramApi } from '../src/telegram.js';
import { handleTelegramCommand, startText, TG_COMMANDS } from '../src/telegram-commands.js';
import { resolveTelegramConfig } from '../src/gateway.js';
describe('telegram', () => {
  it('splitMessage: 4096 chunk', () => {
    assert.deepEqual(splitMessage('hi'), ['hi']);
    assert.equal(splitMessage('x'.repeat(5000)).length, 2);
  });
  it('TG_COMMANDS menu dare', () => {
    assert.ok(TG_COMMANDS.find((c) => c.command === 'start'));
    assert.ok(TG_COMMANDS.find((c) => c.command === 'signal'));
    assert.ok(startText('J-Rock').includes('/status'));
  });
  it('resolveTelegramConfig: settings > env', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-tok';
    process.env.TELEGRAM_USER_ID = '111';
    const r1 = resolveTelegramConfig({ gateway: { token: '', userId: '' } });
    assert.equal(r1.token, 'env-tok');
    const r2 = resolveTelegramConfig({ gateway: { token: 'set-tok', userId: '222' } });
    assert.equal(r2.token, 'set-tok');
    assert.equal(r2.userId, '222');
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_USER_ID;
  });
  it('/start + unknown command', async () => {
    const s = await handleTelegramCommand('/start', { agentName: 'J-Rock' });
    assert.equal(s.handled, true);
    assert.ok(s.reply.includes('/status'));
    const u = await handleTelegramCommand('/blah', {});
    assert.equal(u.handled, true);
  });
  it('non-command -> not handled (mire be agent)', async () => {
    const r = await handleTelegramCommand('salam, btc chetore?', {});
    assert.equal(r.handled, false);
  });
  it('/settings bedune network kar mikone', async () => {
    const r = await handleTelegramCommand('/settings', {});
    assert.equal(r.handled, true);
    assert.ok(r.reply.includes('symbol='));
  });
  it('/diag key ha ro neshoon mide', async () => {
    const r = await handleTelegramCommand('/diag', { getModel: () => 'test-model' });
    assert.equal(r.handled, true);
    assert.ok(r.reply.includes('XT_API_KEY'));
  });
  it('api client ba mock fetch', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({ json: async () => ({ ok: true, result: true }) });
    try {
      const api = createTelegramApi('123:ABC');
      const me = await api.getMe();
      assert.equal(me.ok, true);
      await api.sendMessage(1, 'hi'); // chunk + send, crash nakone
    } finally { globalThis.fetch = orig; }
  });
});
