import express from "express";
import WebSocket from "ws";
import axios from "axios";
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

let lastResult = null;

// ===== ALGORITHMS =====
function algo1(md5) {
  const sum = md5
    .split("")
    .map(c => c.charCodeAt(0))
    .reduce((a, b) => a + b, 0);
  return sum % 2 === 0 ? "Tài" : "Xỉu";
}

function algo3(md5) {
  const digits = md5.replace(/[a-f]/gi, "");
  const digitSum = digits.split("").reduce((a, b) => a + parseInt(b), 0);
  return digitSum % 2 === 0 ? "Xỉu" : "Tài";
}

function algo5(md5) {
  const ascii = [...md5].map(c => c.charCodeAt(0));
  const score = (ascii[0] + ascii[ascii.length - 1]) % 3;
  return score === 0 ? "Xỉu" : "Tài";
}

// ===== HANDLE DATA =====
function handleResult(data) {
  const md5 = data.rS;
  const sid = data.sid;

  const kq1 = algo1(md5);
  const kq2 = algo3(md5);
  const kq3 = algo5(md5);

  const counts = { Tài: 0, Xỉu: 0 };
  [kq1, kq2, kq3].forEach(k => counts[k]++);

  let vote = counts["Tài"] > counts["Xỉu"] ? "Tài" : "Xỉu";
  let nguoc = vote === "Tài" ? "Xỉu" : "Tài";

  lastResult = {
    phien: sid,
    md5: md5,
    du_doan: nguoc,
  };

  console.log("✅ Dự đoán:", lastResult);

  axios
    .post("http://localhost:11000/api/ketqua", lastResult)
    .catch(err => console.log("❌ Gửi API lỗi:", err.message));
}

// ===== WEBSOCKET =====
function connectWS() {
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log("🔌 WebSocket đã kết nối.");
    ws.send(JSON.stringify(HANDSHAKE));
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (Array.isArray(data) && data[1]?.cmd === 1102 && data[1]?.rS) {
        handleResult(data[1]);
      }
    } catch (err) {
      console.log("❌ Lỗi parse dữ liệu:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("⚠️ Mất kết nối WebSocket. Thử lại sau 5s.");
    setTimeout(connectWS, 5000);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket lỗi:", err.message);
  });
}
connectWS();

// ===== EXPRESS API =====
const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/ketqua", (req, res) => {
  if (lastResult) res.json(lastResult);
  else res.json({ status: "Chưa có dữ liệu" });
});

app.post("/api/ketqua", (req, res) => {
  console.log("📦 POST từ client:", req.body);
  res.json({ status: "Đã nhận" });
});

const PORT = process.env.PORT || 11000;
app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
});
