// harness.js — harness-e JSONL (item 8=11)
// ----------------------------------------------------------------
// Ye "harness" ke agent ro az biroun control mikone: har khat-e stdin
// ye JSON (ya matn-e sade) hast, javab ham ye khat-e JSON roye stdout:
//
//   {"id":1,"message":"salam"}   ->  {"id":1,"ok":true,"reply":"...","rounds":1,"provider":"openai"}
//   {"message":"2+2?"}           ->  {"ok":true,"reply":"4",...}
//
// Baraye eval/test/ertebat-e abzar-haye digar be agent (hich UI-e
// terminal niaz nist). Log-ha be stderr mire ta stdout pak bemoone.
//
// Ejra-ye mostaqel (agent-e kamel, dar ~/xt-agent):
//   node src/harness.js        (ya: npm run harness)
//
// NOTE: harness stdin ro eshghal mikone — pas hamzaman ba TUI-e
// interaktive nemishe az tu ye process ejra kard (TUI ham stdin mikhād).

import readline from 'node:readline';

// ------------------------------------------------------------
// startHarness({ say, input, output, log }): loop-e JSONL
// ------------------------------------------------------------
export function startHarness({ say, input = process.stdin, output = process.stdout, log = console.log }) {
  const rl = readline.createInterface({ input });
  const send = (obj) => output.write(JSON.stringify(obj) + '\n');

  rl.on('line', async (line) => {
    const t = line.trim();
    if (!t) return;

    let message = t;
    let id = null;
    try {
      const o = JSON.parse(t);
      if (o && typeof o === 'object') {
        message = String(o.message ?? o.text ?? '');
        id = o.id ?? null;
      }
    } catch { /* matn-e sade — khodesh message-e */ }

    if (!message) { send({ id, ok: false, error: 'message khali-e' }); return; }

    try {
      const out = await say(message);
      const reply = out && out.reply !== undefined ? out.reply : String(out);
      send({ id, ok: true, reply, rounds: out && out.rounds, provider: out && out.provider });
    } catch (e) {
      send({ id, ok: false, error: e.message });
    }
  });

  log('[harness] roshan — har khat ye JSON: {"message":"..."}');

  return {
    stop() { try { rl.close(); } catch { /* hichi */ } },
  };
}

// ------------------------------------------------------------
// Ejra-ye mostaqim: node src/harness.js  ->  agent-e kamel + harness
// ------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const log = (...a) => console.error(...a); // stdout faghat JSONL
  const [{ createAgent }, { buildTools }, { Memory }, { getSettings }, { loadMcpTools }, { xtFuturesTools }] = await Promise.all([
    import('./agent/loop.js'),
    import('./agent/tools.js'),
    import('./agent/memory.js'),
    import('./settings.js'),
    import('./agent/mcp.js'),
    import('./xt/futures-tools.js'),
  ]);

  const s = getSettings();
  const memory = await new Memory().load();

  let mcpTools = [];
  if (s.mcp.enabled && s.mcp.servers) {
    try { mcpTools = await loadMcpTools(s.mcp.servers, s.tools.toolTimeoutMs); }
    catch (e) { log(`[harness] mcp error: ${e.message}`); }
  }

  let xtTools = [];
  if (!s.xt || s.xt.enabled !== false) {
    try { xtTools = xtFuturesTools({}); } catch (e) { log(`[harness] xt error: ${e.message}`); }
  }

  const agent = createAgent({
    system: `To ${s.identity.agentName} hasti — ye agent-e khodkar (harness mode).`,
    tools: s.tools.enabled ? buildTools({ xtTools, mcpTools, memory, timeoutMs: s.tools.toolTimeoutMs }) : [],
    memory,
    autoCompact: s.session.autoCompact,
    compactAfterRounds: s.session.compactAfterRounds,
    thinkingLevel: s.thinking.level,
  });

  startHarness({ say: (text) => agent.say(text), log });
}
