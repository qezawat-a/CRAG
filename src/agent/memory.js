// memory.js — yaddasht-e deraz-moddat-e agent (dar yek file JSON)
// ----------------------------------------------------------------
// Mesl-e MEMORY.md-e khodemon: agent chiz-haye mohem ro inja
// negah midare ta tu session-haye badi ham yadash bashe.
// File: data/memory.json  (mesal: {"risk_lesson": "RSI overbought ..."})
// Har bar agent start mishe, hameye in yaddasht-ha miran tu system
// prompt (loop.js -> buildSystem), pas agent hameshe yadesh-e.
//
// NOTE (fix): ghablan memory.save() hich ja seda zade NEMISHOD —
// yaddasht-ha ba restart miparan! Hala tool-e remember khodesh
// save mikone + flush-e TUI ham save mikone.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export class Memory {
  constructor(filePath = path.resolve('data', 'memory.json')) {
    this.file = filePath;
    this.data = {};
  }

  // az disk mikhoone (agar file nabashad, khali shoroo mikonim)
  async load() {
    try {
      this.data = JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      this.data = {};
    }
    return this;
  }

  async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }

  set(key, value) {
    this.data[key] = value;
  }

  get(key) {
    return this.data[key];
  }

  remove(key) {
    delete this.data[key];
  }

  all() {
    return this.data;
  }
}

// ------------------------------------------------------------
// memoryTools(memory): 2 tool baraye LLM — ta agent khodesh
// betune yad begire / yad biari kone (mesl-e CryptoMind-XT:
// remember/recall). HAME tool auto-save mikonan.
// ------------------------------------------------------------
export function memoryTools(memory) {
  return [
    {
      name: 'remember',
      description: 'Yaddasht-e deraz-moddat zakhire kon (mesal darsha, salighe-ye user, natije-ye trade). Bad az restart ham mimune. Key kutah va roshan bezar.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'esm-e yaddasht (mesal risk_lesson, user_symbol)' },
          value: { type: 'string', description: 'matn-e yaddasht' },
        },
        required: ['key', 'value'],
        additionalProperties: false,
      },
      async run({ key, value }) {
        if (!key || !String(key).trim()) return 'Error: key khali-e';
        memory.set(String(key).trim(), String(value ?? ''));
        await memory.save(); // FIX: fori save — ba restart napare
        return `Zakhire shod: ${String(key).trim()} (data/memory.json)`;
      },
    },
    {
      name: 'recall',
      description: 'Yaddasht-haye deraz-moddat ro bekhun. Bedune key = hame. Ba key = hamoon yeki.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '(ekhtiari) kodum yaddasht' },
        },
        additionalProperties: false,
      },
      async run({ key } = {}) {
        if (key && String(key).trim()) {
          const v = memory.get(String(key).trim());
          return v === undefined ? `(yaddashti ba key "${String(key).trim()}" nist)` : `${String(key).trim()}: ${v}`;
        }
        const all = memory.all();
        const keys = Object.keys(all);
        if (!keys.length) return '(hich yaddashti nist — ba remember besaz)';
        return keys.map((k) => `${k}: ${all[k]}`).join('\n');
      },
    },
  ];
}

