import express from "express";
import WebSocket from "ws";
import cors from "cors";
import crypto from "crypto";

// ===== CONFIG =====
// Thay link WS mới nhất của bạn vào đây
const WS_URL = "wss://taixiu.ozi8367m37p3dp9l.online/signalr/connect?transport=webSockets&connectionToken=ctR2ud%2F07QhCjvsHy8%2B8sklxFOreYWjm4%2FTUD7ZyetUs67u9DkuqvpwT1qdJGv%2F9Y22%2B2Q2waOlmgI6uCM3mLnBa4cG9cMCfiP9mS9pzvu9h%2B5HldGc%2FQbVMSAafvAYH&connectionData=%5B%7B%22name%22%3A%22luckydiceHub%22%7D%5D&tid=1&access_token=05%2F7JlwSPGy18u5nVxiuWecM%2FO32MkRsB3UwDAmuWFLnnn6%2ByCal3RlRPZbuAJ%2FFcOfIfArsm9ScBVZt2rqYUlkdfHmE3Ol8vFNGvXxQaoETMuaNO%2FbhytwweWJp0sQ%2FbgO0V7r66MsNgWvVXXHbn867p3NHafZUCDvFjZ4cM%2BUWLJ1N0ZLUBEd75urdclUM2pIyfnvizdXXWkv07Fb8RLksJo501hg9Uoz8SRRrWYiW65vTrV2JCJiefRNUoDFoR1%2BF7BN3QstjXuNAgaKwylFH1lKskeEsvK64pZCphEE4EtHbi%2FDyqRldZjxlpgc3kMxI337DEkBY2euTQdE182VylDh6tR1OLrPQmXxCfpGUig5KNPwpgAVQAg9ZrK5j.f1cf33e42392f1abad8309958ddfecd7513103ae3d14831a05c8a56df079a5b1";

// ===== BIẾN LƯU =====
let lastResult = null;
let pingCounter = 1;
let lastProcessedPhien = null;

// ===== THUẬT TOÁN DỰ ĐOÁN MD5 (ĐÃ SỬA VÀ THAY THẾ) =====
/**
 * Creates an MD5 hash of the given string.
 * @param {string} session_code - The input string to hash.
 * @returns {string} The hexadecimal MD5 hash.
 */
function md5_hash(session_code) {
  return crypto.createHash('md5').update(session_code).digest('hex');
}

/**
 * Predicts "Tài" or "Xỉu" based on the MD5 hash of a session code.
 * @param {string} session_code - The session code to use for prediction.
 * @returns {string} "Tài" or "Xỉu".
 */
function predictBySessionId(session_code) {
  try {
    const md5_value = md5_hash(session_code);
    
    // Sử dụng BigInt để chuyển đổi chuỗi hex dài thành số nguyên mà không bị mất độ chính xác
    const md5_int = BigInt(`0x${md5_value}`);
    
    // Chuyển BigInt thành chuỗi để có thể tính tổng các chữ số
    const digit_sum = String(md5_int)
      .split('')
      .reduce((sum, digit) => sum + parseInt(digit, 10), 0);

    return digit_sum % 2 === 0 ? "Xỉu" : "Tài";
  } catch (error) {
    // Trả về "Xỉu" nếu có lỗi
    return "Xỉu";
  }
}
// ===== XỬ LÝ KẾT QUẢ TỪ WEBSOCKET (ĐÃ SỬA LẠI THEO YÊU CẦU MỚI) =====
function handleResult(msg) {
  try {
    const data = msg.M?.find(m => m.H === "luckydiceHub" && m.M === "sessionInfo");
    if (!data || !data.A[0] || !data.A[0].Result) return;

    const result = data.A[0].Result;
    const phienHienTai = data.A[0].SessionID;

    // Chỉ xử lý nếu đây là một phiên mới, tránh lặp lại
    if (phienHienTai === lastProcessedPhien) return;
    lastProcessedPhien = phienHienTai;

    // Lấy thông tin kết quả phiên hiện tại
    const d1 = result.Dice1;
    const d2 = result.Dice2;
    const d3 = result.Dice3;
    const tong = d1 + d2 + d3;
    const ket_qua = tong >= 11 ? "Tài" : "Xỉu";

    // === LOGIC DỰ ĐOÁN MỚI NHẤT THEO YÊU CẦU ===
    // Số phiên hiển thị = phienHienTai - 1
    const phienAPI = BigInt(phienHienTai) - 1n;
    // Số phiên tiếp theo = phienAPI + 1
    const phienTiepTheo = phienAPI + 1n;
    // Thực hiện dự đoán cho phiên tiếp theo
    const duDoan = predictBySessionId(phienTiepTheo.toString());

    // Cập nhật đối tượng lastResult với cấu trúc mới
    lastResult = {
      phien: parseInt(phienAPI.toString(), 10), // Trừ 1 phiên
      d1,
      d2,
      d3,
      tong,
      ket_qua,
      phientieptheo: phienTiepTheo.toString(), // Hiển thị số phiên sau khi đã được tính toán
      du_doan: duDoan, // Dự đoán dựa trên phienTiepTheo
      id: "@lvtd1907"
    };

    console.log(`Phiên API ${phienAPI.toString()}: ${ket_qua} (${tong}) -> Dự đoán phiên ${phienTiepTheo.toString()}: ${duDoan}`);

  } catch (err) {
    console.error("Lỗi xử lý kết quả:", err);
  }
}
// ===== KẾT NỐI WEBSOCKET =====
function connectWS() {
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log("✅ (MD5 Mode) Đã kết nối WS");
    startPing(ws);
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.M) {
          handleResult(msg);
      }
    } catch {}
  });

  ws.on("close", () => {
    console.log("❌ Mất kết nối, thử lại sau 5s...");
    setTimeout(connectWS, 5000);
  });

  ws.on("error", (err) => {
    // Tắt các lỗi nhỏ không quan trọng
  });
}

// Ping WS mỗi 5s để giữ kết nối
function startPing(ws) {
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      const pingMsg = { H: "luckydiceHub", M: "Ping", A: [], I: pingCounter++ };
      ws.send(JSON.stringify(pingMsg));
    } else {
      clearInterval(pingInterval);
    }
  }, 5000);
}

connectWS();

// ===== API EXPRESS =====
const app = express();
app.use(cors());

app.get("/api/ketqua", (req, res) => {
  if (lastResult) {
      res.json(lastResult);
  } else {
      res.status(404).json({ status: "Chưa có dữ liệu, vui lòng chờ phiên mới." });
  }
});

const PORT = process.env.PORT || 11000;
app.listen(PORT, () => {
  console.log(`API (MD5 Mode) đang chạy tại http://localhost:${PORT}`);
});
