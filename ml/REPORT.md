# Fraud model report

Dataset: ULB credit card fraud, 284,807 rows, 492 fraud.
Split: time-ordered, first 80% train (227,845), last 20% test (56,962, 75 fraud).

Model: LightGBM, 300 trees, learning rate 0.03, 8 leaves,
depth 4, min child samples 200, feature fraction 0.6,
L2 5.0, positive class weight sqrt(neg/pos) = 23.4. Train time 1.2s.

| Metric | Value |
|---|---|
| ROC-AUC | 0.9864 |
| PR-AUC | 0.7904 |
| Single-row predict | 0.038 ms |

Confusion matrix at threshold 0.5:

| | predicted legit | predicted fraud |
|---|---|---|
| actual legit | 56852 | 35 |
| actual fraud | 16 | 59 |
