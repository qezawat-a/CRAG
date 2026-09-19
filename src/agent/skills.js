// skills.js — load-konande-ye skills (item 2)
// ------------------------------------------------------------
// Skill-ha az folder-e `skills/` khoonde mishan. Har skill ya:
//   - ye file-e .md ba front-matter:
//       ---
//       name: xt-api
//       description: ...
//       ---
//       body...
//   - ya ye folder ba SKILL.md (hamoon format)
// Name + description-e hame skill-ha be system prompt ezafe mishe
// (prompt.js); body-e kamel ba /skills read <id> dide mishe.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

function parseFront(raw) {
  if (!raw.startsWith('---')) return { meta: {}, body: raw.trim() };
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, body: raw.trim() };
  const metaTxt = raw.slice(3, end).trim();
  const meta = {};
  for (const line of metaTxt.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(end + 4).trim() };
}

// listSkills(dir, { exclude }) -> [{ id, name, description, body, file }]
export function listSkills(dir = 'skills', { exclude = [] } = {}) {
  const abs = path.resolve(dir);
  let entries = [];
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return []; // folder nist — skill-i nist
  }

  const out = [];
  for (const e of entries) {
    let file = null;
    let id = e.name.replace(/\.md$/i, '');
    if (e.isDirectory()) {
      const f = path.join(abs, e.name, 'SKILL.md');
      if (!existsSync(f)) continue; // folder bedun-e SKILL.md — rad
      file = f;
    } else if (e.isFile() && /\.md$/i.test(e.name)) {
      if (/^readme(\.md)?$/i.test(e.name)) continue; // README = document, na skill
      file = path.join(abs, e.name);
    } else {
      continue;
    }

    let raw = '';
    try { raw = readFileSync(file, 'utf8'); } catch { continue; }
    const { meta, body } = parseFront(raw);
    const name = meta.name || id;

    if (exclude.includes(name) || exclude.includes(id)) continue; // off shode

    out.push({ id, name, description: meta.description || '', body, file });
  }
  return out;
}
