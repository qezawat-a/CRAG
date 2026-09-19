// session-store.js — zakhirat-e session-ha (item 1)
// ----------------------------------------------------------------
// Har session = { id, title, createdAt, updatedAt, history[] }.
// Hame dar data/sessions.json negah dashte mishan ta betooni
// session-e ghabli ro resume koni ya beyneshun switch koni.
// (Tarikh-e har session khodesh array-e message-hast — hamoon
//  format-e OpenAI-style ke loop.js estefade mikone.)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export class SessionStore {
  constructor(filePath = path.resolve('data', 'sessions.json')) {
    this.file = filePath;
    this.list = []; // array-e session-ha
  }

  async load() {
    try {
      this.list = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(this.list)) this.list = [];
    } catch {
      this.list = []; // file nist ya kharab-e -> start-e pak
    }
    return this;
  }

  async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.list, null, 2));
  }

  // id -> session (ye copy — ta UI az ruye list taghir nade)
  get(id) {
    const found = this.list.find(s => s.id === id);
    return found ? { ...found, history: [...(found.history || [])] } : null;
  }

  upsert(session) {
    const i = this.list.findIndex(s => s.id === session.id);
    if (i >= 0) this.list[i] = session;
    else this.list.push(session);
  }

  remove(id) {
    const i = this.list.findIndex(s => s.id === id);
    if (i >= 0) this.list.splice(i, 1);
  }

  // jadid-tarin session bar asas-e updatedAt (baraye resume-e auto)
  last() {
    if (!this.list.length) return null;
    return [...this.list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  }

  // maxSessions ta negah darim — ghadimi-ha pak mishan
  async prune(maxSessions) {
    if (maxSessions <= 0 || this.list.length <= maxSessions) return;
    const sorted = [...this.list].sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
    this.list = sorted.slice(-maxSessions);
    await this.save();
  }
}
