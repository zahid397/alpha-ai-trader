🤖 Alpha AI Trader

<div align="center">

AI‑Powered Trading Coach for Psychology & Performance

https://img.shields.io/badge/demo-live-brightgreen?style=for-the-badge&logo=vercel
https://img.shields.io/badge/api-available-blue?style=for-the-badge&logo=render
https://img.shields.io/github/license/zahid397/alpha-ai-trader?style=for-the-badge
https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge

</div>

---

📖 About The Project

Alpha AI Trader is a full‑stack application that combines real‑time market data with behavioral psychology to coach traders. It detects cognitive biases—such as loss aversion, overconfidence, and revenge trading—and delivers personalized advice to improve trading discipline. Built for the AI Trading Hackathon Challenge, it demonstrates how AI can transform emotional decision‑making into consistent performance.

🔗 Live Demo: alpha-ai-trader.zh05698.workers.dev
🔗 Backend API: deriv-ai-trade-coach.onrender.com

---

✨ Features

🧠 AI Coaching Engine

· Real‑time analysis of your trading activity
· Buy/sell signals based on market conditions (RSI, MACD, volatility)
· Personalized coaching messages in natural language

🎯 Bias Detection

· Loss Aversion – identifies reluctance to cut losses
· Overconfidence – flags excessive risk after winning streaks
· Revenge Trading – detects emotionally driven trades after losses
· Confirmation Bias – spots one‑sided analysis
· Anchoring – warns about fixation on entry prices

📊 Performance Dashboard

· Live P&L, win rate, and portfolio value
· Interactive charts for cumulative profit/loss
· Risk meter and volatility alerts

🔌 Flexible AI Integration

· Uses Groq API (Llama, Mixtral) for intelligent responses
· Graceful fallback to mock AI when no API key is provided – perfect for testing and demos

---

🛠️ Tech Stack

Frontend Backend AI / ML Deployment
HTML5, CSS3, Vanilla JS Node.js, Express.js Groq SDK Cloudflare Workers (frontend)
Custom CSS variables REST API Prompt Engineering Render (backend)
Canvas for charts Rate limiting Bias detection algorithms 

---

🚀 Getting Started

Prerequisites

· Node.js 18+ and npm
· (Optional) Groq API key for live AI mode

Installation

1. Clone the repository
   ```bash
   git clone https://github.com/zahid397/alpha-ai-trader.git
   cd alpha-ai-trader
   ```
2. Install backend dependencies
   ```bash
   cd backend
   npm install
   ```
3. Set up environment variables
   ```bash
   cp .env.example .env
   # Edit .env – add your GROQ_API_KEY if you have one
   ```
4. Run the backend locally
   ```bash
   npm run dev
   # Backend will be available at http://localhost:3000
   ```
5. Serve the frontend
   · Open public/index.html in your browser, or
   · Use a local server (e.g., npx serve public)

---

🧪 Usage

1. Add your trades – manually enter trades via the dashboard or use the provided sample data.
2. Talk to the AI Coach – ask questions like “Analyze my recent trades” or “What’s the market outlook?”
3. Review bias alerts – the system continuously scans your trading behavior and flags psychological pitfalls.
4. Monitor performance – watch your win rate, profit factor, and risk score evolve over time.

https://via.placeholder.com/800x450?text=Dashboard+Screenshot+Placeholder

---

📡 API Reference

All API endpoints are prefixed with /api. The backend is hosted at https://deriv-ai-trade-coach.onrender.com.

Method Endpoint Description
GET /trades Get all trades
POST /trades Add a new trade
GET /trades/stats Get performance statistics
POST /coach/analyze/:tradeId Analyze a specific trade
POST /coach/advice Get coaching advice based on market context
GET /coach/biases Detect psychological biases from trade history
GET /history Full historical data with charts and patterns

📘 Full API documentation is available here.

---

🌐 Deployment

Frontend (Cloudflare Workers)

The frontend is deployed as a static site on Cloudflare Workers.
To deploy your own:

```bash
cd public
npx wrangler pages publish . --project-name=alpha-ai-trader
```

Backend (Render)

The backend is deployed on Render’s free tier.
To deploy:

1. Push your code to a GitHub repository.
2. Create a new Web Service on Render.
3. Connect the repo, set build command to cd backend && npm install, start command to cd backend && node app.js.
4. Add environment variables (GROQ_API_KEY, etc.) in the Render dashboard.

---

🤝 Contributing

Contributions are what make the open‑source community such an amazing place to learn, inspire, and create. Any contributions you make are greatly appreciated.

1. Fork the Project
2. Create your Feature Branch (git checkout -b feature/AmazingFeature)
3. Commit your Changes (git commit -m 'Add some AmazingFeature')
4. Push to the Branch (git push origin feature/AmazingFeature)
5. Open a Pull Request

---

📄 License

Distributed under the MIT License. See LICENSE for more information.

---

📬 Contact

Zahid – @zh05698 – zahid@example.com

Project Link: https://github.com/zahid397/alpha-ai-trader

---

⚠️ Disclaimer

Alpha AI Trader is an educational tool. It does not constitute financial advice. Trading involves risk; never invest more than you can afford to lose. Always consult a qualified financial advisor.

---

<div align="center">
  Made with ❤️ by a solo developer for the AI Trading Hackathon
</div>
