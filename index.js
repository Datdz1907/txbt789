import WebSocket from 'ws';
import axios from 'axios';

const WS_URL = "wss://api.apibit.net/websocket?d=YW5CaGJXeGthMjA9fDI0ODl8MTc1NDEzNzM4OTUwOHw5OWMwNGQ5Zjg4YmZhOTE5MjgxMDI5NDgxODdhMWZkZXwzM2U5OGVjMDRmYWU4MTY5MzBmYjZjMjk1NjQ5MjE5MQ==";

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

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('🔌 WebSocket đã kết nối.');
  ws.send(JSON.stringify(HANDSHAKE));

  // Gửi ping định kỳ mỗi 10 giây
  setInterval(() => {
    const pingPacket = [7, "MiniGame", 50, Date.now()];
    ws.send(JSON.stringify(pingPacket));
  }, 10000);
});

ws.on('close', () => {
  console.log('⚠️ Mất kết nối WebSocket. Thử lại sau 5s.');
  setTimeout(() => {
    process.exit(1); // Để Render tự restart lại app
  }, 5000);
});

ws.on('message', async (data) => {
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return;

    const [type, payload] = parsed;
    if (type !== 5 || !payload || payload.cmd !== 1102 || !payload.rS) return;

    const md5 = payload.rS;
    const sid = payload.sid;

    const result = duDoanTuMD5(md5);
    console.log(`🎯 Phiên ${sid} | MD5: ${md5} => Dự đoán: ${result}`);

    // Gửi kết quả lên API
    await axios.post('http://localhost:11000/api/ketqua', {
      phien: sid,
      md5,
      du_doan: result,
    });
  } catch (err) {
    console.error('❌ Lỗi khi xử lý message:', err);
  }
});

// Ba thuật toán dự đoán từ MD5
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

// Bỏ phiếu 3 thuật toán, đảo ngược kết quả
function duDoanTuMD5(md5) {
  const votes = [algo1(md5), algo3(md5), algo5(md5)];
  const count = { tài: 0, xỉu: 0 };
  votes.forEach(v => count[v]++);
  const result = count['tài'] > count['xỉu'] ? 'xỉu' : 'tài'; // đảo ngược
  return result;
}
