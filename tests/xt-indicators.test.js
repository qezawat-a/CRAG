// Test indicator ha (pure, bedune network)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emaCross, rsiSignal, bollingerSignal, momentumSignal, atr } from '../src/xt/indicators.js';
import { scanTimeframe, normalizeKlines, dropFormingCandle } from '../src/xt/scanner.js';
function trend(n, from, to) { const out = []; for (let i = 0; i < n; i++) out.push(from + (to - from) * (i / (n - 1))); return out; }
describe('indicators', () => {
  it('RSI: oversold -> LONG, overbought -> SHORT', () => {
    const down = trend(40, 100, 50);
    assert.equal(rsiSignal(down).side, 'LONG');
    const up = trend(40, 50, 100);
    assert.equal(rsiSignal(up).side, 'SHORT');
  });
  it('BB/MOM/ATR crash nemikonan', () => {
    const flat = new Array(40).fill(100);
    assert.ok(bollingerSignal(flat).side);
    assert.ok(momentumSignal(flat).side);
    const ohlc = flat.map((c) => ({ h: c + 1, l: c - 1, c }));
    assert.ok(Number.isFinite(atr(ohlc)));
  });
  it('scanTimeframe hamishe object-e kamel mide', () => {
    const closes = trend(120, 100, 110);
    const candles = closes.map((c, i) => ({ timestamp: 1700000000000 + i * 60000, open: c, high: c + 1, low: c - 1, close: c, volume: 1, turnover: 1 }));
    const r = scanTimeframe(candles);
    assert.ok(['LONG', 'SHORT', 'NEUTRAL'].includes(r.direction));
    assert.ok(Array.isArray(r.allSignals) && r.allSignals.length === 5);
  });
  it('NEUTRAL explains insufficient agreement despite a high score', () => {
    const candles = trend(120, 100, 110).map((close) => ({ close }));
    const r = scanTimeframe(candles, { minAgree: 2 });
    assert.equal(r.direction, 'NEUTRAL');
    assert.ok(r.confidence >= 80);
    assert.match(r.rejectionReason, /Taeed-e hamjahat kafi nist/);
    assert.match(r.rejectionReason, /minimum=2/);
    assert.ok(r.vetoReason);
  });
  it('empty signals explain that no strategy survived', () => {
    const r = scanTimeframe([]);
    assert.equal(r.direction, 'NEUTRAL');
    assert.equal(r.confidence, 0);
    assert.match(r.rejectionReason, /Hich strategy/);
  });
  it('normalizeKlines: newest-first -> oldest-first', () => {
    const rows = [{ t: 3000, o: 1, h: 1, l: 1, c: 1, a: 1, v: 1 }, { t: 1000, o: 1, h: 1, l: 1, c: 1, a: 1, v: 1 }];
    const n = normalizeKlines(rows);
    assert.equal(n[0].timestamp, 1000);
  });
  it('emaCross: data-e kam -> NEUTRAL', () => {
    assert.equal(emaCross([1, 2, 3]).side, 'NEUTRAL');
  });
});
