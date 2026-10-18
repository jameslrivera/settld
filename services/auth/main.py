import asyncio
import csv
import datetime as dt
import io
import json
import math
import os
import random
import re
import secrets
import sys
import threading
import time
import uuid

import numpy as np
import requests
from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

try:
    import lightgbm as lgb
except ImportError:
    lgb = None

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

HERE = os.path.dirname(__file__)
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
TAP_TOKEN = os.environ.get("TAP_TOKEN", "")


AUTH_OFF = os.environ.get("AUTH", "on").lower() in ("off", "0", "false", "no")


def require(token: str, header: str | None, what: str) -> None:
    if AUTH_OFF:
        return None
    if token and header != token:
        raise HTTPException(status_code=401, detail=f"{what} needs a valid token")


def is_admin(header: str | None) -> bool:
    if AUTH_OFF:
        return True
    return bool(ADMIN_TOKEN) and header == ADMIN_TOKEN


SHOP_TOKEN = os.environ.get("SHOP_TOKEN", "")


def is_shop(header: str | None) -> bool:
    if AUTH_OFF:
        return True
    return bool(SHOP_TOKEN) and header == SHOP_TOKEN


def require_shop(x_shop_token: str | None, x_admin_token: str | None, what: str) -> None:
    if AUTH_OFF:
        return None
    if (SHOP_TOKEN or ADMIN_TOKEN) and not (is_shop(x_shop_token) or is_admin(x_admin_token)):
        raise HTTPException(status_code=401, detail=f"{what} needs the shop's token")


def require_owner(person_id: str | None, x_owner_token: str | None, x_admin_token: str | None) -> dict | None:
    if AUTH_OFF:
        return people.get(person_id or "")
    if is_admin(x_admin_token):
        return people.get(person_id or "")
    if not person_id:
        require(ADMIN_TOKEN, x_admin_token, "this card has no account, so it")
        return None
    p = people.get(person_id or "")
    if p and p.get("token") and x_owner_token and secrets.compare_digest(x_owner_token, p["token"]):
        return p
    raise HTTPException(status_code=401, detail="This needs the account owner's token.")


SHOPS: dict[int, dict] = {s["id"]: s for s in json.load(open(os.path.join(HERE, "shops.json")))}
MERCHANTS = {mid: (s["name"], s["category"]) for mid, s in SHOPS.items()}
MERCHANT_ADDR = {mid: s["address"] for mid, s in SHOPS.items()}
MERCHANT_GEO = {mid: (s["geo"][0], s["geo"][1]) for mid, s in SHOPS.items()}
MENU_ROWS: list[dict] = [{"merchant_id": mid, **row} for mid, s in SHOPS.items() for row in s["menu"]]
DELIVERIES = os.path.join(HERE, "deliveries")
os.makedirs(DELIVERIES, exist_ok=True)

CHAIN_URL = os.environ.get("CHAIN_URL")
MODEL_PATH = os.environ.get("MODEL_PATH", os.path.join(ROOT, "ml", "live_model.txt"))
LIVE_FEATURES = ["amount", "hour", "velocity_60s", "two_merchants_60s", "new_card", "amount_vs_usual", "distance_km", "category_risk"]
CATEGORY_RISK = {"coffee": 0.1, "bakery": 0.1, "food": 0.2, "grocery": 0.1, "fuel": 0.3, "retail": 0.3, "electronics": 0.5, "data": 0.15, "research": 0.15, "compute": 0.2, "parking": 0.15}
DECLINE_AT = 0.80
booster = lgb.Booster(model_file=MODEL_PATH) if (lgb and os.path.exists(MODEL_PATH)) else None

DENYLIST: set[str] = set(filter(None, os.environ.get("DENYLIST", "04deadbeef0000,04baadf00d0000").lower().split(",")))

clients: set[WebSocket] = set()
seq = 0
accounts: dict[str, dict] = {}
pending_sale: dict[int, dict] = {}
pending_funds: dict[str, dict] = {}
audit = {"approved": 0, "declined": 0, "settled": 0, "issued": 0, "frozen": 0, "screened_out": 0, "closed": 0}
MODES = {"live": {"rate": 0.0, "fraud": 0.06}, "test": {"rate": 2.0, "fraud": 0.10}}
state = {"mode": "live"}


LEDGER_ROWS = 500


def new_merchant_stats() -> dict:
    return {"sales_cents": 0, "paid": 0, "blocked_cents": 0, "blocked": 0, "recent": []}


merchant_stats: dict[int, dict] = {mid: new_merchant_stats() for mid in MERCHANTS}

STATE_FILE = os.environ.get("STATE_FILE", os.path.join(HERE, "state.json"))


people: dict[str, dict] = {}


_persist_lock = threading.Lock()


def persist() -> None:
    for attempt in range(2):
        try:
            with _persist_lock:
                body = json.dumps({"accounts": dict(accounts), "people": dict(people), "merchant_stats": dict(merchant_stats), "audit": dict(audit), "seq": seq})
                tmp = STATE_FILE + ".tmp"
                with open(tmp, "w") as f:
                    f.write(body)
                os.replace(tmp, STATE_FILE)
            return
        except RuntimeError:
            if attempt:
                print("persist skipped: state changed while writing")
        except Exception as e:
            print("persist failed:", e)
            return


def restore() -> None:
    global seq
    if not os.path.exists(STATE_FILE):
        return
    try:
        with open(STATE_FILE) as f:
            d = json.load(f)
        accounts.update(d.get("accounts", {}))
        people.update(d.get("people", {}))
        for k, v in d.get("merchant_stats", {}).items():
            merchant_stats[int(k)] = v
        audit.update(d.get("audit", {}))
        seq = d.get("seq", 0)
        for p in people.values():
            p.setdefault("token", secrets.token_hex(16))
        print(f"restored {len(accounts)} account(s)")
    except Exception as e:
        print("restore failed:", e)


def chain(path: str, payload: dict, timeout: float = 30) -> dict | None:
    if not CHAIN_URL:
        return None
    try:
        return requests.post(f"{CHAIN_URL}{path}", json=payload, timeout=timeout).json()
    except Exception as e:
        return {"error": str(e)}


def explorer(sig: str | None) -> str | None:
    return f"https://explorer.solana.com/tx/{sig}?cluster=devnet" if sig else None


UNITS_PER_CENT = 10_000


def sync_card(a: dict, res: dict | None) -> None:
    if not res or res.get("error"):
        return
    if "balance" in res:
        a["balance_cents"] = int(res["balance"]) // UNITS_PER_CENT
    if "spent_today" in res:
        a["spent_today_cents"] = int(res["spent_today"]) // UNITS_PER_CENT
    if "status" in res:
        a["status"] = res["status"]


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def live_features(a: dict | None, amount_cents: int, merchant_id: int) -> dict:
    now = time.time()
    hist = [h for h in (a["history"] if a else []) if h["kind"] == "tap"]
    recent = [h for h in hist if now - h["ts"] < 60]
    other = [h for h in recent if h.get("merchant_id") not in (None, merchant_id)]
    usual = (sum(h["amount_cents"] for h in hist) / len(hist)) if hist else 500.0
    last = hist[0] if hist else None
    dist = haversine_km(MERCHANT_GEO[last["merchant_id"]], MERCHANT_GEO[merchant_id]) if last and last.get("merchant_id") in MERCHANT_GEO else 0.3
    _, category = MERCHANTS.get(merchant_id, ("", "retail"))
    return {
        "amount": amount_cents / 100,
        "hour": time.localtime(now).tm_hour,
        "velocity_60s": len(recent),
        "two_merchants_60s": int(bool(other)),
        "new_card": int(a is None or len(hist) == 0),
        "amount_vs_usual": (amount_cents / 100) / max(usual / 100, 0.5),
        "distance_km": dist,
        "category_risk": CATEGORY_RISK.get(category, 0.3),
    }


def score(features: dict) -> tuple[float, list[dict]]:
    if booster is None:
        return 0.03, []
    row = np.array([[features[f] for f in LIVE_FEATURES]])
    p = float(booster.predict(row)[0])
    contrib = booster.predict(row, pred_contrib=True)[0][:-1]
    pos = [(f, float(c)) for f, c in zip(LIVE_FEATURES, contrib) if c > 0]
    total = sum(c for _, c in pos) or 1.0
    scale = max(0.0, p - 0.03) / total
    top = sorted(pos, key=lambda x: -x[1])[:3]
    reasons = [{"feature": f, "contribution": round(c * scale, 2)} for f, c in top if c * scale >= 0.02] if p >= DECLINE_AT else []
    return p, reasons


def card_number(uid: str) -> str:
    digits = "9" + str(int(uid, 16) % 10**14).zfill(14)
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return digits + str((10 - total % 10) % 10)


def fake_sig(rng: random.Random) -> str:
    return "".join(rng.choice("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz") for _ in range(88))


async def broadcast(event: dict) -> None:
    dead = []
    msg = json.dumps(event)
    for ws in list(clients):
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


def account_view(a: dict) -> dict:
    persist()
    return {"type": "account", **a}


def make_event(uid: str, amount_cents: int, merchant_id: int, p: float, sig: str | None, latency_ms: float, reasons: list | None, item: str | None) -> dict:
    global seq
    seq += 1
    name, category = MERCHANTS.get(merchant_id, (f"merchant-{merchant_id}", "other"))
    lat, lng = MERCHANT_GEO.get(merchant_id, (33.7550, -84.3870))
    return {
        "type": "auth", "seq": seq, "ts": time.time(), "uid": uid,
        "merchant_id": merchant_id, "merchant": name, "category": category, "lat": lat, "lng": lng,
        "item": item, "amount_cents": amount_cents, "score": round(p, 4), "approved": p < DECLINE_AT,
        "reasons": reasons or [], "sig": sig, "explorer": explorer(sig), "latency_ms": round(latency_ms, 1),
    }


def record_merchant(ev: dict) -> None:
    st = merchant_stats.setdefault(ev["merchant_id"], new_merchant_stats())
    if ev["approved"]:
        st["sales_cents"] += ev["amount_cents"]
        st["paid"] += 1
    else:
        st["blocked_cents"] += ev["amount_cents"]
        st["blocked"] += 1
    row = {k: ev.get(k) for k in ("seq", "ts", "uid", "item", "amount_cents", "approved", "score", "latency_ms", "sig", "explorer")}
    o = ev.get("order") or {}
    row.update({k: o.get(k, 0) for k in ("subtotal_cents", "tax_cents", "tip_cents")})
    ag = ev.get("agent") or {}
    row.update({"source": "agent" if ev.get("kind") == "agent" else "card", "agent_name": ag.get("name"), "owner_name": ag.get("owner_name"),
                "reason": ((ev.get("reasons") or [{}])[0] or {}).get("feature")})
    st["recent"].insert(0, row)
    del st["recent"][LEDGER_ROWS:]


class Register(BaseModel):
    name: str | None = None
    uid: str | None = None
    person_id: str | None = None


@app.post("/accounts")
async def register(r: Register, x_owner_token: str | None = Header(default=None), x_admin_token: str | None = Header(default=None)):
    rng = random.Random()
    person = people.get(r.person_id) if r.person_id else None
    if r.person_id and not person:
        return {"error": "unknown_account", "reason": "That account does not exist. Open it first."}
    if r.person_id:
        require_owner(r.person_id, x_owner_token, x_admin_token)
    else:
        require(ADMIN_TOKEN, x_admin_token, "issuing a card without an account")
    if person and not person.get("wallet"):
        w = await asyncio.to_thread(chain, "/wallet/new", {"person_id": r.person_id}, 90)
        if w and not w.get("error"):
            person["wallet"] = w["address"]
    name = (r.name or (person["name"] if person else "")).strip()
    uid = (r.uid or ("04" + "".join(rng.choice("0123456789abcdef") for _ in range(12)))).lower()
    if uid in accounts:
        return account_view(accounts[uid])
    if uid in DENYLIST or not name:
        audit["screened_out"] += 1
        reason = "card serial on the reported-lost list" if uid in DENYLIST else "name required"
        await broadcast({"type": "screened", "uid": uid, "name": name, "reason": reason, "ts": time.time()})
        return {"error": "screening_failed", "reason": "This card serial is on the reported-lost list." if uid in DENYLIST else "A name is required to issue a card."}
    a = {
        "uid": uid, "card_number": card_number(uid), "name": name, "person_id": r.person_id, "wallet": (person or {}).get("wallet"),
        "balance_cents": 0, "daily_limit_cents": 50_000, "spent_today_cents": 0, "status": "active",
        "card_pda": None, "register_sig": None, "created": time.time(), "history": [],
    }
    reg = await asyncio.to_thread(chain, "/register", {"uid": uid, "daily_limit": a["daily_limit_cents"] * UNITS_PER_CENT, "owner": a["wallet"], "force": is_admin(x_admin_token)}, 90)
    if reg and reg.get("error") and "another account" in reg["error"]:
        return {"error": "card_taken", "reason": "This card belongs to another account. Its owner can close it first."}
    if reg and reg.get("error") and "task card" in reg["error"]:
        return {"error": "task_card", "reason": "That serial is an agent's task card, not a blank card."}
    if reg and not reg.get("error"):
        a["card_pda"] = reg["card_pda"]
        if reg.get("sig"):
            a["register_sig"] = reg["sig"]
        if reg.get("already"):
            st = await asyncio.to_thread(chain, "/set_status", {"uid": uid, "blocked": False}, 90)
            if st and st.get("sig") and not a["register_sig"]:
                a["register_sig"] = st["sig"]
            sync_card(a, await asyncio.to_thread(chain, "/card", {"uid": uid}, 30))
    elif reg and reg.get("error"):
        return {"error": "chain", "reason": reg["error"]}
    else:
        a["card_pda"], a["register_sig"] = "offline", fake_sig(rng)
    accounts[uid] = a
    if person:
        person["cards"].append(uid)
    audit["issued"] += 1
    await broadcast(account_view(a))
    return account_view(a)


@app.get("/accounts")
def list_accounts():
    return [account_view(a) for a in accounts.values()]


@app.get("/accounts/{uid}")
def get_account(uid: str):
    a = accounts.get(uid.lower())
    return account_view(a) if a else {"error": "unknown card"}


@app.delete("/accounts/{uid}")
async def close_account(uid: str, x_owner_token: str | None = Header(default=None), x_admin_token: str | None = Header(default=None)):
    a = accounts.get(uid.lower())
    if not a:
        return {"error": "unknown card"}
    require_owner(a.get("person_id"), x_owner_token, x_admin_token)
    res = await asyncio.to_thread(chain, "/set_status", {"uid": a["uid"], "blocked": True}, 90)
    left = a["balance_cents"]
    accounts.pop(a["uid"], None)
    if (p := people.get(a.get("person_id") or "")):
        p["cards"] = [c for c in p["cards"] if c != a["uid"]]
    audit["closed"] += 1
    persist()
    await broadcast({"type": "account_removed", "uid": a["uid"], "name": a["name"], "balance_left_cents": left, "sig": (res or {}).get("sig"), "ts": time.time()})
    return {"ok": True, "uid": a["uid"], "balance_left_cents": left, "sig": (res or {}).get("sig"), "explorer": (res or {}).get("explorer")}


class NewPerson(BaseModel):
    name: str
    birthday: str
    email: str | None = None


def person_view(p: dict) -> dict:
    return {"type": "person", **{k: v for k, v in p.items() if k != "token"}}


_signups: list[float] = []


@app.post("/people")
async def create_person(n: NewPerson):
    now = time.time()
    _signups[:] = [t for t in _signups if now - t < 60]
    if len(_signups) >= 6:
        raise HTTPException(status_code=429, detail="Too many new accounts right now. Try again in a minute.")
    _signups.append(now)
    name = n.name.strip()
    if len(name) < 2:
        return {"error": "name_required", "reason": "A name is required to open an account."}
    try:
        dt.date.fromisoformat(n.birthday)
    except ValueError:
        return {"error": "bad_birthday", "reason": "Birthday must be a date."}
    pid = uuid.uuid4().hex[:12]
    p = {"id": pid, "name": name, "birthday": n.birthday, "email": (n.email or "").strip() or None, "created": time.time(), "cards": [], "token": secrets.token_hex(16)}
    people[pid] = p
    w = await asyncio.to_thread(chain, "/wallet/new", {"person_id": pid}, 90)
    if w and not w.get("error"):
        p["wallet"] = w["address"]
        p["wallet_sig"] = w.get("sig")
    persist()
    await broadcast(person_view(p))
    if p.get("wallet"):
        asyncio.create_task(asyncio.to_thread(agent_layer.ensure_agent, pid))
    return {**person_view(p), "token": p["token"]}


@app.get("/people")
def list_people():
    return [person_view(p) for p in people.values()]


@app.get("/people/{pid}")
def get_person(pid: str):
    p = people.get(pid)
    return person_view(p) if p else {"error": "unknown_account", "reason": "That account does not exist."}


@app.get("/people/{pid}/wallet")
async def person_wallet(pid: str):
    p = people.get(pid)
    if not p:
        return {"error": "unknown_account", "reason": "That account does not exist."}
    if not p.get("wallet"):
        w = await asyncio.to_thread(chain, "/wallet/new", {"person_id": pid}, 90)
        if w and not w.get("error"):
            p["wallet"] = w["address"]
            for uid in p["cards"]:
                if uid in accounts:
                    accounts[uid]["wallet"] = w["address"]
            persist()
    w = await asyncio.to_thread(chain, "/wallet/info", {"person_id": pid}, 30)
    return w or {"error": "no_wallet", "reason": "This account has no wallet yet."}


@app.delete("/people/{pid}")
async def delete_person(pid: str, to_wallet: str | None = None, x_owner_token: str | None = Header(default=None), x_admin_token: str | None = Header(default=None)):
    p = people.get(pid)
    if not p:
        return {"error": "unknown_account", "reason": "That account does not exist."}
    require_owner(pid, x_owner_token, x_admin_token)
    await asyncio.to_thread(agent_layer.forget_person, pid)
    closed = []
    for uid in list(p["cards"]):
        a = accounts.get(uid)
        if a:
            closed.append(await retire_card(a, "cardholder"))
    wallet = None
    if p.get("wallet") and CHAIN_URL:
        wallet = await asyncio.to_thread(chain, "/wallet/sweep", {"person_id": pid, "to_wallet": to_wallet or None}, 120)
    people.pop(pid, None)
    persist()
    return {"ok": True, "id": pid, "cards": closed, "wallet": wallet}


class Deposit(BaseModel):
    uid: str
    amount_cents: int


@app.post("/deposit")
async def deposit(d: Deposit, x_admin_token: str | None = Header(default=None)):
    require(ADMIN_TOKEN, x_admin_token, "test top-up")
    a = accounts.get(d.uid.lower())
    if not a:
        return {"error": "unknown card"}
    res = await asyncio.to_thread(chain, "/deposit", {"uid": a["uid"], "amount_units": d.amount_cents * UNITS_PER_CENT}, 90)
    if res and res.get("error"):
        return {"error": res["error"]}
    if res:
        sync_card(a, res)
    else:
        a["balance_cents"] += d.amount_cents
    a["history"].insert(0, {"kind": "deposit", "amount_cents": d.amount_cents, "ts": time.time(), "sig": (res or {}).get("sig") or fake_sig(random.Random())})
    await broadcast(account_view(a))
    return account_view(a)


class Load(BaseModel):
    uid: str
    amount_cents: int


@app.post("/load")
async def load_card(l: Load, x_owner_token: str | None = Header(default=None), x_admin_token: str | None = Header(default=None)):
    a = accounts.get(l.uid.lower())
    if not a:
        return {"error": "unknown card"}
    require_owner(a.get("person_id"), x_owner_token, x_admin_token)
    if a.get("closed"):
        return {"error": "closed", "reason": "This card is closed."}
    pid = a.get("person_id")
    if not pid or pid not in people:
        return {"error": "no_wallet", "reason": "This card is not on an account with a wallet."}
    if l.amount_cents <= 0:
        return {"error": "bad_amount", "reason": "Enter an amount."}
    w = await asyncio.to_thread(chain, "/wallet/info", {"person_id": pid}, 30) or {}
    have = int(round(float(w.get("usdc") or 0) * 100))
    if have < l.amount_cents:
        return {"error": "insufficient", "reason": f"Your wallet has {have / 100:.2f} USDC. Send more to it first."}
    res = await asyncio.to_thread(chain, "/wallet/load", {"person_id": pid, "uid": a["uid"], "amount_units": l.amount_cents * UNITS_PER_CENT}, 90)
    if not res or res.get("error"):
        return {"error": "chain", "reason": (res or {}).get("error") or "Could not reach the chain."}
    sync_card(a, res)
    a["history"].insert(0, {"kind": "deposit", "amount_cents": l.amount_cents, "ts": time.time(), "sig": res["sig"], "source": "wallet", "from_wallet": res.get("from_wallet")})
    del a["history"][50:]
    persist()
    await broadcast(account_view(a))
    return account_view(a)


class Fund(BaseModel):
    uid: str
    amount_cents: int


@app.post("/fund")
async def fund(f: Fund):
    a = accounts.get(f.uid.lower())
    if not a:
        return {"error": "unknown card"}
    req = await asyncio.to_thread(chain, "/deposit_request", {"uid": a["uid"], "amount_units": f.amount_cents * UNITS_PER_CENT}, 30)
    if not req or req.get("error"):
        return {"error": (req or {}).get("error", "chain sidecar not running")}
    pending_funds[req["reference"]] = {"uid": a["uid"], "amount_cents": f.amount_cents, "url": req["url"], "created": time.time(), "status": "pending"}
    return {"reference": req["reference"], "url": req["url"], "recipient": req["recipient"], "mint": req["mint"], "amount_cents": f.amount_cents}


@app.get("/funds")
def list_funds():
    return [{"reference": r, **p} for r, p in pending_funds.items()]


@app.get("/fund/{reference}")
async def fund_status(reference: str):
    p = pending_funds.get(reference)
    if not p:
        return {"error": "unknown reference"}
    if p["status"] == "confirmed":
        return {"status": "confirmed", **{k: p.get(k) for k in ("sig", "explorer", "amount_cents", "from_wallet", "credit_sig")}}
    res = await asyncio.to_thread(chain, "/deposit_check", {"reference": reference}, 30)
    if not res or not res.get("found"):
        return {"status": "pending"}
    a = accounts.get(p["uid"])
    credited = int(res["amount_units"] // UNITS_PER_CENT)
    credit = await asyncio.to_thread(chain, "/deposit", {"uid": p["uid"], "amount_units": int(res["amount_units"])}, 90) if a else None
    if a:
        sync_card(a, credit)
        a["history"].insert(0, {"kind": "deposit", "amount_cents": credited, "ts": time.time(), "sig": res["sig"], "source": "wallet", "from_wallet": res.get("from_wallet"), "credit_sig": (credit or {}).get("sig")})
        await broadcast(account_view(a))
    p.update({"status": "confirmed", "sig": res["sig"], "explorer": res["explorer"], "amount_cents": credited, "from_wallet": res.get("from_wallet"), "credit_sig": (credit or {}).get("sig")})
    return {"status": "confirmed", "sig": res["sig"], "explorer": res["explorer"], "amount_cents": credited, "from_wallet": res.get("from_wallet"), "credit_sig": (credit or {}).get("sig")}


class Withdraw(BaseModel):
    uid: str
    amount_cents: int
    to_wallet: str


@app.post("/withdraw")
async def withdraw(w: Withdraw, x_owner_token: str | None = Header(default=None), x_admin_token: str | None = Header(default=None)):
    a = accounts.get(w.uid.lower())
    if not a:
        return {"error": "unknown card"}
    require_owner(a.get("person_id"), x_owner_token, x_admin_token)
    if a.get("status") == "blocked":
        return {"error": "card is locked"}
    if w.amount_cents <= 0 or w.amount_cents > a["balance_cents"]:
        return {"error": "amount exceeds card balance"}
    res = await asyncio.to_thread(chain, "/withdraw", {"uid": a["uid"], "to_wallet": w.to_wallet, "amount_units": w.amount_cents * UNITS_PER_CENT}, 90)
    if not res or res.get("error"):
        return {"error": (res or {}).get("error", "chain sidecar not running")}
    sync_card(a, res)
    a["history"].insert(0, {"kind": "withdraw", "amount_cents": w.amount_cents, "ts": time.time(), "sig": res["sig"], "to_wallet": w.to_wallet})
    await broadcast(account_view(a))
    await broadcast({"type": "withdraw", "uid": a["uid"], "name": a["name"], "amount_cents": w.amount_cents, "to_wallet": w.to_wallet, "sig": res["sig"], "ts": time.time()})
    return {"ok": True, **res, "balance_cents": a["balance_cents"]}


class Freeze(BaseModel):
    uid: str
    blocked: bool = True
    by: str = "issuer"


@app.post("/freeze")
async def freeze(f: Freeze, x_owner_token: str | None = Header(default=None), x_admin_token: str | None = Header(default=None)):
    if f.by == "issuer":
        require(ADMIN_TOKEN, x_admin_token, "issuer freeze")
    a = accounts.get(f.uid.lower())
    if not a:
        return {"error": "unknown card"}
    if f.by != "issuer":
        require_owner(a.get("person_id"), x_owner_token, x_admin_token)
    if a.get("closed") and not f.blocked and f.by != "issuer":
        return {"error": "closed", "reason": "This card is closed. Delete the account to start over."}
    res = await asyncio.to_thread(chain, "/set_status", {"uid": a["uid"], "blocked": f.blocked}, 90)
    a["status"] = "blocked" if f.blocked else "active"
    if f.blocked:
        audit["frozen"] += 1
    a["history"].insert(0, {"kind": "freeze" if f.blocked else "unfreeze", "amount_cents": 0, "ts": time.time(), "sig": (res or {}).get("sig") or fake_sig(random.Random()), "by": f.by})
    await broadcast(account_view(a))
    await broadcast({"type": "status", "uid": a["uid"], "name": a["name"], "status": a["status"], "by": f.by, "sig": (res or {}).get("sig"), "ts": time.time()})
    return account_view(a)


class CloseCard(BaseModel):
    uid: str


async def retire_card(a: dict, by: str) -> dict:
    swept = 0
    sig = None
    wallet = a.get("wallet")
    if CHAIN_URL:
        sync_card(a, await asyncio.to_thread(chain, "/card", {"uid": a["uid"]}, 60))
    if a["balance_cents"] > 0 and wallet and CHAIN_URL:
        res = await asyncio.to_thread(chain, "/withdraw", {"uid": a["uid"], "to_wallet": wallet, "amount_units": a["balance_cents"] * UNITS_PER_CENT}, 90)
        if res and not res.get("error"):
            swept, sig = a["balance_cents"], res["sig"]
            sync_card(a, res)
    res = await asyncio.to_thread(chain, "/set_status", {"uid": a["uid"], "blocked": True}, 90)
    if CHAIN_URL:
        for _ in range(3):
            rel = await asyncio.to_thread(chain, "/register", {"uid": a["uid"], "owner": None, "force": True}, 90)
            if rel and not rel.get("error"):
                break
            print(f"release {a['uid']} failed: {(rel or {}).get('error')}", flush=True)
            await asyncio.sleep(2)
    accounts.pop(a["uid"], None)
    for p in people.values():
        if a["uid"] in p["cards"]:
            p["cards"].remove(a["uid"])
    audit["closed"] += 1
    out = {"uid": a["uid"], "swept_cents": swept, "to_wallet": wallet, "sig": sig or (res or {}).get("sig"), "explorer": explorer(sig or (res or {}).get("sig"))}
    await broadcast({"type": "account_removed", "uid": a["uid"], "name": a["name"], "balance_left_cents": a["balance_cents"], "sig": out["sig"], "by": by, "ts": time.time()})
    return out


@app.post("/close_card")
async def close_card(c: CloseCard, x_owner_token: str | None = Header(default=None), x_admin_token: str | None = Header(default=None)):
    a = accounts.get(c.uid.lower())
    if not a:
        return {"error": "unknown card"}
    require_owner(a.get("person_id"), x_owner_token, x_admin_token)
    out = await retire_card(a, "cardholder")
    persist()
    return {"ok": True, **out}


@app.post("/demo_wallet")
async def demo_wallet(body: dict | None = None, x_admin_token: str | None = Header(default=None)):
    require(ADMIN_TOKEN, x_admin_token, "demo wallet")
    return await asyncio.to_thread(chain, "/demo_wallet", {"topup_units": int((body or {}).get("topup_cents", 0)) * UNITS_PER_CENT}, 90) or {"error": "no sidecar"}


@app.post("/demo_wallet/pay")
async def demo_wallet_pay(body: dict, x_admin_token: str | None = Header(default=None)):
    require(ADMIN_TOKEN, x_admin_token, "demo wallet")
    return await asyncio.to_thread(chain, "/wallet_pay", {"url": body["url"]}, 90) or {"error": "no sidecar"}


class SaleLine(BaseModel):
    item: str
    cents: int
    qty: int = 1


class Sale(BaseModel):
    merchant_id: int
    item: str | None = None
    cents: int | None = None
    lines: list[SaleLine] | None = None
    tax_cents: int = 0
    tip_cents: int = 0
    source: str = "register"
    customer_name: str | None = None


def summarize(lines: list[SaleLine]) -> str:
    parts = [f"{l.item} ×{l.qty}" if l.qty > 1 else l.item for l in lines]
    return ", ".join(parts[:3]) + (f" +{len(parts) - 3} more" if len(parts) > 3 else "")


@app.post("/sale")
async def set_sale(sale: Sale, x_shop_token: str | None = Header(default=None), x_admin_token: str | None = Header(default=None)):
    require_shop(x_shop_token, x_admin_token, "ringing up a sale")
    if sale.lines:
        subtotal = sum(l.cents * l.qty for l in sale.lines)
        order = {
            "sale_id": uuid.uuid4().hex[:12], "source": sale.source, "item": summarize(sale.lines), "cents": subtotal + sale.tax_cents + sale.tip_cents,
            "lines": [l.model_dump() for l in sale.lines], "subtotal_cents": subtotal, "tax_cents": sale.tax_cents, "tip_cents": sale.tip_cents,
            "customer_name": (sale.customer_name or "").strip()[:40] or None, "ts": time.time(),
        }
    else:
        if sale.item is None or sale.cents is None:
            return {"error": "item and cents, or lines, required"}
        order = {"sale_id": uuid.uuid4().hex[:12], "source": sale.source, "item": sale.item, "cents": sale.cents,
                 "lines": [{"item": sale.item, "cents": sale.cents, "qty": 1}], "subtotal_cents": sale.cents, "tax_cents": 0, "tip_cents": 0, "customer_name": None, "ts": time.time()}
    pending_sale[sale.merchant_id] = order
    await broadcast({"type": "sale", "merchant_id": sale.merchant_id, "merchant": MERCHANTS.get(sale.merchant_id, ("?", ""))[0], **order})
    return {"ok": True, **order}


@app.get("/sale/{merchant_id}")
def get_sale(merchant_id: int):
    return pending_sale.get(merchant_id) or {}


@app.delete("/sale/{merchant_id}")
async def clear_sale(merchant_id: int, x_shop_token: str | None = Header(default=None), x_admin_token: str | None = Header(default=None)):
    require_shop(x_shop_token, x_admin_token, "clearing a sale")
    pending_sale.pop(merchant_id, None)
    await broadcast({"type": "sale_cleared", "merchant_id": merchant_id, "ts": time.time()})
    return {"ok": True}


@app.get("/menu")
def get_menu():
    return [{**r, "merchant": MERCHANTS[r["merchant_id"]][0], "kind": SHOPS[r["merchant_id"]]["kind"]} for r in MENU_ROWS]


FILE_TYPES = {".html": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".png": "image/png", ".json": "application/json"}


@app.get("/files/{name}")
def get_file(name: str):
    ext = os.path.splitext(name)[1]
    if not re.fullmatch(r"[a-z0-9_-]+\.(html|txt|png|json)", name) or ext not in FILE_TYPES:
        raise HTTPException(404, "no such file")
    path = os.path.join(DELIVERIES, name)
    if not os.path.exists(path):
        raise HTTPException(404, "no such file")
    return FileResponse(path, media_type=FILE_TYPES[ext])


_chain_bal_cache: dict = {"ts": 0.0, "data": None}


def merchant_chain_balances() -> dict[int, dict]:
    if not CHAIN_URL:
        return {}
    if time.time() - _chain_bal_cache["ts"] > 5:
        try:
            _chain_bal_cache["data"] = requests.post(f"{CHAIN_URL}/balances", json={}, timeout=15).json()
            _chain_bal_cache["ts"] = time.time()
        except Exception:
            pass
    d = _chain_bal_cache["data"] or {}
    return {m["id"]: m for m in d.get("merchants", [])}


@app.get("/merchants")
def list_merchants():
    chainb = merchant_chain_balances()
    out = []
    for mid, (n, c) in MERCHANTS.items():
        cb = chainb.get(mid, {})
        s = SHOPS[mid]
        out.append({
            "id": mid, "name": n, "category": c, "kind": s["kind"], "address": MERCHANT_ADDR.get(mid, ""),
            "lat": MERCHANT_GEO[mid][0], "lng": MERCHANT_GEO[mid][1],
            "usdc": cb.get("usdc"), "wallet": cb.get("wallet"), "ata": cb.get("ata"),
            "accepts_agents": cb.get("accepts_agents") if cb else (None if CHAIN_URL else s["accepts_agents"]),
            "max_agent_ticket_cents": (int(cb.get("max_agent_ticket") or 0) // UNITS_PER_CENT) if cb else (None if CHAIN_URL else s["max_ticket_cents"]),
            **merchant_stats.get(mid, new_merchant_stats()),
        })
    return out


class MerchantAgentPolicy(BaseModel):
    accepts_agents: bool
    max_agent_ticket_cents: int = 0


@app.post("/merchants/{merchant_id}/agent_policy")
async def set_merchant_agent_policy(merchant_id: int, m: MerchantAgentPolicy, x_shop_token: str | None = Header(default=None), x_admin_token: str | None = Header(default=None)):
    require_shop(x_shop_token, x_admin_token, "merchant settings")
    if merchant_id not in MERCHANTS:
        raise HTTPException(404, "no such shop")
    if m.max_agent_ticket_cents < 0:
        raise HTTPException(400, "max ticket must be zero or more")
    res = await asyncio.to_thread(chain, "/merchant/agent_policy", {"merchant_id": merchant_id, "accepts_agents": m.accepts_agents, "max_agent_ticket": m.max_agent_ticket_cents * UNITS_PER_CENT}, 90)
    if res and res.get("error"):
        raise HTTPException(502, res["error"])
    _chain_bal_cache["ts"] = 0.0
    ev = {"type": "merchant", "merchant_id": merchant_id, "merchant": MERCHANTS[merchant_id][0], "accepts_agents": m.accepts_agents, "max_agent_ticket_cents": m.max_agent_ticket_cents, "sig": (res or {}).get("sig"), "explorer": explorer((res or {}).get("sig")), "ts": time.time()}
    await broadcast(ev)
    return ev


def iso(ts: float | None) -> str:
    return dt.datetime.fromtimestamp(ts or 0).strftime("%Y-%m-%d %H:%M:%S")


def mask_uid(uid: str) -> str:
    a = accounts.get(uid)
    tail = (a["card_number"] if a else uid)[-4:]
    return "**** " + tail


def csv_response(body: str, filename: str) -> Response:
    return Response(body, media_type="text/csv", headers={"content-disposition": f'attachment; filename="{filename}"'})


def money(cents: int | None) -> str:
    return f"{(cents or 0) / 100:.2f}"


def csv_bytes(header: list[str], rows: list[list[str]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue()


def ledger_rows(merchant_id: int) -> list[dict]:
    st = merchant_stats.get(merchant_id)
    return list(reversed(st["recent"])) if st else []


@app.get("/merchants/{merchant_id}/payments.csv")
def payment_log(merchant_id: int):
    if merchant_id not in MERCHANTS:
        raise HTTPException(404, "no such shop")
    rows = []
    for r in ledger_rows(merchant_id):
        rows.append([
            iso(r.get("ts")), r.get("seq"), r.get("item") or "",
            money(r.get("subtotal_cents")), money(r.get("tax_cents")), money(r.get("tip_cents")),
            money(r.get("amount_cents")),
            "settled" if r.get("approved") else "stopped",
            f"{r.get('score', 0):.4f}", mask_uid(r.get("uid") or ""), r.get("sig") or "",
        ])
    header = ["date", "order", "item", "subtotal", "tax", "tip", "total", "status", "risk score", "card", "solana signature"]
    return csv_response(csv_bytes(header, rows), f"settld-payments-{merchant_id}.csv")


@app.get("/merchants/{merchant_id}/tax.csv")
def tax_log(merchant_id: int):
    if merchant_id not in MERCHANTS:
        raise HTTPException(404, "no such shop")
    rows, taxable, tax_due = [], 0, 0
    for r in ledger_rows(merchant_id):
        if not r.get("approved"):
            continue
        taxable += r.get("subtotal_cents") or 0
        tax_due += r.get("tax_cents") or 0
        rows.append([
            iso(r.get("ts")), r.get("seq"), money(r.get("subtotal_cents")),
            money(r.get("tax_cents")), money(r.get("amount_cents")), r.get("sig") or "",
        ])
    rows.append(["TOTAL", "", money(taxable), money(tax_due), "", ""])
    header = ["date", "order", "taxable sales", "tax collected", "total charged", "solana signature"]
    return csv_response(csv_bytes(header, rows), f"settld-tax-{merchant_id}.csv")


SETTLD_FEE_BPS = int(os.environ.get("SETTLD_FEE_BPS", "200"))


def book_rows(merchant_id: int) -> list[dict]:
    agent_by_sig = {o.get("sig"): o for o in agent_layer.agent_orders.get(merchant_id, []) if o.get("sig")}
    out = []
    for r in ledger_rows(merchant_id):
        o = agent_by_sig.get(r.get("sig"))
        source = r.get("source") or ("agent" if o else "card")
        paid = bool(r.get("approved"))
        total = r.get("amount_cents") or 0
        sub = r.get("subtotal_cents") or (total if paid else 0)
        fee = round(total * SETTLD_FEE_BPS / 10000) if paid else 0
        out.append({
            "ts": r.get("ts"), "order": r.get("seq"), "item": r.get("item") or "Purchase", "source": source,
            "agent_name": r.get("agent_name") or (o or {}).get("agent_name"), "owner_name": r.get("owner_name") or (o or {}).get("owner_name"),
            "card": mask_uid(r.get("uid") or ""), "status": "paid" if paid else "stopped", "reason": r.get("reason"),
            "subtotal_cents": sub if paid else 0, "tax_cents": (r.get("tax_cents") or 0) if paid else 0, "tip_cents": (r.get("tip_cents") or 0) if paid else 0,
            "total_cents": total, "fee_cents": fee, "net_cents": total - fee if paid else 0,
            "risk": round(r.get("score") or 0, 4), "latency_ms": r.get("latency_ms"), "sig": r.get("sig"), "explorer": r.get("explorer"),
        })
    return out


def book_summary(rows: list[dict]) -> dict:
    paid = [r for r in rows if r["status"] == "paid"]
    stopped = [r for r in rows if r["status"] != "paid"]
    hours = [0] * 24
    items: dict[str, list[int]] = {}
    for r in paid:
        hours[dt.datetime.fromtimestamp(r["ts"] or 0).hour] += r["total_cents"]
        it = items.setdefault(r["item"], [0, 0])
        it[0] += 1
        it[1] += r["total_cents"]
    s = lambda rs, k: sum(r[k] for r in rs)
    by_source = {src: {"count": len([r for r in paid if r["source"] == src]), "cents": s([r for r in paid if r["source"] == src], "total_cents")} for src in ("card", "agent")}
    lat = [r["latency_ms"] for r in paid if r["latency_ms"] is not None]
    return {
        "from": min((r["ts"] for r in rows), default=None), "to": max((r["ts"] for r in rows), default=None),
        "paid": len(paid), "stopped": len(stopped), "stopped_cents": s(stopped, "total_cents"),
        "gross_cents": s(paid, "total_cents"), "sales_cents": s(paid, "subtotal_cents"), "tax_cents": s(paid, "tax_cents"), "tips_cents": s(paid, "tip_cents"),
        "fee_cents": s(paid, "fee_cents"), "net_cents": s(paid, "net_cents"), "fee_bps": SETTLD_FEE_BPS,
        "avg_ticket_cents": round(s(paid, "total_cents") / len(paid)) if paid else 0,
        "avg_latency_ms": round(sum(lat) / len(lat)) if lat else None,
        "on_chain": len([r for r in rows if r["sig"]]), "by_source": by_source, "by_hour": hours,
        "top_items": [{"item": k, "count": v[0], "cents": v[1]} for k, v in sorted(items.items(), key=lambda kv: -kv[1][1])[:8]],
    }


@app.get("/merchants/{merchant_id}/books")
def books(merchant_id: int):
    if merchant_id not in MERCHANTS:
        raise HTTPException(404, "no such shop")
    rows = book_rows(merchant_id)
    name, category = MERCHANTS[merchant_id]
    return {"merchant_id": merchant_id, "name": name, "category": category, "address": MERCHANT_ADDR.get(merchant_id, ""), "summary": book_summary(rows), "rows": list(reversed(rows))}


@app.get("/merchants/{merchant_id}/audit.csv")
def audit_log(merchant_id: int):
    if merchant_id not in MERCHANTS:
        raise HTTPException(404, "no such shop")
    rows = [[
        iso(r["ts"]), r["order"], r["item"], r["source"], r["agent_name"] or "", r["owner_name"] or "", r["card"],
        money(r["subtotal_cents"]), money(r["tax_cents"]), money(r["tip_cents"]), money(r["total_cents"]), money(r["fee_cents"]), money(r["net_cents"]),
        r["status"], r["reason"] or "", f"{r['risk']:.4f}", r["sig"] or "",
    ] for r in book_rows(merchant_id)]
    header = ["date", "order", "item", "paid by", "agent", "on behalf of", "card", "subtotal", "tax", "tip", "total", "settld fee", "net to shop", "status", "stop reason", "risk score", "solana signature"]
    return csv_response(csv_bytes(header, rows), f"settld-audit-{merchant_id}.csv")


class Tap(BaseModel):
    uid: str
    amount_cents: int | None = None
    merchant_id: int
    item: str | None = None


PROGRAM_REASONS = {1: "card_frozen", 2: "daily_limit", 3: "high_risk", 4: "insufficient_balance", 5: "agent_frozen", 6: "merchant_not_allowed", 7: "outside_window", 8: "over_budget", 9: "needs_approval", 10: "too_many_per_hour", 11: "task_expired"}


@app.post("/tap")
async def tap(t: Tap, x_tap_token: str | None = Header(default=None), x_admin_token: str | None = Header(default=None)):
    if TAP_TOKEN and x_tap_token != TAP_TOKEN and not is_admin(x_admin_token):
        raise HTTPException(status_code=401, detail="Taps come from the reader listener or the admin.")
    t0 = time.perf_counter()
    uid = t.uid.lower()
    order = None
    if t.amount_cents is None:
        sale = pending_sale.get(t.merchant_id)
        if not sale:
            a = accounts.get(uid)
            feats = live_features(a, 0, t.merchant_id)
            p, reasons = score(feats)
            if a is None:
                await broadcast({"type": "card_seen", "uid": uid, "registered": False, "ts": time.time()})
                reasons = [{"feature": "new_card", "contribution": 0.80}]
            elif a.get("status") == "blocked":
                reasons = [{"feature": "card_frozen", "contribution": 0.90}]
            reasons = [{"feature": "no_order", "contribution": 0.60}] + [r for r in reasons if r["feature"] != "no_order"][:2]
            ev = make_event(uid, 0, t.merchant_id, max(p, 0.99), None, (time.perf_counter() - t0) * 1000, reasons, "No order rung up")
            ev.update({"score_ms": round((time.perf_counter() - t0) * 1000, 3), "features": feats, "on_chain": False, "settled": False, "no_order": True})
            audit["declined"] += 1
            persist()
            await broadcast(ev)
            return ev
        t.amount_cents, t.item, order = sale["cents"], sale["item"], sale

    a = accounts.get(uid)
    feats = live_features(a, t.amount_cents, t.merchant_id)
    p, reasons = score(feats)
    if feats["two_merchants_60s"] and p < 0.85:
        p = 0.85
        reasons = [{"feature": "two_merchants_60s", "contribution": 0.62}] + [r for r in reasons if r["feature"] != "two_merchants_60s"][:2]
    score_ms = (time.perf_counter() - t0) * 1000
    if a is None:
        await broadcast({"type": "card_seen", "uid": uid, "registered": False, "ts": time.time()})
        p, reasons = max(p, 0.99), [{"feature": "new_card", "contribution": 0.80}]
    elif a.get("status") == "blocked":
        p, reasons = max(p, 0.99), [{"feature": "card_frozen", "contribution": 0.90}]
    elif a["balance_cents"] < t.amount_cents:
        p, reasons = max(p, 0.95), [{"feature": "insufficient_balance", "contribution": 0.70}]

    sig, chain_ms, settled, merchant_usdc = None, None, False, None
    res = None
    if a is not None and CHAIN_URL:
        res = await asyncio.to_thread(chain, "/pay", {"uid": uid, "amount": t.amount_cents * UNITS_PER_CENT, "risk_bps": int(p * 10000), "merchant_id": t.merchant_id, "nonce": int(time.time() * 1000)}, 60)
        if res and not res.get("error") and res.get("approved") is not None:
            sig, chain_ms, settled, merchant_usdc = res["sig"], res.get("confirmed_ms") or res.get("processed_ms"), bool(res.get("settled")), res.get("merchant_balance")
            if res.get("approved") is False and p < DECLINE_AT:
                p = DECLINE_AT
                reasons = [{"feature": PROGRAM_REASONS.get(res.get("reason"), "program_declined"), "contribution": 0.77}]
            sync_card(a, res)
        else:
            why = (res or {}).get("error") or "no response"
            print("pay failed:", why)
            sig = (res or {}).get("sig")
            p = max(p, DECLINE_AT)
            reasons = [{"feature": "chain_unconfirmed" if ("not confirmed" in why or "not seen" in why) else "chain_error", "contribution": 0.77}]
    rng = random.Random()
    simulated = state["mode"] == "test" and sig is None
    latency = chain_ms if chain_ms is not None else (time.perf_counter() - t0) * 1000 + (rng.gauss(420, 40) if simulated else 0)
    ev = make_event(uid, t.amount_cents, t.merchant_id, p, sig or (fake_sig(rng) if simulated else None), latency, reasons, t.item)
    ev.update({"score_ms": round(score_ms, 3), "features": feats, "on_chain": sig is not None, "settled": settled, "merchant_usdc": merchant_usdc})
    if settled:
        ev["settle_sig"], ev["settle_explorer"] = sig, explorer(sig)
    if order:
        ev["sale_id"] = order["sale_id"]
        ev["order"] = {k: order.get(k) for k in ("lines", "subtotal_cents", "tax_cents", "tip_cents", "source", "customer_name")}
        ev["order"]["total_cents"] = order["cents"]
    if a is not None:
        if ev["approved"] and not (res and "balance" in res):
            a["balance_cents"] -= t.amount_cents
            a["spent_today_cents"] += t.amount_cents
        a["history"].insert(0, {"kind": "tap", "amount_cents": t.amount_cents, "merchant": ev["merchant"], "merchant_id": t.merchant_id, "item": t.item, "approved": ev["approved"], "score": ev["score"], "ts": time.time(), "sig": ev["sig"] or "", "settle_sig": ev.get("settle_sig"), "latency_ms": round(latency), "reasons": reasons, "order": ev.get("order")})
        del a["history"][50:]
        if order and order.get("source") == "kiosk" and ev["approved"]:
            pending_sale.pop(t.merchant_id, None)
        ev["balance_cents"] = a["balance_cents"]
        record_merchant(ev)
        audit["approved" if ev["approved"] else "declined"] += 1
        if settled:
            audit["settled"] += 1
    persist()
    await broadcast(ev)
    if a is not None:
        await broadcast(account_view(a))
    return ev


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    for a in list(accounts.values()):
        await ws.send_text(json.dumps(account_view(a)))
    for ev in agent_layer.snapshot():
        await ws.send_text(json.dumps(ev))
    await ws.send_text(json.dumps({"type": "mode", "mode": state["mode"]}))
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        clients.discard(ws)


SIM_FEATURES = ["velocity_60s", "two_merchants_60s", "amount_vs_usual", "new_card", "distance_km", "hour", "category_risk"]


async def mock_stream() -> None:
    rng = random.Random(7)
    while True:
        m = MODES[state["mode"]]
        if m["rate"] <= 0:
            await asyncio.sleep(0.5)
            continue
        fraud = rng.random() < m["fraud"]
        p = rng.uniform(0.8, 0.99) if fraud else rng.betavariate(1.2, 20)
        row = rng.choice(MENU_ROWS)
        amount = rng.choice([4250, 8900, 12500]) if fraud else row["cents"] * rng.choice([1, 1, 1, 2])
        uid = "04" + "".join(rng.choice("0123456789abcdef") for _ in range(12))
        reasons = []
        if fraud:
            picks = rng.sample(SIM_FEATURES, 3)
            weights = sorted([rng.uniform(0.1, 0.5) for _ in picks], reverse=True)
            reasons = [{"feature": f, "contribution": round(w, 2)} for f, w in zip(picks, weights)]
        ev = make_event(uid, amount, row["merchant_id"], p, fake_sig(rng), rng.gauss(420, 60), reasons, row["item"])
        ev["simulated"] = True
        record_merchant(ev)
        await broadcast(ev)
        await asyncio.sleep(1.0 / m["rate"])


class Mode(BaseModel):
    mode: str


@app.post("/mode")
async def set_mode(m: Mode, x_admin_token: str | None = Header(default=None)):
    require(ADMIN_TOKEN, x_admin_token, "mode switch")
    if m.mode not in MODES:
        return {"ok": False, "modes": list(MODES)}
    state["mode"] = m.mode
    await broadcast({"type": "mode", "mode": m.mode})
    return {"ok": True, "mode": m.mode}


@app.get("/mode")
def get_mode():
    return {"mode": state["mode"]}


@app.post("/reset")
async def reset_demo(x_admin_token: str | None = Header(default=None)):
    require(ADMIN_TOKEN, x_admin_token, "reset")
    accounts.clear()
    people.clear()
    pending_funds.clear()
    pending_sale.clear()
    for k in audit:
        audit[k] = 0
    for mid in merchant_stats:
        merchant_stats[mid] = new_merchant_stats()
    agent_layer.reset()
    persist()
    await broadcast({"type": "reset"})
    return {"ok": True}


@app.get("/audit")
def get_audit():
    return {**audit, "denylist_size": len(DENYLIST), "screening": "denylist", "monitoring": "model+rules" if booster else "rules"}


_chain_info: dict = {}


def chain_info() -> dict:
    if CHAIN_URL and (not _chain_info or time.time() - _chain_info.get("_ts", 0) > 300):
        r = chain("/health", {}, 5) or {}
        if r.get("program"):
            _chain_info.update({k: r.get(k) for k in ("program", "config", "vault")}, _ts=time.time())
    return {k: v for k, v in _chain_info.items() if k != "_ts"}


@app.get("/health")
def health():
    return {"ok": True, "clients": len(clients), "model": booster is not None, "chain": CHAIN_URL, "cluster": "devnet", "auth": "off" if AUTH_OFF else "on", **chain_info(), "audit": audit}


@app.on_event("startup")
async def startup():
    restore()
    asyncio.create_task(mock_stream())


from . import agents as agent_layer

agent_layer.mount(app, sys.modules[__name__])
