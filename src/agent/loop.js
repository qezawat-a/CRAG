// loop.js — halghe-ye asli-ye agent ("hosh")
// ----------------------------------------------------------------
// Inja asl-e kar-e "agent boodan" roje: yek halghe ke
//   1. beyn-e ro be LLM mide (ba tool-ha)
//   2. age LLM bege "man in tool ro seda mizanam" -> tool ejra mishe
//   3. natije be LLM bargardunde mishe
//   4. ta zamani ke LLM tool nakhād, ya be had-e maxRounds beresim
// Natije: agent mitune khodesh tasmim begire chi seda bezane —
// hamin ast ke an ra az yek "robot-e bi-hosh" joda mikone.
//
// Item 1/16/17: createAgent hala ye history-e avvali ghabul mikone
// (baraye resume), method-e replaceHistory dare, va agar autoCompact
// roshan bashe, goftogu-haye tool shode ro khodkar khulas karde va
// message-haye ghadimi ro hazf mikone (masraf-e token kam mishe).

import { chat } from './brain.js';

// ----------------------------------------------------------------
// compactHistory(): ye copy-e jadid bar migardune — faghat
// keepTurns-ta "turn-e user" akhar mimune va ghablish hazf mishe.
// (role-haye tool/tool_call tuye samte hazf-shode-ye tarikh hastan,
//  pas residan-e natijeh-haye tool-e bi-saheb nemisazim.)
// ----------------------------------------------------------------
export function compactHistory(history, keepTurns, note) {
  const userIdx = [];
  history.forEach((m, i) => { if (m.role === 'user') userIdx.push(i); });
  if (userIdx.length <= keepTurns) return history;

  const cutoff = userIdx[userIdx.length - keepTurns];
  const kept = history.slice(cutoff);
  kept.unshift({
    role: 'user',
    content: note || '[auto-compact] Goftogu-haye ghabl hazf shod.',
  });
  return kept;
}

export function createAgent({
  system = '',          // dastur-e asli (mesl system prompt-e ma)
  tools = [],           // array-e tool: { name, description, parameters, run }
  memory = null,        // ye instance az Memory (ekhtiari)
  maxRounds = 8,        // had-e tool-call dar har payam (amniati)
  history = [],         // tarikh-e avvali (baraye resume-e session)
  autoCompact = false,  // item 16: auto-compact roshan/khāmush
  compactAfterRounds = 40, // ba'd az chand turn-e user compact beshe
  thinkingLevel = 'mid', // item 10: reasoning-e provider (brain.js + thinking.js)
} = {}) {
  const hist = [...history]; // tarikh-e mokatebe (format-e OpenAI-style)

  // system prompt ro hamrah-e yaddashthaye memory misazim
  function buildSystem() {
    let s = system;
    if (memory) {
      const notes = memory.all();
      const keys = Object.keys(notes);
      if (keys.length) {
        s += '\n\n[Yaddashthaye man az jalasat-e ghabl]\n' +
             keys.map(k => `- ${k}: ${notes[k]}`).join('\n');
      }
    }
    return s;
  }

  // az LLM mikhaym goftogu-haye ghadimi ro khulas konad (agar momken)
  async function summarizePrefix(prefix) {
    try {
      const res = await chat({
        system: 'To yek khulasgar-e mohemm-hasti. Goftogu-ye zir ro dar 2-3 khat khulas kon (be zabane user). Faghat khulase, bi moqaddame.',
        messages: prefix,
        tools: [],
      });
      return (res.content || '').trim().slice(0, 800);
    } catch {
      return ''; // LLM nist/ghalat -> bedun-e khulas ham mishe hazf kard
    }
  }

  // auto-compact-e vaghei: message-haye ghadimi hazf va (agar shod) khulas mishan
  async function maybeCompact() {
    const userIdx = [];
    hist.forEach((m, i) => { if (m.role === 'user') userIdx.push(i); });
    if (userIdx.length <= compactAfterRounds) return;

    const cutoff = userIdx[userIdx.length - compactAfterRounds];
    const prefix = hist.slice(0, cutoff);
    const summary = await summarizePrefix(prefix);
    const note = summary
      ? `[auto-compact] Khulas-e goftogu-haye ghabl: ${summary}`
      : '[auto-compact] Goftogu-haye ghabl hazf shod (tool shode bud).';
    hist.splice(0, cutoff, { role: 'user', content: note });
    console.log(`[auto-compact] ${cutoff} message-e ghadimi hazf shod.`);
  }

  async function say(userText) {
    hist.push({ role: 'user', content: userText });

    let rounds = 0;
    while (rounds < maxRounds) {
      // thinkingLevel (item 10): be brain mire ta reasoning-e provider set she
      const res = await chat({ system: buildSystem(), messages: hist, tools, thinkingLevel });

      // 1) LLM tool nakhast -> javab-e nahayi -> tamoom
      if (!res.toolCalls.length) {
        hist.push({ role: 'assistant', content: res.content ?? '' });
        if (autoCompact) await maybeCompact(); // item 16
        return { reply: res.content ?? '', rounds: rounds + 1, provider: res.provider };
      }

      // 2) LLM tool khast -> in "assistant message" ro zakhirat kon
      //    (tool-call-hash ham, ke provider-haye badi bebinand)
      hist.push({
        role: 'assistant',
        content: res.content ?? null,
        tool_calls: res.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
        })),
      });

      // 3) tool-ha ro ejra kon (hamzaman — Promise.all)
      const results = await Promise.all(
        res.toolCalls.map(async (tc) => {
          const tool = tools.find(t => t.name === tc.name);
          if (!tool) return { tc, out: `Error: tool "${tc.name}" peyda nashod` };
          try {
            const out = await tool.run(tc.args ?? {});
            return { tc, out: typeof out === 'string' ? out : JSON.stringify(out) };
          } catch (e) {
            return { tc, out: `Error dar tool "${tc.name}": ${e.message}` };
          }
        })
      );

      // 4) natijeh-haye tool ro be tarikh ezafe kon (role:'tool')
      for (const { tc, out } of results) {
        hist.push({ role: 'tool', tool_call_id: tc.id, content: out });
      }
      rounds++;
    }

    throw new Error(`Agent be had-e ${maxRounds} tool-round resid — halaqe motevaghef shod (mohem: tool-i loop-e bi-payan dorost karde?).`);
  }

  return {
    say,                          // harf-e user => javab-e nahayi
    history: () => hist,          // tarikh-e kamel (baraye UI/debug)
    replaceHistory(arr) {         // baraye resume/new session (item 1/17)
      hist.splice(0, hist.length, ...arr);
    },
    remember(key, value) {        // yaddasht-e deraz-moddat
      if (!memory) throw new Error('Memory sakhte nashode — createAgent({ memory }) ro begozar.');
      memory.set(key, value);
    },
    _buildSystem: buildSystem,    // (baraye debug)
  };
}
