# alpha-ai-trader

> AI trading coach with a **built-in AI engine that needs no API key**. It finds the behavioural leaks in your trading (loss aversion, revenge trading, overconfidence, FOMO), forecasts your future with Monte Carlo simulation, and coaches you in plain language. It runs **free on Cloudflare or Vercel**, on any Node host, or fully offline in the browser.

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white) ![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white) ![Hono](https://img.shields.io/badge/Hono-E36002?style=for-the-badge&logo=hono&logoColor=white) ![No API key](https://img.shields.io/badge/AI-no_API_key-2a78d6?style=for-the-badge)

## 📑 Contents

- [Features](#-features)
- [The Alpha Engine](#-the-alpha-engine-no-api-key)
- [Crimson Arena (fun mode game)](#-crimson-arena-fun-mode-game)
- [Tested results](#-tested-results)
- [Deploy (free)](#-deploy-free)
- [Local development](#-local-development)
- [Configuration](#-configuration)
- [API](#-api)
- [Project structure](#-project-structure)

## ✨ Features

- **Alpha Score & Trader DNA:** one 0-100 score plus five traits (discipline, risk control, emotional control, consistency, edge) that explain *why* your results look the way they do.
- **Behavioural bias detection:** loss aversion (stops not honoured, losers held longer), revenge trading (sizing up or jumping back in after a loss), overconfidence, FOMO and missing stops. Each finding comes with evidence, the dollars it cost you and a fix.
- **Monte Carlo forecast:** 1,000 simulated futures of your next 25-250 trades, giving your chance of profit, median outcome, risk of ruin and worst-case drawdown.
- **Pro analytics:** equity and drawdown curves, R-multiple distribution, P/L by market, a weekday × session heatmap, monthly P/L, Sharpe, Sortino, SQN, Kelly, payoff ratio and recovery factor.
- **AI coach chat:** understands free-form questions (typos too), answers from your real numbers, and can analyse any single trade.
- **Trade journal:** add trades, search and filter, CSV import (most broker exports work) and CSV export.
- **Beautiful, accessible UI:** light and dark themes, mobile layout, keyboard-navigable charts with tooltips, and a table view for every chart.
- **Never breaks:** if the API is unreachable, or the host has no database, everything runs in the browser with the same engine and your trades are saved locally.
- **Fun mode: Crimson Arena.** A browser action game at `/game/` whose movement, physics, combat and enemy AI run in a **C# engine compiled to WebAssembly**. No backend needed.

## 🧠 The Alpha Engine (no API key)

The coach is a custom, deterministic AI engine written in plain JavaScript (`public/engine/`). The same code runs on the server and in the browser:

| Module | What it does |
| --- | --- |
| **Quant engine** (`quant.js`) | Win rate, profit factor, expectancy, Sharpe, Sortino, SQN, Kelly, drawdown, R-multiples and every breakdown |
| **Behaviour engine** (`behavior.js`) | Bias detection from trades *and* journal notes, the risk score and Trader DNA |
| **Monte Carlo engine** (`montecarlo.js`) | Bootstrap-resamples your own results into 1,000 futures (seeded, so results are reproducible) |
| **NLU engine** (`nlu.js`) | A machine-learning intent classifier (TF-IDF over words + character trigrams, nearest-centroid model) that understands questions and typos |
| **Synthesis engine** (`synthesis.js`) | Writes every answer from your own numbers, so answers are never invented |

**Optional LLM polish:** set `GROQ_API_KEY` (free tier at groq.com), or `WORKERS_AI_ENABLED=true` on Cloudflare. The engine's grounded answer is passed to the LLM as the source of truth. If the LLM fails or runs out of quota, the engine answers on its own.

## 🎮 Crimson Arena (fun mode game)

Open **`/game/`** (or the *Crimson Arena* link in the sidebar). It's a side-scrolling arena brawler built from the project's sprite art. You hold the arena against dread knights, frost rogues and the Dread Knight boss.

**The game engine is C#.** `game/Engine` is a plain .NET class library holding the whole simulation. `game/Web` compiles it to **WebAssembly** with `[JSExport]`, so it runs in the browser. There is no server call and nothing to install. JavaScript only feeds it input and draws what it reports.

| Part | What it does |
| --- | --- |
| **Movement & physics** (`World.cs`) | Fixed 120 Hz timestep, gravity, acceleration and friction. Coyote time, jump buffering, variable jump height, air dash |
| **Combat** (`Attacks.cs`) | Frame data for every attack (windup → active → recovery), a combo chain and cancel windows. Also hit-stop, knockback, poise/stagger, i-frames and **Perfect dodge** slow-mo |
| **Enemy AI** (`Ai/Brain.cs`) | A **utility AI**: each enemy scores approach / attack / retreat / strafe / evade / wait-turn from what it perceives. Enemies avoid armed spike traps and never lunge across one. **Attack tokens** stop a crowd from all swinging at once |
| **AI Director** (`Ai/Director.cs`) | Adjusts difficulty on the fly. It scores each wave (health, damage taken, speed, accuracy) and tunes enemy reaction time, how many may attack at once, wave size and health drops. A struggling player gets mercy, a dominant one gets a ruthless arena |
| **Waves & world** | Knights, rogues and a boss every 5th wave (enrages at half health and calls for help). Spike traps hurt everyone, and trap kills pay a bonus. Also a combo score multiplier and pickups |
| **Deterministic** | Seeded RNG: the same seed and inputs replay the exact same game (tested) |

**Controls:** `A`/`D` or arrows move (hold `Shift` to walk), `Space` jumps, `J` attacks, `K` heavy, `L` dash and `U` special. `V` toggles **AI vision**, which shows every enemy's current decision and who holds an attack token. `Esc` pauses and `M` mutes. Gamepads work, and phones get on-screen touch controls.

**Juice:** parallax gothic backdrop, sprite animation matched to the attack frame data, particles, screen shake, damage numbers and hit flashes. It also has telegraph glows so attacks can be read, synthesized WebAudio sound effects, an adaptive music loop, and a high score saved locally. If a device renders slowly, the resolution drops automatically.

**Rebuilding the engine** (only after changing `game/`; the compiled output in `public/game/engine/` is committed, so deploys never need .NET):

```bash
npm run game:test     # C# unit tests + a 120-run bot soak test (needs the .NET 10 SDK)
npm run game:build    # dotnet publish -> public/game/engine/_framework
```

Sprites are cut from the source sheets in `game/art/source/` by `game/art/extract.py` (background removal, frame slicing, foot anchoring, WebP atlases).

## 📊 Tested results

- **89 automated tests** (`npm test`): engine math, bias detection, NLU accuracy on 17 phrasings including typos, Monte Carlo determinism, CSV parsing, every API route, the Vercel entry point and prompt-injection protection.
- **Big data:** the test suite analyses **5,000 trades** with no NaN anywhere. In the browser, the "Big data: 2,000 trades" demo is analysed in about 30 ms.
- **Fast on the free tier:** on the server, a coach answer on the 160-trade demo takes about 3 ms of CPU (under 1 ms when cached) and about 7 ms at 1,000 trades, inside Cloudflare's free CPU budget. Dashboards are computed in the browser.
- **Verified end to end** in Chromium: Cloudflare (`wrangler dev` + D1), the Node server (no database, so local mode), and static-only hosting (offline mode), in light and dark themes and at mobile width, with no console errors.
- **Game engine:** 38 C# tests covering physics, combat, AI, traps, waves, the Director, determinism and the snapshot format, plus a soak test. In it, a bot plays **120 full runs (676k frames)** with every frame checked against the engine's invariants. The engine runs about **5,000× faster than real time** in .NET and about 400× in the browser's WebAssembly. `npm test` also boots the real WebAssembly build under Node and plays it.
- **Game in the browser:** played end to end by an automated keyboard bot (wave 4 reached), with touch controls tested on phone viewports in both orientations. The engine loads in under a second.

## 🚀 Deploy (free)

Pick any one. The dashboard and API deploy together from this repo.

### Option 1: Cloudflare Workers (recommended, persistent D1 database)

```bash
npm install
npx wrangler login
npm run deploy        # creates the D1 database automatically on first deploy
```

Open the printed `https://alpha-ai-trader.<you>.workers.dev`. For automatic deploys, connect the repo in the Cloudflare dashboard (*Workers & Pages → Create → Import a repository*), or add the `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets to use `.github/workflows/ci.yml`.

### Option 2: Vercel (Hobby plan)

1. Import the repo at [vercel.com/new](https://vercel.com/new) (or push to your connected repo).
2. Keep the defaults. `vercel.json` configures everything: `public/` is served as the site and `api/index.js` becomes the API function.
3. Deploy.

> **Fixed:** earlier versions crashed on Vercel with `500 FUNCTION_INVOCATION_FAILED`. Vercel's Hono preset loaded `src/app.js`, which did not default-export an app. Now `vercel.json` defines an explicit function entry, and `src/app.js` also default-exports the app, so both setups work. Vercel has no free database here, so the dashboard automatically keeps your trades in the browser.

### Option 3: Any Node host (Render, Railway, Fly, a VPS)

```bash
npm install --omit=dev
npm start             # serves the dashboard + API on $PORT (default 3000)
```

### Option 4: Static hosting only (GitHub Pages, Netlify drop)

Upload the `public/` folder. With no API, the app runs fully in the browser (offline mode) using the same Alpha Engine.

## 💻 Local development

```bash
npm install
npm run dev           # Cloudflare runtime + local D1 at http://localhost:8787
# or
npm start             # plain Node server at http://localhost:3000
npm test              # 89 tests (includes the game's WebAssembly engine)
npm run check         # bundle the Worker exactly as `wrangler deploy` would
```

Copy `.dev.vars.example` to `.dev.vars` for optional local secrets.

## ⚙️ Configuration

Everything is optional. On Cloudflare, set these in `wrangler.jsonc` → `vars` or with `wrangler secret put`. On Vercel/Node, use environment variables.

| Name | Default | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | – | Optional: a Groq LLM polishes the engine's answers |
| `WORKERS_AI_ENABLED` | `false` | Cloudflare only: `true` lets Workers AI polish answers |
| `USE_MOCK_AI` / `AI_PROVIDER=alpha` | – | Force engine-only answers even if an LLM is configured |
| `ADMIN_TOKEN` | – | Bearer token for `GET /api/session/admin/sessions` (disabled when unset) |
| `CORS_ORIGIN` | `*` | Comma-separated origins allowed to call `/api/*` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `60` / `60000` | Per-IP limit on `/api/coach/*` |
| `ENVIRONMENT` | `production` | `development` shows error details |

## 🌐 API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health`, `/api/health` | Status, platform, engine, AI mode, storage (`d1` / `memory`) |
| GET | `/api/trades?symbol=&startDate=&endDate=` | List trades (newest first) |
| POST | `/api/trades` | Add a trade: `symbol`, `type` (`buy`/`sell`/`long`/`short`), `entryPrice`, `exitPrice`, `positionSize`, optional `stopLoss`, `takeProfit`, `duration`, `notes`, `timestamp` |
| POST | `/api/trades/import` | Bulk import `{ trades: [...] }` (up to 1,000) |
| PUT / DELETE | `/api/trades/:id` | Update (profit recomputed) / delete |
| GET | `/api/trades/stats/summary` | Full Alpha Engine report: stats, equity, breakdowns, biases, DNA, Monte Carlo, insights |
| GET | `/api/history` | History view with period comparison |
| POST | `/api/coach/chat` | `{ message, sessionId? , trades? }` → `{ reply, intent, confidence, highlights, source }` |
| POST | `/api/coach/analyze/:tradeId` | Analyse one trade |
| POST | `/api/coach/advice` | `{ marketContext }` → short coaching |
| GET | `/api/coach/biases` | Bias report + summary |
| GET/POST/PUT/DELETE | `/api/session/...` | Chat sessions (`user`/`assistant` roles only) |

## 📁 Project structure

```
.
├── public/                 # the site (served statically everywhere)
│   ├── index.html
│   ├── css/app.css         # design system (light + dark)
│   ├── js/                 # app controller, SVG charts, data layer, icons
│   ├── engine/             # Alpha Engine, shared by browser and server
│   └── game/               # Crimson Arena: canvas client, sprites, compiled C# engine
├── game/                   # C# game engine source
│   ├── Engine/             # simulation: physics, combat, AI brain + director
│   ├── Engine.Tests/       # xUnit tests + bot soak test
│   ├── Web/                # WebAssembly host ([JSExport])
│   └── art/                # source sprite sheets + extractor
├── src/                    # API (Hono): routes, storage (D1 / memory), optional LLMs
├── api/index.js            # Vercel function entry
├── scripts/serve.mjs       # plain Node server (npm start)
├── scripts/build-game.mjs  # compiles the C# engine to WebAssembly
├── vercel.json             # Vercel config
├── wrangler.jsonc          # Cloudflare config
└── test/                   # node:test suites
```

---

*Educational tool, not financial advice.*
