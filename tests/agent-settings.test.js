// Test agent-only trade settings: .env ignore, validation, HAMEYE settings
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Config } from '../src/config.js';
import { LongTermMemory } from '../src/store/memory.js';
import { traderTools } from '../src/trader/agent-tools.js';
import { handleTraderCommand } from '../src/telegram-trader.js';
import { handleTelegramCommand } from '../src/telegram-commands.js';
import { XTTrader } from '../src/trader/trader.js';

const tmpMem = async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-set-')), 'store.json');
  const m = new LongTermMemory(file, { databaseUrl: null });
  await m.init();
  m.seedDefaults();
  return m;
};

describe('config agent-only', () => {
  it('defaultSettings .env ro MIKHUNE NA (static)', () => {
    process.env.DEFAULT_LEVERAGE = '999';
    process.env.MIN_CONFIDENCE = '999';
    process.env.XT_DEFAULT_SYMBOL = 'hack_usdt';
    const d = Config.defaultSettings();
    assert.equal(d.leverage, 75);
    assert.equal(d.min_confidence, 80);
    assert.equal(d.symbol, 'btc_usdt');
    delete process.env.DEFAULT_LEVERAGE;
    delete process.env.MIN_CONFIDENCE;
    delete process.env.XT_DEFAULT_SYMBOL;
  });
  it('validateSetting: valid + alias + invalid', () => {
    assert.deepEqual(Config.validateSetting('leverage', '10'), { ok: true, key: 'leverage', normalized: '10' });
    assert.ok(!Config.validateSetting('leverage', '999').ok);
    assert.ok(!Config.validateSetting('leverage', 'abc').ok);
    // alias margin_mode -> position_type
    const a = Config.validateSetting('margin_mode', 'ISOLATED');
    assert.equal(a.ok, true);
    assert.equal(a.key, 'position_type');
    assert.equal(a.normalized, 'ISOLATED');
    // enum case-insensitive + CROSS normalize
    assert.equal(Config.validateSetting('position_type', 'cross').normalized, 'CROSSED');
    // symbol lowercase validation
    assert.equal(Config.validateSetting('symbol', 'ETH_USDT').normalized, 'eth_usdt');
    assert.ok(!Config.validateSetting('symbol', 'bad').ok);
    // timeframes
    assert.equal(Config.validateSetting('timeframes', '1m, 5m').normalized, '1m,5m');
    assert.ok(!Config.validateSetting('timeframes', '9m').ok);
    // bool
    assert.equal(Config.validateSetting('reversal_enabled', '0').normalized, 'false');
    assert.equal(Config.validateSetting('reversal_enabled', '1').normalized, 'true');
    // unknown + legacy
    assert.ok(!Config.validateSetting('blah_unknown', '1').ok);
    assert.ok(!Config.validateSetting('max_loss_pct', '5').ok);
  });
  it('ignoredTradeEnvSet: env haye ghadimi ro list mikone', () => {
    process.env.DEFAULT_LEVERAGE = '10';
    const set = Config.ignoredTradeEnvSet();
    assert.ok(set.includes('DEFAULT_LEVERAGE'));
    delete process.env.DEFAULT_LEVERAGE;
  });
});

describe('trader settings via agent (HAME, na 4 key)', () => {
  it('trader_settings_get HAMEYE 26 key ro mide', async () => {
    const m = await tmpMem();
    const trader = new XTTrader(m);
    const tools = traderTools(trader, { agentName: 'test' });
    const g = tools.find((t) => t.name === 'trader_settings_get');
    assert.ok(g);
    const out = await g.run({});
    for (const k of ['symbol=', 'leverage=', 'timeframes=', 'min_confidence=', 'tf_min_confidence=', 'min_agreeing_strategies=', 'max_positions=', 'cooldown_minutes=', 'breakeven_threshold_pct=', 'trailing_trigger_roi_pct=', 'trailing_distance_pct=', 'sl_liquidation_safety=', 'on_tpsl_failure=', 'reversal_enabled=', 'reversal_confidence=', 'report_interval_sec=']) {
      assert.ok(out.includes(k), `trader_settings_get bayad ${k} ro dashte bashe:\n${out.slice(0, 500)}`);
    }
    await m.close();
  });
  it('trader_settings_set ba validation (valid OK, invalid fail)', async () => {
    const m = await tmpMem();
    const trader = new XTTrader(m);
    const tools = traderTools(trader, { agentName: 'test' });
    const st = tools.find((t) => t.name === 'trader_settings_set');
    const ok = await st.run({ key: 'leverage', value: '10' });
    assert.ok(ok.includes('OK'), ok);
    assert.equal(m.getSetting('leverage'), '10');
    const bad = await st.run({ key: 'leverage', value: '999' });
    assert.ok(bad.includes('failed'), bad);
    assert.equal(m.getSetting('leverage'), '10'); // avaz NASHODE
    // alias
    const al = await st.run({ key: 'margin_mode', value: 'ISOLATED' });
    assert.ok(al.includes('OK'), al);
    assert.equal(m.getSetting('position_type'), 'ISOLATED');
    await m.close();
  });
  it('/set + /get + /reset_settings via handleTraderCommand', async () => {
    const m = await tmpMem();
    const trader = new XTTrader(m);
    const r1 = await handleTraderCommand('set', ['leverage', '20'], { trader });
    assert.equal(r1.handled, true);
    assert.ok(r1.reply.includes('OK'), r1.reply);
    assert.equal(m.getSetting('leverage'), '20');
    const rBad = await handleTraderCommand('set', ['leverage', '999'], { trader });
    assert.ok(rBad.reply.includes('failed'), rBad.reply);
    const rGet = await handleTraderCommand('get', ['leverage'], { trader });
    assert.ok(rGet.reply.includes('leverage=20'), rGet.reply);
    const rGetBad = await handleTraderCommand('get', ['blah'], { trader });
    assert.ok(rGetBad.reply.includes('unknown'), rGetBad.reply);
    const rReset = await handleTraderCommand('reset_settings', [], { trader });
    assert.ok(rReset.reply.includes('Reset'), rReset.reply);
    assert.equal(m.getSetting('leverage'), '75');
    // /reseed deprecated ولی کار میکنه (= reset)
    m.setSetting('leverage', '33');
    const rReseed = await handleTraderCommand('reseed', [], { trader });
    assert.ok(rReseed.reply.toLowerCase().includes('deprecated') || rReseed.reply.includes('Reset'), rReseed.reply);
    await m.close();
  });
  it('/settings (Telegram) HAME ro neshun mide', async () => {
    const m = await tmpMem();
    const r = await handleTelegramCommand('/settings', { memory: m });
    assert.equal(r.handled, true);
    const count = (r.reply.match(/=/g) || []).length;
    assert.ok(count >= 26, `settings bayad >=26 key dashte bashe (did: ${count}):\n${r.reply.slice(0, 400)}`);
    await m.close();
  });
});
