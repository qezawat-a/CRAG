// tools.js — registry-e markazi-ye tool-ha (item 14) + timeout-e ejra
// --------------------------------------------------------------------
// Hameye tool-ha (basic + XT futures + MCP + ...) az inja mire be agent.
// Ye khat-e defa'i ham darad: **toolTimeoutMs** (settings.tools) — har
// tooli ke bishtar az in moddat tool ro seda bezane, bi-taghsir cut
// mishe va be LLM ye error-e raushan bargardunde mishe. Hich tool-i
// nemitune agent ro be soorat-e bi-payan negah darad.
//
//   buildTools({ mcpTools, xtTools, memory, timeoutMs }) => array-e tool-haye amade:
//     basicTools + memory (remember/recall) + XT futures (25 tool) + MCP tool-ha,
//     hame ba timeout-e wrap shode.
//     (agar tool khodesh `timeoutMs` dashte bashe, hamoon mo'tabar-e —
//      vagar-na `timeoutMs`-e registry.)

import { basicTools } from './basic-tools.js';
import { memoryTools } from './memory.js';

export const DEFAULT_TIMEOUT_MS = 20000; // hamahang ba settings.tools.toolTimeoutMs

// ye fn ro ba timeout wrap mikone: agar bishtar az `ms` tool keshid,
// error mide (Promise.race — hich timer-e bi-payan dar hale ejra nemimoone).
function withTimeout(fn, ms, name) {
  return async (...args) => {
    const timer = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`tool "${name}" bishtar az ${ms}ms tool keshid — cut shod (toolTimeoutMs)`)), ms);
    });
    return Promise.race([fn(...args), timer]);
  };
}

// registry: basic + memory + XT futures + MCP ro yeja jam mikone va be har tool timeout-e
// markazi ro mizane. Natije har bar ye array-e jadid-e pak hast.
export function buildTools({ mcpTools = [], xtTools = [], memory = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const mem = memory ? memoryTools(memory) : [];
  const all = [...basicTools, ...mem, ...(xtTools || []), ...(mcpTools || [])];
  return all.map((t) => ({
    ...t,
    run: withTimeout(t.run, t.timeoutMs || timeoutMs, t.name),
  }));
}
