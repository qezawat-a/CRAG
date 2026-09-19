// Test registry + 25 tool (bedune network — faghat sakhtar)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { xtFuturesTools } from '../src/xt/futures-tools.js';
import { buildTools } from '../src/agent/tools.js';
describe('xt tools', () => {
  it('25 tool-e xt_* hast', () => {
    const t = xtFuturesTools({});
    assert.equal(t.length, 25);
    assert.ok(t.every((x) => x.name.startsWith('xt_')));
    assert.ok(t.every((x) => x.description && x.parameters && x.run));
  });
  it('buildTools: basic + xt + mcp', () => {
    const xt = xtFuturesTools({});
    const all = buildTools({ xtTools: xt, mcpTools: [], timeoutMs: 5000 });
    assert.equal(all.length, 2 + 25); // 2 basic + 25 xt
    assert.ok(all.find((t) => t.name === 'xt_scan'));
    assert.ok(all.find((t) => t.name === 'xt_open'));
    assert.ok(all.find((t) => t.name === 'get_current_time'));
  });
  it('xt_dry_run tool process.env ro avaz mikone', async () => {
    const t = xtFuturesTools({});
    const dry = t.find((x) => x.name === 'xt_dry_run');
    await dry.run({ enabled: '1' });
    assert.equal(process.env.XT_DRY_RUN, '1');
    await dry.run({ enabled: '0' });
    assert.equal(process.env.XT_DRY_RUN, '0');
    process.env.XT_DRY_RUN = '1'; // bargardun be amn
  });
  it('xt_open dar DRY_RUN ejra NEMISHE', async () => {
    process.env.XT_DRY_RUN = '1';
    const t = xtFuturesTools({});
    const open = t.find((x) => x.name === 'xt_open');
    const out = JSON.parse(await open.run({ symbol: 'btc_usdt', positionSide: 'LONG', orderSide: 'BUY', orderType: 'MARKET', origQty: 1 }));
    assert.equal(out.dryRun, true);
  });
});
