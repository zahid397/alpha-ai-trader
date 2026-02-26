```markdown
<div align="center">

# Alpha AI Trader 🧠📈

### AI-Powered Trading Coach for Psychology & Performance

[![Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://alpha-ai-trader.zh05698.workers.dev/)
[![API](https://img.shields.io/badge/api-available-blue)](https://deriv-ai-trade-coach.onrender.com)
[![License](https://img.shields.io/github/license/zahid397/alpha-ai-trader)](LICENSE)
[![Made with](https://img.shields.io/badge/made%20with-Node.js%20%7C%20JavaScript-43853d)]()

</div>

---

## 📋 Overview

Alpha AI Trader is a full‑stack application that combines **real‑time market data** with **behavioral psychology** to coach traders. It detects cognitive biases (loss aversion, overconfidence, revenge trading) and delivers personalized advice to improve trading discipline. Built for the AI Trading Hackathon Challenge, it demonstrates how AI can transform emotional decision‑making into consistent performance.

---

## ✨ Features

### 🧠 AI Coaching Engine
- Real‑time analysis of your trading activity
- Buy/sell signals based on market conditions (RSI, MACD, volatility)
- Personalized recommendations to overcome psychological biases

### 📊 Performance Analytics
- Track win rate, profit factor, drawdowns
- Interactive P&L charts
- Trade categorization (scalp, swing, long‑term)

### ⚡ Live Market Data
- BTC/USD and ETH/USD real‑time updates
- Support/resistance levels
- Volume and sentiment indicators

### 🚀 Deployment Ready
- Frontend hosted on **Cloudflare Workers** – ultra‑fast global delivery
- Backend hosted on **Render** – scalable and reliable

---

## 🌐 Live Demo

| Frontend | Backend API |
|----------|-------------|
| [🔗 alpha-ai-trader.zh05698.workers.dev](https://alpha-ai-trader.zh05698.workers.dev/) | [🔗 deriv-ai-trade-coach.onrender.com](https://deriv-ai-trade-coach.onrender.com) |

> ⚠️ **Note:** The backend may take a few seconds to wake up on first request (free tier). Please be patient.

---

## 🛠️ Tech Stack

| Layer       | Technology                                                                 |
|-------------|----------------------------------------------------------------------------|
| **Frontend**| HTML5, CSS3 (custom design with modern grid/flexbox), vanilla JavaScript   |
| **Backend** | Node.js, Express.js                                                        |
| **AI**      | Groq API (Llama 3, Mixtral) – with automatic fallback to mock AI          |
| **Hosting** | Cloudflare Workers (frontend), Render (backend)                            |
| **Storage** | JSON file (easily upgradeable to MongoDB/PostgreSQL)                       |

---

## 🚀 Quick Start (Local Development)

```bash
# Clone the repository
git clone https://github.com/zahid397/alpha-ai-trader.git
cd alpha-ai-trader

# Install backend dependencies
cd backend
npm install

# Create .env file (optional, for Groq API key)
cp .env.example .env

# Start development server
npm run dev
```

Then open http://localhost:3000 in your browser.

---

📡 API Endpoints (Selection)

Method Endpoint Description
GET /api/trades Retrieve all trades
POST /api/trades Add a new trade
GET /api/trades/stats Get performance statistics
POST /api/coach/advice Get AI coaching based on market context
GET /api/coach/biases Detect psychological biases from trades
GET /api/history Full trading history with analytics

Full API documentation is available at the backend root.

---

🧪 Bias Detection Engine

Alpha AI Trader uses advanced algorithms to detect common trading psychology pitfalls:

Bias Description Detection Method
Loss Aversion Holding losing positions too long Duration & profit/loss ratio analysis
Overconfidence Taking excessive risk after wins Position size changes, win streaks
Revenge Trading Impulsive trades after losses Timing analysis, increased frequency
Confirmation Bias Ignoring contrary signals Direction consistency check
Anchoring Fixating on entry/exit levels Price deviation analysis

---

👤 Team

· Zahid – Sole developer, designer, and AI enthusiast
    GitHub · LinkedIn · Twitter

---

📄 License

This project is licensed under the MIT License – see the LICENSE file for details.

---

🙏 Acknowledgments

· Groq for lightning‑fast AI inference
· Render and Cloudflare Workers for free hosting
· The trading community for continuous inspiration

---

<div align="center">

⭐ If you like this project, please give it a star on GitHub! ⭐

Report Bug · Request Feature

</div>
```
