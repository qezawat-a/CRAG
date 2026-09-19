// client-part1.js — XT USDT-M Futures: transport + signing (CCXT parity)
import { XTError } from './errors.js';
import { signedHeadersAndPayload } from './sign.js';
export { XTError };
export const TP_SL_DEFAULT_EXPIRY_MS = 4102444800000;
export const MARKET = '/future/market';
export const USER = '/future/user';
export const TRADE = '/future/trade';
const NO_RETRY_SUFFIXES = ['/order/create','/order/create-batch','/entrust/create-profit','/entrust/create-plan','/entrust/create-track'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEFAULT_RETRY_BASE_MS = 500;
// Error-e network-e undici ('fetch failed') dalil-e vaghei ro tu cause gom mikone
// (EAI_AGAIN / ECONNRESET / ECONNREFUSED / ENOTFOUND / ETIMEDOUT / abort) — inja
// minevisimesh ta tu /status, /diag va log ha dalil-e vaghei dide beshe
// (ghabl-an faghat "fetch failed" dide mishod va nemishe fahmid chi shode).
export function describeFetchError(e, timeoutMs = 0) {
  if (!e) return 'request failed';
  const msg = String(e.message || e);
  const cause = e.cause;
  if (e.name === 'AbortError' || /aborted/i.test(msg)) return `timeout after ${timeoutMs}ms (request aborted)`;
  const code = cause && (cause.code || cause.name);
  if (code) return `${msg} (${code})`;
  if (cause && cause.message) return `${msg} (${String(cause.message).slice(0, 80)})`;
  return msg;
}
export class XTBase {
  constructor({ host, accessKey, secretKey, timeoutMs = 10000, retryBaseMs = process.env.XT_RETRY_BASE_MS ?? DEFAULT_RETRY_BASE_MS, minRequestIntervalMs = process.env.XT_MIN_REQUEST_MS ?? 100 } = {}) {
    this.host = String(host || process.env.XT_FUTURES_HOST || 'https://fapi.xt.com').replace(/\/$/, '');
    this._ak = accessKey ?? process.env.XT_API_KEY ?? '';
    this._sk = secretKey ?? process.env.XT_API_SECRET ?? '';
    this.timeoutMs = timeoutMs;
    const base = Number(retryBaseMs);
    this.retryBaseMs = Number.isFinite(base) && base >= 0 ? base : DEFAULT_RETRY_BASE_MS;
    const interval = Number(minRequestIntervalMs);
    this.minRequestInterval = Number.isFinite(interval) && interval >= 0 ? interval : 100;
    this.lastRequestTime = 0;
  }
  async _rateLimit() {
    const now = Date.now();
    const el = now - this.lastRequestTime;
    if (el < this.minRequestInterval) await sleep(this.minRequestInterval - el);
    this.lastRequestTime = Date.now();
  }
  async _request(method, path, params = {}, signed = false) {
    const clean = Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== null && v !== undefined));
    const noRetry = method === 'POST' && NO_RETRY_SUFFIXES.some((s) => path.endsWith(s));
    const maxRetries = noRetry ? 1 : 5;
    let lastErr = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await this._rateLimit();
      try {
        const url = new URL(this.host + path);
        let headers; let body;
        if (signed) {
          if (!this._ak || !this._sk) throw new XTError(`${path} -> XT_API_KEY/XT_API_SECRET khali (.env).`);
          const s = signedHeadersAndPayload({ method, path, params: clean, apiKey: this._ak, secret: this._sk });
          headers = s.headers;
          if (method === 'GET') { if (s.query && Object.keys(s.query).length) url.search = new URLSearchParams(s.query).toString(); }
          else body = s.body;
        } else {
          headers = { 'Content-type': 'application/json' };
          if (method === 'GET') { if (Object.keys(clean).length) url.search = new URLSearchParams(clean).toString(); }
          else body = JSON.stringify(clean);
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        let resp;
        try { resp = await fetch(url.toString(), { method, headers, body: method === 'POST' ? body : undefined, signal: ctrl.signal }); }
        finally { clearTimeout(timer); }
        if (resp.status === 429) {
          if (noRetry) throw new XTError(`${path} -> HTTP 429 (not retried — order endpoint)`);
          await sleep(Math.min(this.retryBaseMs * 2 ** (attempt + 1), 8000)); continue;
        }
        if (resp.status >= 500) {
          if (noRetry) throw new XTError(`${path} -> HTTP ${resp.status} (not retried — order endpoint)`);
          await sleep(Math.min(this.retryBaseMs * 2 ** attempt, 4000)); continue;
        }
        const text = await resp.text();
        let payload;
        try { payload = text ? JSON.parse(text) : {}; }
        catch { throw new XTError(`${path} -> HTTP ${resp.status}, non-JSON: ${String(text).slice(0, 200)}`); }
        return XTBase._unwrap(payload, path);
      } catch (e) {
        lastErr = e;
        if (e instanceof XTError) throw e;
        if (noRetry) throw new XTError(`${path} -> ${describeFetchError(e, this.timeoutMs)}`);
        if (attempt < maxRetries - 1) { await sleep(Math.min(this.retryBaseMs * 2 ** attempt, 4000)); continue; }
        throw new XTError(`${path} -> ${describeFetchError(e, this.timeoutMs)}`);
      }
    }
    if (lastErr instanceof XTError) throw lastErr;
    throw new XTError(`${path} -> ${describeFetchError(lastErr, this.timeoutMs)}`);
  }
  _public(m, p, q) { return this._request(m, p, q, false); }
  _private(m, p, q) { return this._request(m, p, q, true); }
  static _unwrap(payload, path) {
    if (payload === null || typeof payload !== 'object') return payload;
    const code = payload.returnCode ?? payload.rc ?? 0;
    if (code !== 0) {
      const err = payload.error || {};
      const msg = payload.msgInfo || payload.mc || 'Unknown error';
      const detail = err.msg || err.code || '';
      throw new XTError(`${path} -> returnCode=${code} ${msg} ${detail}`.trim());
    }
    if ('result' in payload) return payload.result;
    if ('data' in payload) return payload.data;
    return payload;
  }
  static normalizeBalancePayload(data) {
    const list = Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : []);
    const out = [];
    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      const coin = String(row.coin || row.currency || 'USDT').toUpperCase();
      const w = Number(row.walletBalance ?? row.totalAmount ?? row.total ?? row.balance ?? 0);
      const a = Number(row.availableBalance ?? row.available ?? row.availableAmount ?? 0);
      const f = Number(row.openOrderMarginFrozen ?? row.frozen ?? row.frozenAmount ?? 0);
      if (!Number.isFinite(w) || !Number.isFinite(a)) continue;
      out.push({ coin, walletBalance: w, availableBalance: a, openOrderMarginFrozen: Number.isFinite(f) ? f : 0, isolatedMargin: Number(row.isolatedMargin || 0), crossedMargin: Number(row.crossedMargin || 0), bonus: Number(row.bonus || 0), coupon: Number(row.coupon || 0) });
    }
    return out;
  }
}
