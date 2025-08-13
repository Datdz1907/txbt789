import express from "express";
import WebSocket from "ws";
import cors from "cors";
import fs from "fs";

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

// ===== ĐỌC FILE PATTERN =====
let patternData = "";
try {
  patternData = fs.readFileSync("pattern.txt", "utf8").trim();
  console.log(`Đã load pattern.txt (${patternData.length} ký tự)`);
} catch {
  console.log("pattern.txt chưa tồn tại, sẽ tạo mới.");
}

// ===== BIẾN LƯU =====
let lastResult = null;
let lichSuKetQua = [];

// ===== LƯU KẾT QUẢ VÀO FILE =====
function appendPattern(ketQua) {
  const char = ketQua === "Tài" ? "t" : "x";
  fs.appendFileSync("pattern.txt", char);
  patternData += char;
  console.log(`📄 Lưu ${ketQua} → ${char} vào pattern.txt`);
}

// ===== DỰ ĐOÁN =====
function duDoanTheoPattern(history) {
  if (history.length < 4 || !patternData) {
    return "Chưa đủ dữ liệu";
  }
  const seq = history.slice(-4).join("");
  const counts = { t: 0, x: 0 };

  for (let i = 0; i <= patternData.length - 5; i++) {
    if (patternData.slice(i, i + 4) === seq) {
      const nextChar = patternData[i + 4];
      if (nextChar === "t" || nextChar === "x") {
        counts[nextChar]++;
      }
    }
  }

  if (counts.t === 0 && counts.x === 0) {
    return "Chưa đủ dữ liệu";
  }
  if (counts.t > counts.x) return "Tài";
  if (counts.x > counts.t) return "Xỉu";
  return "Chưa đủ dữ liệu";
}

// ===== XỬ LÝ KẾT QUẢ =====
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

  lichSuKetQua.push(ket_qua === "Tài" ? "t" : "x");
  if (lichSuKetQua.length > 1000) lichSuKetQua.shift();

  appendPattern(ket_qua);

  const duDoan = duDoanTheoPattern(lichSuKetQua);

  lastResult = {
    phien,
    xuc_xac_1: d1,
    xuc_xac_2: d2,
    xuc_xac_3: d3,
    tong,
    ket_qua,
    du_doan: duDoan,
  };

  console.log("📥", lastResult);
}

// ===== WEBSOCKET =====
function startPing(ws) {
  setInterval(() => {
    const pingMsg = [7, "MiniGame", 8, Date.now()];
    ws.send(JSON.stringify(pingMsg));
  }, 5000);
}

function connectWS() {
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log("🔌 WebSocket connected");
    ws.send(JSON.stringify(HANDSHAKE));

    setTimeout(() => {
      const joinMsg = [6, "MiniGame", "taixiuMd5Plugin", { cmd: 1105 }];
      ws.send(JSON.stringify(joinMsg));
      console.log("Join room taixiuMd5Plugin sent");
    }, 1000);

    startPing(ws);
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (Array.isArray(data) && typeof data[1] === "object") {
        if (data[1].cmd === 1103) {
          handleResult(data[1]);
        }
      }
    } catch {}
  });

  ws.on("close", () => {
    console.log("⚠️ WebSocket closed, reconnecting in 5s...");
    setTimeout(connectWS, 5000);
  });

  ws.on("error", (err) => {
    console.log("❌ WebSocket error:", err);
  });
}

connectWS();

// ===== API =====
const app = express();
app.use(cors());

// API cũ
app.get("/api/ketqua", (req, res) => {
  if (lastResult) {
    res.json(lastResult);
  } else {
    res.json({ status: "chưa có dữ liệu" });
  }
});

// API cho 1.html
app.get("/api/taixiu", (req, res) => {
  if (lastResult) {
    res.json({
      current_session: lastResult.phien,
      current_result: lastResult.ket_qua,
      next_session: lastResult.phien + 1,
      prediction: lastResult.du_doan || "--"
    });
  } else {
    res.json({
      current_session: "--",
      current_result: "--",
      next_session: "--",
      prediction: "--"
    });
  }
});

const PORT = process.env.PORT || 11000;
app.listen(PORT, () => {
  console.log(`🚀 API server running at http://localhost:${PORT}`);
});
