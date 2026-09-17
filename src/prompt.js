// prompt.js — sazande-ye "system prompt"-e kamel-e J-Rock
// ------------------------------------------------------------
// Inja hame chiz-e shakhsiyat/ghodrat-e agent yekja assemble mishe:
//   1. SOUL  (hoviyat — az identity.soulFile, mesl soul/SOUL.md)
//   2. STYLE (sabk-e goftogu — az style.file, mesl soul/STYLE.md)
//   3. Capabilities (chi mitune bokone — az settings-ha)
//   4. Skills-e dastres (name + description — item 2)
//   5. Thinking level (item 10)
//   6. Tools-e dastres (item 14)
// User mitune SOUL.md / STYLE.md ro edite kone va prompt-e agent
// hamoonja avaz mishe (biron az code). Khodesh code-vasete nist.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getSettings } from './settings.js';

function readText(abs, fallback) {
  try {
    const t = readFileSync(abs, 'utf8').trim();
    return t || fallback;
  } catch {
    return fallback;
  }
}

export const FALLBACK_SOUL = `You are J-Rock, an autonomous personal AI agent running in a terminal.
Be helpful, honest and direct. Never fabricate facts, URLs or tool results.
Reply in the user's language. Use your tools when they help.`;

export const FALLBACK_STYLE = `Reply in the language of the user. Be concise. Use markdown; bullets for
lists, tables for comparisons, code fences for code. No emojis unless asked.`;

// rahnamaye har thinking level — be LLM mige cheghadr fekr kone:
export const THINKING_GUIDE = {
  low:   'Keep answers short and direct; minimal internal deliberation.',
  mid:   'Balanced reasoning: think before multi-step actions, but stay efficient.',
  high:  'Reason more carefully: consider alternatives and edge cases in complex tasks.',
  xhigh: 'Deep reasoning: deliberate thoroughly before every non-trivial step.',
  max:   'Maximum deliberation: exhaustively reason, plan and self-check before acting.',
};

export function buildSystemPrompt({
  agentName = 'J-Rock',
  skills = [],          // array-e { id, name, description } (az skills.js)
  tools = [],           // array-e tool-ha (name/description baraye list)
  thinkingLevel = 'mid',
  extra = '',           // matn-e ezafi (mesl note-e dar run)
} = {}) {
  const s = getSettings();

  const soulPath = path.resolve(s.identity.soulFile || 'soul/SOUL.md');
  const soul = readText(soulPath, FALLBACK_SOUL);

  const styleFile = s.style && s.style.enabled ? s.style.file : null;
  const style = styleFile ? readText(path.resolve(styleFile), FALLBACK_STYLE) : '';

  const parts = [];
  parts.push(`# ${agentName} — System Prompt (assembled by prompt.js)`);
  parts.push(`Generated: ${new Date().toISOString()}`);

  // 1) SOUL — hoviyat
  parts.push(`\n## SOUL — Identity & Rules\n${soul}`);

  // 2) STYLE — sabk
  if (style) parts.push(`\n## STYLE — Defaults\n${style}`);

  // 3) Capabilities — chi in build mitune bokone (az settings)
  const cap = [
    `- Name: ${agentName}`,
    `- Sessions: resume/switch/new + auto-compact (${s.session.autoCompact ? 'on' : 'off'})`,
    `- Long-term memory: notes from past runs are appended by the loop`,
    `- Skills: ${skills.length ? skills.map(k => k.name).join(', ') : 'none loaded'}`,
    `- Thinking level: ${thinkingLevel}`,
    `- Model mode: auto-pick with probe/fallback (unless set in .env)`,
    `- Gateway/Serve/Harness/Dream/Agents: ${[['gateway', s.gateway.enabled], ['serve', s.serve.enabled], ['harness', s.harness.enabled], ['dream', s.dream.enabled], ['agents', s.agents.enabled]].filter(x => x[1]).map(x => x[0]).join(', ') || 'disabled (flags only)'}`,
  ];
  parts.push(`\n## Capabilities (this build)\n${cap.join('\n')}`);

  // 4) Skills — playbook-haye dastres
  if (s.skills.enabled && skills.length) {
    const lines = skills.map((k, i) => `${i + 1}. **${k.name}** — ${k.description || '(no description)'}`);
    parts.push(`\n## Available Skills (follow when they match)\n${lines.join('\n')}`);
  } else {
    parts.push(`\n## Available Skills\n(none)`);
  }

  // 5) Tools
  if (s.tools.enabled && tools.length) {
    const tLines = tools.map(t => `- ${t.name}: ${(t.description || '').slice(0, 120)}`);
    parts.push(`\n## Tools You Can Call\n${tLines.join('\n')}`);
  }

  // 6) Thinking
  parts.push(`\n## Thinking Level: ${thinkingLevel}\n${THINKING_GUIDE[thinkingLevel] || THINKING_GUIDE.mid}`);

  if (extra) parts.push(`\n## Extra Context\n${extra}`);

  parts.push('\n## Output language\nTerminal output must be left-to-right. Write Persian responses in Finglish (Persian using Latin letters), never Persian/Arabic script. Apply this to reports, summaries and explanations, even when the user or previous history uses Persian script. Preserve code, numbers, symbols and setting keys exactly.');

  return parts.join('\n\n');
}
