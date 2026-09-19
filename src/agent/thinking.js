// thinking.js — vasl-e settings.thinking.level be API-haye provider-ha (item 10)
// ----------------------------------------------------------------------------
// Har provider ye tarz-e "reasoning" darad. Inja faghat VAGHTI parameter ro
// ezafe mikonim ke 100% midoonim model-e khase ma support-esh mikone —
// vagar-na API 400 mide va hameye kar shekast mikhorad.
//
//   openai (o-series / gpt-5) : reasoning_effort (low..high)
//   anthropic (claude 3.7/4)  : thinking { type:'enabled', budget_tokens }
//   google (gemini)           : native-e thinkingConfig dar OpenAI-compat
//                               route peyda nist => inja rad mishavad.
//                               (agar GEMINI_BASE_URL-e native bekharim,
//                                ye cluster-e joda mikhād.)
//
// Level-ha: low | mid | high | xhigh | max.
// - openai o-series: hameshe reasoning dare — effort ro set mikonim.
// - anthropic: low/mid = bi-extended-thinking (sari'tar va arzoon-tar);
//   high/xhigh/max = extended thinking ba budget-e bishtar.
// - agar model support nakone => null (request-e normal, bi-khatar).

// OpenAI (Chat Completions-e o-series / gpt-5)
export function openaiReasoning(level, model) {
  const m = String(model || '').toLowerCase();
  const isReasoning =
    m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4') || m.startsWith('gpt-5');
  if (!isReasoning) return null;

  const effort = { low: 'low', mid: 'medium', high: 'high', xhigh: 'high', max: 'high' };
  return { reasoning_effort: effort[level] || 'medium' };
}

// Anthropic (extended thinking)
const ANTH_BUDGET = { high: 4096, xhigh: 8192, max: 16384 };

export function anthropicThinking(level, model) {
  const budget = ANTH_BUDGET[level];
  if (!budget) return null; // low/mid = thinking roshan nist (default-e arzoon)

  const m = String(model || '').toLowerCase();
  const capable =
    m.includes('claude') &&
    (m.includes('3-7') || m.includes('sonnet-4') || m.includes('opus-4') || /claude-(sonnet|opus)-4/.test(m));
  if (!capable) return null; // claude-haye ghadimi thinking nadaran

  return { thinking: { type: 'enabled', budget_tokens: budget }, budget };
}
