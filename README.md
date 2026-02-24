```markdown
# Alpha AI Trader 🧠📈

> **AI-Powered Trading Coach | Psychological Bias Detection | Real-time Market Analysis**

[![Live Demo](https://img.shields.io/badge/demo-live-blue?style=for-the-badge)](https://alpha-ai-trader.pages.dev)
[![Backend API](https://img.shields.io/badge/api-backend-green?style=for-the-badge)](https://alpha-ai-trader.onrender.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](/LICENSE)

---

## 📋 Project Overview

**Alpha AI Trader** is a production-ready, full-stack AI trading assistant designed to help traders identify psychological biases, improve decision-making, and maximize performance. Built with a clean, modern architecture and deployed at zero cost, it combines real-time market data with advanced AI coaching.

> *"The best investment you can make is in yourself." — Warren Buffett*

🔗 **Live Frontend:** [https://alpha-ai-trader.pages.dev](https://alpha-ai-trader.pages.dev)  
🔗 **Backend API:** [https://alpha-ai-trader.onrender.com](https://alpha-ai-trader.onrender.com)  
🔗 **Health Check:** [https://alpha-ai-trader.onrender.com/health](https://alpha-ai-trader.onrender.com/health)

---

## ✨ Features

### 🤖 AI Trading Coach
- Real-time buy/sell signals with market context
- Personalized coaching based on individual trading history
- Psychological bias detection: loss aversion, overconfidence, revenge trading
- Trade analysis with confidence scoring and improvement suggestions

### 📊 Performance Dashboard
- Live P&L tracking with interactive charts
- Win rate analytics (24H, 30D, All-time)
- Risk score assessment (1–10)
- Portfolio value monitoring

### 🧠 Behavioral Psychology Engine
- **Loss Aversion:** Flags when holding losers too long
- **Overconfidence:** Alerts after winning streaks
- **Revenge Trading:** Detects emotional trading after losses
- Actionable advice delivered in real time

### ⚡ Real-time Market Data
- Live prices for BTC/USD, ETH/USD
- Volatility signals with entry/exit suggestions
- RSI, MACD, and market sentiment indicators
- Portfolio updates without page refresh

### 🛡️ Bias Detection System

| Bias | Detection Method | Recommended Solution |
|------|------------------|----------------------|
| Loss Aversion | Holding losers 2× longer than winners | Set strict stop losses |
| Overconfidence | Increasing position size after wins | Consistent position sizing |
| Revenge Trading | Trading immediately after losses | Mandatory 1-hour break |
| Confirmation Bias | Ignoring contrary signals | Seek opposing evidence |
| Anchoring | Fixating on entry price | Use trailing stops |

---

## 🏗️ Architecture

```

┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Pages (Frontend)               │
│           https://alpha-ai-trader.pages.dev                 │
├─────────────────────────────────────────────────────────────┤
│  • Vanilla JavaScript + CSS3                                │
│  • Canvas charts & dark/light theme                         │
│  • Offline-ready with localStorage                          │
│  • Fully responsive                                         │
└───────────────────────┬─────────────────────────────────────┘
│ HTTPS API Calls
▼
┌─────────────────────────────────────────────────────────────┐
│                    Render.com (Backend)                      │
│           https://alpha-ai-trader.onrender.com               │
├─────────────────────────────────────────────────────────────┤
│  • Express.js REST API                                       │
│  • Groq AI integration with fallback mock system            │
│  • Trade analysis & statistics                               │
│  • Rate limiting & CORS                                      │
└─────────────────────────────────────────────────────────────┘

```

---

## 🔌 API Endpoints

All endpoints are prefixed with `/api` and return JSON.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/` | API information |
| `GET` | `/trades` | List all trades |
| `POST` | `/trades` | Add a new trade |
| `GET` | `/trades/stats/summary` | Trading statistics |
| `POST` | `/coach/advice` | Get AI coaching |
| `GET` | `/coach/biases` | Detect psychological biases |
| `GET` | `/history` | Complete trade history |
| `GET` | `/session/:id` | Session management |

---

## 🚀 Deployment

### Frontend (Cloudflare Pages)
1. Connect your GitHub repository
2. Set build command: (none – static site)
3. Set output directory: `frontend`
4. Deploy automatically on push

### Backend (Render.com)
1. Create a new Web Service
2. Connect your GitHub repository
3. Build command: `cd backend && npm install`
4. Start command: `cd backend && node app.js`
5. Add environment variables if using a real API key

---

## 🎯 Demo Instructions

### Without API Key (Mock Mode)
- All AI features work with simulated responses
- Perfect for testing and demonstrations
- No rate limits or costs

### With Groq API Key
1. Obtain a free API key from [GroqCloud](https://console.groq.com)
2. Add to backend `.env`:
```

GROQ_API_KEY=your_key_here

```
3. Enjoy real AI‑powered coaching

### Quick Start
1. **Add a trade:** Click "Add Trade" → enter symbol, prices, notes
2. **Get advice:** Type questions like "Should I buy BTC now?"
3. **Monitor:** Watch live P&L and bias alerts

---

## 🧪 Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | HTML5, CSS3 (variables), Vanilla JavaScript, Canvas API |
| **Backend**  | Node.js, Express.js, CORS, Helmet, express-rate-limit |
| **AI**       | Groq API (with fallback mock system) |
| **Hosting**  | Cloudflare Pages + Render.com (both free tier) |
| **Data**     | In‑memory with localStorage for persistence |

---

## 🛤️ Future Roadmap

- [ ] Multi-language support
- [ ] TradingView chart integration
- [ ] Telegram/Discord bot for real‑time alerts
- [ ] Social trading features
- [ ] Mobile app (React Native)
- [ ] Paper trading simulator
- [ ] Advanced AI models (GPT‑4, Claude)
- [ ] CSV/PDF export for trading journals

---

## 📄 License

This project is open‑source and available under the [MIT License](/LICENSE).

---

## 🙏 Acknowledgements

- Built for an **AI Trading Hackathon Challenge**
- [Groq Cloud](https://groq.com) for AI inference API
- [Render.com](https://render.com) for free backend hosting
- [Cloudflare Pages](https://pages.cloudflare.com) for free frontend hosting
- Open‑source contributors and trading psychology researchers

---

> **Ready to improve your trading psychology?**  
> [Launch Alpha AI Trader](https://alpha-ai-trader.pages.dev)  
> [Report an issue](https://github.com/zahid397/alpha-ai-trader/issues)  
> [Request a feature](https://github.com/zahid397/alpha-ai-trader/discussions)

---

⭐ **If you find this project valuable, consider giving it a star!**  
```
