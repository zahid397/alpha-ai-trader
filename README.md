🤖 Alpha AI Trader
AI-Powered Trading Psychology Coach for Smarter Decision-Making
🚀 Live Demo: https://alpha-ai-trader.zh05698.workers.dev/⁠�
⚡ Backend API: https://deriv-ai-trade-coach.onrender.com⁠�
🎯 Problem
Most retail traders fail not due to lack of strategy —
but because of emotional decision-making.
Common behavioral biases:
Loss Aversion
Overconfidence
Revenge Trading
Anchoring Bias
Confirmation Bias
Traditional trading tools focus on signals, not psychology.
💡 Solution
Alpha AI Trader focuses on behavioral analysis.
Instead of telling users what to trade, it:
Analyzes trading behavior
Detects psychological biases
Provides AI-driven coaching
Tracks performance metrics
Encourages disciplined trading
✨ Core Features
🧠 Behavioral Bias Detection
Detects patterns such as:
Holding losing trades too long
Increasing risk after wins
Emotional trading patterns
📊 Performance Dashboard
Win rate tracking
Risk score
Trade history analysis
Real-time P&L monitoring
🤖 AI Coach
Context-aware trade analysis
Strategy feedback
Psychological insights
Confidence scoring
⚡ Real-Time System
Market condition simulation
Technical indicators (RSI, MACD)
Dynamic feedback system
🏗️ Architecture
Frontend
Cloudflare Workers (Vanilla JS)
Backend
Node.js + Express (REST API)
AI Layer
Groq API (LLM integration with fallback mode)
Deployment
Frontend: Cloudflare
Backend: Render
🛠 Tech Stack
Frontend:
HTML5
CSS3
Vanilla JavaScript
Backend:
Node.js
Express.js
REST API Architecture
AI:
Groq LLM API
Prompt Engineering
Fallback AI system
DevOps:
Cloudflare Workers
Render Hosting
GitHub
🚀 Quick Start
Backend Setup
git clone https://github.com/zahid397/alpha-ai-trader.git
cd alpha-ai-trader/backend
npm install
Create .env:
PORT=3000
GROQ_API_KEY=your_key_here
Run server:
npm run dev
🔌 API Endpoints
GET /health
GET /api/trades
POST /api/trades
POST /api/coach/advice
GET /api/
🧪 Testing
npm test
📈 Future Improvements
Multi-language support
Advanced behavioral scoring
Mobile app version
Advanced analytics dashboard
👨‍💻 Developer
MD Zahid Hasan
Full Stack Developer | AI Integration Enthusiast
GitHub: https://github.com/zahid397⁠�
📄 License
MIT License
