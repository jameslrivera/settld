import sys
import time

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, confusion_matrix, roc_auc_score

path = sys.argv[1] if len(sys.argv) > 1 else "ml/data/creditcard.csv"
df = pd.read_csv(path)
if "Time" in df.columns:
    df = df.sort_values("Time").drop(columns=["Time"])
X = df.drop(columns=["Class"])
y = df["Class"].astype(int)

split = int(len(df) * 0.8)
X_tr, X_te = X.iloc[:split], X.iloc[split:]
y_tr, y_te = y.iloc[:split], y.iloc[split:]
neg, pos = int((y_tr == 0).sum()), int((y_tr == 1).sum())

params = dict(
    n_estimators=300, learning_rate=0.03, num_leaves=8, max_depth=4, min_child_samples=200,
    feature_fraction=0.6, bagging_fraction=0.8, bagging_freq=1, reg_lambda=5.0,
    scale_pos_weight=float(np.sqrt(neg / max(pos, 1))), verbose=-1,
)
t0 = time.perf_counter()
clf = lgb.LGBMClassifier(**params).fit(X_tr, y_tr)
train_s = time.perf_counter() - t0

p = clf.predict_proba(X_te)[:, 1]
roc, pr = roc_auc_score(y_te, p), average_precision_score(y_te, p)
thr = 0.5
cm = confusion_matrix(y_te, (p >= thr).astype(int))
clf.booster_.save_model("ml/model.txt")

b = lgb.Booster(model_file="ml/model.txt")
row = X_te.iloc[[0]].to_numpy()
for _ in range(50):
    b.predict(row)
n = 1000
t0 = time.perf_counter()
for _ in range(n):
    b.predict(row)
lat_ms = (time.perf_counter() - t0) / n * 1000

report = f"""# Fraud model report

Dataset: ULB credit card fraud, {len(df):,} rows, {int(y.sum())} fraud.
Split: time-ordered, first 80% train ({len(X_tr):,}), last 20% test ({len(X_te):,}, {int(y_te.sum())} fraud).

Model: LightGBM, {params['n_estimators']} trees, learning rate {params['learning_rate']}, {params['num_leaves']} leaves,
depth {params['max_depth']}, min child samples {params['min_child_samples']}, feature fraction {params['feature_fraction']},
L2 {params['reg_lambda']}, positive class weight sqrt(neg/pos) = {params['scale_pos_weight']:.1f}. Train time {train_s:.1f}s.

| Metric | Value |
|---|---|
| ROC-AUC | {roc:.4f} |
| PR-AUC | {pr:.4f} |
| Single-row predict | {lat_ms:.3f} ms |

Confusion matrix at threshold {thr}:

| | predicted legit | predicted fraud |
|---|---|---|
| actual legit | {cm[0, 0]} | {cm[0, 1]} |
| actual fraud | {cm[1, 0]} | {cm[1, 1]} |
"""
open("ml/REPORT.md", "w").write(report)
print(report)
