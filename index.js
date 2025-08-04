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

// ===== BIẾN LƯU =====
let lastResult = null;
let lichSuKetQua = [];
let thongKeChiTiet = { dung: 0, sai: 0 };

// Load pattern từ file
let PATTERN_DATA = "";
try {
  PATTERN_DATA = fs.readFileSync("pattern.txt", "utf8").trim();
} catch (e) {
  console.error("Không đọc được file pattern.txt");
}

// ===== DỰ ĐOÁN THEO PATTERN =====
function duDoanBangPattern(history) {
  if (history.length < 3) {
    return { duDoan: "Chưa đủ dữ liệu", method: "pattern" };
  }

  let seq = history.slice(-4).join("");
  let len = 4;

  // Nếu chuỗi 4 ký tự không tìm thấy thì fallback xuống 3 ký tự
  let sub = PATTERN_DATA;
  let counts = { T: 0, X: 0 };

  function countNext(seq) {
    let total = { T: 0, X: 0 };
    for (let i = 0; i < sub.length - seq.length; i++) {
      if (sub.substr(i, seq.length) === seq) {
        const next = sub[i + seq.length];
        if (next === "T") total.T++;
        else if (next === "X") total.X++;
      }
    }
    return total;
  }

  counts = countNext(seq);

  if (counts.T === 0 && counts.X === 0) {
    // fallback 3 ký tự
    len = 3;
    seq = history.slice(-3).join("");
    counts = countNext(seq);
  }

  if (counts.T === 0 && counts.X === 0) {
    return { duDoan: "Chưa đủ dữ liệu", method: "pattern" };
  }

  const duDoan = counts.T >= counts.X ? "Tài" : "Xỉu";
  console.log(`Pattern ${seq} => T:${counts.T} | X:${counts.X}`);
  return { duDoan, method: "pattern" };
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

  // Lưu lịch sử (T = Tài, X = Xỉu)
  lichSuKetQua.push(ket_qua === "Tài" ? "T" : "X");
  if (lichSuKetQua.length > 1000) lichSuKetQua.shift();

  const { duDoan, method } = duDoanBangPattern(lichSuKetQua);

  // Cập nhật thống kê đúng/sai
  if (duDoan !== "Chưa đủ dữ liệu") {
    if (duDoan === ket_qua) {
      thongKeChiTiet.dung++;
    } else {
      thongKeChiTiet.sai++;
    }
  }

  lastResult = {
    phien,
    xuc_xac_1: d1,
    xuc_xac_2: d2,
    xuc_xac_3: d3,
    tong,
    ket_qua,
    du_doan: duDoan,
    method,
  };

  console.log("Cập nhật dữ liệu:", lastResult);
  console.log(
    `Thống kê đúng/sai: Đúng = ${thongKeChiTiet.dung} | Sai = ${thongKeChiTiet.sai}`
  );
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
    console.log("WebSocket connected");
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
    console.log("WebSocket closed, reconnecting in 5s...");
    setTimeout(connectWS, 5000);
  });

  ws.on("error", (err) => {
    console.log("WebSocket error:", err);
  });
}

connectWS();

// ===== API GET =====
const app = express();
app.use(cors());

app.get("/api/ketqua", (req, res) => {
  if (lastResult) {
    res.json(lastResult);
  } else {
    res.json({ status: "chưa có dữ liệu" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});
