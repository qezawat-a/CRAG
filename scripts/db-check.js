// scripts/db-check.js — DATABASE_URL (persistence) ro test mikone
// ------------------------------------------------------------
// Ejra: npm run db:check      (ya: node scripts/db-check.js)
// Chi check mishe:
//   1) DATABASE_URL set-e? (URL mask mishe — password log nemishe)
//   2) backend: file ya postgres/mysql
//   3) vasl mishe? table sakhte mishe? (init)
//   4) chand row tu table hast + akharin update
//   5) state-e store: settings / trades / signals / cooldowns
// Exit code: 0 = OK, 1 = error (ta tu log-e Railway/Monitoring dide beshe)
import 'dotenv/config';
import { Config } from '../src/config.js';
import { backendKind } from '../src/store/persist.js';
import { LongTermMemory } from '../src/store/memory.js';

const mask = (u) => String(u).replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@');
const kind = backendKind(Config.DATABASE_URL);
console.log(`[db:check] DATABASE_URL: ${Config.DATABASE_URL ? mask(Config.DATABASE_URL) : '(set NIST)'}`);
console.log(`[db:check] backend: ${kind}`);

if (kind === 'file') {
  console.log('[db:check] HOSHDAR: DATABASE_URL nadari — state faghat tu file-e mahali mimune.');
  console.log('[db:check]   ru deploy-e ephemeral (Railway/Heroku) ba har deploy PAK mishe.');
  console.log('[db:check]   Neon: postgresql://user:pass@ep-xxx-pooler.neon.tech/neondb?sslmode=require');
  console.log('[db:check]   in ro tu .env (mahali) ya Railway -> Variables bezar.');
}

let memory = null;
try {
  memory = new LongTermMemory();
  await memory.init();
  console.log(`[db:check] store OK: ${memory.persistence}`);
  const d = memory.data;
  console.log(`[db:check] state: settings=${Object.keys(d.settings).length} trades=${d.trades.length} signals=${d.signals.length} cooldowns=${Object.keys(d.cooldowns).length} chat=${d.chat.length}`);
  const info = await memory.backend.info();
  console.log(`[db:check] backend info: ${JSON.stringify(info).slice(0, 300)}`);
  if (kind !== 'file') {
    const mine = (info.rows || []).find((r) => r.id === memory.backend.id);
    console.log(mine ? `[db:check] row-e STORE_ID=${memory.backend.id} peyda shod (bytes=${mine.bytes})` : `[db:check] row-e STORE_ID=${memory.backend.id} hanuz nist — ba avalin write sakhte mishe.`);
  }
  console.log('[db:check] NATIJE: OK');
  await memory.close();
  process.exit(0);
} catch (e) {
  console.error(`[db:check] KHATA: ${e.message}`);
  try { if (memory) await memory.close(); } catch { /* hichi */ }
  process.exit(1);
}