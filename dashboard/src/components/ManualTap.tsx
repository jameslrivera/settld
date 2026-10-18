"use client";
import { useEffect, useState } from "react";
import { api, type Merchant, type MenuItem } from "@/lib/api";
import { usd } from "@/lib/format";
import { Card } from "./Panel";

export function ManualTap() {
  const [open, setOpen] = useState(false);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [name, setName] = useState("");
  const [uid, setUid] = useState("");
  const [shop, setShop] = useState<number>(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api.merchants().then((ms) => setMerchants(ms.filter((m) => m.kind !== "digital"))).catch(() => {});
    api.menu().then(setMenu).catch(() => {});
  }, [open]);

  async function issue() {
    setBusy("issue"); setNote(null);
    try {
      const r = await api.register(name.trim(), uid.trim() || undefined);
      if (r.error) setNote(r.reason ?? r.error);
      else { setUid(r.uid); setNote(`Issued •••• ${r.uid.slice(-4)} to ${name.trim()}`); }
    } catch { setNote("Service unreachable."); }
    setBusy(null);
  }

  async function tap(item: MenuItem) {
    setBusy(item.item); setNote(null);
    try {
      const r = await api.tap(uid.trim(), item.cents, shop, item.item);
      setNote(r.approved ? `Paid ${usd(item.cents)} · ${r.latency_ms.toFixed(0)} ms` : `Stopped · ${r.reasons?.[0]?.feature ?? r.reason ?? "refused"}`);
    } catch { setNote("Service unreachable."); }
    setBusy(null);
  }

  return (
    <Card className="!p-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between text-left">
        <span className="text-[13px] text-ink-2 font-medium">Manual transaction</span>
        <span className="text-ink-3 text-xs">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-12 gap-3 items-start">
          <div className="col-span-12 md:col-span-4 flex flex-col gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cardholder name"
              className="bg-surface-2 rounded-xl px-3 py-2 text-sm outline-none" />
            <input value={uid} onChange={(e) => setUid(e.target.value)} placeholder="Card serial (blank = virtual card)"
              className="bg-surface-2 rounded-xl px-3 py-2 text-sm font-mono outline-none" />
            <button onClick={issue} disabled={!!busy || name.trim().length < 2}
              className="rounded-xl px-3 py-2 text-sm font-semibold bg-surface-2 hover:bg-line disabled:opacity-40">
              {busy === "issue" ? "Issuing on Solana…" : "Issue card"}
            </button>
          </div>
          <div className="col-span-12 md:col-span-8">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[12px] text-ink-3">Pay at</span>
              {merchants.map((m) => (
                <button key={m.id} onClick={() => setShop(m.id)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${shop === m.id ? "border-ink text-ink" : "border-line text-ink-2 hover:text-ink"}`}>{m.name}</button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {menu.filter((it) => it.merchant_id === shop).slice(0, 6).map((it) => (
                <button key={it.item} onClick={() => tap(it)} disabled={!!busy || uid.trim().length < 8}
                  className="rounded-xl px-3 py-2 text-left bg-surface-2 hover:bg-line disabled:opacity-40">
                  <div className="text-sm font-medium truncate">{it.item}</div>
                  <div className="text-sm font-semibold">{usd(it.cents)}</div>
                </button>
              ))}
            </div>
            {note && <div className="mt-2 text-xs text-ink-2">{note}</div>}
          </div>
        </div>
      )}
    </Card>
  );
}
