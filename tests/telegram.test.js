// Test Telegram gateway (bedune network — mock fetch)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitMessage, createTelegramApi } from '../src/telegram.js';
import { handleTelegramCommand, startText, TG_COMMANDS } from '../src/telegram-commands.js';
import { TRADER_COMMANDS, handleTraderCommand } from '../src/telegram-trader.js';
import { resolveTelegramConfig } from '../src/gateway.js';
describe('telegram', () => {
  it('splitMessage: 4096 chunk', () => {
    assert.deepEqual(splitMessage('hi'), ['hi']);
    assert.equal(splitMessage('x'.repeat(5000)).length, 2);
  });
  it('TG_COMMANDS menu dare', () => {
    assert.ok(TG_COMMANDS.find((c) => c.command === 'start'));
    assert.ok(TG_COMMANDS.find((c) => c.command === 'signal'));
    assert.ok(TG_COMMANDS.find((c) => c.command === 'test'));
    assert.ok(TG_COMMANDS.find((c) => c.command === 'tset'));
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
  it('/test and typo-friendly /tset run the AI connectivity check', async () => {
    const say = async () => ({ reply: 'online' });
    for (const command of ['/check_ai', '/test', '/tset']) {
      const r = await handleTelegramCommand(command, { say, getModel: () => 'test-model' });
      assert.equal(r.handled, true, `${command} bayad handled beshe`);
      assert.ok(r.reply.includes('online'), `${command} bayad response-e AI ro neshun bede`);
    }
  });
  it('command haye trader az handleTelegramCommand rad NEMISHAN (handled:false)', async () => {
    // BUG-e ghabl: hame ina 'Unknown command' migereftan chon in module
    // handled:true bargasht mikard va handleTraderCommand hich vaght seda nashode.
    for (const c of ['/autotrade_on', '/autotrade_off', '/open LONG', '/close_all', '/protect', '/midmanage', '/sync', '/trades', '/reset_cooldown', '/set min_confidence 75', '/get leverage', '/reset_settings', '/reseed', '/dryrun 1']) {
      const r = await handleTelegramCommand(c, {});
      assert.equal(r.handled, false, `${c} bayad handled:false bashe (vagar-na trader ejra nemishe)`);
    }
  });
  it('/start list-e trader commands ro ham neshon mide (ba ctx.traderCommands)', async () => {
    const r = await handleTelegramCommand('/start', { agentName: 'J-Rock', traderCommands: [{ command: 'reset_settings', description: 'x' }, { command: 'autotrade_on', description: 'y' }] });
    assert.ok(r.reply.includes('/reset_settings'));
    assert.ok(r.reply.includes('/autotrade_on'));
  });
  it('har command-e TRADER_COMMANDS (a) handleTraderCommand handle mikone va (b) az handleTelegramCommand rad mishe', async () => {
    // Regression-e "nesfe command ha mige Unknown": handleTelegramCommand nabaad
    // command-haye trader ro (handled:true) ghabul kone, vagar-na telegram-bot.js
    // ghabl az handleTraderCommand return mishe va command hich vaght ejra nemishe.
    // TRADER_COMMANDS alan dar src/telegram-trader.js-e (shared bot + gateway).
    assert.ok(TRADER_COMMANDS.length >= 11, `TRADER_COMMANDS kam-e (${TRADER_COMMANDS.length})`);
    const cmds = TRADER_COMMANDS.map((c) => c.command);
    // start/help dar base handle mishan, baghie dar sharedTraderCommand
    for (const c of cmds) {
      const r = await handleTelegramCommand(`/${c}`, {});
      assert.equal(r.handled, false, `/${c} nabaad tu handleTelegramCommand handle beshe`);
    }
    // shared handler: bedune trader -> handled:true ba payam-e "trader nist" (na Unknown)
    // ba trader mock -> ham handled:true (ejra mishe, Unknown NADIM)
    const { LongTermMemory } = await import('../src/store/memory.js');
    const { XTTrader } = await import('../src/trader/trader.js');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-test-')), 'store.json');
    const mem = new LongTermMemory(file, { databaseUrl: null });
    await mem.init();
    mem.seedDefaults();
    const trader = new XTTrader(mem);
    for (const c of cmds) {
      let args = [];
      if (c === 'set') args = ['leverage', '10'];
      if (c === 'get') args = ['leverage'];
      if (c === 'open') args = ['LONG'];
      if (c === 'dryrun') args = [];
      const r = await handleTraderCommand(c, args, { trader });
      assert.equal(r.handled, true, `/${c} bayad dar handleTraderCommand handle beshe (Unknown NADIM)`);
      assert.ok(typeof r.reply === 'string' && r.reply.length > 0, `/${c} reply khali-e`);
    }
    // unknown command -> handled:false (ta caller be agent forward kone, na "Unknown command")
    const u = await handleTraderCommand('blah_unknown_xyz', [], { trader });
    assert.equal(u.handled, false);
    await mem.close();
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
  it('/settings bedune memory ham kar mikone + HAME ro neshun mide (na 4 key)', async () => {
    const r = await handleTelegramCommand('/settings', {});
    assert.equal(r.handled, true);
    assert.ok(r.reply.includes('symbol='));
    assert.ok(r.reply.includes('SETTINGS'));
    // HAMEYE 26 key bayad bashan (fix-e "faghat 4 key + base url")
    for (const k of ['symbol=', 'leverage=', 'timeframes=', 'min_confidence=', 'max_positions=', 'cooldown_minutes=', 'reversal_confidence=']) {
      assert.ok(r.reply.includes(k), `settings bayad ${k} ro dashte bashe (HAME, na 4 key): ${r.reply.slice(0, 300)}`);
    }
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
