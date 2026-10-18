import base64
import csv
import hashlib
import html
import io
import json
import os
import re
import statistics
import time

import requests
import segno

HERE = os.path.dirname(__file__)
SAMPLE_CSV = os.path.join(HERE, "compute", "settlements.csv")
UA = {"User-Agent": "Settld-devnet-demo/0.1"}
ATLANTA = {"name": "Atlanta", "admin1": "Georgia", "country_code": "US", "latitude": 33.749, "longitude": -84.388}
WMO = {0: "clear", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "rime fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
       56: "freezing drizzle", 57: "freezing drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain", 71: "light snow",
       73: "snow", 75: "heavy snow", 77: "snow grains", 80: "light showers", 81: "showers", 82: "heavy showers", 85: "snow showers", 86: "snow showers",
       95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail"}
STOP = {"weather", "snapshot", "forecast", "current", "conditions", "for", "in", "at", "the", "a", "an", "of", "today", "now", "right", "please", "me", "my", "get", "check", "what", "is", "it", "like"}
RESEARCHER = """You are the research desk at Research agent, a shop on the Settld payment network. A buyer's agent has paid for one piece of research for its owner, {owner}. Write the deliverable itself, not a chat reply: plain text, no markdown, no headings, no preamble, at most 220 words. Be concrete and give numbers where you can; when a figure is an estimate, say so once. End with one sentence that states the answer or the pick."""
JOB_PROMPTS = {
    "price_check": "Give the typical price range for the thing described, what drives the low and high end, and one tip for paying less. Brief: {brief}",
    "summarize": "Summarize the document below in plain language: what it is, the three points that matter most, and anything the reader should act on.\n\nDocument:\n{doc}",
    "compare": "Compare three options for the decision described, side by side on the two or three things that matter most, then pick one and say why. Brief: {brief}",
}
ctx = None
client = None
model = None


def configure(main, api, api_model) -> None:
    global ctx, client, model
    ctx, client, model = main, api, api_model


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def text_artifact(title: str, text: str, summary: str) -> dict:
    return {"type": "text", "title": title, "text": text, "url": None, "sha256": sha(text.encode("utf-8")), "summary": summary}


def fetch_json(url: str, timeout: float = 8, headers: dict | None = None):
    r = requests.get(url, timeout=timeout, headers=headers or UA)
    r.raise_for_status()
    return r.json()


def geocode(q: str) -> dict | None:
    hits = fetch_json(f"https://geocoding-api.open-meteo.com/v1/search?name={requests.utils.quote(q)}&count=5&language=en&format=json").get("results") or []
    towns = [h for h in hits if str(h.get("feature_code", "")).startswith("PPL")]
    return (towns or hits or [None])[0]


def place_from(brief: str) -> dict:
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z.'-]*,?", brief or "") if w.lower().rstrip(",") not in STOP]
    q = re.sub(r"\s*,\s*", ", ", " ".join(words)).strip(" ,")
    if not q:
        return ATLANTA
    for attempt in (q, q.split(",")[0].strip()):
        try:
            hit = geocode(attempt)
            if hit:
                return hit
        except Exception:
            break
    return ATLANTA


def weather(brief: str) -> dict:
    p = place_from(brief)
    where = ", ".join(x for x in (p.get("name"), p.get("admin1"), p.get("country_code")) if x)
    try:
        cur = fetch_json(f"https://api.open-meteo.com/v1/forecast?latitude={p['latitude']}&longitude={p['longitude']}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,precipitation&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto")["current"]
    except Exception as e:
        text = f"Weather snapshot for {where}\nThe live feed could not be reached ({type(e).__name__}). No reading this time."
        return text_artifact(f"Weather snapshot: {where}", text, f"{where}: the weather feed was unreachable")
    sky = WMO.get(int(cur.get("weather_code", -1)), "unknown sky")
    line = f"{cur['temperature_2m']:.0f}°F, {sky}, feels like {cur['apparent_temperature']:.0f}°F, humidity {cur['relative_humidity_2m']:.0f}%, wind {cur['wind_speed_10m']:.0f} mph"
    text = (f"Weather snapshot for {where}\n{line}.\nPrecipitation in the last hour: {cur.get('precipitation', 0)} mm.\n"
            f"Read at {cur.get('time')} local time from Open-Meteo, at {p['latitude']:.3f}, {p['longitude']:.3f}.")
    return text_artifact(f"Weather snapshot: {where}", text, f"{where}: {line}")


def market(brief: str) -> dict:
    rows = []
    try:
        d = fetch_json("https://api.coingecko.com/api/v3/simple/price?ids=solana,bitcoin,ethereum,usd-coin&vs_currencies=usd&include_24hr_change=true")
        for cid, sym in (("solana", "SOL"), ("bitcoin", "BTC"), ("ethereum", "ETH"), ("usd-coin", "USDC")):
            if cid in d:
                rows.append((sym, float(d[cid]["usd"]), d[cid].get("usd_24h_change")))
        source = "CoinGecko"
    except Exception:
        try:
            d = fetch_json("https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112")
            sol = d["So11111111111111111111111111111111111111112"]
            rows.append(("SOL", float(sol["usdPrice"]), sol.get("priceChange24h")))
            source = "Jupiter"
        except Exception:
            source = None
    stamp = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())
    if not rows:
        text = f"Market snapshot at {stamp}\nBoth price feeds were unreachable. No quotes this time."
        return text_artifact("Market snapshot", text, "the price feeds were unreachable")
    lines = []
    for sym, px, chg in rows:
        fmt = f"${px:,.4f}" if px < 10 else f"${px:,.2f}"
        lines.append(f"{sym} {fmt}" + (f" ({chg:+.2f}% 24h)" if chg is not None else ""))
    text = f"Market snapshot at {stamp}\n" + "\n".join(lines) + f"\nSource: {source}, spot prices in USD."
    return text_artifact("Market snapshot", text, "; ".join(lines))


def business(brief: str) -> dict:
    q = (brief or "").strip()
    for s in ctx.SHOPS.values():
        if q and s["name"].lower().split(" ")[0] in q.lower():
            rec = (ctx.merchant_chain_balances() or {}).get(s["id"], {})
            text = (f"Business lookup: {s['name']}\n{s['address']}\n{s['geo'][0]:.4f}, {s['geo'][1]:.4f}\nCategory: {s['category']}. On the Settld network as shop {s['id']}, "
                    f"{'takes' if s['accepts_agents'] else 'does not take'} agent orders." + (f"\nSettlement wallet: {rec.get('wallet')}" if rec.get("wallet") else "") +
                    f"\nMap: https://www.openstreetmap.org/?mlat={s['geo'][0]}&mlon={s['geo'][1]}#map=17/{s['geo'][0]}/{s['geo'][1]}")
            return text_artifact(f"Business lookup: {s['name']}", text, f"{s['name']}, {s['address']}")
    if not q:
        return text_artifact("Business lookup", "Business lookup\nNo business was named, so there is nothing to look up.", "no business named")
    try:
        hits = fetch_json(f"https://nominatim.openstreetmap.org/search?q={requests.utils.quote(q)}&format=jsonv2&limit=1&addressdetails=1")
    except Exception as e:
        return text_artifact(f"Business lookup: {q}", f"Business lookup: {q}\nThe directory could not be reached ({type(e).__name__}).", "the directory was unreachable")
    if not hits:
        return text_artifact(f"Business lookup: {q}", f"Business lookup: {q}\nNo listing matched that name.", f"no listing matched {q}")
    h = hits[0]
    lat, lon = float(h["lat"]), float(h["lon"])
    text = (f"Business lookup: {q}\n{h.get('display_name')}\n{lat:.4f}, {lon:.4f}\nListed as: {h.get('type', '')} ({h.get('category', '')})\n"
            f"Map: https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=18/{lat}/{lon}\nSource: OpenStreetMap Nominatim.")
    return text_artifact(f"Business lookup: {q}", text, h.get("display_name", q))


def fetch_document(brief: str) -> str:
    m = re.search(r"https?://\S+", brief or "")
    if not m:
        return (brief or "").strip()
    try:
        r = requests.get(m.group(0), timeout=10, headers=UA)
        body = re.sub(r"(?is)<(script|style).*?</\1>", " ", r.text)
        body = html.unescape(re.sub(r"(?s)<[^>]+>", " ", body))
        return re.sub(r"\s+", " ", body).strip()[:6000] or brief
    except Exception:
        return brief


def offline_note(job: str, brief: str) -> str:
    topic = (brief or "the request").strip()
    if job == "price_check":
        return f"Price check for {topic}.\nThe research desk is offline, so this is a placeholder: compare three listed prices, take the middle one as typical, and treat anything 30 percent under it as suspect."
    if job == "summarize":
        return f"Summary of {topic[:80]}.\nThe research desk is offline, so this is a placeholder: the document was received and would be summarized to its three main points and any action items."
    return f"Comparison for {topic}.\nThe research desk is offline, so this is a placeholder: three options would be compared on cost, fit and risk, with one pick."


def research(job: str, brief: str, owner: str) -> str:
    if client is None:
        return offline_note(job, brief)
    prompt = JOB_PROMPTS[job].format(brief=(brief or "").strip() or "no brief given; say what you would need", doc=fetch_document(brief) or "no document given")
    msg = client.messages.create(model=model, max_tokens=700, system=RESEARCHER.format(owner=owner), messages=[{"role": "user", "content": prompt}])
    text = "\n".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
    return text or offline_note(job, brief)


def note_html(title: str, shop: str, body: str, stamp: str) -> str:
    paras = "".join(f"<p>{html.escape(p.strip())}</p>" for p in body.split("\n") if p.strip())
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{html.escape(title)}</title>
<style>body{{margin:0;background:#000;color:#fff;font:17px/1.55 -apple-system,system-ui,sans-serif}}main{{max-width:640px;margin:0 auto;padding:48px 24px}}h1{{font-weight:600;font-size:26px;margin:0 0 4px}}.k{{color:#a4a4ac;font-size:13px;margin-bottom:28px}}p{{margin:0 0 14px}}.f{{margin-top:40px;color:#a4a4ac;font-size:13px;border-top:1px solid #2e2e35;padding-top:14px}}</style></head>
<body><main><h1>{html.escape(title)}</h1><div class="k">{html.escape(shop)} · {html.escape(stamp)}</div>{paras}<div class="f">Delivered on the Settld network and signed by {html.escape(shop)}. The delivery signature is on the order record.</div></main></body></html>
"""


def research_file(job: str, item: str, brief: str, owner: str, intent_id: str) -> dict:
    body = research(job, brief, owner)
    stamp = time.strftime("%b %d, %Y %H:%M UTC", time.gmtime())
    title = f"{item}: {brief.strip()[:60]}" if brief and brief.strip() else item
    name = f"note-{re.sub(r'[^a-z0-9]', '', intent_id.lower())}.html"
    data = note_html(title, "Research agent", body, stamp).encode("utf-8")
    with open(os.path.join(ctx.DELIVERIES, name), "wb") as f:
        f.write(data)
    paras = [p.strip() for p in body.split("\n") if p.strip()]
    first = paras[0] if paras else ""
    headline = re.split(r"(?<=[.!?])\s+", first, maxsplit=1)[0][:200]
    return {"type": "link", "title": title, "text": first[:240], "url": f"/files/{name}", "sha256": sha(data), "summary": body[:1600], "headline": headline}


def stats(full: bool) -> dict:
    with open(SAMPLE_CSV) as f:
        rows = list(csv.DictReader(f))
    t0 = time.perf_counter()
    orders = [int(r["orders"]) for r in rows]
    usd = [float(r["settled_usd"]) for r in rows]
    p50 = [int(r["settle_p50_ms"]) for r in rows]
    declined = [int(r["declined"]) for r in rows]
    best = max(rows, key=lambda r: float(r["settled_usd"]))
    worst = min(rows, key=lambda r: float(r["settled_usd"]))
    lines = [
        f"Dataset: settlements.csv, {len(rows)} days from {rows[0]['date']} to {rows[-1]['date']}, sha256 {sha(open(SAMPLE_CSV, 'rb').read())[:16]}",
        f"Orders: total {sum(orders):,}, mean {statistics.mean(orders):.1f}, median {statistics.median(orders):.0f}, stdev {statistics.pstdev(orders):.1f}",
        f"Settled: total ${sum(usd):,.2f}, mean ${statistics.mean(usd):,.2f} a day, average ticket ${sum(usd) / sum(orders):.2f}",
        f"Settle time: median of daily p50 {statistics.median(p50):.0f} ms, range {min(p50)} to {max(p50)} ms",
        f"Declined: {sum(declined)} of {sum(orders) + sum(declined)} ({100 * sum(declined) / (sum(orders) + sum(declined)):.2f}%)",
        f"Best day {best['date']} ({best['weekday']}) ${float(best['settled_usd']):,.2f}; worst day {worst['date']} ({worst['weekday']}) ${float(worst['settled_usd']):,.2f}",
    ]
    if full:
        by_day: dict[str, list[float]] = {}
        for r in rows:
            by_day.setdefault(r["weekday"], []).append(float(r["settled_usd"]))
        lines.append("Weekday averages: " + ", ".join(f"{d} ${statistics.mean(by_day[d]):,.0f}" for d in ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun") if d in by_day))
        n = len(usd)
        xs = list(range(n))
        mx, my = statistics.mean(xs), statistics.mean(usd)
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, usd)) / sum((x - mx) ** 2 for x in xs)
        lines.append(f"Trend: {slope:+.2f} USD a day by least squares; next 7 days projected ${sum(my + slope * (n + k - mx) for k in range(7)):,.2f}")
    ms = (time.perf_counter() - t0) * 1000
    lines.append(f"Ran in {ms:.1f} ms on the shop's worker, billed as a {'30' if full else '10'} minute slot.")
    text = ("Full statistics summary" if full else "Statistics summary") + "\n" + "\n".join(lines)
    return text_artifact("Compute result: " + ("full summary" if full else "stats summary"), text, lines[2] + "; " + lines[3])


def qr_pass(job: str, brief: str, owner: str, intent_id: str, merchant_id: int, sign) -> dict:
    hours = 2 if job == "parking_2h" else 24
    plate = next((p for p in re.findall(r"\b[A-Z0-9]{2,3}[- ]?[A-Z0-9]{3,4}\b", (brief or "").upper()) if re.search(r"\d", p)), None)
    now = int(time.time())
    doc = {"v": 1, "pass": job, "holder": owner, "plate": plate.replace(" ", "").replace("-", "") if plate else None, "merchant_id": merchant_id, "order": intent_id, "valid_from": now, "valid_to": now + hours * 3600}
    body = ctx_canonical(doc)
    sig = sign(body)
    payload = json.dumps({"pass": doc, "sig": sig.get("signature"), "key": sig.get("key")}, separators=(",", ":"))
    buf = io.BytesIO()
    segno.make(payload, error="m").save(buf, kind="png", scale=5, border=2, dark="#000000", light="#ffffff")
    png = buf.getvalue()
    until = time.strftime("%b %d %H:%M UTC", time.gmtime(doc["valid_to"]))
    label = "2-hour parking pass" if hours == 2 else "Day pass"
    caption = f"{label} for {owner}" + (f", plate {doc['plate']}" if doc["plate"] else "") + f", valid until {until}. Signed by the Pass office."
    return {"type": "image", "title": label, "text": caption, "url": "data:image/png;base64," + base64.b64encode(png).decode("ascii"), "sha256": sha(png), "summary": caption, "pass": doc, "pass_signature": sig.get("signature")}


def ctx_canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def fulfill(row: dict, brief: str, owner: str, intent_id: str, merchant_id: int, sign) -> dict:
    job = row.get("job", "")
    if job == "weather":
        return weather(brief)
    if job == "market":
        return market(brief)
    if job == "business":
        return business(brief)
    if job in JOB_PROMPTS:
        return research_file(job, row["item"], brief, owner, intent_id)
    if job in ("stats_basic", "stats_full"):
        return stats(job == "stats_full")
    if job in ("parking_2h", "day_pass"):
        return qr_pass(job, brief, owner, intent_id, merchant_id, sign)
    return text_artifact(row["item"], f"{row['item']}\nThis item has no fulfillment job configured.", "nothing configured")
