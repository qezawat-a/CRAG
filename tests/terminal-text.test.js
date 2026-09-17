import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { terminalText } from '../src/ui/terminal-text.js';
import { buildSystemPrompt } from '../src/prompt.js';

const rtl = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

describe('terminal Latin output', () => {
  it('transliterates Persian reports and digits without changing setting keys', () => {
    const text = terminalText('سلام، موجودی ۱۲۳٫۵ USDT؛ leverage=10\nمعامله باز نیست.');
    assert.match(text, /^slam,/);
    assert.match(text, /123\.5 USDT; leverage=10\n/);
    assert.doesNotMatch(text, rtl);
  });

  it('handles presentation forms, bidi controls, and unknown letters', () => {
    const text = terminalText('\u202eﺳﻼﻡ\u202c می\u200cشود ١٢٣ ڿ');
    assert.doesNotMatch(text, rtl);
    assert.match(text, /123/);
    assert.match(text, /\\u06bf/);
  });

  it('preserves Latin code and numbers', () => {
    const text = 'if (balance === 0) return; btc_usdt -1.25%\n/settings';
    assert.equal(terminalText(text), text);
    assert.equal(terminalText(null), '');
  });

  it('instructs the agent to use Finglish for reports', () => {
    const prompt = buildSystemPrompt({ tools: [] });
    assert.match(prompt, /Write Persian responses in Finglish/);
    assert.match(prompt, /Preserve code, numbers, symbols and setting keys exactly/);
  });
});
