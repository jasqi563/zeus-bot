const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
require('dotenv').config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ÉTAT GLOBAL OPTIMISÉ
const STATE = {
  ws: null,
  token: null,
  chatId: null,
  running: false,
  balance: 0,
  currentStake: 0.35,
  baseStake: 0.35,
  target: 1.00,
  stopLoss: 3.00,
  minScore: 72, // Augmenté légèrement pour filtrer les signaux faibles
  symbol: 'R_50',
  duration: 2,
  consecutiveLosses: 0,
  totalWins: 0,
  totalLosses: 0,
  totalPL: 0,
  sessionStart: 0,
  ticks: [],
  lastAnalyzedTickCount: 0,
  contractId: null,
  waitingResult: false,
  reqId: 1
};

// ============================================================
//  MOTEUR MATHÉMATIQUE SÉCURISÉ & OPTIMISÉ
// ============================================================

function calcEMA(arr, period) {
  if (arr.length < period) return null;
  const k = 2 / (period + 1);
  let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
}

function calcRSI(arr, period = 14) {
  if (arr.length < period + 1) return null;
  const slice = arr.slice(-period - 1);
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + (gains / losses));
}

function calcBB(arr, period = 20) {
  if (arr.length < period) return null;
  const slice = arr.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period);
  return { upper: mean + 2 * std, lower: mean - 2 * std, mid: mean };
}

// AMÉLIORATION : Analyse algorithmique haute performance
function analyzeSignal(ticks) {
  const reasons = [];
  let callScore = 0, putScore = 0;

  if (ticks.length < 50) return { score: 0, direction: null, reasons: ['Acquisition des données (50 ticks min)...'] };

  const rsi = calcRSI(ticks, 14);
  const ema9 = calcEMA(ticks, 9);
  const ema21 = calcEMA(ticks, 21);
  const ema50 = calcEMA(ticks, 50);
  const bb = calcBB(ticks, 20);
  
  const last = ticks[ticks.length - 1];
  const prev = ticks[ticks.length - 2];
  const prev2 = ticks[ticks.length - 3];

  // 1. FILTRE MAÎTRE : Tendance globale (EMA 50) pour éviter le contre-tendance complet
  if (ema50) {
    if (last < ema50) {
      putScore += 15; // Biais baissier de fond
    } else {
      callScore += 15; // Biais haussier de fond
    }
  }

  // 2. STRATÉGIE RSI REVISITÉE (Surachat / Survente Dynamique)
  if (rsi !== null) {
    if (rsi < 28) { // Plus strict que 30
      callScore += 35; 
      reasons.push(`🟢 RSI en hyper-survente (${rsi.toFixed(1)})`);
    } else if (rsi > 72) { // Plus strict que 70
      putScore += 35; 
      reasons.push(`🔴 RSI en hyper-surachat (${rsi.toFixed(1)})`);
    }
  }

  // 3. CROISEMENT ET ALIGNEMENT DES MOMENTUMS (EMA9 & EMA21)
  if (ema9 && ema21) {
    if (ema9 > ema21 && last > ema21) {
      callScore += 25;
      if (prev <= ema9 && last > ema9) reasons.push(`📈 Breakout haussier EMA9`);
    } else if (ema9 < ema21 && last < ema21) {
      putScore += 25;
      if (prev >= ema9 && last < ema9) reasons.push(`📉 Breakout baissier EMA9`);
    }
  }

  // 4. BOLLINGER REBOND ET REJET (Évite de shorter une explosion de bougie)
  if (bb) {
    if (last < bb.lower && prev > prev2) { // Prix sous la bande basse ET amorce de retournement (mèche)
      callScore += 25;
      reasons.push(`🟢 Rejet validé sur Bande Basse Bollinger`);
    } else if (last > bb.upper && prev < prev2) { // Prix sur la bande haute ET baisse du momentum
      putScore += 25;
      reasons.push(`🔴 Rejet validé sur Bande Haute Bollinger`);
    }
  }

  // 5. FILTRE ANTI-BRUIT (Si le marché fait du sur-place, on n'entre pas)
  const marketRange = Math.abs(last - prev2);
  if (marketRange < (last * 0.00002)) {
    return { score: 0, direction: null, reasons: ['⚠️ Marché plat / Compression extrême indécise'] };
  }

  // Calcul du score final
  const maxScore = Math.max(callScore, putScore);
  const direction = callScore >= putScore ? 'CALL' : 'PUT';
  
  // Normalisation basée sur un total de points max possible de 100
  const normalizedScore = Math.min(maxScore, 100);

  // SÉCURITÉ ABSOLUE : Verrouillage de la direction selon l'EMA 50
  if (direction === 'CALL' && last < ema50 && normalizedScore < 80) {
    return { score: 0, direction: null, reasons: ['⚠️ Signal CALL bloqué par tendance macro baissière (sous EMA50)'] };
  }
  if (direction === 'PUT' && last > ema50 && normalizedScore < 80) {
    return { score: 0, direction: null, reasons: ['⚠️ Signal PUT bloqué par tendance macro haussière (au-dessus EMA50)'] };
  }

  return { score: normalizedScore, direction, reasons };
}

// ============================================================
//  LOGIQUE DE TRADING ET SYSTEME TELEGRAM
// ============================================================

bot.onText(/\/start/, (msg) => {
  STATE.chatId = msg.chat.id;
  const menu = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔑 Authentifier Token Deriv", callback_data: "deriv_connect" }],
        [{ text: "⚡ RUN ZEUS V5 PRO", callback_data: "zeus_start" }, { text: "⏹️ STOP", callback_data: "zeus_stop" }],
        [{ text: "📊 Rapport Performances", callback_data: "zeus_stats" }]
      ]
    }
  };
  bot.sendMessage(msg.chat.id, "🤖 *ZEUS V5 PREMIUM CORE*\nCode optimisé : Filtre de tendance EMA50, protection de capital accrue, calculs instantanés asynchrones.", { parse_mode: 'Markdown', ...menu });
});

bot.on('callback_query', (query) => {
  const action = query.data;
  const cid = query.message.chat.id;
  STATE.chatId = cid;

  if (action === 'deriv_connect') {
    bot.sendMessage(cid, "Envoyez votre token via :\n`/token MON_TOKEN`", { parse_mode: 'Markdown' });
  } else if (action === 'zeus_start') {
    startBot(cid);
  } else if (action === 'zeus_stop') {
    stopBot(cid);
  } else if (action === 'zeus_stats') {
    sendStats(cid);
  }
  bot.answerCallbackQuery(query.id);
});

bot.onText(/\/token (.+)/, (msg, match) => {
  const token = match.trim();
  STATE.chatId = msg.chat.id;
  STATE.token = token;
  bot.sendMessage(msg.chat.id, "🔄 Connexion sécurisée en cours...");
  connectWS(token, msg.chat.id);
});

function connectWS(token, chatId) {
  if (STATE.ws) STATE.ws.close();
  STATE.ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

  STATE.ws.on('open', () => {
    STATE.ws.send(JSON.stringify({ authorize: token, req_id: STATE.reqId++ }));
  });

  STATE.ws.on('message', (data) => {
    const res = JSON.parse(data);
    handleMessage(res, chatId);
  });
}

function handleMessage(data, chatId) {
  if (data.error) {
    bot.sendMessage(chatId, `❌ Erreur Deriv : ${data.error.message}`);
    return;
  }

  if (data.msg_type === 'authorize') {
    STATE.balance = data.authorize.balance;
    bot.sendMessage(chatId, `✅ *Moteur Synchrone Prêt !*\nSolde : ${STATE.balance.toFixed(2)} $`);
    STATE.ws.send(JSON.stringify({ balance: 1, subscribe: 1, req_id: STATE.reqId++ }));
  }

  if (data.msg_type === 'balance') {
    STATE.balance = data.balance.balance;
  }

  if (data.msg_type === 'tick') {
    const price = parseFloat(data.tick.quote);
    STATE.ticks.push(price);
    if (STATE.ticks.length > 200) STATE.ticks.shift();

    // AMÉLIORATION : Plus de freeze d'analyse, l'exécution s'auto-throttle
    if (STATE.running && !STATE.waitingResult && STATE.ticks.length !== STATE.lastAnalyzedTickCount) {
      STATE.lastAnalyzedTickCount = STATE.ticks.length;
      attemptTrade(chatId);
    }
  }

  if (data.msg_type === 'buy') {
    STATE.contractId = data.buy.contract_id;
    STATE.waitingResult = true;
    STATE.ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: STATE.contractId, subscribe: 1, req_id: STATE.reqId++ }));
  }

  if (data.msg_type === 'proposal_open_contract') {
    const c = data.proposal_open_contract;
    if (c && c.is_settleable) {
      processResult(c, chatId);
    }
  }
}

function attemptTrade(chatId) {
  const sig = analyzeSignal(STATE.ticks);
  if (sig.score < STATE.minScore) return;

  const sessionPL = STATE.totalPL - STATE.sessionStart;
  if (Math.abs(Math.min(sessionPL, 0)) >= STATE.stopLoss) {
    bot.sendMessage(chatId, `🛑 *STOP LOSS ALERTE* (${sessionPL.toFixed(2)}$) — Coupure automatique de sécurité.`);
    stopBot(chatId); return;
  }
  if (Math.max(sessionPL, 0) >= STATE.target) {
    bot.sendMessage(chatId, `🎉 *OBJECTIF ATTEINT !* (+${sessionPL.toFixed(2)}$) — Session coupée proprement.`);
    stopBot(chatId); return;
  }

  let tradeSpecs = `🎯 *SIGNAL FORCE DETECTE : ${sig.direction}*\n🔥 Fiabilité calculée : ${sig.score}%\nMise engagée : ${STATE.currentStake.toFixed(2)}$\n\n📌 *Confluences mathématiques :*\n`;
  sig.reasons.forEach(r => { tradeSpecs += `${r}\n`; });

  bot.sendMessage(chatId, tradeSpecs, { parse_mode: 'Markdown' });

  STATE.ws.send(JSON.stringify({
    buy: 1,
    price: STATE.currentStake,
    parameters: {
      amount: STATE.currentStake,
      basis: 'stake',
      contract_type: sig.direction,
      currency: 'USD',
      duration: STATE.duration,
      duration_unit: 't',
      symbol: STATE.symbol
    },
    req_id: STATE.reqId++
  }));
}

function processResult(contract, chatId) {
  STATE.waitingResult = false;
  const profit = parseFloat(contract.profit);
  const won = profit > 0;

  if (won) {
    STATE.totalWins++;
    STATE.totalPL += profit;
    STATE.consecutiveLosses = 0;
    STATE.currentStake = STATE.baseStake;
    bot.sendMessage(chatId, `🟢 *PROFIT : +${profit.toFixed(2)} $* \nMise sécurisée réinitialisée.`);
  } else {
    STATE.totalLosses++;
    STATE.totalPL += profit;
    STATE.consecutiveLosses++;

    if (STATE.consecutiveLosses >= 3) {
      bot.sendMessage(chatId, `🛡️ *DISJONCTEUR SECURITE : 3 Pertes consécutives.*\nArrêt temporaire du bot pendant 45 secondes pour laisser le marché se stabiliser.`);
      STATE.currentStake = STATE.baseStake;
      STATE.consecutiveLosses = 0;
      STATE.waitingResult = true;
      setTimeout(() => { STATE.waitingResult = false; }, 45000);
    } else {
      // Ajustement Martingale lissée (x1.4) pour préserver le capital
      STATE.currentStake = parseFloat((STATE.currentStake * 1.4).toFixed(2));
      bot.sendMessage(chatId, `🔴 *PERTE : ${profit.toFixed(2)} $* \nApplication Martingale Soft (Mise: ${STATE.currentStake.toFixed(2)}$)`);
    }
  }
}

function startBot(chatId) {
  if (!STATE.token) {
    bot.sendMessage(chatId, "❌ Impossible : Token manquant.");
    return;
  }
  if (STATE.running) return;
  STATE.running = true;
  STATE.sessionStart = STATE.totalPL;
  STATE.ticks = [];
  bot.sendMessage(chatId, `🚀 *Moteur algorithmique ZEUS V5 activé.* Analyse du flux en cours...`);
  STATE.ws.send(JSON.stringify({ ticks: STATE.symbol, subscribe: 1, req_id: STATE.reqId++ }));
}

function stopBot(chatId) {
  if (!STATE.running) return;
  STATE.running = false;
  if (STATE.ws) STATE.ws.send(JSON.stringify({ forget_all: 'ticks', req_id: STATE.reqId++ }));
  bot.sendMessage(chatId, "😴 *ZEUS V5 mis en veille.*");
}

function sendStats(chatId) {
  const total = STATE.totalWins + STATE.totalLosses;
  const wr = total > 0 ? Math.round((STATE.totalWins / total) * 100) : 0;
  const msg = `📊 *RAPPORT DE PERFORMANCE PRO*\n\n• État : ${STATE.running ? "🟢 Trading" : "😴 Veille"}\n• P/L de la session : ${STATE.totalPL.toFixed(2)}$\n• Taux de réussite (WinRate) : *${wr}%*\n• Total Trades : ${total} (✅ ${STATE.totalWins} | ❌ ${STATE.totalLosses})`;
  bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
  }
