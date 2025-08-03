# update_model.py
import sys
import joblib
import numpy as np
from sklearn.linear_model import SGDClassifier
import os

def encode(seq):
    return [1 if ch == "T" else 0 for ch in seq]

MODEL_FILE = "model.pkl"

seq = sys.argv[1]
label = int(sys.argv[2])  # 1 = đúng (Tài), 0 = sai (Xỉu)

X_new = np.array([encode(seq)])
y_new = np.array([label])

if os.path.exists(MODEL_FILE):
    model = joblib.load(MODEL_FILE)
else:
    model = SGDClassifier(loss="log_loss", max_iter=1000, tol=1e-3)

# partial_fit cần biết classes ngay từ lần đầu
model.partial_fit(X_new, y_new, classes=[0, 1])

joblib.dump(model, MODEL_FILE)
