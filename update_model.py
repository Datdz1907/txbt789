import sys
import os
import joblib
from sklearn.linear_model import SGDClassifier

MODEL_FILE = "model5.pkl"

seq = sys.argv[1].strip().upper()
label = int(sys.argv[2])  # 1 = Tài, 0 = Xỉu

# Chuyển chuỗi TX thành vector
X_new = [[1 if c == "T" else 0 for c in seq]]
y_new = [label]

# Tải model nếu có, nếu không thì tạo mới
if os.path.exists(MODEL_FILE):
    model = joblib.load(MODEL_FILE)
else:
    model = SGDClassifier(loss="log")
    # cần init classes cho partial_fit
    model.partial_fit([[0,0,0,0,0]], [0], classes=[0, 1])

# Cập nhật model với dữ liệu mới
model.partial_fit(X_new, y_new)

# Lưu lại
joblib.dump(model, MODEL_FILE)
