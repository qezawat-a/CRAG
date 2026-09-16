// services.js — edare-ye service-haye HTTP/Gateway/Harness (item 8,12,13)
// ----------------------------------------------------------------
// Ye class-e Services ke hame-ye kanal-haye agent ro ba ham manage mikone:
//   - serve: HTTP API-e mahali (item 13)
//   - gateway: Messenger (telegram/...) (item 12)
//   - harness: JSONL stdin/stdout (item 8=11)
//
// TUI mitune inho ro ON/OFF kone va az say-e queue-dar estefade kone
// ta history-e agent az chand kanal gharbe-gherb nashe.

import { startServe } from './serve.js';
import { startGateway } from './gateway.js';
import { startHarness } from './harness.js';

export class Services {
  constructor({ getSettings, say, agentName = 'agent', getModel, log = console.log }) {
    this.getSettings = getSettings;
    this.say = say;
    this.agentName = agentName;
    this.getModel = getModel;
    this.log = log;

    this.serveHandle = null;
    this.gatewayHandle = null;
    this.harnessHandle = null;
  }

  // sync kardan-e service-ha ba settings (dar start)
  syncFromSettings() {
    const s = this.getSettings();
    if (s.serve && s.serve.enabled) this.serveOn();
    if (s.gateway && s.gateway.enabled) this.gatewayOn();
    if (s.harness && s.harness.enabled) this.harnessOn();
  }

  // --- serve (item 13) ---
  serveOn() {
    if (this.serveHandle) return;
    const s = this.getSettings();
    const port = (s.serve && s.serve.port) || 8787;
    this.serveHandle = startServe({
      port,
      say: this.say,
      agentName: this.agentName,
      getModel: this.getModel,
      log: this.log,
    });
  }

  serveOff() {
    if (this.serveHandle) {
      this.serveHandle.stop();
      this.serveHandle = null;
    }
  }

  // --- gateway (item 12) ---
  gatewayOn() {
    if (this.gatewayHandle) return;
    const s = this.getSettings();
    const messenger = (s.gateway && s.gateway.messenger) || 'telegram';
    const token = (s.gateway && s.gateway.token) || process.env.TELEGRAM_BOT_TOKEN || '';
    const userId = (s.gateway && s.gateway.userId) || process.env.TELEGRAM_USER_ID || '';
    if (!token) {
      this.log('[gateway] token nist — /tg token <bot-token> ya TELEGRAM_BOT_TOKEN dar .env.');
      return;
    }
    this.gatewayHandle = startGateway({
      messenger,
      token,
      userId,
      onMessage: this.say,
      getModel: this.getModel,
      agentName: this.agentName,
      log: this.log,
    });
  }

  gatewayOff() {
    if (this.gatewayHandle) {
      this.gatewayHandle.stop();
      this.gatewayHandle = null;
    }
  }

  // --- harness (item 8=11) ---
  harnessOn() {
    if (this.harnessHandle) return;
    this.harnessHandle = startHarness({
      say: this.say,
      log: this.log,
    });
  }

  harnessOff() {
    if (this.harnessHandle) {
      this.harnessHandle.stop();
      this.harnessHandle = null;
    }
  }

  // --- stop-e hame ---
  stopAll() {
    this.serveOff();
    this.gatewayOff();
    this.harnessOff();
    this.log('[services] hame-ye service-ha khamush shodan.');
  }
}
