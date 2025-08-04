import WebSocket from 'ws';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

// Cấu hình
const WS_URL = "wss://api.apibit.net/websocket?d=YW5CaGJXeGthMjA9fDI0ODl8MTc1NDEzNzM4OTUwOHw5OWMwNGQ5Zjg4YmZhOTE5MjgxMDI5NDgxODdhMWZkZXwzM2U5OGVjMDRmYWU4MTY5MzBmYjZjMjk1NjQ5MjE5MQ==";

const HANDSHAKE = [
  1,
  "MiniGame",
  "syncho01",
  "Ledat1907@",
  {
    signature: "62AEDD3AB10F6AC303898BB1763937212B4BD5DB6B07BB1DC9281391282AAA2BFA79DB7423B5F707974CDB0F327C0B92FAE80796A2DE20FFDB578FEE1459861E5B417D99CE8B6F91EFBFC8A19511F4A248E598A3695190EF7F99E7140D5BF51A519119429DC0A38E644ED8C14423F39411D4CC88C675A8E3989144BCB1586C73",
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
  }
];

// Thuật toán MD5
function algo1(md5) {
  const sum = md5.split('').map(c => c.charCodeAt(0)).reduce((a, b) => a + b, 0);
  return sum % 2 === 0 ? 'tài' : 'xỉu';
}

function algo3(md5) {
  const digits = md5.replace(/[a-f]/gi, '');
  const digitSum = digits.split('').reduce((a, b) => a + parseInt(b), 0);
  return digitSum % 2 === 0 ? 'xỉu' : 'tài';
}

function algo5(md5) {
  const ascii = [...md5].map(c => c.charCodeAt(0));
  const score = (ascii[0] + ascii[ascii.length - 1]) % 3;
  return score === 0 ? 'xỉu' : 'tài';
}

// Biến lưu kết quả mới nhất
let latestResult = {
  phien: null,
  md5: null,
  du_doan: null,
};

// Tạo server API
const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post('/api/ketqua', (req, res) => {
  const { phien, md5, du_doan } = req.body;
  latestResult = { phien, md5, du_doan };
  console.log("📩 Kết quả gửi API:", latestResult);
  res.json({ success: true });
});

app.get('/api/ketqua', (req, res) => {
  if (latestResult.phien) {
    res.json(latestResult);
  } else {
    res.json({ message: 'Chưa có dữ liệu.' });
  }
});

const PORT = process.env.PORT || 11000;
app.listen(PORT, () => {
  console.log(`🚀 API đang chạy tại http://localhost:${PORT}/api/ketqua`);
});

// Kết nối WebSocket
function connectWS() {
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('🔌 WebSocket đã kết nối.');
    ws.send(JSON.stringify(HANDSHAKE));

    // Gửi ping mỗi 10 giây
    setInterval(() => {
      const ping = [7, "MiniGame", 50, Date.now()];
      ws.send(JSON.stringify(ping));
    }, 10000);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      // Nhận gói có MD5 (cmd: 1102)
      if (msg[0] === 5 && msg[1]?.cmd === 1102) {
        const { rS: md5, sid: phien } = msg[1];
        const result1 = algo1(md5);
        const result2 = algo3(md5);
        const result3 = algo5(md5);

        const votes = [result1, result2, result3];
        const tai = votes.filter(v => v === 'tài').length;
        const xiu = votes.filter(v => v === 'xỉu').length;
        const du_doan = tai > xiu ? 'xỉu' : 'tài'; // Đảo kết quả

        const payload = { phien, md5, du_doan };
        console.log('📥 Dự đoán:', payload);

        // Gửi lên API
        fetch(`http://localhost:${PORT}/api/ketqua`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
    } catch (e) {
      console.error('❌ Lỗi xử lý tin nhắn:', e.message);
    }
  });

  ws.on('close', () => {
    console.warn('⚠️ Mất kết nối WebSocket. Thử lại sau 5s.');
    setTimeout(connectWS, 5000);
  });

  ws.on('error', (err) => {
    console.error('💥 WebSocket lỗi:', err.message);
  });
}

connectWS();
