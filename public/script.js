// ============================================================================
// AI TRADING COACH - Frontend
// Served by the same Cloudflare Worker as the API, so requests are same-origin.
// ============================================================================

const API_BASE = (
  window.API_BASE_URL ||
  document.querySelector('meta[name="api-base"]')?.content ||
  ""
).replace(/\/+$/, "");

const SESSION_STORAGE_KEY = "alpha-ai-trader:session-id";
const REQUEST_TIMEOUT_MS = 30000;

const AI_SOURCE_LABELS = {
  groq: "Groq",
  "workers-ai": "Workers AI",
  rules: "Rules engine",
  offline: "Offline demo"
};

const BIAS_LABELS = {
  lossAversion: "Loss aversion",
  revengeTrading: "Revenge trading",
  overconfidence: "Overconfidence",
  fomo: "FOMO / impulsive entries",
  riskManagement: "Missing stop losses"
};

// Shown only when the API cannot be reached.
const DEMO_TRADES = [
  { id: "demo_1", symbol: "BTCUSD", type: "buy", entryPrice: 64250, exitPrice: 64820, positionSize: 1, profit: 570, timestamp: "2024-01-15T10:00:00Z", status: "win" },
  { id: "demo_2", symbol: "ETHUSD", type: "sell", entryPrice: 3450, exitPrice: 3420, positionSize: 1, profit: 30, timestamp: "2024-01-14T14:00:00Z", status: "win" },
  { id: "demo_3", symbol: "TSLA", type: "buy", entryPrice: 245.5, exitPrice: 243.2, positionSize: 100, profit: -230, timestamp: "2024-01-13T16:00:00Z", status: "loss" }
];

const savedSessionId = loadSavedSessionId();
const state = {
  online: false,
  currentSection: "dashboard",
  // The id is only saved after the first successful chat, so a saved id
  // means there is server-side history worth restoring.
  sessionId: savedSessionId || newSessionId(),
  sessionSaved: Boolean(savedSessionId)
};

document.addEventListener("DOMContentLoaded", async () => {
  initNavigation();
  setupRefreshButtons();
  setupQuickQuestions();
  setupChat();
  setupTradeActions();

  await checkBackendStatus();
  await Promise.all([loadDashboard(), restoreChatHistory()]);
});

// ============================================================================
// API helpers
// ============================================================================
async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function loadSavedSessionId() {
  try {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY);
    if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
  } catch {
    // Storage unavailable (private mode).
  }
  return null;
}

function newSessionId() {
  const random = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `session_${random}`;
}

function saveSessionId() {
  if (state.sessionSaved) return;
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, state.sessionId);
    state.sessionSaved = true;
  } catch {
    // Non-persistent session is fine.
  }
}

// ============================================================================
// Navigation
// ============================================================================
function initNavigation() {
  document.querySelectorAll(".nav-item[data-section]").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      showSection(item.dataset.section);
    });
  });
}

function showSection(section) {
  if (!section || section === state.currentSection) return;

  document.querySelectorAll(".nav-item[data-section]").forEach((i) => {
    i.classList.toggle("active", i.dataset.section === section);
  });
  document.querySelectorAll(".dashboard-section, .coach-section").forEach((sec) => {
    sec.classList.toggle("active", sec.id === `${section}-section`);
  });

  document.getElementById("page-title").textContent =
    section === "dashboard" ? "Trading Dashboard" : "AI Trading Coach";
  document.getElementById("page-subtitle").textContent =
    section === "dashboard" ? "Real-time insights and performance metrics" : "Get personalized trading advice";

  state.currentSection = section;
}

// ============================================================================
// Backend Status
// ============================================================================
async function checkBackendStatus() {
  const statusBadge = document.getElementById("status-badge");
  const statusDetail = document.getElementById("status-detail");
  const coachStatus = document.getElementById("coach-status");

  try {
    const health = await api("/api/health");
    state.online = true;

    statusBadge.textContent = "Online";
    statusBadge.className = "status-badge online";
    statusDetail.textContent = `AI: ${AI_SOURCE_LABELS[health.aiMode] || health.aiMode} · Storage: ${
      health.storage === "d1" ? "D1" : "memory"
    }`;
    coachStatus.textContent = "Online";
    coachStatus.style.color = "var(--positive)";
  } catch (error) {
    console.warn("Backend offline:", error);
    state.online = false;

    statusBadge.textContent = "Offline";
    statusBadge.className = "status-badge offline";
    statusDetail.textContent = "Demo mode: API unreachable";
    coachStatus.textContent = "Offline (Demo Mode)";
    coachStatus.style.color = "var(--negative)";

    showToast("Backend offline - running in demo mode", "warning");
  }
}

// ============================================================================
// Dashboard: KPIs, insights, trades table
// ============================================================================
async function loadDashboard() {
  if (state.online) {
    try {
      const [tradesResponse, summary] = await Promise.all([api("/api/trades"), api("/api/trades/stats/summary")]);
      renderTrades(tradesResponse.trades);
      renderKPIs(summary);
      renderInsights(summary);
      return;
    } catch (error) {
      console.warn("Failed to load dashboard data, showing demo data:", error);
    }
  }

  renderTrades(DEMO_TRADES);
  renderKPIs(demoSummary(DEMO_TRADES));
  renderInsights({ biases: [], behavioralPattern: "Demo mode: connect the API to analyze your trading behavior." });
}

function demoSummary(trades) {
  const wins = trades.filter((t) => t.profit > 0);
  const losses = trades.filter((t) => t.profit < 0);
  const grossProfit = wins.reduce((s, t) => s + t.profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
  const totalProfit = grossProfit - grossLoss;

  return {
    stats: {
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length ? Math.round((wins.length / trades.length) * 1000) / 10 : 0,
      totalProfit,
      profitFactor: grossLoss ? Math.round((grossProfit / grossLoss) * 100) / 100 : 0,
      expectancy: trades.length ? totalProfit / trades.length : 0
    },
    riskScore: null,
    riskLevel: null
  };
}

function setTrend(id, text, tone = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `kpi-trend ${tone}`.trim();
  el.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = text;
  el.appendChild(span);
}

function renderKPIs(summary) {
  const stats = summary?.stats || {};
  const total = stats.totalTrades || 0;

  const netPl = document.getElementById("net-pl");
  netPl.textContent = formatMoney(stats.totalProfit || 0);
  netPl.className = `kpi-value ${stats.totalProfit > 0 ? "value-positive" : stats.totalProfit < 0 ? "value-negative" : ""}`;
  setTrend(
    "net-pl-trend",
    total ? `Profit factor ${Number(stats.profitFactor || 0).toFixed(2)}` : "No trades yet",
    stats.profitFactor >= 1 ? "positive" : total ? "negative" : ""
  );

  document.getElementById("win-rate").textContent = `${stats.winRate || 0}%`;
  setTrend("win-rate-trend", `${stats.wins || 0} wins / ${stats.losses || 0} losses`, stats.winRate >= 50 ? "positive" : total ? "negative" : "");

  document.getElementById("total-trades").textContent = total;
  setTrend("total-trades-trend", total ? `Expectancy ${formatMoney(stats.expectancy || 0)} / trade` : "Log trades to get started");

  const riskEl = document.getElementById("risk-score");
  if (summary.riskScore === null || summary.riskScore === undefined) {
    riskEl.textContent = "--";
    setTrend("risk-trend", "Available when the API is online");
  } else {
    riskEl.textContent = `${summary.riskScore}/100`;
    const tone = summary.riskLevel === "high" ? "negative" : summary.riskLevel === "low" ? "positive" : "";
    const label = summary.riskLevel === "high" ? "High risk: needs improvement" : summary.riskLevel === "low" ? "Low risk" : "Moderate risk";
    setTrend("risk-trend", label, tone);
  }
}

function renderInsights(summary) {
  const summaryEl = document.getElementById("insights-summary");
  const listEl = document.getElementById("insights-list");
  if (!summaryEl || !listEl) return;

  summaryEl.textContent = summary.behavioralPattern || "";
  listEl.innerHTML = "";

  for (const bias of summary.biases || []) {
    const item = document.createElement("li");
    item.className = "insight-item";
    item.innerHTML = `
      <div class="insight-header">
        <span class="severity-badge severity-${escapeHtml(bias.severity)}">${escapeHtml(bias.severity)}</span>
        <strong>${escapeHtml(BIAS_LABELS[bias.type] || bias.type)}</strong>
        <span class="insight-confidence">${escapeHtml(bias.confidence)}% confidence</span>
      </div>
      <p class="insight-evidence">${escapeHtml(bias.evidence)}</p>
      <p class="insight-action"><i class="fas fa-lightbulb"></i> ${escapeHtml(bias.recommendation)}</p>
    `;
    listEl.appendChild(item);
  }
}

function renderTrades(trades) {
  const tableBody = document.getElementById("trades-table-body");
  if (!tableBody) return;

  if (!Array.isArray(trades) || trades.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-row">
          <i class="fas fa-exchange-alt"></i>
          No trades found
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = "";

  trades.forEach((trade) => {
    const row = document.createElement("tr");
    const status = trade.status || (trade.profit > 0 ? "win" : trade.profit < 0 ? "loss" : "breakeven");
    const statusClass = status === "win" ? "status-win" : status === "loss" ? "status-loss" : "status-pending";
    const direction = trade.type === "sell" ? "Short" : "Long";
    const plClass = trade.profit > 0 ? "value-positive" : trade.profit < 0 ? "value-negative" : "";
    const canAnalyze = state.online && trade.id && !String(trade.id).startsWith("demo_");

    row.innerHTML = `
      <td><strong>${escapeHtml(trade.symbol)}</strong></td>
      <td><span class="status-badge trade ${trade.type === "sell" ? "status-loss" : "status-win"}">${direction}</span></td>
      <td>${formatPrice(trade.entryPrice)}</td>
      <td>${formatPrice(trade.exitPrice)}</td>
      <td class="${plClass}" style="font-weight:600;">${formatMoney(trade.profit)}</td>
      <td>${formatDate(trade.timestamp)}</td>
      <td><span class="status-badge trade ${statusClass}">${escapeHtml(capitalize(status))}</span></td>
      <td>${
        canAnalyze
          ? `<button class="btn-icon analyze-trade" data-trade-id="${escapeHtml(trade.id)}" data-trade-label="${escapeHtml(`${trade.symbol} ${direction.toLowerCase()} on ${formatDate(trade.timestamp)}`)}" title="Ask the AI coach to analyze this trade" aria-label="Analyze trade"><i class="fas fa-robot"></i></button>`
          : ""
      }</td>
    `;

    tableBody.appendChild(row);
  });
}

// ============================================================================
// Chat System (AI Coach)
// ============================================================================
let chatUi = null;

function setupChat() {
  const messageInput = document.getElementById("message-input");
  const sendButton = document.getElementById("send-button");
  const chatMessages = document.getElementById("chat-messages");
  const typingIndicator = document.getElementById("typing-indicator");
  const clearButton = document.getElementById("clear-chat");

  if (!messageInput || !sendButton || !chatMessages) return;

  const welcomeHtml = chatMessages.innerHTML;

  function addMessage(text, sender, source) {
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${sender}-message`;

    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const sourceLabel = source ? ` · ${AI_SOURCE_LABELS[source] || source}` : "";

    if (sender === "user") {
      messageDiv.innerHTML = `
        <div class="message-content user-content">
          <div class="message-sender">You</div>
          <div class="message-text">${escapeHtml(text)}</div>
          <div class="message-time">${timestamp}</div>
        </div>
        <div class="message-avatar">
          <i class="fas fa-user"></i>
        </div>
      `;
    } else {
      messageDiv.innerHTML = `
        <div class="message-avatar">
          <i class="fas fa-robot"></i>
        </div>
        <div class="message-content">
          <div class="message-sender">AI Coach<span class="message-source">${escapeHtml(sourceLabel)}</span></div>
          <div class="message-text">${escapeHtml(text)}</div>
          <div class="message-time">${timestamp}</div>
        </div>
      `;
    }

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function setBusy(busy) {
    sendButton.disabled = busy;
    if (typingIndicator) typingIndicator.style.display = busy ? "flex" : "none";
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || sendButton.disabled) return;

    addMessage(message, "user");
    messageInput.value = "";
    setBusy(true);

    try {
      if (!state.online) throw new Error("offline");
      const data = await api("/api/coach/chat", {
        method: "POST",
        body: JSON.stringify({ message, sessionId: state.sessionId })
      });
      addMessage(data.reply, "ai", data.source);
      saveSessionId();
    } catch (error) {
      if (error.message !== "offline") console.warn("AI coach error:", error);
      addMessage(generateFallbackReply(message), "ai", "offline");
    } finally {
      setBusy(false);
    }
  }

  async function analyzeTrade(tradeId, label) {
    showSection("coach");
    addMessage(`Analyze my ${label || "selected"} trade`, "user");
    setBusy(true);

    try {
      const data = await api(`/api/coach/analyze/${encodeURIComponent(tradeId)}`, { method: "POST", body: "{}" });
      addMessage(formatTradeAnalysis(data.trade, data.analysis), "ai", data.source);
    } catch (error) {
      console.warn("Trade analysis failed:", error);
      addMessage("Sorry, I couldn't analyze that trade right now. Please try again.", "ai", "offline");
    } finally {
      setBusy(false);
    }
  }

  async function clearChat() {
    chatMessages.innerHTML = welcomeHtml;
    if (!state.online || !state.sessionSaved) return;
    try {
      await api(`/api/session/${state.sessionId}/messages`, { method: "DELETE" });
    } catch (error) {
      if (error.status !== 404) console.warn("Failed to clear session:", error);
    }
    showToast("Started a new conversation", "success");
  }

  sendButton.addEventListener("click", sendMessage);
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  if (clearButton) clearButton.addEventListener("click", clearChat);

  chatUi = { addMessage, analyzeTrade };
}

async function restoreChatHistory() {
  if (!state.online || !chatUi || !state.sessionSaved) return;
  try {
    const data = await api(`/api/session/${state.sessionId}/history?type=chat&limit=20`);
    for (const m of data.messages || []) {
      chatUi.addMessage(m.content, m.role === "user" ? "user" : "ai", m.role === "user" ? undefined : m.source);
    }
  } catch (error) {
    // 404 simply means this browser has not chatted yet.
    if (error.status !== 404) console.warn("Failed to restore chat history:", error);
  }
}

function formatTradeAnalysis(trade, analysis) {
  const lines = [
    `${trade.symbol} ${trade.type === "sell" ? "short" : "long"} on ${formatDate(trade.timestamp)}: ${formatMoney(trade.profit)}`,
    `Plan adherence: ${analysis.confidenceScore}/100 · Risk: ${analysis.riskAssessment}`
  ];
  if (analysis.successFactors?.length) lines.push("", "What went well:", ...analysis.successFactors.map((s) => `- ${s}`));
  if (analysis.mistakes?.length) lines.push("", "Mistakes:", ...analysis.mistakes.map((s) => `- ${s}`));
  if (analysis.behavioralInsights) lines.push("", analysis.behavioralInsights);
  if (analysis.improvementSuggestions?.length) lines.push("", "Next time:", ...analysis.improvementSuggestions.map((s) => `- ${s}`));
  return lines.join("\n");
}

// Offline replies (API unreachable).
function generateFallbackReply(userMessage) {
  const msg = userMessage.toLowerCase();

  if (/\b(hi|hello|hey)\b/.test(msg)) {
    return "Hello! I'm your AI Trading Coach. The API is offline right now, so I can only share general trading principles.";
  }
  if (msg.includes("risk")) {
    return "General risk advice: never risk more than 1-2% of your capital on a single trade. Place the stop loss as a hard order when you enter.";
  }
  if (msg.includes("win") || msg.includes("rate")) {
    return "To improve win rate: focus on quality setups over quantity, wait for confirmation, and avoid trading right after a loss.";
  }
  if (msg.includes("pattern") || msg.includes("trend")) {
    return "Common reliable patterns: support/resistance bounces, trend continuations and consolidation breakouts. Always confirm with volume.";
  }
  if (msg.includes("analyze") || msg.includes("performance")) {
    return "Key metrics to track: win rate, average win vs average loss, maximum drawdown and consistency. Aim for at least 1:2 risk/reward.";
  }
  return "Trading success is mostly psychology and risk management. Focus on discipline and consistency over chasing profits.";
}

// ============================================================================
// Quick Questions, Refresh Buttons, Trade Actions
// ============================================================================
function setupQuickQuestions() {
  document.querySelectorAll(".quick-question").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById("message-input");
      const send = document.getElementById("send-button");
      if (input && send && btn.dataset.question && !send.disabled) {
        input.value = btn.dataset.question;
        send.click();
      }
    });
  });
}

function setupRefreshButtons() {
  const refresh = async () => {
    await checkBackendStatus();
    await loadDashboard();
    if (state.online) showToast("Data refreshed", "success");
  };

  document.getElementById("refresh-data")?.addEventListener("click", (e) => {
    e.preventDefault();
    refresh();
  });
  document.getElementById("refresh-trades")?.addEventListener("click", refresh);
}

function setupTradeActions() {
  document.getElementById("trades-table-body")?.addEventListener("click", (e) => {
    const button = e.target.closest(".analyze-trade");
    if (button && chatUi) chatUi.analyzeTrade(button.dataset.tradeId, button.dataset.tradeLabel);
  });
}

// ============================================================================
// Toast Notification
// ============================================================================
function showToast(message, type = "success") {
  document.querySelectorAll("[data-toast]").forEach((toast) => toast.remove());

  const color = type === "success" ? "var(--neon-cyan)" : type === "warning" ? "var(--warning)" : "var(--negative)";
  const icon = type === "success" ? "fa-check-circle" : type === "warning" ? "fa-exclamation-triangle" : "fa-exclamation-circle";

  const toast = document.createElement("div");
  toast.dataset.toast = type;
  toast.className = "toast";
  toast.style.borderLeftColor = color;
  toast.innerHTML = `
    <i class="fas ${icon}" style="color:${color};"></i>
    <span>${escapeHtml(message)}</span>
  `;

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ============================================================================
// Utils
// ============================================================================
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Safe for both element content and quoted attribute values.
function escapeHtml(value) {
  return (value === null || value === undefined ? "" : String(value)).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "N/A";
  const abs = Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${num < 0 ? "-" : num > 0 ? "+" : ""}$${abs}`;
}

function formatPrice(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString(undefined, { maximumFractionDigits: 8 }) : "N/A";
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? "N/A"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
