// Test-e error-e network-e XT (bedune network — mock fetch)
// Motive: /status ghabl-an "Price: 0" va "fetch failed" (bedune dalil) neshoon
// midad; in test-ha tasmim daran ke cause-e vaghei (EAI_AGAIN/...) va timeout
// dige gom nashe.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XTBase, describeFetchError } from '../src/xt/client-part1.js';
import { XTClient } from '../src/xt/client.js';
import { getCurrentPriceDetailed } from '../src/xt/scanner.js';
import { handleTelegramCommand } from '../src/telegram-commands.js';

const withFetch = async (mock, fn) => {
  const orig = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await fn(); } finally { globalThis.fetch = orig; }
};
const netFail = (code) => { const e = new TypeError('fetch failed'); e.cause = { code }; throw e; };
const okJson = (result) => ({ status: 200, text: async () => JSON.stringify({ returnCode: 0, msgInfo: 'success', error: null, result }) });
const fast = () => new XTClient({ host: 'https://fapi.test.local', accessKey: 'AK', secretKey: 'SK', retryBaseMs: 0, minRequestIntervalMs: 0 });

describe('XT network errors', () => {
  it('describeFetchError: cause code / abort / bedune cause', () => {
    assert.equal(describeFetchError(null), 'request failed');
    const e = new TypeError('fetch failed'); e.cause = { code: 'EAI_AGAIN' };
    assert.equal(describeFetchError(e, 10000), 'fetch failed (EAI_AGAIN)');
    const ab = new Error('This operation was aborted'); ab.name = 'AbortError';
    assert.equal(describeFetchError(ab, 10000), 'timeout after 10000ms (request aborted)');
    assert.equal(describeFetchError(new Error('boom')), 'boom');
  });

  it('fetch fail (GET): cause code tu message + 5 attempt', async () => {
    let calls = 0;
    const c = fast();
    await withFetch(async () => { calls++; netFail('EAI_AGAIN'); }, async () => {
      await assert.rejects(() => c._private('GET', '/future/user/v1/balance/list'), (e) => {
        assert.equal(e.name, 'XTError');
        assert.equal(e.message, '/future/user/v1/balance/list -> fetch failed (EAI_AGAIN)');
        return true;
      });
    });
    assert.equal(calls, 5); // 5 attempt (retry-e network)
  });

  it('fetch fail (POST order): 1 attempt, vali dalil hamrah-e message', async () => {
    let calls = 0;
    const c = fast();
    await withFetch(async () => { calls++; netFail('ECONNRESET'); }, async () => {
      await assert.rejects(
        () => c._private('POST', '/future/trade/v1/order/create', { symbol: 'btc_usdt' }),
        (e) => e.message === '/future/trade/v1/order/create -> fetch failed (ECONNRESET)',
      );
    });
    assert.equal(calls, 1); // order endpoint retry NEMISHE
  });

  it('socket loss during order creation is unknown and never retried', async () => {
    let calls = 0;
    const client = fast();
    await withFetch(async () => { calls++; netFail('UND_ERR_SOCKET'); }, async () => {
      await assert.rejects(
        () => client.createOrder({ symbol: 'btc_usdt', positionSide: 'LONG', orderSide: 'BUY', orderType: 'MARKET', origQty: 1 }),
        (error) => {
          assert.equal(error.orderOutcomeUnknown, true);
          assert.equal(error.cause.cause.code, 'UND_ERR_SOCKET');
          assert.match(error.message, /UND_ERR_SOCKET/);
          return true;
        },
      );
    });
    assert.equal(calls, 1);
  });

  it('getBalances: error-e endpoint-e avval ro mide (na list-e khali)', async () => {
    const c = fast();
    await withFetch(async () => { netFail('ENOTFOUND'); }, async () => {
      await assert.rejects(() => c.getBalances(), (e) => {
        assert.ok(e.message.includes('/v1/balance/list -> fetch failed (ENOTFOUND)'));
        return true;
      });
    });
  });

  it('getCurrentPriceDetailed: dalil-e 0-e gheymat ro report mikone', async () => {
    const c = fast();
    await withFetch(async () => { netFail('EAI_AGAIN'); }, async () => {
      const r = await getCurrentPriceDetailed(c, 'syn_usdt');
      assert.equal(r.price, 0);
      assert.ok(r.error.includes('agg-ticker: /future/market/v1/public/q/agg-ticker -> fetch failed (EAI_AGAIN)'));
      assert.ok(r.error.includes('mark-price:'));
    });
  });

  it('getCurrentPriceDetailed: gheymat-e movafagh -> error=null', async () => {
    const c = fast();
    await withFetch(async () => okJson({ c: '0.1794' }), async () => {
      assert.deepEqual(await getCurrentPriceDetailed(c, 'syn_usdt'), { price: 0.1794, error: null });
    });
  });
});
const setEnv = (kv) => {
  const orig = {};
  for (const [k, v] of Object.entries(kv)) { orig[k] = process.env[k]; process.env[k] = v; }
  return () => {
    for (const [k, v] of Object.entries(kv)) { if (orig[k] === undefined) delete process.env[k]; else process.env[k] = orig[k]; }
  };
};

describe('/status error reporting', () => {
  it('network down -> "Price: error (...)" na "Price: 0"', async () => {
    const restore = setEnv({ XT_API_KEY: 'AK', XT_API_SECRET: 'SK', XT_RETRY_BASE_MS: '0', XT_MIN_REQUEST_MS: '0' });
    try {
      await withFetch(async () => { netFail('EAI_AGAIN'); }, async () => {
        // AGENT-ONLY: symbol az store (na .env XT_DEFAULT_SYMBOL)
        const { LongTermMemory } = await import('../src/store/memory.js');
        const fs = await import('node:fs');
        const os = await import('node:os');
        const path = await import('node:path');
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-')), 'store.json');
        const mem = new LongTermMemory(file, { databaseUrl: null });
        await mem.init();
        mem.seedDefaults();
        mem.setSetting('symbol', 'syn_usdt');
        const r = await handleTelegramCommand('/status', { memory: mem });
        assert.equal(r.handled, true);
        assert.ok(r.reply.includes('=== STATUS [syn_usdt] ==='), r.reply);
        assert.ok(r.reply.includes('Price: error ('), r.reply);
        assert.ok(!r.reply.includes('Price: 0\n'), r.reply);
        assert.ok(r.reply.includes('fetch failed (EAI_AGAIN)'), r.reply);
        assert.ok(r.reply.includes('Balance: error ('), r.reply);
        assert.ok(r.reply.includes('Positions: error ('), r.reply);
        await mem.close();
      });
    } finally { restore(); }
  });

  it('movafagh -> price/balance/positions dorost', async () => {
    const restore = setEnv({ XT_API_KEY: 'AK', XT_API_SECRET: 'SK', XT_RETRY_BASE_MS: '0', XT_MIN_REQUEST_MS: '0' });
    const mock = async (url) => {
      const u = String(url);
      if (u.includes('/v1/balance/list')) return okJson([{ coin: 'usdt', walletBalance: '6.39', availableBalance: '6.39' }]);
      if (u.includes('/v1/position')) return okJson([]);
      if (u.includes('agg-ticker')) return okJson({ c: '0.1794' });
      return okJson({});
    };
    try {
      await withFetch(mock, async () => {
        const r = await handleTelegramCommand('/status btc_usdt', {});
        assert.ok(r.reply.includes('Price: 0.1794'), r.reply);
        assert.ok(r.reply.includes('Balance: 6.39 USDT | Available: 6.39 USDT'), r.reply);
        assert.ok(r.reply.includes('hich position-e baz nist'), r.reply);
      });
    } finally { restore(); }
  });

  it('/diag: network fail -> dalil (EAI_AGAIN) tu khoroji', async () => {
    const restore = setEnv({ XT_API_KEY: 'AK', XT_API_SECRET: 'SK', XT_RETRY_BASE_MS: '0', XT_MIN_REQUEST_MS: '0' });
    try {
      await withFetch(async () => { netFail('EAI_AGAIN'); }, async () => {
        const r = await handleTelegramCommand('/diag', {});
        assert.ok(r.reply.includes('XT connect: FAIL'), r.reply);
        assert.ok(r.reply.includes('fetch failed (EAI_AGAIN)'), r.reply);
      });
    } finally { restore(); }
  });
});

describe('XTBase backoff knobs', () => {
  it('retryBaseMs / minRequestInterval default ha hefz mishan', () => {
    const b = new XTBase({ host: 'https://x.local' });
    assert.equal(b.retryBaseMs, 500);
    assert.equal(b.minRequestInterval, 100);
    const z = new XTBase({ host: 'https://x.local', retryBaseMs: 0, minRequestIntervalMs: 0 });
    assert.equal(z.retryBaseMs, 0);
    assert.equal(z.minRequestInterval, 0);
    assert.equal(new XTBase({ host: 'https://x.local', retryBaseMs: 'bad' }).retryBaseMs, 500);
  });
});
