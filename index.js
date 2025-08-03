import express from "express";
import WebSocket from "ws";
import cors from "cors";
import fs from "fs";
import pkg from "synaptic";
const { Architect, Trainer } = pkg;

// ========== CONFIG ==========
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

// ========== ĐỌC FILE PATTERN ==========
const patternFile = "./pattern.txt";
let rawPattern = "";
try {
  rawPattern = fs.readFileSync(patternFile, "utf8").trim();
  console.log(`Đã load ${rawPattern.length} ký tự từ pattern.txt`);
} catch (e) {
  console.log("Không tìm thấy pattern.txt, sẽ huấn luyện với dữ liệu rỗng");
  rawPattern = "";
}

// ========== TẠO DATASET TỪ PATTERN ==========
function createDataset(pattern, seqLen = 5) {
  const dataset = [];
  const convert = (ch) => (ch === "T" ? 1 : 0);
  for (let i = 0; i <= pattern.length - seqLen; i++) {
    const seq = pattern.slice(i, i + seqLen);
    const inputs = seq.slice(0, seqLen - 1).split("").map(convert);
    const target = convert(seq[seqLen - 1]);
    dataset.push({ input: inputs, output: [target] });
  }
  return dataset;
}

// ========== HUẤN LUYỆN MÔ HÌNH SYNAPTIC ==========
let model = null;
if (rawPattern.length >= 10) {
  const dataset = createDataset(rawPattern, 5);
  model = new Architect.Perceptron(4, 8, 1);
  const trainer = new Trainer(model);
  trainer.train(dataset, {
    rate: 0.1,
    iterations: 5000,
    shuffle: true,
    log: 1000,
  });
  console.log("Đã huấn luyện mô hình Synaptic từ pattern.txt");
} else {
  console.log("Không đủ dữ liệu để huấn luyện model");
}

// ========== DỰ ĐOÁN BẰNG MÔ HÌNH ==========
function predict(history) {
  if (!model || history.length < 4) return "Chưa đủ dữ liệu";

  const recent = history.slice(-4).map((x) => (x === "T" ? 1 : 0));
  const output = model.activate(recent);
  return output[0] > 0.5 ? "Tài" : "Xỉu";
}

// ========== BIẾN TOÀN CỤC ==========
let lastResult = null;
let history = [];
let thongKe = { Tai: 0, Xiu: 0 };

// ========== XỬ LÝ KHI CÓ KẾT QUẢ MỚI ==========
function handleResult(data) {
  const match = data.rS.match(/#(\d+)/);
  if (!match) return;

  const phien = parseInt(match[1]);
  const d1 = data.d1,
    d2 = data.d2,
    d3 = data.d3;
  const tong = d1 + d2 + d3;
  const ket_qua = tong >= 11 ? "Tài" : "Xỉu";

  history.push(ket_qua === "Tài" ? "T" : "X");
  if (history.length > 1000) history.shift();

  const du_doan = predict(history);

  lastResult = {
    phien,
    xuc_xac_1: d1,
    xuc_xac_2: d2,
    xuc_xac_3: d3,
    tong,
    ket_qua,
    du_doan,
  };

  console.log("Cập nhật dữ liệu:", lastResult);

  // Thống kê đúng/sai
  if (du_doan !== "Chưa đủ dữ liệu" && du_doan === ket_qua) {
    if (ket_qua === "Tài") thongKe.Tai++;
    else thongKe.Xiu++;
  }
  console.log(`Thống kê: Tài = ${thongKe.Tai} | Xỉu = ${thongKe.Xiu}`);
}

// ========== WEBSOCKET ==========
function startPing(ws) {
  setInterval(() => {
    ws.send(JSON.stringify([7, "MiniGame", 8, Date.now()]));
  }, 5000);
}

function connectWS() {
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log("WebSocket connected");
    ws.send(JSON.stringify(HANDSHAKE));

    setTimeout(() => {
      ws.send(JSON.stringify([6, "MiniGame", "taixiuMd5Plugin", { cmd: 1105 }]));
      console.log("Join room taixiuMd5Plugin sent");
    }, 1000);

    startPing(ws);
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (Array.isArray(data) && typeof data[1] === "object") {
        if (data[1].cmd === 1103) handleResult(data[1]);
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

// ========== API EXPRESS ==========
const app = express();
app.use(cors());

app.get("/api/ketqua", (req, res) => {
  if (lastResult) res.json(lastResult);
  else res.json({ status: "chưa có dữ liệu" });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`API server running at http://localhost:${PORT}`)
);
