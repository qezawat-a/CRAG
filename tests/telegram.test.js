// Test Telegram gateway (bedune network — mock fetch)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitMessage, createTelegramApi } from '../src/telegram.js';
import { handleTelegramCommand, startText, TG_COMMANDS } from '../src/telegram-commands.js';
import { resolveTelegramConfig } from '../src/gateway.js';
import fs from 'node:fs';
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
    // command-e nashenakhte bayad handled:false bashe ta router (telegram-bot)
    // betoone be trader/agent berese — vagar-na "Unknown command" midad.
    const u = await handleTelegramCommand('/blah', {});
    assert.equal(u.handled, false);
  });
  it('command haye trader az handleTelegramCommand rad NEMISHAN (handled:false)', async () => {
    // BUG-e ghabl: hame ina 'Unknown command' migereftan chon in module
    // handled:true bargasht mikard va handleTraderCommand hich vaght seda nashode.
    for (const c of ['/autotrade_on', '/autotrade_off', '/open LONG', '/close_all', '/protect', '/midmanage', '/sync', '/trades', '/reset_cooldown', '/set min_confidence 75', '/reseed']) {
      const r = await handleTelegramCommand(c, {});
      assert.equal(r.handled, false, `${c} bayad handled:false bashe (vagar-na trader ejra nemishe)`);
    }
  });
  it('/start list-e trader commands ro ham neshon mide (ba ctx.traderCommands)', async () => {
    const r = await handleTelegramCommand('/start', { agentName: 'J-Rock', traderCommands: [{ command: 'reseed', description: 'x' }, { command: 'autotrade_on', description: 'y' }] });
    assert.ok(r.reply.includes('/reseed'));
    assert.ok(r.reply.includes('/autotrade_on'));
  });
  it('har command-e TRADER_COMMANDS (a) tu switch case dare va (b) az handleTelegramCommand rad mishe', async () => {
    // Regression-e "nesfe command ha mige Unknown": handleTelegramCommand nabaad
    // command-haye trader ro (handled:true) ghabul kone, vagar-na telegram-bot.js
    // ghabl az handleTraderCommand return mishe va command hich vaght ejra nemishe.
    const src = fs.readFileSync(new URL('../src/telegram-bot.js', import.meta.url), 'utf8');
    const start = src.indexOf('const TRADER_COMMANDS');
    const list = src.slice(start, src.indexOf('];', start));
    const cmds = [...list.matchAll(/command: '([a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(cmds.length >= 11, `TRADER_COMMANDS parse nashod (${cmds.length})`);
    for (const c of cmds) {
      assert.ok(new RegExp(`case '${c}':`).test(src), `${c} tu TRADER_COMMANDS-e vali case nadarad`);
      const r = await handleTelegramCommand(`/${c}`, {});
      assert.equal(r.handled, false, `/${c} nabaad tu handleTelegramCommand handle beshe`);
    }
    // command-haye TG_COMMANDS ham bayad handle beshan (na handled:false).
    // fetch ra mock mikonim ta test be network (fapi.xt.com) niyaz nadashte bashe.
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 200, text: async () => JSON.stringify({ returnCode: 0, result: [] }) });
    try {
      for (const { command } of TG_COMMANDS) {
        const r = await handleTelegramCommand(`/${command}`, {});
        assert.equal(r.handled, true, `/${command} az TG_COMMANDS handle nemishe`);
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });
  it('non-command -> not handled (mire be agent)', async () => {
    const r = await handleTelegramCommand('salam, btc chetore?', {});
    assert.equal(r.handled, false);
  });
  it('/settings bedune memory ham kar mikone (env-only)', async () => {
    const r = await handleTelegramCommand('/settings', {});
    assert.equal(r.handled, true);
    assert.ok(r.reply.includes('symbol='));
    assert.ok(r.reply.includes('SETTINGS'));
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
