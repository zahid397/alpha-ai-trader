# alpha-ai-trader

> AI-powered backend for analyzing trading behavior and mitigating emotional biases.

![GitHub stars](https://img.shields.io/github/stars/zahid397/alpha-ai-trader?style=for-the-badge&logo=github) ![GitHub forks](https://img.shields.io/github/forks/zahid397/alpha-ai-trader?style=for-the-badge&logo=github) ![GitHub issues](https://img.shields.io/github/issues/zahid397/alpha-ai-trader?style=for-the-badge&logo=github) ![Last commit](https://img.shields.io/github/last-commit/zahid397/alpha-ai-trader?style=for-the-badge&logo=github) ![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white) ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=white) ![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)

## 📑 Table of Contents

- [Description](#description)
- [Key Features](#key-features)
- [Use Cases](#use-cases)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Key Dependencies](#key-dependencies)
- [Available Scripts](#available-scripts)
- [API Endpoints](#api-endpoints)
- [Project Structure](#project-structure)
- [Development Setup](#development-setup)
- [Testing](#testing)
- [Contributing](#contributing)

## 📝 Description

Alpha AI Trader is a specialized backend API designed to address a primary pitfall in retail trading: emotional decision-making. While traditional tools focus entirely on market signals and technical indicators, this system targets behavioral psychology. It analyzes user trading data to detect cognitive biases, such as loss aversion, overconfidence, and revenge trading, helping users build discipline.

## ✨ Key Features

- **🧠 Behavioral Bias Detection** — Analyzes trading patterns to detect psychological biases like loss aversion and revenge trading.
- **🤖 Groq LLM Coaching Engine** — Integrates the Groq API to provide context-aware, real-time strategy feedback and psychological coaching with a fallback mechanism.
- **🔌 RESTful Trade Management API** — Exposes structured endpoints for logging trades, fetching trade histories, checking system health, and requesting real-time coaching advice.
- **🧪 Jest Automated Testing Suite** — Includes pre-configured scripts for executing unit tests, watching file changes, and generating detailed test coverage reports.

## 🎯 Use Cases

- Integrating an automated behavioral analysis coach into a custom dashboard for retail traders.
- Analyzing historical trade logs to find correlation between specific market conditions and emotional trading decisions.
- Deploying an AI-based financial advice proxy system with custom prompt engineering using the Groq API.

## 🛠️ Tech Stack

- 🚀 **Express.js**
- 🟨 **JavaScript**
- 🟥 **Redis**

**Notable libraries:** Jest

## ⚡ Quick Start

```bash

# 1. Clone the repository
git clone https://github.com/zahid397/alpha-ai-trader.git

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run start
```

## 📦 Key Dependencies

```
express: ^4.18.2
cors: ^2.8.5
helmet: ^7.0.0
morgan: ^1.10.0
dotenv: ^16.0.3
express-rate-limit: ^6.10.0
groq-sdk: ^0.3.0
redis: ^4.6.7
node-cache: ^5.1.2
```

## 🚀 Available Scripts

- **start** — `npm run start`
- **dev** — `npm run dev`
- **test** — `npm run test`
- **test:watch** — `npm run test:watch`
- **test:coverage** — `npm run test:coverage`

## 🌐 API Endpoints

Detected endpoints (best-effort scan):

```
GET /
GET /health
GET /api
```

## 📁 Project Structure

```
.
├── backend
│   ├── app.js
│   ├── config
│   │   └── env.js
│   ├── middleware
│   │   ├── errorHandler.js
│   │   └── rateLimiter.js
│   ├── package.json
│   ├── routes
│   │   ├── coach.js
│   │   ├── history.js
│   │   ├── session.js
│   │   └── trades.js
│   └── services
│       ├── groqService.js
│       ├── promptBuilder.js
│       └── tradeAnalyzer.js
├── data
│   └── sampleTrades.json
└── public
    ├── index.html
    ├── script.js
    └── style.css
```

## 🛠️ Development Setup

### Node.js / JavaScript
1. Install Node.js (v18+ recommended)
2. Install dependencies: `npm install` (or `yarn` / `pnpm install` / `bun install`)
3. Start the dev server: see the **Quick Start** above

## 🧪 Testing

This project uses **Jest** for testing.

```bash
npm run test
```

## 👥 Contributing

Contributions are welcome! Here's the standard flow:

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/zahid397/alpha-ai-trader.git`
3. **Branch**: `git checkout -b feature/your-feature`
4. **Commit**: `git commit -m 'feat: add some feature'`
5. **Push**: `git push origin feature/your-feature`
6. **Open** a pull request

Please follow the existing code style and include tests for new behavior where applicable.

---
*This README was generated with ❤️ by [ReadmeBuddy](https://readmebuddy.com)*
