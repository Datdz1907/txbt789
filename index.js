import WebSocket from 'ws';
import axios from 'axios';
import express from 'express';
import cors from 'cors';

const WS_URL = 'wss://api.apibit.net/websocket?d=YW5CaGJXeGthMjA9fDI0ODl8MTc1NDEzNzM4OTUwOHw5OWMwNGQ5Zjg4YmZhOTE5MjgxMDI5NDgxODdhMWZkZXwzM2U5OGVjMDRmYWU4MTY5MzBmYjZjMjk1NjQ5MjE5MQ==';
const HANDSHAKE = [
  1,
  'MiniGame',
  'syncho01',
  'Ledat1907@',
  {
    signature:
      '62AEDD3AB10F6AC303898BB1763937212B4BD5DB6B07BB1DC9281391282AAA2BFA79DB7423B5F707974CDB0F327C0B92FAE80796A2DE20FFDB578FEE1459861E5B417D99CE8B6F91EFBFC8A19511F4A248E598A3695190EF7F99E7140D5BF51A519119429DC0A38E644ED8C14423F39411D4CC88C675A8E3989144BCB1586C73',
    info: {
      cs: '691e2414a8aa35421716e5b014f768fa',
      phone: '84968239523',
      ipAddress: '42.118.191.0',
      isMerchant: false,
      userId: '0a86bd85-4d3e-45fe-8f6c-63b11182183e',
      deviceId: '250165605115165151486041589641432',
      isMktAccount: false,
      username: 'syncho01',
      timestamp: 1754136593817,
    },
    pid: 4,
  },
];

// Thuật toán
function algo1(md5) {
  const sum = md5
    .split('')
    .map(c => c.charCodeAt(0))
    .reduce((a, b) => a + b, 0);
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

// Vote thuật toán rồi đảo kết quả
function voteAndReverse(md5) {
  const results = [algo1(md5), algo3(md5), algo5(md5)];
  const tai = results.filter(r => r === 'tài').length;
  const final = tai >= 2 ? 'xỉu' : 'tài'; // đảo
  return final;
}

// Gửi dữ liệu đến API
async function postToAPI(phien, md5, du_doan) {
  try {
    await axios.post('http://localhost:11000/api/ketqua', {
      phien,
      md5,
      du_doan,
    });
    console.log(`📤 Đã gửi API: phiên ${phien}, md5: ${md5}, dự đoán: ${du_doan}`);
  } catch (err) {
    console.error('❌ Lỗi gửi API:', err.message);
  }
}

// WebSocket
function connectWebSocket() {
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('🔌 WebSocket đã kết nối.');
    ws.send(JSON.stringify(HANDSHAKE));

    // Ping mỗi 10 giây
    setInterval(() => {
      const pingMsg = [7, 'MiniGame', 50, Date.now()];
      ws.send(JSON.stringify(pingMsg));
    }, 10000);
  });

  ws.on('message', data => {
    try {
      const msg = JSON.parse(data);

      if (Array.isArray(msg) && msg[0] === 5 && msg[1]?.cmd === 1102) {
        const { rS: md5, sid: phien } = msg[1];
        const du_doan = voteAndReverse(md5);
        console.log(`📥 Nhận: phiên ${phien}, md5: ${md5}, dự đoán: ${du_doan}`);
        postToAPI(phien, md5, du_doan);
      }
    } catch (e) {
      console.error('❗ Lỗi phân tích WebSocket:', e.message);
    }
  });

  ws.on('close', () => {
    console.warn('⚠️ Mất kết nối WebSocket. Thử lại sau 5s.');
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', err => {
    console.error('🚨 Lỗi WebSocket:', err.message);
  });
}

// Express server (port 11000)
const app = express();
app.use(cors()); // Cho phép mọi domain
app.use(express.json());

app.post('/api/ketqua', (req, res) => {
  console.log('📩 Dữ liệu từ client:', req.body);
  res.sendStatus(200);
});

app.listen(11000, () => {
  console.log('🚀 API server chạy tại http://localhost:11000');
});

// Khởi động
connectWebSocket();
