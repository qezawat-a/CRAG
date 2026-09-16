// basic-tools.js — do ta tool-e nemune baraye test-e tool-calling
// ----------------------------------------------------------------
// Formate har tool (in formate asli-ye ma hast — ba'dan XT ham
// be hamin shekl neveshte mishe):
//   { name, description, parameters (JSON Schema), run(args) }
// - description: be LLM mige in tool chi kar mikone (kheyli mohem)
// - parameters:  JSON Schema — LLM az in mafhum mishe chi args bede
// - run(args):   code-ye asli — vaghti LLM in tool ro seda zad ejra mishe

export const basicTools = [
  {
    name: 'get_current_time',
    description: 'Saat va tarikh-e hala (UTC). Baraye soal-haye zamani.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async run() {
      return new Date().toISOString();
    },
  },

  {
    name: 'calculate',
    description: 'Mohasebe-ye riyazi-ye sade: add | sub | mul | div beyn-e 2 adad.',
    parameters: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'adad-e aval' },
        b: { type: 'number', description: 'adad-e dovom' },
        op: { type: 'string', enum: ['add', 'sub', 'mul', 'div'], description: 'amalgar' },
      },
      required: ['a', 'b', 'op'],
      additionalProperties: false,
    },
    async run({ a, b, op }) {
      if (op === 'add') return String(a + b);
      if (op === 'sub') return String(a - b);
      if (op === 'mul') return String(a * b);
      if (op === 'div') {
        if (b === 0) return 'Error: taghsim bar sefr';
        return String(a / b);
      }
      return `Error: op-e nadarim: ${op}`;
    },
  },
];
