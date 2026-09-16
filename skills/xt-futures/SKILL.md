---
name: xt-futures
 description: XT USDT-M Futures trading — market, account, orders, TP/SL, scan, risk. FUTURES ONLY.
---

# XT Futures Skill (FUTURES ONLY — spot nadarim)

In agent 25 tool-e `xt_*` darad (az `src/xt/futures-tools.js`). Hameye kar ba symbol-e mesl-e `btc_usdt` (lowercase + `_usdt`).

## Ghanoon haye amniati (HATMAN)
- Default `XT_DRY_RUN=1` hast: `xt_open` / `xt_close` / `xt_tpsl_create` faghat preview midan, ejra NEMISHAN. Baraye trade-e vaghei aval `xt_dry_run` ba `0` seda bezan va be user begu dare vaghei trade mikone.
- Ghabl az OPEN: `xt_symbol_detail` (minQty/minNotional/precision) + `xt_size` (contracts) + `xt_leverage` (clamp ba bracket) + `xt_balance` (available) ro check kon.
- `CROSSED` default-e. `xt_position_type` faghat vaghti lazem-e. `adjustMargin`/`autoMargin` dar CROSSED MAMNOO (ISOLATED-only).
- Order endpoint ha retry NEMISHAN (duplicate risk) — bad az timeout dobare order NAZAR bedoone check-e `xt_orders`.
- TP/SL ba `xt_tpsl_create` (expireTime default 2100 = permanent). Cancel-e joda: `xt_tpsl_cancel`.
- Close: `xt_close` (MARKET IOC reduce-only + cancel TPSL-e hamoon side) — hichvaght ba SELL/BUY-e dasti naband.

## Flow haye standard
**Scan:** `xt_scan` (EMA/MACD/RSI/BB/MOM + weight vote) -> `xt_ticker` (price) -> `xt_positions` (exposure)
**Open LONG:** balance -> symbol_detail -> size(qty) -> leverage -> open(LONG/BUY/MARKET) -> tpsl_create
**Open SHORT:** hamin, ba SHORT/SELL
**Manage:** `xt_position_pnl` -> `xt_tpsl_update` ya `xt_close`
**Status:** `xt_status` (balance + positions + price)

## Kline
`xt_klines` interval ha: 1m/3m/5m/15m/30m/1h/2h/4h/1d/1w. Forming candle hazf mishe (mesl-e CryptoMind-XT).

## History
`xt_history` ba kind=orders|trades|positions|tpsl.
