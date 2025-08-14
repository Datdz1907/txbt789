// index.js — AI-LVTD (nguyên bản format API)

import express from "express";
import WebSocket from "ws";
import cors from "cors";

/** ================== CẤU HÌNH ================== **/
const PORT = process.env.PORT || 3000;

// WS mới bạn cung cấp (SignalR WebSocket)
const WS_URL = "wss://taixiu.ozi8367m37p3dp9l.online/signalr/connect?transport=webSockets&connectionToken=pisj0kMUQAY0vu5aLGJPu%2FFCFHTzJK1J9%2FuTyd%2F8kae8GN1bGjeXNtat7IiJF01X%2F%2Fcc9astqKsrnIqdp%2B%2BX0G52jbdbCeaqX6pKuBwznvQJ6q3YQjMg0kVKiZ3VA9Sw&connectionData=%5B%7B%22name%22%3A%22luckydiceHub%22%7D%5D&tid=4&access_token=05%2F7JlwSPGy18u5nVxiuWecM%2FO32MkRsB3UwDAmuWFLnnn6%2ByCal3RlRPZbuAJ%2FFcOfIfArsm9ScBVZt2rqYUlkdfHmE3Ol8vFNGvXxQaoETMuaNO%2FbhytwweWJp0sQ%2FbgO0V7r66MtySzZlGwthVL9Qt4IC3pbICDvFjZ4cM%2BUWLJ1N0ZLUBEd75urdclUM2pIyfnvizdUwxAa22Jm1ZWxtvZKOHkUZPIIUeuNcaK60O%2Bm8hBLJgkVGxF3f3cYSR1%2BF7BN3QstjXuNAgaKwylFH1lKskeEsvK64pZCphEE4EtHbi%2FDyqRldZjxlpgc3kMxI337DEkBY2euTQdE182VylDh6tR1OLrPQmXxCfpE5lN5Mx6vO00os7oXo%2FZlG.2229e95571d58922e221c63d64fa57f296f79e7537fb3a81ed85af073f51e3c4";

/** ================== BIẾN TRẠNG THÁI ================== **/
let ws = null;
let pingTimer = null;
let pingId = 1;

let history = []; // [{session, result: 'Tài'|'Xỉu', score: sum}]
let lastPacket = null; // lưu gói result mới nhất (để /data trả phien_truoc)
let lastSessionId = null;
let nextPrediction = "Chưa có";
let modelPredictions = { trend: {}, short: {}, mean: {}, switch: {}, bridge: {} };

/** ================== HÀM TIỆN ÍCH ================== **/
function formatTime() {
  const now = new Date();
  return now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function resultFromSum(sum) {
  return sum >= 11 ? "Tài" : "Xỉu";
}

/** ================== THUẬT TOÁN AI-LVTD ================== **/
function detectStreakAndBreak(his) {
  if (!his || his.length === 0) return { streak: 0, currentResult: null, breakProb: 0 };
  let streak = 1;
  const currentResult = his[his.length - 1].result;
  for (let i = his.length - 2; i >= 0; i--) {
    if (his[i].result === currentResult) streak++; else break;
  }
  const last15 = his.slice(-15).map(x => x.result);
  if (!last15.length) return { streak, currentResult, breakProb: 0 };

  const switches = last15.slice(1).reduce((c, r, i) => c + (r !== last15[i] ? 1 : 0), 0);
  const taiCount = last15.filter(r => r === "Tài").length;
  const xiuCount = last15.length - taiCount;
  const imbalance = Math.abs(taiCount - xiuCount) / last15.length;

  let breakProb = 0;
  if (streak >= 8) breakProb = Math.min(0.6 + switches / 15 + imbalance * 0.15, 0.9);
  else if (streak >= 5) breakProb = Math.min(0.35 + switches / 10 + imbalance * 0.25, 0.85);
  else if (streak >= 3 && switches >= 7) breakProb = 0.3;

  return { streak, currentResult, breakProb };
}

function trendAndProb(his) {
  if (!his || his.length < 3) return 0;
  const ctx = detectStreakAndBreak(his);
  if (ctx.streak >= 5) return ctx.breakProb > 0.75 ? (ctx.currentResult === "Tài" ? 2 : 1) : (ctx.currentResult === "Tài" ? 1 : 2);

  const last15 = his.slice(-15).map(x => x.result);
  if (!last15.length) return 0;

  const weighted = last15.map((_, idx) => Math.pow(1.2, idx));
  const taiW = weighted.reduce((s, w, i) => s + (last15[i] === "Tài" ? w : 0), 0);
  const xiuW = weighted.reduce((s, w, i) => s + (last15[i] === "Xỉu" ? w : 0), 0);
  const totalW = taiW + xiuW;

  const last10 = last15.slice(-10);
  const patterns = [];
  if (last10.length >= 4) {
    for (let i = 0; i <= last10.length - 4; i++) patterns.push(last10.slice(i, i + 4).join(","));
  }
  const counts = {};
  for (let i = 0; i < patterns.length; i++) counts[patterns[i]] = (counts[patterns[i]] || 0) + 1;
  const most = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (most && most[1] >= 3) {
    const parts = most[0].split(",");
    return parts[parts.length - 1] !== last10[last10.length - 1] ? 1 : 2;
  }
  if (totalW > 0 && Math.abs(taiW - xiuW) / totalW >= 0.25) return taiW > xiuW ? 2 : 1;
  return last15[last15.length - 1] === "Xỉu" ? 1 : 2;
}

function shortPattern(his) {
  if (!his || his.length < 3) return 0;
  const ctx = detectStreakAndBreak(his);
  if (ctx.streak >= 4) return ctx.breakProb > 0.75 ? (ctx.currentResult === "Tài" ? 2 : 1) : (ctx.currentResult === "Tài" ? 1 : 2);

  const last8 = his.slice(-8).map(x => x.result);
  if (!last8.length) return 0;
  const patterns = [];
  if (last8.length >= 3) {
    for (let i = 0; i <= last8.length - 3; i++) patterns.push(last8.slice(i, i + 3).join(","));
  }
  const counts = {};
  for (let i = 0; i < patterns.length; i++) counts[patterns[i]] = (counts[patterns[i]] || 0) + 1;
  const most = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (most && most[1] >= 2) {
    const parts = most[0].split(",");
    return parts[parts.length - 1] !== last8[last8.length - 1] ? 1 : 2;
  }
  return last8[last8.length - 1] === "Xỉu" ? 1 : 2;
}

function meanDeviation(his) {
  if (!his || his.length < 3) return 0;
  const ctx = detectStreakAndBreak(his);
  if (ctx.streak >= 4) return ctx.breakProb > 0.75 ? (ctx.currentResult === "Tài" ? 2 : 1) : (ctx.currentResult === "Tài" ? 1 : 2);

  const last12 = his.slice(-12).map(x => x.result);
  if (!last12.length) return 0;
  const tai = last12.filter(r => r === "Tài").length;
  const xiu = last12.length - tai;
  const imbalance = Math.abs(tai - xiu) / last12.length;
  if (imbalance < 0.35) return last12[last12.length - 1] === "Xỉu" ? 1 : 2;
  return xiu > tai ? 1 : 2;
}

function recentSwitch(his) {
  if (!his || his.length < 3) return 0;
  const ctx = detectStreakAndBreak(his);
  if (ctx.streak >= 4) return ctx.breakProb > 0.75 ? (ctx.currentResult === "Tài" ? 2 : 1) : (ctx.currentResult === "Tài" ? 1 : 2);

  const last10 = his.slice(-10).map(x => x.result);
  if (!last10.length) return 0;
  const switches = last10.slice(1).reduce((c, r, i) => c + (r !== last10[i] ? 1 : 0), 0);
  return switches >= 6
    ? (last10[last10.length - 1] === "Xỉu" ? 1 : 2)
    : (last10[last10.length - 1] === "Xỉu" ? 1 : 2);
}

function smartBridgeBreak(his) {
  if (!his || his.length < 3) return { prediction: 0, breakProb: 0, reason: "Không đủ dữ liệu để bẻ cầu" };
  const ctx = detectStreakAndBreak(his);
  const last20R = his.slice(-20).map(x => x.result);
  const last20S = his.slice(-20).map(x => x.score || 0);

  const avgScore = last20S.reduce((s, v) => s + v, 0) / (last20S.length || 1);
  const dev = last20S.reduce((s, v) => s + Math.abs(v - avgScore), 0) / (last20S.length || 1);
  const patternCounts = {};
  for (let i = 0; i <= last20R.length - 3; i++) {
    const p = last20R.slice(i, i + 3).join(",");
    patternCounts[p] = (patternCounts[p] || 0) + 1;
  }
  const most = Object.entries(patternCounts).sort((a, b) => b[1] - a[1])[0];
  const hasRepeat = most && most[1] >= 3;

  let finalProb = ctx.breakProb;
  let reason = "";
  if (ctx.streak >= 6) {
    finalProb = Math.min(finalProb + 0.15, 0.9);
    reason = `[Bẻ Cầu] Chuỗi ${ctx.streak} ${ctx.currentResult} dài, khả năng bẻ cầu cao`;
  } else if (ctx.streak >= 4 && dev > 3) {
    finalProb = Math.min(finalProb + 0.1, 0.85);
    reason = `[Bẻ Cầu] Biến động điểm số lớn (${dev.toFixed(1)}), khả năng bẻ cầu tăng`;
  } else if (hasRepeat && last20R.slice(-5).every(r => r === ctx.currentResult)) {
    finalProb = Math.min(finalProb + 0.05, 0.8);
    reason = `[Bẻ Cầu] Phát hiện mẫu lặp ${most[0]}, có khả năng bẻ cầu`;
  } else {
    finalProb = Math.max(finalProb - 0.15, 0.15);
    reason = `[Bẻ Cầu] Không phát hiện mẫu bẻ cầu mạnh, tiếp tục theo cầu`;
  }

  const prediction = finalProb > 0.65 ? (ctx.currentResult === "Tài" ? 2 : 1) : (ctx.currentResult === "Tài" ? 1 : 2);
  return { prediction, breakProb: finalProb, reason };
}

function isBadPattern(his) {
  if (!his || his.length < 3) return false;
  const last15 = his.slice(-15).map(x => x.result);
  if (!last15.length) return false;
  const switches = last15.slice(1).reduce((c, r, i) => c + (r !== last15[i] ? 1 : 0), 0);
  const { streak } = detectStreakAndBreak(his);
  return switches >= 9 || streak >= 10;
}

function aiHtddLogic(his) {
  if (!his || his.length < 3) {
    const randomPred = Math.random() < 0.5 ? "Tài" : "Xỉu";
    return { prediction: randomPred, reason: "Không đủ lịch sử, dự đoán ngẫu nhiên", source: "AI HTDD" };
  }
  const last5R = his.slice(-5).map(x => x.result);
  const last5S = his.slice(-5).map(x => x.score || 0);
  const taiCount = last5R.filter(r => r === "Tài").length;
  const xiuCount = last5R.filter(r => r === "Xỉu").length;

  if (his.length >= 3) {
    const last3 = his.slice(-3).map(x => x.result).join(",");
    if (last3 === "Tài,Xỉu,Tài") return { prediction: "Xỉu", reason: "Phát hiện mẫu 1T1X → nên đánh Xỉu", source: "AI HTDD" };
    if (last3 === "Xỉu,Tài,Xỉu") return { prediction: "Tài", reason: "Phát hiện mẫu 1X1T → nên đánh Tài", source: "AI HTDD" };
  }
  if (his.length >= 4) {
    const last4 = his.slice(-4).map(x => x.result).join(",");
    if (last4 === "Tài,Tài,Xỉu,Xỉu") return { prediction: "Tài", reason: "Phát hiện mẫu 2T2X → nên đánh Tài", source: "AI HTDD" };
    if (last4 === "Xỉu,Xỉu,Tài,Tài") return { prediction: "Xỉu", reason: "Phát hiện mẫu 2X2T → nên đánh Xỉu", source: "AI HTDD" };
  }
  if (his.length >= 9 && his.slice(-6).every(x => x.result === "Tài")) return { prediction: "Xỉu", reason: "Chuỗi Tài quá dài (6) → dự đoán Xỉu", source: "AI HTDD" };
  if (his.length >= 9 && his.slice(-6).every(x => x.result === "Xỉu")) return { prediction: "Tài", reason: "Chuỗi Xỉu quá dài (6) → dự đoán Tài", source: "AI HTDD" };

  const avg = last5S.reduce((s, v) => s + v, 0) / (last5S.length || 1);
  if (avg > 10) return { prediction: "Tài", reason: `Điểm trung bình cao (${avg.toFixed(1)}) → dự đoán Tài`, source: "AI HTDD" };
  if (avg < 8) return { prediction: "Xỉu", reason: `Điểm trung bình thấp (${avg.toFixed(1)}) → dự đoán Xỉu`, source: "AI HTDD" };

  if (taiCount > xiuCount + 1) return { prediction: "Xỉu", reason: `Tài chiếm đa số (${taiCount}/${last5R.length}) → dự đoán Xỉu`, source: "AI HTDD" };
  if (xiuCount > taiCount + 1) return { prediction: "Tài", reason: `Xỉu chiếm đa số (${xiuCount}/${last5R.length}) → dự đoán Tài`, source: "AI HTDD" };

  const totalTai = his.filter(x => x.result === "Tài").length;
  const totalXiu = his.filter(x => x.result === "Xỉu").length;
  if (totalTai > totalXiu + 2) return { prediction: "Xỉu", reason: "Tổng thể Tài nhiều hơn → dự đoán Xỉu", source: "AI HTDD" };
  if (totalXiu > totalTai + 2) return { prediction: "Tài", reason: "Tổng thể Xỉu nhiều hơn → dự đoán Tài", source: "AI HTDD" };

  const randomPred = Math.random() < 0.5 ? "Tài" : "Xỉu";
  return { prediction: randomPred, reason: "Cân bằng, dự đoán ngẫu nhiên", source: "AI HTDD" };
}

function evaluateModelPerformance(his, name, lookback = 10) {
  if (!modelPredictions[name] || his.length < 2) return 1;
  lookback = Math.min(lookback, his.length - 1);
  let correct = 0;
  for (let i = 0; i < lookback; i++) {
    const sid = his[his.length - (i + 2)].session;
    const pred = modelPredictions[name][sid] || 0;
    const actual = his[his.length - (i + 1)].result;
    if ((pred === 1 && actual === "Tài") || (pred === 2 && actual === "Xỉu")) correct++;
  }
  const ratio = lookback > 0 ? 1 + (correct - lookback / 2) / (lookback / 2) : 1;
  return Math.max(0.5, Math.min(1.5, ratio));
}

function generatePrediction(his) {
  if (!his || his.length === 0) {
    return Math.random() < 0.5 ? "Tài" : "Xỉu";
  }
  const currentSession = his[his.length - 1].session; // dùng để ghi hiệu suất

  const trendPred = his.length < 5 ? (his[his.length - 1].result === "Tài" ? 2 : 1) : trendAndProb(his);
  const shortPred = his.length < 5 ? (his[his.length - 1].result === "Tài" ? 2 : 1) : shortPattern(his);
  const meanPred  = his.length < 5 ? (his[his.length - 1].result === "Tài" ? 2 : 1) : meanDeviation(his);
  const switchPred= his.length < 5 ? (his[his.length - 1].result === "Tài" ? 2 : 1) : recentSwitch(his);
  const bridgePred= his.length < 5 ? { prediction: (his[his.length - 1].result === "Tài" ? 2 : 1), breakProb: 0, reason: "Lịch sử ngắn" } : smartBridgeBreak(his);
  const aiPred    = aiHtddLogic(his);

  // Lưu dự đoán từng mô hình theo session
  modelPredictions.trend[currentSession]  = trendPred;
  modelPredictions.short[currentSession]  = shortPred;
  modelPredictions.mean[currentSession]   = meanPred;
  modelPredictions.switch[currentSession] = switchPred;
  modelPredictions.bridge[currentSession] = bridgePred.prediction;

  const perf = {
    trend:  evaluateModelPerformance(his, "trend"),
    short:  evaluateModelPerformance(his, "short"),
    mean:   evaluateModelPerformance(his, "mean"),
    switch: evaluateModelPerformance(his, "switch"),
    bridge: evaluateModelPerformance(his, "bridge"),
  };

  // trọng số động theo hiệu suất
  const w = {
    trend:  0.2  * perf.trend,
    short:  0.2  * perf.short,
    mean:   0.25 * perf.mean,
    switch: 0.2  * perf.switch,
    bridge: 0.15 * perf.bridge,
    aihtdd: 0.2,
  };

  let tai = 0, xiu = 0;
  if (trendPred  === 1) tai += w.trend;  else if (trendPred  === 2) xiu += w.trend;
  if (shortPred  === 1) tai += w.short;  else if (shortPred  === 2) xiu += w.short;
  if (meanPred   === 1) tai += w.mean;   else if (meanPred   === 2) xiu += w.mean;
  if (switchPred === 1) tai += w.switch; else if (switchPred === 2) xiu += w.switch;
  if (bridgePred.prediction === 1) tai += w.bridge; else if (bridgePred.prediction === 2) xiu += w.bridge;
  if (aiPred.prediction === "Tài") tai += w.aihtdd; else xiu += w.aihtdd;

  if (isBadPattern(his)) { tai *= 0.8; xiu *= 0.8; }

  const last10 = his.slice(-10).map(x => x.result);
  const last10Tai = last10.filter(r => r === "Tài").length;
  if (last10Tai >= 7) xiu += 0.15;
  else if (last10Tai <= 3) tai += 0.15;

  if (bridgePred.breakProb > 0.65) {
    if (bridgePred.prediction === 1) tai += 0.2; else xiu += 0.2;
  }

  return tai > xiu ? "Tài" : "Xỉu";
}

/** ================== WS HANDLER ================== **/
function connectWS() {
  if (ws) try { ws.close(); } catch (e) {}
  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    // Ping mỗi 5s, I tăng dần
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      try {
        const packet = { M: "PingPong", H: "luckydiceHub", I: pingId };
        pingId += 1;
        ws.send(JSON.stringify(packet));
      } catch (e) { /* noop */ }
    }, 5000);
  });

  ws.on("message", (raw) => {
    let msg = null;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_e) {
      return;
    }

    // Khuôn dạng bạn đưa: {"C":"...","M":[{"H":"luckydiceHub","M":"sessionInfo","A":[{...}]}]}
    if (!msg || !msg.M || !Array.isArray(msg.M)) return;
    for (let i = 0; i < msg.M.length; i++) {
      const item = msg.M[i];
      if (!item || item.H !== "luckydiceHub" || item.M !== "sessionInfo" || !item.A || !item.A[0]) continue;
      const payload = item.A[0];
      if (!payload || !payload.SessionID || !payload.Result) continue;

      const sessionId = payload.SessionID;
      const d1 = Number(payload.Result.Dice1 || 0);
      const d2 = Number(payload.Result.Dice2 || 0);
      const d3 = Number(payload.Result.Dice3 || 0);
      const sum = d1 + d2 + d3;
      const res = resultFromSum(sum);

      // Chỉ đẩy khi là phiên mới
      if (sessionId !== lastSessionId) {
        lastSessionId = sessionId;
        // lưu lịch sử (để dự đoán phiên kế tiếp)
        history.push({ session: sessionId, result: res, score: sum });
        if (history.length > 500) history.shift();

        // Lưu gói “phiên trước” cho API
        lastPacket = {
          sid: sessionId,
          ket_qua: `${res} = ${d1}+${d2}+${d3}`
        };

        // Cập nhật dự đoán cho phiên kế tiếp
        nextPrediction = generatePrediction(history);
      }
    }
  });

  ws.on("close", () => {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    setTimeout(connectWS, 2000);
  });

  ws.on("error", () => {
    try { ws.close(); } catch (e) {}
  });
}

/** ================== HTTP API ================== **/
const app = express();
app.use(cors());

app.get("/data", (req, res) => {
  const nextSid = lastSessionId ? lastSessionId + 1 : null;
  res.json({
    phien_ke_tiep: { sid: nextSid },
    du_doan: nextPrediction || "Chưa có",
    phien_truoc: lastPacket ? { sid: lastPacket.sid, ket_qua: lastPacket.ket_qua } : null,
    pattern: "AI-LVTD",
    time: formatTime()
  });
});

app.listen(PORT, () => {
  console.log("Server listening on", PORT);
  connectWS();
});
