import sys
import joblib

# Load model đã train từ file model5.pkl
model = joblib.load("model5.pkl")

# Nhận chuỗi 5 ký tự từ tham số dòng lệnh
seq = sys.argv[1].strip().upper()  # Ví dụ: "TXTTX"

# Chuyển thành vector số (T=1, X=0)
X = [[1 if c == "T" else 0 for c in seq]]

# Dự đoán
pred = model.predict(X)[0]

# In kết quả
print("Tài" if pred == 1 else "Xỉu")
