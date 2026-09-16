// Test memory tools (remember/recall + save/load)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Memory, memoryTools } from '../src/agent/memory.js';
import { buildTools } from '../src/agent/tools.js';
describe('memory', () => {
  it('remember -> save -> load (persistence)', async () => {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jrock-')), 'memory.json');
    const m = await new Memory(tmp).load();
    const [rem, rec] = memoryTools(m);
    assert.equal(rem.name, 'remember');
    assert.equal(rec.name, 'recall');
    await rem.run({ key: 'risk_lesson', value: 'RSI overbought = no LONG' });
    // file rooye disk hast?
    const raw = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    assert.equal(raw.risk_lesson, 'RSI overbought = no LONG');
    // load-e jadid yadesh-e?
    const m2 = await new Memory(tmp).load();
    assert.equal(m2.get('risk_lesson'), 'RSI overbought = no LONG');
    const out = await rec.run({});
    assert.ok(out.includes('risk_lesson'));
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  });
  it('buildTools ba memory: basic(2) + mem(2) + xt(25)', async () => {
    const { xtFuturesTools } = await import('../src/xt/futures-tools.js');
    const m = await new Memory(path.join(os.tmpdir(), 'jrock-nofile.json')).load();
    const all = buildTools({ xtTools: xtFuturesTools({}), memory: m });
    assert.equal(all.length, 2 + 2 + 25);
    assert.ok(all.find((t) => t.name === 'remember'));
    assert.ok(all.find((t) => t.name === 'recall'));
  });
});
