import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.metrics import roc_auc_score, average_precision_score

FEATURES = ["amount", "hour", "velocity_60s", "two_merchants_60s", "new_card", "amount_vs_usual", "distance_km", "category_risk"]


def simulate(n: int, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(n):
        r = rng.random()
        hour = int(rng.integers(6, 23))
        usual = float(rng.lognormal(1.6, 0.5))
        cat = float(rng.choice([0.1, 0.1, 0.2, 0.3, 0.5]))
        if r < 0.94:
            amount = max(1.0, usual * rng.lognormal(0, 0.35))
            rows.append(dict(amount=amount, hour=hour, velocity_60s=int(rng.poisson(0.15) + (rng.random() < 0.08) * rng.integers(1, 4)),
                             two_merchants_60s=int(rng.random() < 0.01), new_card=int(rng.random() < 0.05), amount_vs_usual=amount / usual,
                             distance_km=float(abs(rng.normal(0.4, 0.5)) + (rng.random() < 0.05) * rng.uniform(2, 10)), category_risk=cat, y=0))
        elif r < 0.96:
            amount = max(1.0, usual * rng.lognormal(0.8, 0.5))
            rows.append(dict(amount=amount, hour=int(rng.integers(0, 24)), velocity_60s=int(rng.integers(3, 9)), two_merchants_60s=int(rng.random() < 0.6),
                             new_card=0, amount_vs_usual=amount / usual, distance_km=float(abs(rng.normal(2.0, 2.0))), category_risk=cat, y=1))
        elif r < 0.975:
            amount = float(rng.choice([0.5, 1.0, 1.0, 2.0]))
            rows.append(dict(amount=amount, hour=int(rng.integers(0, 24)), velocity_60s=int(rng.integers(4, 15)), two_merchants_60s=int(rng.random() < 0.8),
                             new_card=int(rng.random() < 0.5), amount_vs_usual=amount / usual, distance_km=float(abs(rng.normal(5.0, 4.0))), category_risk=cat, y=1))
        elif r < 0.99:
            amount = max(1.0, usual * rng.lognormal(1.5, 0.6))
            rows.append(dict(amount=amount, hour=hour, velocity_60s=int(rng.integers(1, 4)), two_merchants_60s=int(rng.random() < 0.95),
                             new_card=0, amount_vs_usual=amount / usual, distance_km=float(abs(rng.choice([0.4, 0.5, 1.0, 6.0]) * rng.lognormal(0, 0.4))), category_risk=cat, y=1))
        else:
            amount = float(rng.lognormal(5.5, 0.4))
            rows.append(dict(amount=amount, hour=hour, velocity_60s=int(rng.poisson(0.3)), two_merchants_60s=0,
                             new_card=1, amount_vs_usual=amount / usual, distance_km=float(abs(rng.normal(1.0, 1.0))), category_risk=cat, y=1))
    return pd.DataFrame(rows)


if __name__ == "__main__":
    train, test = simulate(60_000, 1), simulate(20_000, 2)
    params = dict(n_estimators=300, learning_rate=0.03, num_leaves=8, max_depth=4, min_child_samples=100,
                  feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, reg_lambda=5.0, verbose=-1)
    clf = lgb.LGBMClassifier(**params).fit(train[FEATURES], train["y"])
    p = clf.predict_proba(test[FEATURES])[:, 1]
    print(f"live model  ROC-AUC {roc_auc_score(test['y'], p):.4f}  PR-AUC {average_precision_score(test['y'], p):.4f}  fraud rate {test['y'].mean():.3f}")
    clf.booster_.save_model("ml/live_model.txt")
    b = lgb.Booster(model_file="ml/live_model.txt")
    legit = pd.DataFrame([dict(amount=5.50, hour=14, velocity_60s=0, two_merchants_60s=0, new_card=0, amount_vs_usual=1.1, distance_km=0.2, category_risk=0.1)])
    clone = pd.DataFrame([dict(amount=12.95, hour=14, velocity_60s=2, two_merchants_60s=1, new_card=0, amount_vs_usual=2.25, distance_km=0.4, category_risk=0.1)])
    print(f"latte at the usual shop -> {b.predict(legit)[0]:.3f}   same card at a second shop 20 s later -> {b.predict(clone)[0]:.3f}")
    contrib = b.predict(clone, pred_contrib=True)[0]
    print("top reasons for the clone:", [(f, round(float(c), 2)) for f, c in sorted(zip(FEATURES, contrib[:-1]), key=lambda x: -x[1])[:3]])
