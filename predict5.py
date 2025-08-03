# predict5.py
import sys
import joblib
import numpy as np
from sklearn.linear_model import SGDClassifier
import os

def encode(seq):
    # Chuyển TX thành số: T=1, X=0
    return [1 if ch == "T" else 0 for ch in seq]

MODEL_FILE = "model.pkl"

seq = sys.argv[1]

# Load hoặc tạo model
if os.path.exists(MODEL_FILE):
    model = joblib.load(MODEL_FILE)
else:
    model = SGDClassifier(loss="log_loss", max_iter=1000, tol=1e-3)

X = np.array([encode(seq)])
try:
    pred = model.predict(X)[0]
    print("Tài" if pred == 1 else "Xỉu")
except Exception:
    print("Chưa đủ dữ liệu")
