# crypto-agent

**Merge-e Crypto2 + xt-agent — yek proje, JavaScript.**

XT USDT-M Futures **AI trader bot** + **autonomous AI agent** (soul / skills / prompt options) dar yek package.

- Bot trader (port-e kamel az Crypto2 python → JS): auto-trade loop, signal gate, dynamic TP/SL, breakeven, trailing stop, mid-manager guardian, adoption/reconcile, cooldowns, software stop.
- Agency (az xt-agent): agent loop ba tool-calling, SOUL.md / STYLE.md, skills (`skills/`), settings.json (18 option), TUI (`npm run agent`), harness JSONL, MCP.
- Strategies + Signal Scanner (az xt-agent — port-e JS-e hamin strategi-ha): EMA / MACD / RSI / Bollinger / Momentum + RSI veto + confidence-mass vote + multi-timeframe weight vote.
- Telegram: command-ha → trader, chat-e mamuli → agent.
- 25 tool-e `xt_*` (futures) + 12 tool-e `trader_*` (control-e bot tavasot agent).

## Ejra

```bash
npm install
cp .env.example .env   # XT_API_KEY / TELEGRAM_BOT_TOKEN / AI_API_KEY ro por kon
npm start              # trader + agent + telegram + health server
npm run agent          # TUI-e agent (agency mode)
npm test               # 33 test
```

> **Amniat:** `XT_DRY_RUN=1` (default) order/TPSL/close-e VAGHEI nemifreste. Baraye trade-e vaghei `XT_DRY_RUN=0` konid.

> **Auto-model:** `AI_MODEL` ro dar `.env` set konid ta probe/autodetect az `/models` skip beshe (saritar va paydar-tar).

## Sakhtar

```
src/
├── main.js               # entry: trader + agent + telegram + health server
├── config.js             # config-e trading (port az Crypto2 config.py)
├── store/memory.js       # settings/signals/trades/cooldowns (JSON store, port az memory.py)
├── trader/
│   ├── trader.js         # XTTrader: scan→open→guard→midmanage (port az trader.py)
│   ├── position-manager.js # dynamic TP/SL, breakeven, trailing, adoption (port az position_manager.py)
│   └── agent-tools.js    # tool-haye trader_* baraye agent
├── xt/                   # client/sign/risk/positions/indicators/scanner/futures-tools (az xt-agent)
├── agent/                # loop/brain/memory/skills/prompt (agency — az xt-agent)
├── telegram-bot.js       # merged telegram runner
├── telegram.js / telegram-commands.js
├── prompt.js / settings.js / harness.js / serve.js / gateway.js / session-store.js
└── ui/tui.js             # terminal UI
soul/  skills/  tests/
```

## Branch-haye Telegram (merged mode)

`/status /balance /signal /pnl /settings /check_ai /close` (az xt-agent) +
`/autotrade_on /autotrade_off /open /close_all /protect /midmanage /sync /trades /diag /reset_cooldown /set` (trader).
Chat-e mamuli (bedun-e `/`) mire be agent.

## Settings-e mohem (settings be store/save mishan: `/set key value`)

`symbol, leverage, timeframes, min_confidence, tf_min_confidence, min_agreeing_strategies, max_positions, position_mode, margin_amount_pct, margin_risk_pct, cooldown_minutes, breakeven_threshold_pct, trailing_trigger_roi_pct, trailing_distance_pct, sl_liquidation_safety, on_tpsl_failure, reversal_enabled, reversal_confidence, report_interval_sec`
