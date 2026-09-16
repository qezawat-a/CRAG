# crypto-agent

**Merge-e Crypto2 + xt-agent — yek proje, JavaScript.**

XT USDT-M Futures **AI trader bot** + **autonomous AI agent** (soul / skills / prompt options) dar yek package.

- Bot trader (port-e kamel az Crypto2 python → JS): auto-trade loop, signal gate, dynamic TP/SL, breakeven, trailing stop, mid-manager guardian, adoption/reconcile, cooldowns, software stop.
- Agency (az xt-agent): agent loop ba tool-calling, SOUL.md / STYLE.md, skills (`skills/`), settings.json (18 option), TUI (`npm run agent`), harness JSONL, MCP.
- Strategies + Signal Scanner (az xt-agent — port-e JS-e hamin strategi-ha): EMA / MACD / RSI / Bollinger / Momentum + RSI veto + confidence-mass vote + multi-timeframe weight vote.
- Telegram: command-ha → trader, chat-e mamuli → agent (unknown /command ham be agent forward mishe, na "Unknown command").
- 25 tool-e `xt_*` (futures) + 12 tool-e `trader_*` (control-e bot tavasot agent).

## Ejra

```bash
npm install
cp .env.example .env   # XT_API_KEY / TELEGRAM_BOT_TOKEN / AI_API_KEY ro por kon
npm start              # trader + agent + telegram + health server
npm run agent          # TUI-e agent (agency mode + trader settings)
npm test               # test ha (1 test-e DB-e vaghei be-soorate skip — ba TEST_DATABASE_URL ejra mishe)
```

> **Amniat:** `XT_DRY_RUN=1` (default) order/TPSL/close-e VAGHEI nemifreste. Baraye trade-e vaghei `XT_DRY_RUN=0` konid (az env ya `/dryrun 0` / agent).

> **Auto-model:** `AI_MODEL` ro dar `.env` set konid ta probe/autodetect az `/models` skip beshe (saritar va paydar-tar).

> **Zakhire (persistence):** state-e bot (settings / trades / signals / cooldowns) be-soorate pishfarz tu file-e `data/trader-store.json` mimune — ke ru deploy-e ephemeral (Railway/Heroku) **ba har deploy pak mishe**. Baraye zakhire-ye DAEMI `DATABASE_URL` bedid (Neon Postgres ya Railway MySQL), mesl-e versione Python-e Crypto2:

```bash
# Neon (pishnahad shode) — pooler URL + sslmode=require
DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.neon.tech/neondb?sslmode=require
# ya Railway MySQL (niyaz be `npm install mysql2`)
DATABASE_URL=mysql://user:pass@host:3306/railway
```

State be-soorate snapshot-e JSON tu table-e `trader_store` (id = `STORE_ID`) upsert mishe; pool + `pg` automatic misazan. Chand bot ru yek DB? `STORE_ID` ro baraye har bot joda konid.

## Sakhtar

```
src/
├── main.js               # entry: trader + agent + telegram + health server
├── config.js             # config-e trading (agent-only, static defaults + validation)
├── store/memory.js       # settings/signals/trades/cooldowns (JSON store, port az memory.py)
├── trader/
│   ├── trader.js         # XTTrader: scan→open→guard→midmanage (port az trader.py)
│   ├── position-manager.js # dynamic TP/SL, breakeven, trailing, adoption (port az position_manager.py)
│   └── agent-tools.js    # tool-haye trader_* baraye agent (settings HAME)
├── xt/                   # client/sign/risk/positions/indicators/scanner/futures-tools (az xt-agent)
├── agent/                # loop/brain/memory/skills/prompt (agency — az xt-agent)
├── telegram-bot.js       # merged telegram runner (main)
├── telegram-trader.js    # shared trader commands (bot + gateway, ta Unknown nadim)
├── telegram.js / telegram-commands.js
├── prompt.js / settings.js / harness.js / serve.js / gateway.js / session-store.js
└── ui/tui.js             # terminal UI (+ /tsettings /tset ...)
soul/  skills/  tests/
```

## Branch-haye Telegram (merged mode)

/status /balance /signal /pnl /settings /check_ai /close /diag (az xt-agent) +
/autotrade_on /autotrade_off /open /close_all /protect /midmanage /sync /trades /reset_cooldown /set /get /reset_settings /dryrun (trader)
(diagnose-e trader ham alan tu hamun `/diag` merge shode).

> **Trade settings AGENT-ONLY:** tanzimat FAGHAT az tarigh-e agent avaz mishan (TUI / Telegram / agent chat) va dar store zakhire mishan (ba restart NEMIPARAN). `.env` baraye trade tuning KHANDE NEMISHE (ignored) — age ghadimi set karde bashi, dar log hoshdar mibini. `/settings` HAMEYE 26 key ro az store neshun mide. `/set key value` ba validation + alias (`margin_mode` -> `position_type`). `/get key` baraye yeki. `/reset_settings` reset be defaults. `/reseed` deprecated (= reset).
> Chat-e mamuli (bedun-e `/`, hatta Farsi mesl-e "setting o neshun bede") mire be agent — agent az `trader_settings_get` HAME ro neshun mide (na faghat 4 key + base url).
> Unknown `/command` ham aval be agent forward mishe — faghat age agent ham natunest, list neshun dade mishe.

## TUI (terminal)

- `/tsettings` — HAMEYE trader settings (az store)
- `/tset key value` — mesal `/tset leverage 10`
- `/tget key` — mesal `/tget leverage`
- `/treset` — reset be defaults
- `/tstatus` `/tsignal [symbol]` `/ttrades` `/tsync` `/tauto_on` `/tauto_off` `/tdryrun 1|0`
- `/settings` — tanzimat-e AGENT (settings.json), na trader!

## Settings-e trader (HAME, via `/settings` + `/tset key value` ya agent)

`symbol, leverage, position_type, timeframes, margin_amount_pct, margin_risk_pct, min_confidence, tf_min_confidence, min_agreeing_strategies, signal_confirm_scans, cooldown_minutes, max_positions, position_mode, scan_interval_sec, guard_interval_sec, breakeven_threshold_pct, trailing_stop_pct, trailing_trigger_roi_pct, trailing_distance_pct, sl_liquidation_safety, on_tpsl_failure, reversal_enabled, reversal_confidence, report_interval_sec, mid_manage_interval_sec`
(alias: `margin_mode` -> `position_type`)
