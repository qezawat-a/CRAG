import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chat } from '../src/agent/brain.js';

describe('AI error diagnostics', () => {
  it('does not claim an invalid key when the real failure is a network fetch error', async () => {
    const oldKey = process.env.AI_API_KEY;
    const oldModel = process.env.AI_MODEL;
    const oldBase = process.env.AI_BASE_URL;
    const oldFetch = globalThis.fetch;
    process.env.AI_API_KEY = 'test-key';
    process.env.AI_MODEL = 'test-model';
    process.env.AI_BASE_URL = 'https://provider.test/v1';
    globalThis.fetch = async () => {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'ENOTFOUND' };
      throw error;
    };
    try {
      await assert.rejects(
        () => chat({ messages: [{ role: 'user', content: 'ping' }] }),
        (error) => {
          assert.match(error.message, /AI request failed after trying all configured providers\/models/);
          assert.match(error.message, /openai\/test-model/);
          assert.match(error.message, /ENOTFOUND/);
          assert.match(error.message, /Etesal-e shabake/);
          assert.doesNotMatch(error.message, /[\u0600-\u06ff]/u);
          assert.doesNotMatch(error.message, /hich model-i ba in key kar nakard/);
          return true;
        },
      );
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = oldKey;
      if (oldModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = oldModel;
      if (oldBase === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = oldBase;
    }
  });
});
