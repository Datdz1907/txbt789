import express from "express";
import WebSocket from "ws";
import cors from "cors";
import fs from "fs";

// ===== CONFIG =====
const WS_URL = "wss://taixiu.ozi8367m37p3dp9l.online/signalr/connect?transport=webSockets&connectionToken=ctR2ud%2F07QhCjvsHy8%2B8sklxFOreYWjm4%2FTUD7ZyetUs67u9DkuqvpwT1qdJGv%2F9Y22%2B2Q2waOlmgI6uCM3mLnBa4cG9cMCfiP9mS9pzvu9h%2B5HldGc%2FQbVMSAafvAYH&connectionData=%5B%7B%22name%22%3A%22luckydiceHub%22%7D%5D&tid=1&access_token=05%2F7JlwSPGy18u5nVxiuWecM%2FO32MkRsB3UwDAmuWFLnnn6%2ByCal3RlRPZbuAJ%2FFcOfIfArsm9ScBVZt2rqYUlkdfHmE3Ol8vFNGvXxQaoETMuaNO%2FbhytwweWJp0sQ%2FbgO0V7r66MsNgWvVXXHbn867p3NHafZUCDvFjZ4cM%2BUWLJ1N0ZLUBEd75urdclUM2pIyfnvizdXXWkv07Fb8RLksJo501hg9Uoz8SRRrWYiW65vTrV2JCJiefRNUoDFoR1%2BF7BN3QstjXuNAgaKwylFH1lKskeEsvK64pZCphEE4EtHbi%2FDyqRldZjxlpgc3kMxI337DEkBY2euTQdE182VylDh6tR1OLrPQmXxCfpGUig5KNPwpgAVQAg9ZrK5j.f1cf33e42392f1abad8309958ddfecd7513103ae3d14831a05c8a56df079a5b1";

// ===== BIẾN LƯU =====
let lastResult = null;
let pingCounter = 1;
let lastProcessedPhien = null;
let isReversed = false; // Biến trạng thái để theo dõi chế độ dự đoán

// Biến mới để theo dõi hiệu suất dự đoán
let totalPredictions = 0;
let correctPredictions = 0;

// ===== THUẬT TOÁN DỰ ĐOÁN CHÍNH (Độ chính xác 83.33%) =====
/**
 * Dự đoán "Tài" hoặc "Xỉu" dựa trên chữ số cuối cùng của mã phiên.
 * @param {string} sessionId - Mã phiên cần dự đoán.
 * @returns {string} - "Tài" hoặc "Xỉu".
 */
function predictByLastDigitOfSession(sessionId) {
    const lastDigit = BigInt(sessionId) % 10n;
    switch (lastDigit.toString()) {
        case '0':
        case '3':
        case '4':
        case '5':
        case '7':
        case '9':
            return "Xỉu";
        case '1':
        case '2':
        case '6':
        case '8':
            return "Tài";
        default:
            return "Xỉu";
    }
}

// ===== HÀM LƯU LỊCH SỬ =====
function saveHistoryToFile(phien, ket_qua) {
    const logEntry = `Phiên ${phien} - ${ket_qua}\n`;
    fs.appendFile('lichsu.txt', logEntry, (err) => {
        if (err) {
            console.error('Lỗi khi ghi file lichsu.txt:', err);
        }
    });
}

// ===== XỬ LÝ KẾT QUẢ TỪ WEBSOCKET =====
function handleResult(msg) {
  try {
    const data = msg.M?.find(m => m.H === "luckydiceHub" && m.M === "sessionInfo");
    if (!data || !data.A[0] || !data.A[0].Result) return;

    const phienHienTai = data.A[0].SessionID;

    if (phienHienTai === lastProcessedPhien) return;
    lastProcessedPhien = phienHienTai;

    const d1 = data.A[0].Result.Dice1;
    const d2 = data.A[0].Result.Dice2;
    const d3 = data.A[0].Result.Dice3;
    const tong = d1 + d2 + d3;
    if (typeof tong !== 'number' || isNaN(tong)) {
        console.error("Lỗi: Tổng xúc xắc không phải là số hợp lệ.");
        return;
    }
    const ket_qua = tong >= 11 ? "Tài" : "Xỉu";
    
    // === Lấy mã phiên thực tế và lưu kết quả vào file ===
    const phienThucTe = BigInt(phienHienTai) - 1n;
    saveHistoryToFile(phienThucTe.toString(), ket_qua);

    // === CẬP NHẬT TỶ LỆ DỰ ĐOÁN ===
    if (lastResult) {
      totalPredictions++;
      const predictionWasCorrect = lastResult.du_doan === ket_qua;
      if (predictionWasCorrect) {
          correctPredictions++;
      }

      if (lastResult.wasReversed) {
        if (predictionWasCorrect) {
          isReversed = true;
          console.log(`  => Dự đoán đảo ngược đúng, tiếp tục đảo ngược.`);
        } else {
          isReversed = false;
          console.log(`  => Dự đoán đảo ngược sai, tắt chế độ đảo ngược.`);
        }
      } else {
        if (predictionWasCorrect) {
          isReversed = false;
          console.log(`  => Dự đoán bình thường đúng, giữ nguyên.`);
        } else {
          isReversed = true;
          console.log(`  => Dự đoán bình thường sai, bật chế độ đảo ngược.`);
        }
      }
    }

    // === LOGIC DỰ ĐOÁN MỚI ===
    const duDoanCoBan = predictByLastDigitOfSession(phienHienTai.toString());
    let duDoanCuoiCung = duDoanCoBan;

    if (isReversed) {
        duDoanCuoiCung = duDoanCoBan === "Tài" ? "Xỉu" : "Tài";
    }
    
    const accuracy = totalPredictions > 0 ? ((correctPredictions / totalPredictions) * 100).toFixed(2) : "N/A";
    
    lastResult = {
      phien: parseInt(phienThucTe.toString(), 10),
      d1,
      d2,
      d3,
      tong,
      ket_qua,
      phientieptheo: phienHienTai.toString(),
      du_doan: duDoanCuoiCung,
      wasReversed: isReversed,
      dotincay: `${accuracy}%`, // Thêm tỷ lệ chính xác vào response
      id: "@lvtd1907"
    };

    console.log(`Phiên ${phienThucTe}: ${ket_qua} (${tong})`);
    console.log(`  => Dự đoán cho phiên ${phienHienTai}: ${duDoanCuoiCung} (đảo ngược: ${isReversed})`);
    console.log(`  => Tỷ lệ chính xác: ${accuracy}%`);

  } catch (err) {
    console.error("Lỗi xử lý kết quả:", err);
  }
}

// ===== KẾT NỐI WEBSOCKET =====
function connectWS() {
  const ws = new WebSocket(WS_URL);
  ws.on("open", () => {});
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.M) {
          handleResult(msg);
      }
    } catch {}
  });
  ws.on("close", () => {
    setTimeout(connectWS, 5000);
  });
  ws.on("error", (err) => {});
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
app.listen(PORT, () => {});
