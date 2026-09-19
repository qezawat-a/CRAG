// persist.js — backend-e store: JSON file (default) ya Postgres/MySQL (DATABASE_URL)
// ------------------------------------------------------------
// Python (Crypto2) ba SQLAlchemy + DATABASE_URL kar mikard:
//   sqlite:///data/memory.db  |  postgresql://...neon.tech/neondb  |  mysql://
// Va README-e Python hoshdar midad: "SQLite tu container ba har deploy pak mishe".
// Inja hamun fekr: agar DATABASE_URL set bashe, state mire rooye DB-e DAEMI
// (Neon / Railway Postgres/MySQL) — vagar-na hamin file-e JSON-e mahali mimune.
//
// State ye snapshot-e kamel-e JSON (settings/trades/signals/cooldowns/...):
// hame be-soorate YEK row upsert mishe (id = STORE_ID) — pas schema-e sade va
// neveshtan-e snapshot-i race nadare. API-e LongTermMemory sync mimune (khandan az
// RAM) va neveshtan async + queued-e.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_STORE_ID = 'default';
const TABLE = 'trader_store';

// 'file' | 'postgres' | 'mysql'
export function backendKind(url) {
  const u = String(url || '').trim().toLowerCase();
  if (/^postgres(ql)?:\/\//.test(u)) return 'postgres';
  if (/^mysql:\/\//.test(u)) return 'mysql';
  return 'file';
}
export function isDbUrl(url) { return backendKind(url) !== 'file'; }

// Neon/Supabase/Railway TLS-e self-signed daran (ya sslmode=require dar URL-e Neon).
function sslFor(url) {
  const u = String(url || '');
  if (/sslmode=(require|verify-ca|verify-full)/i.test(u)) return { rejectUnauthorized: false };
  if (/neon\.tech|supabase\.co|render\.com|railway|\.aws\./i.test(u)) return { rejectUnauthorized: false };
  return undefined;
}

// ------------------------------------------------------------
// 1) FileBackend — hamin raftar-e ghabl (data/trader-store.json)
// ------------------------------------------------------------
export class FileBackend {
  constructor(file) {
    this.kind = 'file';
    this.file = file;
  }
  async init() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); }
  loadSync() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return null; } }
  async load() { return this.loadSync(); }
  async save(data) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.file); // atomic
  }
  async info() {
    const st = fs.statSync(this.file, { throwIfNoEntry: false });
    return { backend: 'file', file: this.file, exists: Boolean(st), bytes: st ? st.size : 0, updatedAt: st ? new Date(st.mtimeMs).toISOString() : null };
  }
  async close() {}
}

// ------------------------------------------------------------
// 2) PostgresBackend — Neon / Railway / har Postgres-e dige
//    pool ro mitooni inject koni (baraye test) — vagar-na khodesh az `pg` misaze.
// ------------------------------------------------------------
export class PostgresBackend {
  constructor(url, id = DEFAULT_STORE_ID, { pool = null } = {}) {
    this.kind = 'postgres';
    this.url = url;
    this.id = id;
    this._pool = pool;
  }
  async init() {
    if (!this._pool) {
      let pg;
      try { pg = (await import('pg')).default; }
      catch { throw new Error('pg nasb nist — `npm install pg` kon (ya DATABASE_URL ro bardar)'); }
      this._pool = new pg.Pool({ connectionString: this.url, ssl: sslFor(this.url), max: 2 });
    }
    await this._pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
  }
  async load() {
    const r = await this._pool.query(`SELECT data FROM ${TABLE} WHERE id = $1`, [this.id]);
    const row = r && r.rows && r.rows[0];
    if (!row) return null;
    return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  }
  async save(data) {
    await this._pool.query(
      `INSERT INTO ${TABLE} (id, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [this.id, JSON.stringify(data)],
    );
  }
  async info() {
    const r = await this._pool.query(`SELECT id, updated_at, pg_column_size(data) AS bytes FROM ${TABLE} ORDER BY updated_at DESC`);
    return { backend: 'postgres', id: this.id, rows: (r && r.rows) || [] };
  }
  async close() { if (this._pool && typeof this._pool.end === 'function') { try { await this._pool.end(); } catch { /* hichi */ } } }
}

// ------------------------------------------------------------
// 3) MysqlBackend — Railway MySQL (${{ MySQL.MYSQL_URL }})
//    mysql2 optional-e (lazy import): agar nasb nabashe error-e roshan mide.
// ------------------------------------------------------------
export class MysqlBackend {
  constructor(url, id = DEFAULT_STORE_ID, { pool = null } = {}) {
    this.kind = 'mysql';
    this.url = url;
    this.id = id;
    this._pool = pool;
  }
  async init() {
    if (!this._pool) {
      let mysql;
      try { mysql = await import('mysql2/promise'); }
      catch { throw new Error('mysql2 nasb nist — `npm install mysql2` kon (ya DATABASE_URL-e postgres bede)'); }
      this._pool = mysql.createPool({ uri: this.url, connectionLimit: 2 });
    }
    await this._pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id varchar(64) PRIMARY KEY, data JSON NOT NULL, updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
  }
  async load() {
    const [rows] = await this._pool.query(`SELECT data FROM ${TABLE} WHERE id = ?`, [this.id]);
    const row = rows && rows[0];
    if (!row) return null;
    return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  }
  async save(data) {
    await this._pool.query(`INSERT INTO ${TABLE} (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)`, [this.id, JSON.stringify(data)]);
  }
  async info() {
    const [rows] = await this._pool.query(`SELECT id, updated_at, LENGTH(data) AS bytes FROM ${TABLE} ORDER BY updated_at DESC`);
    return { backend: 'mysql', id: this.id, rows: rows || [] };
  }
  async close() { if (this._pool && typeof this._pool.end === 'function') { try { await this._pool.end(); } catch { /* hichi */ } } }
}

// ------------------------------------------------------------
// 4) factory
// ------------------------------------------------------------
export function createBackend({ url = null, file = null, id = DEFAULT_STORE_ID, pool = null } = {}) {
  const kind = backendKind(url);
  if (kind === 'postgres') return new PostgresBackend(url, id, { pool });
  if (kind === 'mysql') return new MysqlBackend(url, id, { pool });
  return new FileBackend(file);
}