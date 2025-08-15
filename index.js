import express from "express";
import WebSocket from "ws";
import cors from "cors";

// ===== CONFIG =====
const WS_URL =
  "wss://api.apibit.net/websocket?d=YW5CaGJXeGthMjA9fDI0ODl8MTc1NDEzNzM4OTUwOHw5OWMwNGQ5Zjg4YmZhOTE5MjgxMDI5NDgxODdhMWZkZXwzM2U5OGVjMDRmYWU4MTY5MzBmYjZjMjk1NjQ5MjE5MQ==";

const HANDSHAKE = [
  1,
  "MiniGame",
  "syncho01",
  "Ledat1907@",
  {
    signature:
      "62AEDD3AB10F6AC303898BB1763937212B4BD5DB6B07BB1DC9281391282AAA2BFA79DB7423B5F707974CDB0F327C0B92FAE80796A2DE20FFDB578FEE1459861E5B417D99CE8B6F91EFBFC8A19511F4A248E598A3695190EF7F99E7140D5BF51A519119429DC0A38E644ED8C14423F39411D4CC88C675A8E3989144BCB1586C73",
    info: {
      cs: "691e2414a8aa35421716e5b014f768fa",
      phone: "84968239523",
      ipAddress: "42.118.191.0",
      isMerchant: false,
      userId: "0a86bd85-4d3e-45fe-8f6c-63b11182183e",
      deviceId: "250165605115165151486041589641432",
      isMktAccount: false,
      username: "syncho01",
      timestamp: 1754136593817,
    },
    pid: 4,
  },
];

// ===== BIẾN LƯU TRỮ =====
let lastResult = null;
let lichSuPhien = [];
let modelPredictions = {};
let lastPredictionForComparison = null;
let doTinCay = 50.0;

// ===================================================================
// ===== THUẬT TOÁN DỰ ĐOÁN =====
// ===================================================================

function detectStreakAndBreak(history) {
  if (!history || history.length === 0) {
    return { streak: 0, currentResult: null, breakProb: 0 };
  }
  let streak = 1;
  const currentResult = history[history.length - 1].result;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].result === currentResult) streak++;
    else break;
  }
  const last15Results = history.slice(-15).map(item => item.result);
  if (!last15Results.length) {
    return { streak, currentResult, breakProb: 0 };
  }
  const switches = last15Results.slice(1).reduce((count, result, index) => {
    return count + (result !== last15Results[index] ? 1 : 0);
  }, 0);
  const taiCount = last15Results.filter(result => result === 'Tài').length;
  const xiuCount = last15Results.filter(result => result === 'Xỉu').length;
  const imbalance = Math.abs(taiCount - xiuCount) / last15Results.length;
  let breakProb = 0;
  if (streak >= 8) {
    breakProb = Math.min(0.6 + switches / 15 + imbalance * 0.15, 0.9);
  } else if (streak >= 5) {
    breakProb = Math.min(0.35 + switches / 10 + imbalance * 0.25, 0.85);
  } else if (streak >= 3 && switches >= 7) {
    breakProb = 0.3;
  }
  return { streak, currentResult, breakProb };
}

function evaluateModelPerformance(history, modelName, lookback = 10) {
  if (!modelPredictions[modelName] || history.length < 2) return 1;
  lookback = Math.min(lookback, history.length - 1);
  let correctPredictions = 0;
  for (let i = 0; i < lookback; i++) {
    const sessionId = history[history.length - (i + 2)].session;
    const prediction = modelPredictions[modelName][sessionId] || 0;
    const actualResult = history[history.length - (i + 1)].result;
    if ((prediction === 1 && actualResult === 'Tài') || (prediction === 2 && actualResult === 'Xỉu')) {
      correctPredictions++;
    }
  }
  const performanceRatio = lookback > 0 ? 1 + (correctPredictions - lookback / 2) / (lookback / 2) : 1;
  return Math.max(0.5, Math.min(1.5, performanceRatio));
}

function smartBridgeBreak(history) {
  if (!history || history.length < 3) {
    return { prediction: 0, breakProb: 0, reason: 'Không đủ dữ liệu' };
  }
  const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
  const last20Results = history.slice(-20).map(item => item.result);
  const last20Scores = history.slice(-20).map(item => item.score || 0);
  let finalBreakProb = breakProb;
  let reason = '';
  const avgScore = last20Scores.reduce((sum, score) => sum + score, 0) / (last20Scores.length || 1);
  const scoreDeviation = last20Scores.reduce((sum, score) => sum + Math.abs(score - avgScore), 0) / (last20Scores.length || 1);
  const last5Results = last20Results.slice(-5);
  const patternCounts = {};
  for (let i = 0; i <= last20Results.length - 3; i++) {
    const pattern = last20Results.slice(i, i + 3).join(',');
    patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
  }
  const mostCommonPattern = Object.entries(patternCounts).sort((a, b) => b[1] - a[1])[0];
  const hasRepeatingPattern = mostCommonPattern && mostCommonPattern[1] >= 3;
  if (streak >= 6) {
    finalBreakProb = Math.min(finalBreakProb + 0.15, 0.9);
    reason = `[Bẻ Cầu] Chuỗi ${streak} ${currentResult} dài`;
  } else if (streak >= 4 && scoreDeviation > 3) {
    finalBreakProb = Math.min(finalBreakProb + 0.1, 0.85);
    reason = `[Bẻ Cầu] Biến động điểm (${scoreDeviation.toFixed(1)})`;
  } else if (hasRepeatingPattern && last5Results.every(result => result === currentResult)) {
    finalBreakProb = Math.min(finalBreakProb + 0.05, 0.8);
    reason = `[Bẻ Cầu] Mẫu lặp ${mostCommonPattern[0]}`;
  } else {
    finalBreakProb = Math.max(finalBreakProb - 0.15, 0.15);
    reason = '[Theo Cầu]';
  }
  let prediction = finalBreakProb > 0.65 ? (currentResult === 'Tài' ? 2 : 1) : (currentResult === 'Tài' ? 1 : 2);
  return { prediction, breakProb: finalBreakProb, reason };
}

function trendAndProb(history) {
    if (!history || history.length < 3) return 0;
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 5) {
        if (breakProb > 0.75) return currentResult === "Tài" ? 2 : 1;
        return currentResult === "Tài" ? 1 : 2;
    }
    const last15Results = history.slice(-15).map((item) => item.result);
    if (!last15Results.length) return 0;
    const weightedResults = last15Results.map((result, index) => Math.pow(1.2, index));
    const taiWeight = weightedResults.reduce((sum, weight, i) => sum + (last15Results[i] === "Tài" ? weight : 0), 0);
    const xiuWeight = weightedResults.reduce((sum, weight, i) => sum + (last15Results[i] === "Xỉu" ? weight : 0), 0);
    const totalWeight = taiWeight + xiuWeight;
    if (totalWeight > 0 && Math.abs(taiWeight - xiuWeight) / totalWeight >= 0.25) {
        return taiWeight > xiuWeight ? 2 : 1;
    }
    return last15Results[last15Results.length - 1] === "Xỉu" ? 1 : 2;
}

function shortPattern(history) {
    if (!history || history.length < 3) return 0;
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 4) {
        if (breakProb > 0.75) return currentResult === "Tài" ? 2 : 1;
        return currentResult === "Tài" ? 1 : 2;
    }
    const last8Results = history.slice(-8).map((item) => item.result);
    if (!last8Results.length) return 0;
    return last8Results[last8Results.length - 1] === "Xỉu" ? 1 : 2;
}

function meanDeviation(history) {
    if (!history || history.length < 3) return 0;
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 4) {
        if (breakProb > 0.75) return currentResult === "Tài" ? 2 : 1;
        return currentResult === "Tài" ? 1 : 2;
    }
    const last12Results = history.slice(-12).map((item) => item.result);
    if (!last12Results.length) return 0;
    const taiCount = last12Results.filter((result) => result === "Tài").length;
    const xiuCount = last12Results.length - taiCount;
    const imbalance = Math.abs(taiCount - xiuCount) / last12Results.length;
    if (imbalance < 0.35) {
        return last12Results[last12Results.length - 1] === "Xỉu" ? 1 : 2;
    }
    return xiuCount > taiCount ? 1 : 2;
}

function recentSwitch(history) {
    if (!history || history.length < 3) return 0;
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 4) {
        if (breakProb > 0.75) return currentResult === "Tài" ? 2 : 1;
        return currentResult === "Tài" ? 1 : 2;
    }
    const last10Results = history.slice(-10).map((item) => item.result);
    if (!last10Results.length) return 0;
    const switches = last10Results.slice(1).reduce((count, result, index) => {
        return count + (result !== last10Results[index] ? 1 : 0);
    }, 0);
    return switches >= 6 ?
        (last10Results[last10Results.length - 1] === "Xỉu" ? 1 : 2) :
        (last10Results[last10Results.length - 1] === "Xỉu" ? 1 : 2);
}

function isBadPattern(history) {
    if (!history || history.length < 3) return false;
    const last15Results = history.slice(-15).map((item) => item.result);
    if (!last15Results.length) return false;
    const switches = last15Results.slice(1).reduce((count, result, index) => {
        return count + (result !== last15Results[index] ? 1 : 0);
    }, 0);
    const { streak } = detectStreakAndBreak(history);
    return switches >= 9 || streak >= 10;
}


function aiHtddLogic(history) {
  if (!history || history.length < 3) {
    return { prediction: Math.random() < 0.5 ? 'Tài' : 'Xỉu', reason: 'Lịch sử ít' };
  }
  const last5Results = history.slice(-5).map(item => item.result);
  const last5Scores = history.slice(-5).map(item => item.score || 0);
  if (history.length >= 3) {
    const last3 = history.slice(-3).map(item => item.result).join(',');
    if (last3 === 'Tài,Xỉu,Tài') return { prediction: 'Xỉu', reason: 'Mẫu 1T-1X-1T' };
    if (last3 === 'Xỉu,Tài,Xỉu') return { prediction: 'Tài', reason: 'Mẫu 1X-1T-1X' };
  }
  if (history.length >= 4) {
    const last4 = history.slice(-4).map(item => item.result).join(',');
    if (last4 === 'Tài,Tài,Xỉu,Xỉu') return { prediction: 'Tài', reason: 'Mẫu 2T-2X' };
    if (last4 === 'Xỉu,Xỉu,Tài,Tài') return { prediction: 'Xỉu', reason: 'Mẫu 2X-2T' };
  }
  if (history.length >= 9 && history.slice(-6).every(item => item.result === 'Tài')) {
    return { prediction: 'Xỉu', reason: 'Chuỗi Tài dài (6)' };
  }
  if (history.length >= 9 && history.slice(-6).every(item => item.result === 'Xỉu')) {
    return { prediction: 'Tài', reason: 'Chuỗi Xỉu dài (6)' };
  }
  const avgScore = last5Scores.reduce((a, b) => a + b, 0) / (last5Scores.length || 1);
  if (avgScore > 10) return { prediction: 'Tài', reason: `Điểm TB cao (${avgScore.toFixed(1)})` };
  if (avgScore < 8) return { prediction: 'Xỉu', reason: `Điểm TB thấp (${avgScore.toFixed(1)})` };
  
  const taiCount = last5Results.filter(r => r === 'Tài').length;
  const xiuCount = 5 - taiCount;
  if (taiCount > xiuCount + 1) return { prediction: 'Xỉu', reason: `Tài đa số (${taiCount}/5)` };
  if (xiuCount > taiCount + 1) return { prediction: 'Tài', reason: `Xỉu đa số (${xiuCount}/5)` };

  return { prediction: Math.random() < 0.5 ? 'Tài' : 'Xỉu', reason: 'Cân bằng' };
}

function generatePrediction(history) {
    if (!history || history.length === 0) {
        return { prediction: Math.random() < 0.5 ? "Tài" : "Xỉu", reason: "Ngẫu nhiên" };
    }
    if (!modelPredictions.trend) {
        modelPredictions = { trend: {}, short: {}, mean: {}, switch: {}, bridge: {} };
    }
    const currentSession = history[history.length - 1].session;
    const trendPred = trendAndProb(history);
    const shortPred = shortPattern(history);
    const meanPred = meanDeviation(history);
    const switchPred = recentSwitch(history);
    const bridgePred = smartBridgeBreak(history);
    const aiPred = aiHtddLogic(history);

    modelPredictions.trend[currentSession] = trendPred;
    modelPredictions.short[currentSession] = shortPred;
    modelPredictions.mean[currentSession] = meanPred;
    modelPredictions.switch[currentSession] = switchPred;
    modelPredictions.bridge[currentSession] = bridgePred.prediction;

    const modelPerformance = {
        trend: evaluateModelPerformance(history, "trend"),
        short: evaluateModelPerformance(history, "short"),
        mean: evaluateModelPerformance(history, "mean"),
        switch: evaluateModelPerformance(history, "switch"),
        bridge: evaluateModelPerformance(history, "bridge"),
    };

    const modelWeights = {
        trend: 0.2 * modelPerformance.trend,
        short: 0.2 * modelPerformance.short,
        mean: 0.25 * modelPerformance.mean,
        switch: 0.2 * modelPerformance.switch,
        bridge: 0.15 * modelPerformance.bridge,
        aihtdd: 0.2,
    };

    let taiScore = 0;
    let xiuScore = 0;

    if (trendPred === 1) taiScore += modelWeights.trend; else if (trendPred === 2) xiuScore += modelWeights.trend;
    if (shortPred === 1) taiScore += modelWeights.short; else if (shortPred === 2) xiuScore += modelWeights.short;
    if (meanPred === 1) taiScore += modelWeights.mean; else if (meanPred === 2) xiuScore += modelWeights.mean;
    if (switchPred === 1) taiScore += modelWeights.switch; else if (switchPred === 2) xiuScore += modelWeights.switch;
    if (bridgePred.prediction === 1) taiScore += modelWeights.bridge; else if (bridgePred.prediction === 2) xiuScore += modelWeights.bridge;
    if (aiPred.prediction === "Tài") taiScore += modelWeights.aihtdd; else xiuScore += modelWeights.aihtdd;

    if (isBadPattern(history)) {
        taiScore *= 0.8;
        xiuScore *= 0.8;
    }
    if (bridgePred.breakProb > 0.65) {
        if (bridgePred.prediction === 1) taiScore += 0.2;
        else xiuScore += 0.2;
    }

    const finalPrediction = taiScore > xiuScore ? "Tài" : "Xỉu";
    return {
        prediction: finalPrediction,
        reason: `${aiPred.reason} | ${bridgePred.reason}`,
    };
}

// ===================================================================
// ===== XỬ LÝ KẾT QUẢ & WEBSOCKET =====
// ===================================================================

function handleResult(data) {
  const rS = data.rS;
  const match = rS.match(/#(\d+)/);
  if (!match) return;

  const phien = parseInt(match[1]);
  const d1 = data.d1;
  const d2 = data.d2;
  const d3 = data.d3;
  const tong = d1 + d2 + d3;
  const ket_qua = tong >= 11 ? "Tài" : "Xỉu";

  if (lastPredictionForComparison && lastPredictionForComparison.prediction) {
    if (lastPredictionForComparison.prediction === ket_qua) {
      doTinCay = Math.min(99.0, doTinCay + 1.5);
    } else {
      doTinCay = Math.max(10.0, doTinCay - 2.0);
    }
  }

  const newHistoryEntry = { session: phien, result: ket_qua, score: tong };
  lichSuPhien.push(newHistoryEntry);
  if (lichSuPhien.length > 200) lichSuPhien.shift();

  const predictionResult = generatePrediction(lichSuPhien);
  lastPredictionForComparison = { prediction: predictionResult.prediction };

  lastResult = {
    phien,
    xuc_xac_1: d1,
    xuc_xac_2: d2,
    xuc_xac_3: d3,
    tong,
    ket_qua,
    du_doan: predictionResult.prediction,
    pattern: predictionResult.reason,
    do_tin_cay: parseFloat(doTinCay.toFixed(2))
  };

  console.log(`Phiên #${phien}: ${ket_qua} - Dự đoán: ${lastResult.du_doan} - Tin cậy: ${lastResult.do_tin_cay}%`);
}

// ===== WEBSOCKET =====
function startPing(ws) {
  setInterval(() => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify([7, "MiniGame", 8, Date.now()]));
      }
    } catch (err) {
      console.log("Ping error:", err);
    }
  }, 5000);
}

function connectWS() {
  const ws = new WebSocket(WS_URL);
  ws.on("open", () => {
    console.log("WebSocket connected");
    ws.send(JSON.stringify(HANDSHAKE));
    setTimeout(() => {
      ws.send(JSON.stringify([6, "MiniGame", "taixiuMd5Plugin", { cmd: 1105 }]));
      console.log("Joined room taixiuMd5Plugin");
    }, 1000);
    startPing(ws);
  });
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (Array.isArray(data) && typeof data[1] === "object" && data[1].cmd === 1103) {
        handleResult(data[1]);
      }
    } catch {}
  });
  ws.on("close", () => {
    console.log("WebSocket closed, reconnecting...");
    setTimeout(connectWS, 5000);
  });
  ws.on("error", (err) => {
    console.log("WebSocket error:", err);
  });
}

connectWS();

// ===== API SERVER (ĐÃ CHỈNH SỬA) =====
const app = express();
app.use(cors());

app.get("/api/taixiu", (req, res) => {
  if (lastResult) {
    // Trả về JSON với định dạng mà file HTML yêu cầu cho Sunwin
    res.json({
      phien: lastResult.phien,
      du_doan: lastResult.du_doan,
      do_tin_cay: `${lastResult.do_tin_cay}%`,
      ket_qua: lastResult.ket_qua
    });
  } else {
    res.status(404).json({
      message: "Chưa có dữ liệu, vui lòng chờ phiên mới.",
    });
  }
});

const PORT = process.env.PORT || 11000;
app.listen(PORT, () => {
  console.log(`API server is running at http://localhost:${PORT}`);
});
