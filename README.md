# alpha-ai-trader

> AI trading coach that analyses your trade journal for behavioural biases (loss aversion, revenge trading, overconfidence, FOMO) and coaches you on discipline. Full stack, running entirely on the **Cloudflare free tier**.

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white) ![Hono](https://img.shields.io/badge/Hono-E36002?style=for-the-badge&logo=hono&logoColor=white) ![D1](https://img.shields.io/badge/Cloudflare_D1-F38020?style=for-the-badge&logo=sqlite&logoColor=white) ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

## 📑 Table of Contents

- [Description](#-description)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Deploy to Cloudflare (free)](#-deploy-to-cloudflare-free)
- [Local Development](#-local-development)
- [Configuration](#-configuration)
- [API Endpoints](#-api-endpoints)
- [Project Structure](#-project-structure)
- [Testing](#-testing)
- [Contributing](#-contributing)

## 📝 Description

Most trading tools focus on market signals. Alpha AI Trader focuses on the trader. It reads your trades (entry, exit, stop loss, size, notes) and detects psychological biases from how you actually behave. For example, it notices when you close losers beyond your planned stop, size up right after a loss, or enter on FOMO. It then scores your risk and coaches you through an AI chat.

## ✨ Key Features

- **🧠 Behavioural bias detection:** rule-based and deterministic. It detects loss aversion (stops not honoured, losers held longer, notes like "hoping for recovery"), revenge trading, overconfidence, FOMO entries and missing stop losses, each with evidence and a fix.
- **🛡️ Risk score:** a 0–100 score computed from biases, profit factor, win rate and streaks. There is no randomness.
- **🤖 AI coach chat:** answers questions using your real stats. Conversations are saved per browser session in D1.
- **🔁 Free AI fallback chain:** Groq (if you add a key) → Cloudflare Workers AI (free, no key) → built-in rules engine. The coach never goes offline.
- **🔍 One-click trade analysis:** plan adherence score, R-multiple, stop-loss discipline and suggestions for any trade.
- **📊 Dashboard:** net P/L, win rate, expectancy, risk score, behavioural insights and a trade table. It works on mobile.
- **🔐 Safe prompt roles:** system prompts live on the server only. Clients can send only `user`/`assistant` messages, so they can't inject a `system` prompt.

## 🏗 Architecture

```
Browser ──► Cloudflare Worker (one deploy, one URL)
            ├── Static Assets  → public/ (dashboard: HTML/CSS/JS)
            └── Hono API       → /api/*, /health
                 ├── D1 (SQLite)       trades + chat sessions
                 ├── Groq API          optional, primary AI
                 ├── Workers AI        free AI fallback
                 └── Rules engine      always-available fallback
```

The frontend and API share an origin, so there is no API URL to configure and no CORS setup. The D1 schema and demo trades are created automatically on the first request.

## 🚀 Deploy to Cloudflare (free)

Everything fits the **Workers Free** plan: no credit card is needed.

| Service | Free allowance |
| --- | --- |
| Workers | 100,000 requests/day |
| Static Assets | Free and unlimited (don't count as Worker requests) |
| D1 database | 5 GB storage, 5M rows read / 100k rows written per day |
| Workers AI | 10,000 neurons/day |

### One-time deploy from your machine

Requires Node.js 22+ and a free [Cloudflare account](https://dash.cloudflare.com/sign-up).

```bash
git clone https://github.com/zahid397/alpha-ai-trader.git
cd alpha-ai-trader
npm install

npx wrangler login     # opens the browser once
npm run deploy         # creates the D1 database automatically and deploys
```

Wrangler prints your URL, e.g. `https://alpha-ai-trader.<your-subdomain>.workers.dev`. Open it and the dashboard loads with demo trades.

**Optional extras:**

```bash
# Use Groq (free key at https://console.groq.com/keys) as the primary AI model
npx wrangler secret put GROQ_API_KEY

# Enable the admin endpoint GET /api/session/admin/sessions
npx wrangler secret put ADMIN_TOKEN
```

Without `GROQ_API_KEY`, the coach uses Workers AI (free). If that quota runs out, it uses the rules engine.

### Automatic deploys on every push (pick one)

**Option A: Cloudflare Workers Builds (simplest).** In the Cloudflare dashboard go to *Workers & Pages → Create → Import a repository*, choose this repo, keep the deploy command `npx wrangler deploy`, and save. Every push to `main` then deploys.

**Option B: GitHub Actions.** The included workflow (`.github/workflows/ci.yml`) runs the tests on every PR and deploys `main`. Add two repository secrets under *Settings → Secrets and variables → Actions*:

- `CLOUDFLARE_ACCOUNT_ID`: shown on the right side of the Cloudflare dashboard *Workers & Pages* overview.
- `CLOUDFLARE_API_TOKEN`: create it at *My Profile → API Tokens* from the **Edit Cloudflare Workers** template, then add the permission *Account → D1 → Edit*.

Until those secrets exist, the deploy job only prints a notice.

## 💻 Local Development

```bash
npm install
cp .dev.vars.example .dev.vars   # optional: GROQ_API_KEY, ADMIN_TOKEN, ENVIRONMENT
npm run dev                      # http://localhost:8787
```

`npm run dev` runs the real Workers runtime locally with a local SQLite copy of D1 (stored in `.wrangler/`). It doesn't need a Cloudflare login. Workers AI is remote-only, so locally the coach uses Groq (if `GROQ_API_KEY` is in `.dev.vars`) or the rules engine. After `npx wrangler login`, use `npm run dev:ai` to call Workers AI from local dev.

## ⚙️ Configuration

Plain variables live in `wrangler.jsonc` → `vars`. Secrets go in `wrangler secret put` (production) or `.dev.vars` (local).

| Name | Type | Default | Purpose |
| --- | --- | --- | --- |
| `GROQ_API_KEY` | secret | – | Enables Groq as the primary AI provider |
| `ADMIN_TOKEN` | secret | – | Bearer token for the admin session list (disabled when unset) |
| `GROQ_MODEL` | var | `llama-3.3-70b-versatile` | Groq model id |
| `WORKERS_AI_MODEL` | var | `@cf/meta/llama-3.1-8b-instruct` | Workers AI model id |
| `USE_MOCK_AI` | var | `false` | `true` forces the rules engine |
| `WORKERS_AI_ENABLED` | var | `true` | `false` skips Workers AI (set automatically by `npm run dev`) |
| `CORS_ORIGIN` | var | `*` | Comma-separated allowed origins for `/api/*` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | var | `30` / `60000` | Per-IP limit on `/api/coach/*` |
| `ENVIRONMENT` | var | `production` | `development` exposes error details |

To host the frontend somewhere else, set `<meta name="api-base" content="https://your-worker.workers.dev">` in `public/index.html`.

## 🌐 API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health`, `/api/health` | Status, AI mode (`groq` / `workers-ai` / `rules`), storage (`d1` / `memory`) |
| GET | `/api` | API info and route list |
| GET | `/api/trades?symbol=&startDate=&endDate=` | List trades, newest first |
| GET | `/api/trades/stats/summary` | Stats, biases, patterns, risk score, heatmap |
| GET | `/api/trades/:id` | Single trade |
| POST | `/api/trades` | Add a trade: `symbol`, `type` (`buy`/`sell`/`long`/`short`), `entryPrice`, `exitPrice`, `positionSize`, optional `stopLoss`, `takeProfit`, `duration`, `notes`, `timestamp` |
| PUT | `/api/trades/:id` | Partial update (profit/status recomputed) |
| DELETE | `/api/trades/:id` | Delete a trade |
| GET | `/api/history` | Full history: period stats, symbol performance, chart data |
| POST | `/api/coach/chat` | `{ message, sessionId? }` → `{ reply, source }` |
| POST | `/api/coach/analyze/:tradeId` | Analyse one trade |
| POST | `/api/coach/advice` | `{ marketContext, traderProfile? }` → short coaching |
| GET | `/api/coach/biases` | Bias report + coaching summary |
| POST | `/api/coach/market-analysis` | Coaching on a **simulated** market snapshot |
| GET | `/api/session/:id?` | Get or create a chat session |
| GET | `/api/session/:id/history?type=&limit=` | Session messages |
| POST | `/api/session/:id/message` | Add a `user`/`assistant` message |
| PUT | `/api/session/:id/metadata` | Merge session metadata |
| DELETE | `/api/session/:id/messages` | Clear a conversation |
| GET | `/api/session/admin/sessions` | All sessions (`Authorization: Bearer <ADMIN_TOKEN>`) |

Example:

```bash
curl -X POST https://alpha-ai-trader.<your-subdomain>.workers.dev/api/coach/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"What is my biggest weakness?"}'
```

## 📁 Project Structure

```
.
├── src/
│   ├── index.js              # Worker entry
│   ├── app.js                # Hono app: middleware, routes, errors
│   ├── config.js             # env → config, AI mode
│   ├── routes/               # trades, coach, history, session
│   ├── services/
│   │   ├── tradeAnalyzer.js  # stats, patterns, bias detection, risk score
│   │   ├── tradeModel.js     # trade validation + profit/status
│   │   ├── coachService.js   # AI features + rule-based fallbacks
│   │   ├── promptBuilder.js  # server-side system prompts
│   │   ├── aiService.js      # Groq → Workers AI provider chain
│   │   └── sessionService.js # chat sessions / roles
│   ├── storage/              # D1 store, in-memory store (fallback + tests)
│   ├── middleware/           # rate limit, admin auth
│   └── lib/http.js
├── public/                   # dashboard (served as static assets)
├── data/sampleTrades.json    # demo trades seeded into D1 on first run
├── test/                     # node:test suites
├── wrangler.jsonc            # Cloudflare config
└── .github/workflows/ci.yml  # tests + optional deploy
```

## 🧪 Testing

```bash
npm test        # unit + API tests (Node's built-in test runner, no extra deps)
npm run check   # bundle the Worker exactly as `wrangler deploy` would, without uploading
```

## 👥 Contributing

1. Fork the repository and create a branch: `git checkout -b feature/your-feature`
2. Make your change and run `npm test`
3. Open a pull request

---

*Educational tool, not financial advice.*
