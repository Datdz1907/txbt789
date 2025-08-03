import sys
import joblib

model = joblib.load("model5.pkl")
seq = sys.argv[1]  # 5 ký tự T/X

X = [[1 if c == "T" else 0 for c in seq]]
pred = model.predict(X)[0]
print("Tài" if pred == 1 else "Xỉu")
