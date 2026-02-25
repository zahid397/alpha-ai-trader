Alpha AI Trader

AI-Powered Trading Coach for Psychology & Performance

https://img.shields.io/badge/demo-live-brightgreen
https://img.shields.io/badge/api-available-blue
https://img.shields.io/github/license/zahid397/alpha-ai-trader

---

Project Overview

Alpha AI Trader is a full‑stack application that combines real‑time market data with behavioral psychology to coach traders. It detects cognitive biases (loss aversion, overconfidence, revenge trading) and delivers personalized advice to improve trading discipline. Built for the AI Trading Hackathon Challenge, it demonstrates how AI can transform emotional decision‑making into consistent performance.

---

Features

🧠 AI Coaching Engine

· Real‑time analysis of your trading activity
· Buy/sell signals based on market conditions (RSI, MACD, volatility)
· Personalised coaching messages that address your specific psychological patterns

📊 Performance Dashboard

· Live P&L tracking with visual charts
· Win rate (24h, 30d, all‑time)
· Risk score (1‑10) calculated from trade behaviour
· Portfolio value updates in real time

🔍 Behavioural Bias Detection

· Loss Aversion – detects if you hold losers too long
· Overconfidence – alerts when winning streaks inflate position sizes
· Revenge Trading – flags emotional trades after a loss
· Confirmation Bias – warns when you ignore contradictory signals
· Actionable advice for each bias

📈 Trade Analysis

· Detailed post‑trade reviews with AI commentary
· Entry/exit visualisation on price charts
· Confidence score for each analysis
· Improvement suggestions (e.g. tighter stops, better entries)

⚡ Real‑time Market Data

· Live prices for BTC/USD, ETH/USD
· Volatility alerts with buy/sell recommendations
· RSI, MACD, and other technical indicators

---

Architecture

The application follows a clean client‑server separation:

```
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Pages (Frontend)               │
│            https://alpha-ai-trader.pages.dev                │
├─────────────────────────────────────────────────────────────┤
│ • Vanilla JavaScript (no framework, minimal overhead)       │
│ • CSS variables for light/dark theme                         │
│ • Canvas‑based charts (custom rendering)                     │
│ • Service Worker for offline capability                      │
│ • LocalStorage for data persistence                          │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTPS API calls
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                     Render.com (Backend)                     │
│           https://alpha-ai-trader.onrender.com               │
├─────────────────────────────────────────────────────────────┤
│ • Express.js REST API                                        │
│ • Groq AI integration (with fallback mock)                   │
│ • Trade analysis & statistics engine                          │
│ • Session management & rate limiting                          │
│ • CORS enabled for secure cross‑origin requests              │
└─────────────────────────────────────────────────────────────┘
```

Key design decisions:

· Frontend – static site on Cloudflare Pages for global low‑latency delivery.
· Backend – Node.js/Express on Render with auto‑scaling and free tier.
· AI – Groq API for real‑time coaching; fallback to local mock responses when API key is not set.

---

API Endpoints

All endpoints return JSON and are accessible at https://alpha-ai-trader.onrender.com.

Method Endpoint Description
GET /health Health check
GET /api API information
GET /api/trades List all trades
POST /api/trades Add a new trade
GET /api/trades/stats/summary Summary statistics
POST /api/coach/advice Request AI coaching
GET /api/coach/biases Detect psychological biases
GET /api/history Complete trading history
GET /api/session/:id Manage session data

---

Deployment

Frontend – Cloudflare Pages

1. Fork or clone this repository.
2. Log in to Cloudflare Pages and create a new project.
3. Connect your GitHub repository.
4. Set the build command to echo "Static site, no build required" (or leave empty).
5. Set the output directory to frontend.
6. Deploy – your site will be live at https://alpha-ai-trader.pages.dev.

Backend – Render.com

1. Create a new Web Service on Render.
2. Connect the same GitHub repository.
3. Set Build Command to cd backend && npm install.
4. Set Start Command to cd backend && node app.js.
5. Add environment variables (optional):
   · GROQ_API_KEY – your Groq API key for real AI responses.
6. Deploy – your API will be available at https://alpha-ai-trader.onrender.com.

---

Demo Instructions

1. Visit the live demo → alpha-ai-trader.zh05698.workers.dev
2. Add a trade – click "Add Trade", enter symbol (BTCUSD, ETHUSD) and price details.
3. Ask the coach – type questions in the chat panel, e.g. “Should I buy BTC?” or “Analyze my recent trades”.
4. Monitor your performance – the dashboard updates in real time, showing P&L, win rate, risk score, and bias alerts.
5. Review insights – the bias detection cards highlight psychological patterns and suggest improvements.

The app works out‑of‑the‑box with mock AI responses; for full Groq integration, set your own API key in the backend environment.

---

Bias Detection System

The AI continuously analyses your trading behaviour for common psychological pitfalls:

Bias Detection Method Recommended Solution
Loss Aversion Holding losers >2x longer than winners Set strict stop‑losses
Overconfidence Increased position size after consecutive wins Maintain consistent position sizing
Revenge Trading Trading immediately after a loss Enforce a mandatory 1‑hour cooldown
Confirmation Bias Ignoring signals that contradict your bias Seek out contrary evidence deliberately
Anchoring Fixating on the entry price Use trailing stops

Each detected bias triggers a real‑time alert with actionable advice.

---

Tech Stack

Layer Technology Purpose
Frontend HTML5, CSS3, Vanilla JavaScript Fast, lightweight UI
Charts Canvas API Custom performance visualisations
Backend Node.js, Express REST API & business logic
AI Groq SDK (with mock fallback) Real‑time coaching & analysis
Hosting Cloudflare Pages, Render Production‑grade, zero‑cost deployment
Data In‑memory / localStorage Simple persistence for demo

---

Future Roadmap

· 📱 Mobile app (React Native) for on‑the‑go coaching.
· 🔗 Telegram / Discord bot integration.
· 📊 Advanced charting with TradingView widgets.
· 👥 Social trading – compare stats with peers.
· 🧠 More AI models – GPT‑4, Claude, Gemini.
· 💼 Paper trading simulator to practice risk‑free.
· 📁 Export/import trading journal (CSV, PDF).

---

License

Distributed under the MIT License. See LICENSE for more information.

---

Acknowledgements

· Built for an AI Trading Hackathon Challenge
· Groq Cloud – for fast AI inference
· Render.com – free backend hosting
· Cloudflare Pages – free global frontend delivery
· Trading psychology researchers whose work inspired the bias detection algorithms

---

"The best investment you can make is in yourself." – Warren Buffett

🚀 Try Alpha AI Trader Now | 🐛 Report Issue | ⭐ Star on GitHub
