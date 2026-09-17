// tests/trader-merge.test.js — smoke test baraye module-haye merged (Crypto2 port -> JS)
// Run: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LongTermMemory } from '../src/store/memory.js';
import { XTTrader } from '../src/trader/trader.js';

function tmpStore() {
  const dir = mkdtempSync(path.join(tmpdir(), 'crypto-agent-test-'));
  return new LongTermMemory(path.join(dir, 'store.json'));
}

// mock XT client: zigzag-uptrend candles (MACD+MOM LONG midan, RSI veto nemishe)
function uptrendRows(n = 121) {
  const rows = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price *= i % 2 === 0 ? 1.007 : 0.996; // net uptrend ba zigzag
    const t = 1700000000000 + i * 60000;
    rows.push({ t, o: price, h: price * 1.002, l: price * 0.998, c: price, a: '10', v: '1000' });
  }
  return rows;
}
function mockXT() {
  const rows = uptrendRows();
  return {
    getKlines: async () => rows,
    getAggTicker: async () => ({ c: String(rows[rows.length - 1].c) }),
    getMarkPrice: async () => ({ p: String(rows[rows.length - 1].c) }),
    getPositions: async () => [],
    createOrder: async () => ({ orderId: 'mock-order-1' }),
    cancelTpsl: async () => ({}),
    cancelOrder: async () => ({}),
    cancelAllOrders: async () => ({}),
    getSymbolDetail: async () => ({ contractSize: '0.001', minQty: '1', pricePrecision: '2', minStepPrice: '0.01', supportOrderType: 'MARKET,LIMIT', supportTimeInForce: 'IOC,GTC', maxMarketOrderQty: '10000', minNotional: '1', maxNotional: '1000000' }),
    getLeverageBrackets: async () => [{ maxLeverage: '125', maxNominalValue: '1000000' }],
  };
}

describe('LongTermMemory (store)', () => {
  test('settings: set/get/default/legacy cleanup', () => {
    const m = tmpStore();
    m.seedDefaults();
    assert.equal(m.getSetting('symbol'), 'btc_usdt'); // seeded default
    m.setSetting('min_confidence', '75');
    assert.equal(m.getSetting('min_confidence'), '75');
    assert.equal(m.getInt('min_confidence', 80), 75);
    assert.equal(m.setSettingDefault('symbol', 'eth_usdt'), false); // default clobber nemikone
  });

  test('cooldowns: set/cap/expire/clear', () => {
    const m = tmpStore();
    m.setCooldown('BTC_USDT', 'long', 30); // cap 10 min
    assert.ok(m.getCooldownRemaining('btc_usdt', 'LONG') <= 601);
    assert.ok(m.isInCooldown('btc_usdt', 'LONG'));
    assert.equal(m.isInCooldown('eth_usdt', 'LONG'), false);
    assert.equal(m.clearCooldown('btc_usdt'), 1);
    assert.equal(m.isInCooldown('btc_usdt', 'LONG'), false);
  });

  test('trades: record/close/stats/pnl', () => {
    const m = tmpStore();
    const id = m.recordTrade({ symbol: 'btc_usdt', positionSide: 'LONG', orderId: 'o1', entryPrice: 100, amount: 5, leverage: 10, confidence: 85, strategy: 'EMA,MACD', signalStrength: 0.5, timeframe: '1m,5m' });
    assert.equal(m.getOpenTrades().length, 1);
    m.closeTrade(id, 101, 0.5);
    assert.equal(m.getOpenTrades().length, 0);
    assert.equal(m.getTotalPnl(), 0.5);
    const stats = m.getTradeCount();
    assert.equal(stats.closed, 1);
    assert.equal(stats.winrate, 100);
  });

  test('signals: record + recent dedupe lookup', () => {
    const m = tmpStore();
    m.recordSignal({ symbol: 'btc_usdt', direction: 'LONG', strategy: 'EMA,MACD', timeframe: '1m,5m', confidence: 85, signalStrength: 0.4, price: 100 });
    const recent = m.getRecentSignals('btc_usdt', 5);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].direction, 'LONG');
  });
});

describe('XTTrader (merged logic)', () => {
  function makeTrader() {
    const memory = tmpStore();
    memory.seedDefaults();
    memory.setSetting('min_confidence', '60');
    memory.setSetting('tf_min_confidence', '50');
    memory.setSetting('min_agreeing_strategies', '1');
    const trader = new XTTrader(memory);
    const mock = mockXT();
    trader.xt = mock;
    trader.risk.xt = mock;
    trader.positionMgr.xt = mock;
    return { trader, memory };
  }

  test('scanAndReport: uptrend -> LONG ba confidence', async () => {
    const { trader } = makeTrader();
    const r = await trader.scanAndReport('btc_usdt');
    assert.equal(r.symbol, 'btc_usdt');
    assert.ok(r.price > 0);
    assert.equal(r.direction, 'LONG');
    assert.ok(r.confidence > 0);
    assert.ok(r.strategiesUsed.length >= 1);
    const report = trader.formatSignalReport(r);
    assert.match(report, /SIGNAL SCAN \[btc_usdt\]/);
    assert.match(report, /Direction: LONG/);
  });

  test('_gateChecks: cooldown va max_positions block mikonan', async () => {
    const { trader, memory } = makeTrader();
    // 1) cooldown ghabl az trade: gate-e aval mibinare
    memory.setCooldown('btc_usdt', 'SHORT', 3);
    assert.match(await trader._gateChecks('btc_usdt', 'SHORT'), /cooldown active/);
    memory.clearCooldown();
    // 2) max_positions
    assert.equal(await trader._gateChecks('btc_usdt', 'LONG'), null);
    memory.recordTrade({ symbol: 'btc_usdt', positionSide: 'LONG', entryPrice: 100, amount: 1, leverage: 5 });
    assert.match(await trader._gateChecks('btc_usdt', 'LONG'), /max positions|already have/);
  });

  test('executeTrade: DRY_RUN preview midahad va order nemifreste', async () => {
    const { trader } = makeTrader();
    process.env.XT_DRY_RUN = '1';
    let orderCalled = false;
    trader.xt.createOrder = async () => { orderCalled = true; return { orderId: 'x' }; };
    const out = await trader.executeTrade('LONG', 'MARKET');
    assert.match(out, /DRY_RUN=1/);
    assert.equal(orderCalled, false);
    delete process.env.XT_DRY_RUN;
  });

  for (const mode of ['margin', 'risk']) {
    test(`auto scan: ${mode} sizing object reaches mocked order creation`, async () => {
      const { trader, memory } = makeTrader();
      const oldDryRun = process.env.XT_DRY_RUN;
      process.env.XT_DRY_RUN = '0';
      memory.setSetting('position_mode', mode);
      let sizingCalls = 0;
      let order = null;
      const calculate = trader.risk.calculatePositionSize.bind(trader.risk);
      trader.risk.calculatePositionSize = async (...args) => {
        sizingCalls++;
        return calculate(...args);
      };
      trader.xt.getBalances = async () => [{ coin: 'USDT', availableBalance: '100', walletBalance: '100' }];
      trader.xt.setLeverage = async () => ({});
      trader.xt.setPositionType = async () => ({});
      trader.xt.createOrder = async (args) => { order = args; return { orderId: 'mock-only' }; };
      trader._finalizeOpen = async (args) => {
        assert.equal(args.sizeMode, mode === 'margin' ? 'margin_based' : 'risk_based');
        assert.equal(args.orderId, 'mock-only');
        return 'mock order accepted';
      };
      try {
        await trader._scanCycle();
        assert.ok(order);
        assert.ok(Number.isInteger(order.origQty) && order.origQty > 0);
        assert.equal(order.positionSide, 'LONG');
        assert.equal(sizingCalls, mode === 'margin' ? 2 : 1);
      } finally {
        if (oldDryRun === undefined) delete process.env.XT_DRY_RUN;
        else process.env.XT_DRY_RUN = oldDryRun;
        await memory.close();
      }
    });
  }

  test('zero sizing returns reason without sending an order', async () => {
    const { trader, memory } = makeTrader();
    const oldDryRun = process.env.XT_DRY_RUN;
    process.env.XT_DRY_RUN = '0';
    trader.xt.getBalances = async () => [{ coin: 'USDT', availableBalance: '0' }];
    trader.xt.createOrder = async () => { assert.fail('zero balance must not send orders'); };
    try {
      assert.match(await trader.executeTrade('LONG'), /Cannot size position: computed size 0/);
    } finally {
      if (oldDryRun === undefined) delete process.env.XT_DRY_RUN;
      else process.env.XT_DRY_RUN = oldDryRun;
      await memory.close();
    }
  });

  test('closePosition: vaghei close -> cooldown baraye HAR DO side', async () => {
    const { trader, memory } = makeTrader();
    // position-e zende rooye exchange mock kon
    trader.positionMgr.xt = {
      ...trader.positionMgr.xt,
      getPositions: async () => [{ symbol: 'btc_usdt', positionSide: 'LONG', positionSize: '2', entryPrice: '100', calMarkPrice: '101', availableCloseSize: '2' }],
    };
    const id = memory.recordTrade({ symbol: 'btc_usdt', positionSide: 'LONG', entryPrice: 100, amount: 2, leverage: 5 });
    const [ok] = await trader.positionMgr.closePosition('btc_usdt', 'LONG', id);
    assert.equal(ok, true);
    assert.equal(memory.getOpenTrades().length, 0);
    const closed = memory.getTrade(id);
    assert.equal(closed.status, 'CLOSED');
    assert.ok(memory.isInCooldown('btc_usdt', 'LONG'));
    assert.ok(memory.isInCooldown('btc_usdt', 'SHORT'));
  });

  test('adoptExchangePositions: position-e bironi record mishe', async () => {
    const { trader, memory } = makeTrader();
    trader.positionMgr.xt = {
      ...trader.positionMgr.xt,
      getPositions: async () => [{ symbol: 'eth_usdt', positionSide: 'SHORT', positionSize: '3', entryPrice: '2000', leverage: '10', profitId: 'p1' }],
    };
    const adopted = await trader.positionMgr.adoptExchangePositions();
    assert.equal(adopted.length, 1);
    assert.equal(adopted[0].symbol, 'eth_usdt');
    assert.ok(adopted[0].trade_id > 0);
    assert.equal(memory.getOpenTrades('eth_usdt').length, 1);
  });
});
