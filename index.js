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
let history = []; // Lưu lịch sử kết quả của các phiên trước

// Biến mới để theo dõi hiệu suất dự đoán
let totalPredictions = 0;
let correctPredictions = 0;

// ===== HÀM LƯU LỊCH SỬ =====
function saveHistoryToFile(phien, ket_qua) {
    const logEntry = `Phiên ${phien} - ${ket_qua}\n`;
    fs.appendFile('lichsu.txt', logEntry, (err) => {
        if (err) {
            console.error('Lỗi khi ghi file lichsu.txt:', err);
        }
    });
}

// ===== THUẬT TOÁN DỰ ĐOÁN THEO CẦU THỰC CHIẾN =====
function getPredictionFromHistory(history) {
    const count = history.length;
    const MIN_HISTORY = 4; // Cần tối thiểu 4 phiên để nhận diện các cầu phức tạp

    if (count < MIN_HISTORY) {
        const remaining = MIN_HISTORY - count;
        return { prediction: null, pattern: `Chờ ${remaining} phiên nữa để dự đoán` };
    }

    const last = history[count - 1];
    const last2 = history[count - 2];
    const last3 = history[count - 3];
    const last4 = history[count - 4];
    
    // Đếm cầu bệt
    let longStreak = 0;
    for (let i = count - 1; i >= 0; i--) {
        if (history[i] === last) {
            longStreak++;
        } else {
            break;
        }
    }
    
    // === CÁC CẦU PHỨC TẠP VÀ ƯU TIÊN CAO NHẤT ===
    
    // Quy tắc 1: Cầu bệt dài (> 5 phiên), ưu tiên bẻ cầu
    if (longStreak >= 5) {
        return { prediction: last === "Tài" ? "Xỉu" : "Tài", pattern: `Bệt dài (${longStreak} phiên), bẻ cầu` };
    }

    // Quy tắc 2: Cầu 1-2-3 (Ví dụ: Tài-Xỉu-Xỉu-Tài-Tài-Tài)
    // Đây là một ví dụ mẫu. Các cầu 1-2-3 thực tế có thể phức tạp hơn.
    if (count >= 6) {
        const last6 = history.slice(-6);
        const is123 = 
            (last6[0] !== last6[1] && last6[1] === last6[2] && last6[2] !== last6[3] && last6[3] === last6[4] && last6[4] === last6[5]);
        if (is123) {
            return { prediction: last6[0], pattern: "Cầu 1-2-3" };
        }
    }

    // Quy tắc 3: Cầu 1-1 (Tài-Xỉu-Tài...)
    if (last !== last2 && last2 !== last3) {
        return { prediction: last === "Tài" ? "Xỉu" : "Tài", pattern: "Cầu 1-1" };
    }
    
    // Quy tắc 4: Cầu 2-2 (Tài-Tài-Xỉu-Xỉu...)
    if (last === last2 && last2 !== last3 && last3 === last4) {
        return { prediction: last === "Tài" ? "Xỉu" : "Tài", pattern: "Cầu 2-2" };
    }
    
    // Quy tắc 5: Cầu 3-3 (Tài-Tài-Tài-Xỉu-Xỉu-Xỉu...)
    if (last === last2 && last2 === last3 && last3 !== last4) {
        return { prediction: last === "Tài" ? "Xỉu" : "Tài", pattern: "Cầu 3-3" };
    }

    // Quy tắc 6: Cầu bệt ngắn
    if (longStreak >= 2) {
        return { prediction: last, pattern: `Bệt ngắn (${longStreak} phiên)` };
    }
    
    // Dự đoán mặc định: Đảo ngược kết quả cuối
    return { prediction: last === "Tài" ? "Xỉu" : "Tài", pattern: "Mặc định (đảo)" };
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
    
    // Cập nhật lịch sử và giữ tối đa 20 phiên
    history.push(ket_qua);
    if (history.length > 20) {
        history.shift();
    }
    
    // === CẬP NHẬT TỶ LỆ DỰ ĐOÁN ===
    if (lastResult && lastResult.du_doan) {
      totalPredictions++;
      if (lastResult.du_doan === ket_qua) {
        correctPredictions++;
      }
    }
    
    // === Lấy mã phiên thực tế và lưu kết quả vào file ===
    const phienThucTe = BigInt(phienHienTai) - 1n;
    saveHistoryToFile(phienThucTe.toString(), ket_qua);

    // === LOGIC DỰ ĐOÁN MỚI THEO CẦU THỰC CHIẾN ===
    const phienTiepTheo = BigInt(phienHienTai) + 1n;
    const { prediction: duDoanCuoiCung, pattern: cauDangDung } = getPredictionFromHistory(history);
    
    const accuracy = totalPredictions > 0 ? ((correctPredictions / totalPredictions) * 100).toFixed(2) : "N/A";

    lastResult = {
      phien: parseInt(phienThucTe.toString(), 10),
      d1,
      d2,
      d3,
      tong,
      ket_qua,
      phientieptheo: phienTiepTheo.toString(),
      du_doan: duDoanCuoiCung,
      do_tin_cay: `${accuracy}%`, // Thay đổi tên trường thành "do_tin_cay"
      pattern: cauDangDung, // Thêm trường "pattern" mới
      id: "@lvtd1907"
    };

    console.log(`Phiên ${phienThucTe}: ${ket_qua} (${tong})`);
    console.log(`  => Lịch sử: [${history.join(', ')}]`);
    console.log(`  => Cầu đang dùng: ${cauDangDung}`);
    if (duDoanCuoiCung) {
      console.log(`  => Dự đoán cho phiên ${phienTiepTheo}: ${duDoanCuoiCung}`);
      console.log(`  => Độ tin cậy: ${accuracy}%`);
    }

  } catch (err) {
    console.error("Lỗi xử lý kết quả:", err);
  }
}

// ===== KẾT NỐI WEBSOCKET =====
function connectWS() {
  const ws = new WebSocket(WS_URL);
  ws.on("open", () => {
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
app.listen(PORT, () => {
  console.log(`API đang chạy tại http://localhost:${PORT}`);
});
