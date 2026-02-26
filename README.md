```markdown
<div align="center">
  <h1>🚀 Alpha AI Trader</h1>
  <p><strong>AI-Powered Trading Coach for Psychology & Performance</strong></p>
  
  <!-- Badges -->
  <p>
    <a href="https://alpha-ai-trader.zh05698.workers.dev/">
      <img src="https://img.shields.io/badge/demo-live-brightgreen?style=for-the-badge&logo=vercel" alt="Demo Live">
    </a>
    <a href="https://deriv-ai-trade-coach.onrender.com/health">
      <img src="https://img.shields.io/badge/api-available-blue?style=for-the-badge&logo=render" alt="API Available">
    </a>
    <a href="https://github.com/zahid397/alpha-ai-trader/blob/main/LICENSE">
      <img src="https://img.shields.io/github/license/zahid397/alpha-ai-trader?style=for-the-badge" alt="License">
    </a>
    <img src="https://img.shields.io/badge/version-1.0.0-purple?style=for-the-badge" alt="Version">
  </p>
  
  <!-- Links -->
  <p>
    <a href="#overview">Overview</a> •
    <a href="#features">Features</a> •
    <a href="#live-demo">Live Demo</a> •
    <a href="#architecture">Architecture</a> •
    <a href="#team">Team</a>
  </p>
</div>

---

## 📋 Overview

Alpha AI Trader is a full‑stack application that combines **real‑time market data** with **behavioral psychology** to coach traders. It detects cognitive biases—such as loss aversion, overconfidence, and revenge trading—and delivers personalized advice to improve trading discipline. Built for the **AI Trading Hackathon Challenge**, it demonstrates how AI can transform emotional decision‑making into consistent performance.

> **Why Alpha AI Trader?**  
> Most traders fail because of emotions, not strategy. Our AI coach analyzes your trades, identifies psychological patterns, and gives actionable feedback—helping you become a more disciplined, profitable trader.

---

## ✨ Features

### 🧠 AI Coaching Engine
- **Real‑time trade analysis** – Get instant feedback on every trade.
- **Buy/sell signals** – Based on market conditions (RSI, MACD, volatility).
- **Personalized recommendations** – Tailored advice to improve your strategy.

### 🧬 Psychological Bias Detection
- **Loss Aversion** – Identifies when you hold losers too long.
- **Overconfidence** – Detects increased risk‑taking after wins.
- **Revenge Trading** – Flags impulsive trades after losses.
- **Confirmation Bias** – Spots one‑sided analysis.
- **Anchoring** – Recognizes fixation on price levels.

### 📊 Advanced Analytics
- **Performance dashboard** – Win rate, profit factor, drawdown, and more.
- **Trade history** – Categorized by symbol, duration, and outcome.
- **Heatmaps** – Visualize your best trading times and symbols.
- **Pattern recognition** – Learn from your winning and losing streaks.

### 🌐 Live Market Data
- **Real‑time BTC/USD & ETH/USD** – Price, RSI, volume, sentiment.
- **Volatility alerts** – Get notified of potential breakout opportunities.
- **Support/resistance levels** – Key technical levels displayed.

---

## 🚀 Live Demo

Experience Alpha AI Trader right now:

| Frontend | Backend API |
|----------|-------------|
| [**alpha-ai-trader.zh05698.workers.dev**](https://alpha-ai-trader.zh05698.workers.dev/) | [**deriv-ai-trade-coach.onrender.com**](https://deriv-ai-trade-coach.onrender.com/health) |

The backend is hosted on **Render** (free tier) and may take a few seconds to wake up after inactivity. The frontend runs on **Cloudflare Workers** for lightning‑fast global access.

---

## 🏗️ Architecture

Alpha AI Trader follows a modern, serverless‑friendly architecture:

```

┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   Cloudflare    │  →   │   Express API    │  →   │   Groq AI       │
│   Worker        │      │   (Render)       │      │   (Llama/Mixtral)│
│   (Frontend)    │      │   /api/*         │      │                 │
└─────────────────┘      └──────────────────┘      └─────────────────┘
↓                         ↓                           ↓
Static HTML/CSS/JS         Trade data &          Market analysis
served via Worker          session storage       & coaching advice

```

**Tech Stack:**
- **Frontend:** Vanilla JavaScript, CSS3 (Flexbox/Grid), HTML5
- **Backend:** Node.js, Express.js, rate‑limiting, CORS, Helmet
- **AI:** Groq SDK (Llama3, Mixtral) with automatic fallback to mock AI
- **Data Storage:** JSON files (easily swappable with MongoDB/PostgreSQL)
- **Deployment:** Cloudflare Workers (frontend) + Render (backend)

---

## 🎯 How It Works

1. **Add your trades** – Manually enter or import from CSV/JSON.
2. **AI analyzes** – Every trade is evaluated for strengths, mistakes, and psychological biases.
3. **Get coaching** – Ask questions, request market outlook, or receive bias alerts.
4. **Track progress** – Watch your win rate, profit factor, and other metrics improve over time.

---

## 📸 Screenshots

*(Placeholder – actual screenshots would be inserted here)*

| Dashboard Overview | AI Coach Chat |
|--------------------|---------------|
| ![Dashboard](https://via.placeholder.com/400x250/0f172a/ffffff?text=Dashboard) | ![Chat](https://via.placeholder.com/400x250/1e293b/ffffff?text=AI+Chat) |

| Trade Analysis | Market Data |
|----------------|-------------|
| ![Analysis](https://via.placeholder.com/400x250/334155/ffffff?text=Trade+Analysis) | ![Market](https://via.placeholder.com/400x250/0c4a6e/ffffff?text=Market+Data) |

---

## 🧪 Local Development

Want to run Alpha AI Trader locally? Follow these steps:

### Prerequisites
- Node.js 18+ and npm
- (Optional) Groq API key from [console.groq.com](https://console.groq.com)

### Backend Setup
```bash
git clone https://github.com/zahid397/alpha-ai-trader.git
cd alpha-ai-trader/backend
npm install
cp .env.example .env
# Add your GROQ_API_KEY if desired
npm run dev
```

Frontend Setup

The frontend is served as static files. You can open public/index.html directly or serve it with a simple HTTP server:

```bash
cd ../public
npx serve
```

The backend will be available at http://localhost:3000 and the frontend at http://localhost:5000 (or similar).

---

📡 API Reference

All API endpoints are prefixed with /api.

Method Endpoint Description
GET /trades Retrieve all trades
POST /trades Add a new trade
GET /trades/stats/summary Get performance statistics
POST /coach/advice Get AI coaching advice
GET /coach/biases Detect psychological biases
GET /history Full trading history with analytics
GET /session/:id Get or create coaching session

Full API documentation is available via the /api endpoint of the live backend.

---

👤 Team

Role Name Links
Sole Developer & Designer Zahid Hasan GitHub · LinkedIn

Built with ❤️ for the AI Trading Hackathon Challenge.

---

📄 License

Distributed under the MIT License. See LICENSE for more information.

---

🙏 Acknowledgments

· Groq for lightning‑fast AI inference
· Render for reliable backend hosting
· Cloudflare Workers for edge static serving
· The open‑source community for countless inspiration and tools

---

<div align="center">
  <p>
    <a href="https://alpha-ai-trader.zh05698.workers.dev/">🌐 Live Demo</a> •
    <a href="https://github.com/zahid397/alpha-ai-trader">📦 GitHub</a> •
    <a href="https://github.com/zahid397/alpha-ai-trader/issues">🐛 Issues</a>
  </p>
  <p>⭐ Star us on GitHub – it really helps! ⭐</p>
  <p><em>“The goal of a successful trader is to make the best trades. Money is secondary.” – Alexander Elder</em></p>
  <br/>
  <img src="https://img.shields.io/badge/made%20with-❤️%20and%20JavaScript-orange" alt="Made with love and JavaScript">
</div>
```
