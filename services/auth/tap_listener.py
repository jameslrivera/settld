import os
import sys
import time

import requests
from smartcard.CardMonitoring import CardMonitor, CardObserver
from smartcard.System import readers
from smartcard.util import toHexString

GET_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00]
MERCHANT_ID = int(os.environ.get("MERCHANT_ID", "1"))
TAP_TOKEN = os.environ.get("TAP_TOKEN", "")
HEADERS = {"x-tap-token": TAP_TOKEN} if TAP_TOKEN else {}
DEBOUNCE_S = 8.0


class TapObserver(CardObserver):
    def __init__(self, url: str):
        self.url = url
        self.last: dict[str, float] = {}
        self.present: dict[int, str] = {}
        self.on_reader: set[str] = set()

    def update(self, observable, actions):
        added, removed = actions
        for card in removed:
            uid = self.present.pop(id(card), None)
            if uid:
                self.on_reader.discard(uid)
                print(f"uid={uid} removed")
        for card in added:
            t0 = time.perf_counter()
            try:
                conn = card.createConnection()
                conn.connect()
                data, sw1, sw2 = conn.transmit(GET_UID)
            except Exception as e:
                print(f"card error: {e}")
                continue
            if (sw1, sw2) != (0x90, 0x00):
                print(f"get uid failed: {sw1:02X}{sw2:02X}")
                continue
            uid = toHexString(data).replace(" ", "").lower()
            now = time.time()
            self.present[id(card)] = uid
            if uid in self.on_reader or now - self.last.get(uid, 0) < DEBOUNCE_S:
                print(f"uid={uid} ignored (still on the reader)")
                continue
            self.on_reader.add(uid)
            self.last[uid] = now
            t_uid = (time.perf_counter() - t0) * 1000
            try:
                r = requests.post(self.url, json={"uid": uid, "merchant_id": MERCHANT_ID}, timeout=60, headers=HEADERS)
                body = r.json()
            except Exception as e:
                body = {"error": str(e)}
            t_total = (time.perf_counter() - t0) * 1000
            print(f"uid={uid} read={t_uid:.1f}ms total={t_total:.0f}ms -> approved={body.get('approved')} score={body.get('score')} sig={str(body.get('sig'))[:12]}")


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("SERVICE_URL", "http://127.0.0.1:8000").rstrip("/") + "/tap"
    rs = readers()
    if not rs:
        print("no PC/SC readers found")
        sys.exit(1)
    print(f"readers: {rs}")
    mon = CardMonitor()
    obs = TapObserver(url)
    mon.addObserver(obs)
    print(f"merchant {MERCHANT_ID}; posting to {url}")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        mon.deleteObserver(obs)


if __name__ == "__main__":
    main()
