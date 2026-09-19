// scanner.js — signal scanner (port az CryptoMind-XT/bot/signal_scanner.py + strategies.py)
// - fetchKlines: kline ha ro be OHLC DataFrame-sade tabdil mikone (newest-first -> oldest-first, forming candle hazf)
// - scanTimeframe: 5 strategy (EMA/MACD/RSI/BB/Momentum) + RSI veto + min_agree vote (confidence-mass)
// - scanMultiTimeframe: weight vote (1m .5 / 3m .8 / 5m 1 / 15m 1.5 ...) + tf gate
import { emaCross, macdSignal, rsiSignal, bollingerSignal, momentumSignal } from './indicators.js';
export const VALID_INTERVALS = ['1m','3m','5m','15m','30m','1h','2h','4h','1d','1w'];
export const TF_WEIGHTS = { '1m': 0.5, '3m': 0.8, '5m': 1.0, '15m': 1.5, '30m': 2.0, '1h': 2.5, '2h': 2.8, '4h': 3.0, '1d': 4.0, '1w': 5.0 };
export const KLINE_MAP = { t: 'timestamp', o: 'open', h: 'high', l: 'low', c: 'close', a: 'volume', v: 'turnover', s: 'symbol' };
export function normalizeKlines(rows) {
  if (!rows || !rows.length) return [];
  const out = rows.map((r) => ({ timestamp: Number(r.t ?? r.timestamp ?? 0), open: Number(r.o ?? r.open ?? 0), high: Number(r.h ?? r.high ?? 0), low: Number(r.l ?? r.low ?? 0), close: Number(r.c ?? r.close ?? 0), volume: Number(r.a ?? r.volume ?? 0), turnover: Number(r.v ?? r.turnover ?? 0) })).filter((c) => Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}
function intervalSec(iv) { const u = { m: 60, h: 3600, d: 86400, w: 604800 }; return parseInt(iv, 10) * (u[iv.slice(-1)] || 60); }
export function dropFormingCandle(candles, interval) {
  if (!candles.length) return candles;
  try {
    let last = candles[candles.length - 1].timestamp;
    if (last < 1e12) last *= 1000;
    if (Date.now() < last + intervalSec(interval) * 1000) return candles.slice(0, -1);
  } catch {}
  return candles;
}
export async function fetchCandles(xt, symbol, interval, limit = 200) {
  const rows = await xt.getKlines(symbol, interval, { limit: Math.min(limit, 1500) });
  return dropFormingCandle(normalizeKlines(rows), interval);
}
export function scanTimeframe(candles, { minConfidence = 80, minAgree = 2, tfMinConfidence = 70 } = {}) {
  const closes = candles.map((c) => c.close);
  const all = [
    { strategy: 'EMA', ...emaCross(closes) },
    { strategy: 'MACD', ...macdSignal(closes) },
    { strategy: 'RSI', ...rsiSignal(closes) },
    { strategy: 'BB', ...bollingerSignal(closes) },
    { strategy: 'MOM', ...momentumSignal(closes) },
  ];
  // RSI: extreme (>=70 / <=30) alone doesn't tell us "reversal now" — ye trend-e
  // ghavi mitune RSI ro deraz-mod-dat extreme negah dare (mesal: RSI 90+ tu ye
  // pump-e vaghei). Do chiz check mikonim ghabl az veto/signal-e RSI:
  //  1) rsiTurningDown/Up: RSI nesbat be bar-e ghabl dare az extreme bar migarde
  //     ya na. BUG FIX: ghablan har kam-e rsi (92->91.9) "turning" migereft.
  //     ALAN: faghat vaghti RSI az 70 (overbought) PAEEN MIAD ya az 30 (oversold)
  //     BALA MIAD — yani reversal-e vaghei. Yani:
  //       - overbought: prevRsi >= 70 VA rsiVal < prevRsi VA rsiVal < 70
  //       - oversold:   prevRsi <= 30 VA rsiVal > prevRsi VA rsiVal > 30
  //  2) strongUptrend/Downtrend: 2-ta az 3-ta strategy-e trend-following
  //     (EMA/MACD/MOM) hamjahat-an va hich kodum mokhalef nist.
  // Vaghti trend ghavi-ye hamun samt-e extreme-e va RSI HANUZ dare turn nemikone
  // (mesal RSI=92 va dare bala mire), RSI ro nadide migirim — bezar trend edame
  // peida kone, zoodtar-gereftan-e ghalat ro jelo migire. Be mahzi ke RSI dare az
  // peak-esh bar migarde (rsiTurningDown/Up = true), hatta agar hanuz literally
  // 70/30 ro rad nakarde, tabdil be signal-e vaghei mishe + veto ejra mishe —
  // chon hamun lahze-i-e ke momentum vaghean dare barmigarde.
  const rsiEntry = all.find((s) => s.strategy === 'RSI');
  const rsiVal = rsiEntry && rsiEntry.detail ? rsiEntry.detail.rsi : null;
  const prevRsi = closes.length > 1 ? (rsiSignal(closes.slice(0, -1)).detail?.rsi ?? null) : null;
  // FIX: only count as "turning" if RSI crosses the 70/30 threshold (confirmed reversal)
  // Not just any tiny fluctuation in extreme territory
  const rsiTurningDown = rsiVal != null && prevRsi != null && prevRsi >= 70 && rsiVal < prevRsi && rsiVal < 70;
  const rsiTurningUp = rsiVal != null && prevRsi != null && prevRsi <= 30 && rsiVal > prevRsi && rsiVal > 30;
  // MOM (momentum-e piyoste-ye N-bar) behtarin nesbat-e "trend hanuz zende-s" ast —
  // EMA/MACD faghat sar-e bar-e crossover signal midan (rowidad-e lahzei, na
  // vaziyat-e edame-dar), pas nemishe montazer-e hamzaman-budan-e 2-ta-shun mand.
  // strongUptrend/Downtrend = MOM ba etminan-e bala hamun samt-o mige, va
  // EMA/MACD (agar in bar signal dashte bashan) mokhalefat nemikonan.
  const mom = all.find((s) => s.strategy === 'MOM');
  const emaS = all.find((s) => s.strategy === 'EMA');
  const macdS = all.find((s) => s.strategy === 'MACD');
  const noContraryTrend = (dir) => (emaS.side === 'NEUTRAL' || emaS.side === dir) && (macdS.side === 'NEUTRAL' || macdS.side === dir);
  const strongUptrend = mom.side === 'LONG' && mom.conf >= 75 && noContraryTrend('LONG');
  const strongDowntrend = mom.side === 'SHORT' && mom.conf >= 75 && noContraryTrend('SHORT');
  const rsiExtremeButTrending = rsiVal != null && ((rsiVal >= 70 && strongUptrend && !rsiTurningDown) || (rsiVal <= 30 && strongDowntrend && !rsiTurningUp));
  if (rsiExtremeButTrending) { rsiEntry.side = 'NEUTRAL'; rsiEntry.conf = 0; rsiEntry.detail = { ...rsiEntry.detail, overriddenByTrend: true }; }

  const fired = all.filter((s) => s.side !== 'NEUTRAL' && s.conf >= tfMinConfidence);
  let longs = fired.filter((s) => s.side === 'LONG' && s.conf >= minConfidence);
  let shorts = fired.filter((s) => s.side === 'SHORT' && s.conf >= minConfidence);
  let veto = null;
  if (rsiVal != null && !rsiExtremeButTrending) {
    if (rsiVal >= 70) { longs = []; veto = rsiTurningDown ? `RSI ${rsiVal.toFixed(1)} dare az overbought bar migarde — LONG veto (reversal confirmed)` : `RSI ${rsiVal.toFixed(1)} overbought — LONG veto`; }
    if (rsiVal <= 30) { shorts = []; veto = rsiTurningUp ? `RSI ${rsiVal.toFixed(1)} dare az oversold bar migarde — SHORT veto (reversal confirmed)` : `RSI ${rsiVal.toFixed(1)} oversold — SHORT veto`; }
  }
  const ls = longs.reduce((a, s) => a + s.conf, 0), ss = shorts.reduce((a, s) => a + s.conf, 0);
  let direction = 'NEUTRAL'; let used = [];
  if (ls > ss && longs.length >= minAgree) { direction = 'LONG'; used = longs.map((s) => s.strategy); }
  else if (ss > ls && shorts.length >= minAgree) { direction = 'SHORT'; used = shorts.map((s) => s.strategy); }
  const tot = ls + ss;
  const strength = direction !== 'NEUTRAL' && tot > 0 ? Math.abs(ls - ss) / tot : 0;
  const sigs = [...longs, ...shorts];
  const avg = sigs.length ? Math.floor(sigs.reduce((a, s) => a + s.conf, 0) / sigs.length) : 0;
  let rejectionReason = null;
  if (direction === 'NEUTRAL') {
    if (!sigs.length) rejectionReason = 'Hich strategy bad az filter-ha baghi namand';
    else if (ls === ss) rejectionReason = 'Emtiaz-e LONG va SHORT barabar ast';
    else rejectionReason = `Taeed-e hamjahat kafi nist: LONG=${longs.length}, SHORT=${shorts.length}, minimum=${minAgree}`;
  }
  return { direction, confidence: avg, signalStrength: strength, strategiesUsed: used, allSignals: all, longCount: longs.length, shortCount: shorts.length, rsi: rsiVal, vetoReason: veto, rejectionReason, rsiOverriddenByTrend: rsiExtremeButTrending };
}
export async function scanMultiTimeframe(xt, symbol, intervals, { minConfidence = 80, tfMinConfidence = 70, minAgree = 2, limit = 200 } = {}) {
  const tfResults = {};
  let longW = 0, shortW = 0;
  for (const tf of intervals) {
    try {
      const candles = await fetchCandles(xt, symbol, tf, limit);
      if (!candles.length) { tfResults[tf] = { error: 'no data' }; continue; }
      const r = scanTimeframe(candles, { minConfidence, minAgree, tfMinConfidence });
      tfResults[tf] = r;
      const w = TF_WEIGHTS[tf] || 1;
      if (r.direction === 'LONG') longW += w * (r.confidence / 100);
      if (r.direction === 'SHORT') shortW += w * (r.confidence / 100);
    } catch (e) { tfResults[tf] = { error: e.message }; }
  }
  let direction = 'NEUTRAL';
  if (longW > shortW) direction = 'LONG'; else if (shortW > longW) direction = 'SHORT';
  const votedW = Math.abs(longW - shortW);
  const confs = Object.values(tfResults).filter((r) => r.direction && r.direction !== 'NEUTRAL').map((r) => r.confidence || 0);
  const confidence = confs.length ? Math.floor(confs.reduce((a, b) => a + b, 0) / confs.length) : 0;
  const used = [...new Set(Object.values(tfResults).flatMap((r) => r.strategiesUsed || []))];
  return { symbol, direction, confidence, longWeight: longW, shortWeight: shortW, votedWeight: votedW, strategiesUsed: used, timeframeResults: tfResults, signalStrength: (longW + shortW) > 0 ? votedW / (longW + shortW) : 0 };
}
export async function getCurrentPrice(xt, symbol) {
  try { const t = await xt.getAggTicker(symbol); const p = Number(t.c || 0); if (p > 0) return p; } catch {}
  try { const m = await xt.getMarkPrice(symbol); const p = Number(m.p || m.markPrice || 0); if (p > 0) return p; } catch {}
  return 0;
}
// getCurrentPriceDetailed: mesl-e getCurrentPrice vali error ro gom NEMIKONE.
// (ghabl-an /status vaghti network down bud "Price: 0" neshoon midad — in
//  model-e ghalat bud va dalil-e asli (fetch failed) dide nemishod.)
export async function getCurrentPriceDetailed(xt, symbol) {
  const errs = [];
  try {
    const t = await xt.getAggTicker(symbol);
    const p = Number(t.c || 0);
    if (p > 0) return { price: p, error: null };
    errs.push('agg-ticker: gheymat-e 0');
  } catch (e) { errs.push(`agg-ticker: ${e.message}`); }
  try {
    const m = await xt.getMarkPrice(symbol);
    const p = Number(m.p || m.markPrice || 0);
    if (p > 0) return { price: p, error: null };
    errs.push('mark-price: gheymat-e 0');
  } catch (e) { errs.push(`mark-price: ${e.message}`); }
  return { price: 0, error: errs.join(' | ') };
}
