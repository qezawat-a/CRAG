// Test-e store persistence: file backend + Postgres/MySQL-e vaghei.
// DB-e vaghei faghat vaghti TEST_DATABASE_URL set bashe test mishe (vagar-na
// skip) — pas CI/Railway be DB-e test niyaz nadare.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  backendKind, isDbUrl, createBackend, FileBackend, PostgresBackend, MysqlBackend,
  DEFAULT_STORE_ID,
} from '../src/store/persist.js';
import { LongTermMemory } from '../src/store/memory.js';
import { handleTelegramCommand } from '../src/telegram-commands.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const tmpFile = (name = 'store.json') => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jrock-store-')), name);
// pool-e fake: SQL-haye seda-zade ro zakhire mikone (bedune server)
// row-ha faghat baraye SELECT bargardoonde mishan (mesl-e server-e vaghei)
const fakePool = () => {
  const calls = [];
  const queued = [];
  return {
    calls,
    setRows(rows) { queued.push(rows); },
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (/^\s*select/i.test(String(sql))) return { rows: queued.shift() || [] };
      return { rows: [] };
    },
    async end() { calls.push({ sql: '__END__' }); },
  };
};

describe('store backends', () => {
  it('backendKind: postgres/mysql/file', () => {
    assert.equal(backendKind('postgres://u:p@h/db'), 'postgres');
    assert.equal(backendKind('postgresql://u:p@ep-x.neon.tech/neondb?sslmode=require'), 'postgres');
    assert.equal(backendKind('mysql://u:p@h:3306/db'), 'mysql');
    assert.equal(backendKind(''), 'file');
    assert.equal(backendKind(null), 'file');
    assert.equal(backendKind('data/trader-store.json'), 'file');
    assert.equal(isDbUrl('postgres://x'), true);
    assert.equal(isDbUrl(''), false);
  });

  it('createBackend: bedune URL -> file, ba URL -> postgres/mysql', () => {
    assert.ok(createBackend({ file: '/tmp/x.json' }) instanceof FileBackend);
    assert.equal(createBackend({ file: '/tmp/x.json' }).kind, 'file');
    const pg = createBackend({ url: 'postgres://u@h/db' });
    assert.ok(pg instanceof PostgresBackend);
    assert.equal(pg.id, DEFAULT_STORE_ID);
    assert.equal(createBackend({ url: 'postgres://u@h/db', id: 'bot1' }).id, 'bot1');
    assert.ok(createBackend({ url: 'mysql://u@h/db' }) instanceof MysqlBackend);
  });

  it('postgres: SQL-e dorost (CREATE jsonb + upsert) ba pool-e fake', async () => {
    const pool = fakePool();
    const b = new PostgresBackend('postgres://u@h/db', 'default', { pool });
    await b.init();
    assert.match(pool.calls[0].sql, /CREATE TABLE IF NOT EXISTS trader_store/);
    assert.match(pool.calls[0].sql, /data jsonb NOT NULL/);
    await b.save({ a: 1 });
    const ins = pool.calls.find((c) => /INSERT INTO trader_store/.test(c.sql));
    assert.match(ins.sql, /ON CONFLICT \(id\) DO UPDATE SET data = EXCLUDED\.data/);
    assert.equal(ins.params[0], 'default');
    assert.equal(ins.params[1], JSON.stringify({ a: 1 }));
    await b.close();
    assert.equal(pool.calls[pool.calls.length - 1].sql, '__END__');
  });

  it('postgres load(): data-ro string ya object mide -> object', async () => {
    const p1 = fakePool(); p1.setRows([{ data: '{"symbol":"syn_usdt"}' }]);
    assert.deepEqual(await new PostgresBackend('postgres://u@h/db', 'default', { pool: p1 }).load(), { symbol: 'syn_usdt' });
    const p2 = fakePool(); p2.setRows([{ data: { symbol: 'btc_usdt' } }]);
    assert.deepEqual(await new PostgresBackend('postgres://u@h/db', 'default', { pool: p2 }).load(), { symbol: 'btc_usdt' });
    const p3 = fakePool(); // row-e khali -> null (store-e jadid)
    assert.equal(await new PostgresBackend('postgres://u@h/db', 'default', { pool: p3 }).load(), null);
  });

  it('mysql: SQL-e dorost (JSON + ON DUPLICATE KEY) ba pool-e fake', async () => {
    const calls = [];
    const pool = {
      async query(sql, params) { calls.push({ sql: String(sql), params }); return [[], []]; },
      async end() { calls.push({ sql: '__END__' }); },
    };
    const b = new MysqlBackend('mysql://u@h/db', 'default', { pool });
    await b.init();
    assert.match(calls[0].sql, /CREATE TABLE IF NOT EXISTS trader_store/);
    await b.save({ a: 2 });
    const ins = calls.find((c) => /INSERT INTO trader_store/.test(c.sql));
    assert.match(ins.sql, /ON DUPLICATE KEY UPDATE data = VALUES\(data\)/);
    assert.equal(ins.params[1], JSON.stringify({ a: 2 }));
    pool.query = async () => [[{ data: '{"symbol":"x_usdt"}' }], []];
    assert.deepEqual(await b.load(), { symbol: 'x_usdt' });
  });
});

describe('LongTermMemory zakhire', () => {
  it('file mode: default seed + write + reload (raftar-e ghabl hefz shode)', async () => {
    const file = tmpFile();
    const m = new LongTermMemory(file, { databaseUrl: null }); // explicit: hich DB
    await m.init();
    assert.equal(m.persistence, `file:${file}`);
    m.seedDefaults();
    m.setSetting('symbol', 'syn_usdt');
    await m.close();
    assert.ok(fs.existsSync(file));
    const m2 = new LongTermMemory(file, { databaseUrl: null });
    await m2.init();
    assert.equal(m2.getSetting('symbol'), 'syn_usdt');
    assert.ok(Object.keys(m2.getAllSettings()).length > 5); // seedDefaults ham save shode
    await m2.close();
  });

  it('DB mode: init() snapshot-e ghabli ro load mikone (bedune file)', async () => {
    const pool = fakePool();
    pool.setRows([{ data: { settings: { symbol: 'syn_usdt' }, trades: [], signals: [], chat: [], cooldowns: {}, aiContext: {}, seq: { trades: 0, signals: 0 } } }]);
    const m = new LongTermMemory(null, { backend: new PostgresBackend('postgres://u@h/db', 'bot9', { pool }) });
    assert.equal(m.getSetting('symbol', 'NIST'), 'NIST'); // ghabl az init: khali
    await m.init();
    assert.equal(m.getSetting('symbol'), 'syn_usdt'); // ba'd az init: az DB
    assert.equal(m.persistence, 'postgres:bot9');
    await m.close();
  });

  it('DB mode: seedDefaults + write -> upsert rooye hamun id', async () => {
    const pool = fakePool();
    const m = new LongTermMemory(null, { backend: new PostgresBackend('postgres://u@h/db', 'bot9', { pool }) });
    await m.init();
    m.seedDefaults();
    m.setSetting('leverage', '10');
    await m.flush();
    const ins = pool.calls.filter((c) => /INSERT INTO trader_store/.test(c.sql));
    assert.ok(ins.length >= 1);
    const last = ins[ins.length - 1];
    assert.equal(last.params[0], 'bot9');
    assert.equal(JSON.parse(last.params[1]).settings.leverage, '10');
    await m.close();
  });

  // DB-e vaghei: TEST_DATABASE_URL bede ta ejra beshe (vagar-na skip)
  it('postgres-e vaghei: write -> process-e jadid -> reload', { skip: !TEST_DB }, async () => {
    const id = `test-${Date.now()}`;
    const m = new LongTermMemory(null, { databaseUrl: TEST_DB, storeId: id });
    await m.init();
    m.seedDefaults();
    m.setSetting('symbol', 'syn_usdt');
    m.setSetting('leverage', '10');
    m.recordSignal({ symbol: 'syn_usdt', direction: 'LONG', strategy: 'EMA', timeframe: '1m', confidence: 85, signalStrength: 0.5, price: 0.1794 });
    await m.flush();
    await m.close();

    const m2 = new LongTermMemory(null, { databaseUrl: TEST_DB, storeId: id });
    await m2.init();
    assert.equal(m2.getSetting('symbol'), 'syn_usdt');
    assert.equal(m2.getSetting('leverage'), '10');
    assert.equal(m2.getRecentSignals('syn_usdt', 5).length, 1);
    await m2.close();

    // cleanup
    const pg = (await import('pg')).default;
    const c = new pg.Client({ connectionString: TEST_DB });
    await c.connect();
    await c.query('DELETE FROM trader_store WHERE id = $1', [id]);
    await c.end();
  });
});

describe('/settings + env (.env chera ejra nemishod)', () => {
  it('applyEnvDefaults: env ro rooye store minevise va fargh ha ro migoo', async () => {
    const file = tmpFile();
    const m = new LongTermMemory(file, { databaseUrl: null });
    await m.init();
    m.seedDefaults();
    m.setSetting('leverage', '999'); // store fargh-e .env dare
    const changed = m.applyEnvDefaults();
    assert.ok(changed.find((c) => c.key === 'leverage' && c.from === '999'), JSON.stringify(changed));
    assert.notEqual(m.getSetting('leverage'), '999'); // alan = meghdar-e env
    await m.close();
  });

  it('/settings: meghdar-e MOASER + "ejra NEMISHE" baraye fargh-e .env', async () => {
    const file = tmpFile();
    const m = new LongTermMemory(file, { databaseUrl: null });
    await m.init();
    m.seedDefaults();
    m.setSetting('leverage', '999');
    const r = await handleTelegramCommand('/settings', { memory: m });
    assert.equal(r.handled, true);
    assert.ok(r.reply.includes('leverage=999 [store]'), r.reply);
    assert.ok(r.reply.includes('ejra NEMISHE'), r.reply);
    assert.ok(r.reply.includes('/reseed'), r.reply);
    assert.ok(r.reply.includes(`store=file:${file}`), r.reply);
    await m.close();
  });

  it('/status symbol ro az store migire (na faghat env)', async () => {
    const o1 = process.env.XT_RETRY_BASE_MS; const o2 = process.env.XT_MIN_REQUEST_MS;
    process.env.XT_RETRY_BASE_MS = '0'; process.env.XT_MIN_REQUEST_MS = '0';
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const file = tmpFile();
    const m = new LongTermMemory(file, { databaseUrl: null });
    await m.init(); m.seedDefaults(); m.setSetting('symbol', 'syn_usdt');
    try {
      const r = await handleTelegramCommand('/status', { memory: m });
      assert.ok(r.reply.includes('=== STATUS [syn_usdt] ==='), r.reply);
    } finally {
      globalThis.fetch = origFetch;
      if (o1 === undefined) delete process.env.XT_RETRY_BASE_MS; else process.env.XT_RETRY_BASE_MS = o1;
      if (o2 === undefined) delete process.env.XT_MIN_REQUEST_MS; else process.env.XT_MIN_REQUEST_MS = o2;
      await m.close();
    }
  });
});