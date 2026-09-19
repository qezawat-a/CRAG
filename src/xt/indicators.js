// indicators.js — EMA/RSI/MACD/BB/ATR/Momentum pure-JS (port az strategies.py, bedune pandas)
// Vorudi: closes[] (number). Khuruji hamishe {side:'LONG'|'SHORT'|'NEUTRAL', conf, detail}
function emaArr(vals, period) {
  const k = 2 / (period + 1); const out = [];
  let prev = vals[0];
  for (let i = 0; i < vals.length; i++) { prev = i === 0 ? vals[0] : vals[i] * k + prev * (1 - k); out.push(prev); }
  return out;
}
function rsiArr(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i-1]; if (d > 0) g += d; else l -= d; }
  g /= period; l /= period;
  out[period] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    g = (g * (period - 1) + Math.max(d, 0)) / period;
    l = (l * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
export function emaCross(closes, fast = 9, slow = 21) {
  if (!closes || closes.length < slow + 10) return { side: 'NEUTRAL', conf: 0, detail: {} };
  const f = emaArr(closes, fast), s = emaArr(closes, slow);
  const pd = f[f.length-2] - s[s.length-2], cd = f[f.length-1] - s[s.length-1];
  if (pd < 0 && cd > 0) { const st = Math.min(100, Math.abs(cd) / Math.max(closes[closes.length-1], 0.01) * 10000); return { side: 'LONG', conf: Math.min(95, Math.floor(60 + st * 2)), detail: { fast: f[f.length-1], slow: s[s.length-1] } }; }
  if (pd > 0 && cd < 0) { const st = Math.min(100, Math.abs(cd) / Math.max(closes[closes.length-1], 0.01) * 10000); return { side: 'SHORT', conf: Math.min(95, Math.floor(60 + st * 2)), detail: { fast: f[f.length-1], slow: s[s.length-1] } }; }
  return { side: 'NEUTRAL', conf: 0, detail: {} };
}
export function macdSignal(closes, fast = 12, slow = 26, sigP = 9) {
  if (!closes || closes.length < slow + sigP + 10) return { side: 'NEUTRAL', conf: 0, detail: {} };
  const ef = emaArr(closes, fast), es = emaArr(closes, slow);
  const macd = closes.map((_, i) => ef[i] - es[i]);
  const sig = emaArr(macd.slice(slow), sigP);
  const m1 = macd[macd.length-1], m0 = macd[macd.length-2];
  const s1 = sig[sig.length-1], s0 = sig[sig.length-2];
  const h1 = m1 - s1, h0 = m0 - s0;
  if (h1 > 0 && h0 < 0) { const st = Math.min(100, Math.abs(h1) / closes[closes.length-1] * 50000); return { side: 'LONG', conf: Math.min(95, Math.floor(60 + st)), detail: { macd: m1, signal: s1, histogram: h1 } }; }
  if (h1 < 0 && h0 > 0) { const st = Math.min(100, Math.abs(h1) / closes[closes.length-1] * 50000); return { side: 'SHORT', conf: Math.min(95, Math.floor(60 + st)), detail: { macd: m1, signal: s1, histogram: h1 } }; }
  return { side: 'NEUTRAL', conf: 0, detail: {} };
}
export function rsiSignal(closes, period = 14) {
  const arr = rsiArr(closes, period);
  const r = arr[arr.length-1];
  if (r == null) return { side: 'NEUTRAL', conf: 0, detail: {} };
  if (r < 30) return { side: 'LONG', conf: Math.min(90, Math.floor(70 + (30 - r))), detail: { rsi: r } };
  if (r > 70) return { side: 'SHORT', conf: Math.min(90, Math.floor(70 + (r - 70))), detail: { rsi: r } };
  return { side: 'NEUTRAL', conf: 0, detail: { rsi: r } };
}
export function bollingerSignal(closes, period = 20, mult = 2) {
  if (!closes || closes.length < period + 5) return { side: 'NEUTRAL', conf: 0, detail: {} };
  const w = closes.slice(-period);
  const mean = w.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  const up = mean + mult * sd, lo = mean - mult * sd;
  const c = closes[closes.length-1];
  if (c < lo) return { side: 'LONG', conf: 70, detail: { close: c, lower: lo, upper: up } };
  if (c > up) return { side: 'SHORT', conf: 70, detail: { close: c, lower: lo, upper: up } };
  return { side: 'NEUTRAL', conf: 0, detail: { close: c, lower: lo, upper: up } };
}
export function momentumSignal(closes, period = 10) {
  if (!closes || closes.length < period + 5) return { side: 'NEUTRAL', conf: 0, detail: {} };
  const mom = closes[closes.length-1] - closes[closes.length-1-period];
  const pct = mom / closes[closes.length-1-period] * 100;
  if (pct > 0.5) return { side: 'LONG', conf: Math.min(85, Math.floor(60 + pct * 5)), detail: { momentumPct: pct } };
  if (pct < -0.5) return { side: 'SHORT', conf: Math.min(85, Math.floor(60 - pct * 5)), detail: { momentumPct: pct } };
  return { side: 'NEUTRAL', conf: 0, detail: { momentumPct: pct } };
}
export function atr(ohlc, period = 14) {
  if (!ohlc || ohlc.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < ohlc.length; i++) {
    const h = ohlc[i].h, l = ohlc[i].l, pc = ohlc[i-1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const last = trs.slice(-period);
  return last.reduce((a, b) => a + b, 0) / last.length;
}
