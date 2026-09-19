// Test signing-e XT (CCXT parity) — bedune network
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signedHeadersAndPayload, sortedQuery, signPrefix } from '../src/xt/sign.js';
import { XTBase } from '../src/xt/client-part1.js';
describe('XT signing', () => {
  it('sortedQuery moratab-e', () => {
    assert.equal(sortedQuery({ b: 2, a: 1 }), 'a=1&b=2');
  });
  it('GET: msg = appkey&ts#path#sortedQuery', () => {
    const { headers } = signedHeadersAndPayload({ method: 'GET', path: '/future/market/v1/test', params: { b: '2', a: '1' }, apiKey: 'AK', secret: 'SK' });
    assert.ok(headers['xt-validate-appkey'] === 'AK');
    assert.ok(headers['xt-validate-signature']);
  });
  it('POST JSON: signature rooye JSON body-e bedune fasele', () => {
    const params = { symbol: 'btc_usdt', origQty: 1 };
    const { headers, body } = signedHeadersAndPayload({ method: 'GET', path: '/p', params: {}, apiKey: 'AK', secret: 'SK' });
    assert.ok(headers);
    const s2 = signedHeadersAndPayload({ method: 'POST', path: '/p', params, apiKey: 'AK', secret: 'SK' });
    assert.equal(s2.body, JSON.stringify(params));
    // verify: recompute
    const ts = s2.headers['xt-validate-timestamp'];
    const msg = `xt-validate-appkey=AK&xt-validate-timestamp=${ts}#/p#${JSON.stringify(params)}`;
    const expect = crypto.createHmac('sha256', 'SK').update(msg).digest('hex');
    assert.equal(s2.headers['xt-validate-signature'], expect);
    assert.ok(body === '' || body === undefined);
  });
  it('_unwrap: returnCode!=0 -> XTError, result/data unwrap', () => {
    assert.throws(() => XTBase._unwrap({ returnCode: 1, msgInfo: 'bad' }, '/p'), /returnCode=1/);
    assert.deepEqual(XTBase._unwrap({ returnCode: 0, result: [1] }, '/p'), [1]);
    assert.deepEqual(XTBase._unwrap({ rc: 0, data: { a: 1 } }, '/p'), { a: 1 });
  });
  it('normalizeBalancePayload: single-coin dict -> list', () => {
    const n = XTBase.normalizeBalancePayload({ coin: 'usdt', walletBalance: 100, availableBalance: 80 });
    assert.equal(n.length, 1);
    assert.equal(n[0].coin, 'USDT');
  });
});
