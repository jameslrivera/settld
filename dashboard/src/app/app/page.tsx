"use client";
import { useEffect, useState } from "react";
import { useFeed } from "@/lib/feed";
import { api, WS_URL } from "@/lib/api";
import { usd, plain, explorerTx } from "@/lib/format";
import { Wordmark } from "@/components/Logo";

type Screen = "card" | "activity";

export default function PhoneApp() {
  const { accounts, cardSeen } = useFeed(WS_URL);
  const list = Object.values(accounts).sort((a, b) => b.created - a.created);
  const [sel, setSel] = useState<string | null>(null);
  const acct = (sel && accounts[sel]) || list[0];
  const [screen, setScreen] = useState<Screen>("card");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string; sig?: string | null } | null>(null);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); } }, [toast]);

  async function go(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  const locked = acct?.status === "blocked";

  return (
    <main className="min-h-screen bg-bg text-ink max-w-[430px] mx-auto flex flex-col">
      <header className="px-5 pt-12 pb-3 flex items-center justify-between">
        <span className="flex items-center gap-2"><Wordmark className="text-lg" /></span>
        {acct && list.length > 1 && (
          <select value={acct.uid} onChange={(e) => setSel(e.target.value)} className="bg-surface-2 text-xs rounded-full px-3 py-1.5 outline-none">
            {list.map((a) => <option key={a.uid} value={a.uid}>{a.name}</option>)}
          </select>
        )}
      </header>

      <section className="flex-1 px-5 pb-28">
        {!acct ? (
          <div className="mt-8">
            <div className="text-2xl font-semibold">Get your card</div>
            <p className="text-sm text-ink-2 mt-2">{cardSeen ? `Card ${cardSeen.uid.toUpperCase()} is on the reader. Add your name.` : "Tap a blank card on the reader, then add your name."}</p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="mt-5 w-full bg-surface-2 rounded-2xl px-4 py-4 text-base outline-none focus:ring-1 focus:ring-lime" />
            <button disabled={!name || busy} onClick={() => go(async () => { const r = await api.register(name, cardSeen?.uid); setSel(r.uid); setName(""); })}
              className="mt-3 w-full py-4 rounded-full bg-lime text-on-accent font-semibold disabled:opacity-40">{busy ? "Issuing on Solana…" : "Issue my card"}</button>
          </div>
        ) : screen === "card" ? (
          <>
            <div className="mt-2 text-xs text-ink-3">Spending power</div>
            <div className="font-serif text-[56px] leading-none mt-1 tracking-tight">{usd(acct.balance_cents)}</div>
            <div className="text-xs text-ink-2 mt-2">USDC · settles the moment you tap</div>

            <div className="mt-6 rounded-3xl p-5 bg-gradient-to-br from-[#121214] to-[#1e1e22] border border-line relative overflow-hidden" style={{ aspectRatio: "1.586" }}>
              <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full" style={{ background: "var(--brand)", opacity: 0.14 }} />
              <div className="flex justify-between items-start">
                <span className="flex items-center gap-2"><Wordmark className="text-base" /></span>
                <span className={`text-[10px] uppercase tracking-widest ${locked ? "text-warn font-semibold" : "text-ink-3"}`}>{locked ? "locked" : acct.status}</span>
              </div>
              <div className="absolute bottom-5 left-5 right-5">
                <div className="font-mono text-base tracking-[0.18em]">{acct.card_number.match(/.{4}/g)?.join(" ")}</div>
                <div className="mt-2 flex justify-between text-[11px] text-ink-2"><span className="uppercase tracking-wide">{acct.name}</span><span className="font-mono text-ink-3">{acct.uid.toUpperCase()}</span></div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              {[2000, 5000, 10000].map((c) => (
                <button key={c} disabled={busy} onClick={() => go(async () => { await api.deposit(acct.uid, c); setToast({ ok: true, text: `Added ${usd(c)}` }); })}
                  className="py-3 rounded-2xl bg-surface-2 font-semibold text-sm disabled:opacity-40">+{usd(c).replace(".00", "")}</button>
              ))}
            </div>
            <div className="text-[10px] text-ink-3 mt-1.5">test funds from the issuer, credited on chain</div>

            <button disabled={busy} onClick={() => go(async () => { await api.freeze(acct.uid, !locked, "cardholder"); setToast({ ok: true, text: locked ? "Card unlocked" : "Card locked" }); })}
              className={`mt-4 w-full py-3.5 rounded-2xl font-semibold text-sm border ${locked ? "border-warn text-warn" : "border-line text-ink-2"}`}>
              {locked ? "Unlock card" : "Lock card"}
            </button>

            <div className="mt-5 text-xs text-ink-3">Spent today {usd(acct.spent_today_cents)} of {usd(acct.daily_limit_cents)}</div>
            <div className="h-1.5 rounded-full bg-surface-2 mt-1.5 overflow-hidden"><div className="h-full bg-up rounded-full" style={{ width: `${Math.min(100, (acct.spent_today_cents / Math.max(1, acct.daily_limit_cents)) * 100)}%` }} /></div>
            <div className="text-[10px] text-ink-3 mt-1">daily limit set on chain</div>
          </>
        ) : (
          <>
            <div className="mt-2 text-2xl font-semibold">Activity</div>
            <ul className="mt-3 divide-y divide-line">
              {acct.history.length === 0 && <li className="text-sm text-ink-3 py-3">Nothing yet. Add money, then pay at a shop.</li>}
              {acct.history.map((h, i) => {
                const title = h.kind === "deposit" ? (h.source === "wallet" ? "Funded from wallet" : "Added money")
                  : h.kind === "withdraw" ? "Withdrawn to wallet"
                  : h.kind === "freeze" ? "Card locked" : h.kind === "unfreeze" ? "Card unlocked" : (h.item ?? "Purchase");
                const stopped = h.kind === "tap" && h.approved === false;
                return (
                  <li key={i} className="py-3 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${h.kind === "deposit" ? "bg-up/15 text-up" : stopped ? "bg-shield/15 text-shield" : "bg-surface-2"}`}>{h.kind === "deposit" ? "+" : (h.merchant ?? "•").slice(0, 1)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{title}</div>
                      <div className="text-xs text-ink-3">{h.kind === "deposit" ? "USDC" : h.merchant ?? ""} · {new Date(h.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · <a className="underline" href={explorerTx(h.sig)} target="_blank" rel="noreferrer">receipt</a></div>
                      {stopped && h.reasons?.[0] && <div className="text-[11px] text-shield mt-0.5">Protected: {plain(h.reasons[0].feature)}</div>}
                    </div>
                    <div className={`text-sm font-semibold ${h.kind === "deposit" ? "text-up" : stopped ? "text-shield line-through" : ""}`}>
                      {h.kind === "freeze" || h.kind === "unfreeze" ? "" : `${h.kind === "deposit" ? "+" : "−"}${usd(h.amount_cents)}`}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {toast && (
        <div className={`fixed left-4 right-4 bottom-24 max-w-[398px] mx-auto rounded-2xl px-4 py-3 text-sm shadow-lg ${toast.ok ? "bg-up text-black" : "bg-shield text-black"}`}>
          <div className="font-semibold">{toast.text}</div>
          {toast.sig && <a href={explorerTx(toast.sig)} target="_blank" rel="noreferrer" className="text-xs underline opacity-80">view on Solana</a>}
        </div>
      )}

      {acct && (
        <nav className="fixed bottom-0 left-0 right-0 bg-bg/90 backdrop-blur border-t border-line">
          <div className="max-w-[430px] mx-auto grid grid-cols-2 px-2 pb-6 pt-2">
            {(["card", "activity"] as Screen[]).map((s) => (
              <button key={s} onClick={() => setScreen(s)} className={`py-2 text-xs font-medium capitalize rounded-xl ${screen === s ? "text-ink" : "text-ink-3"}`}>
                <div className={`mx-auto mb-1 w-1.5 h-1.5 rounded-full ${screen === s ? "bg-lime" : "bg-transparent"}`} />{s === "card" ? "My card" : "Activity"}
              </button>
            ))}
          </div>
        </nav>
      )}
    </main>
  );
}
