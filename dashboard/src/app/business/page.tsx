"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, API_URL, type BookRow, type Books, type Merchant } from "@/lib/api";
import { usd, plain } from "@/lib/format";
import { RibbonS, Wordmark } from "@/components/Logo";

type Filter = "all" | "card" | "agent" | "stopped";
type Msg = { role: "user" | "reply"; content: string };

const SUGGESTED = ["How much did agents spend here?", "What sales tax did I collect?", "Which orders should my auditor check?", "What was my busiest hour?"];
const dayTime = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const time = (ts: number) => new Date(ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;

export default function BusinessPage() {
  return <Suspense><Business /></Suspense>;
}

function Business() {
  const params = useSearchParams();
  const [merchantId, setMerchantId] = useState(Number(params.get("merchant") ?? 6));
  const [shops, setShops] = useState<Merchant[]>([]);
  const [books, setBooks] = useState<Books | null>(null);
  const [offline, setOffline] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [report, setReport] = useState(false);
  const [base, setBase] = useState("");
  useEffect(() => { setBase(API_URL); }, []);

  useEffect(() => { api.merchants().then(setShops).catch(() => {}); }, []);

  const load = useCallback(() => {
    api.books(merchantId).then((b) => { setBooks(b); setOffline(false); }).catch(() => setOffline(true));
  }, [merchantId]);

  useEffect(() => {
    setBooks(null);
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const rows = useMemo(() => {
    if (!books) return [];
    const q = query.trim().toLowerCase();
    return books.rows.filter((r) =>
      (filter === "all" || (filter === "stopped" ? r.status === "stopped" : r.source === filter && r.status === "paid")) &&
      (!q || [r.item, r.agent_name, r.owner_name, r.card, String(r.order), r.sig].some((v) => v?.toLowerCase().includes(q))));
  }, [books, filter, query]);

  const s = books?.summary;

  return (
    <main className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-10 bg-bg/90 backdrop-blur border-b border-line print:hidden">
        <div className="max-w-[1280px] mx-auto px-8 h-16 flex items-center gap-4">
          <span className="flex items-center gap-2.5"><RibbonS size={24} /><Wordmark className="text-[20px] leading-none" /></span>
          <span className="text-ink-3 text-sm">Business</span>
          <div className="ml-auto flex items-center gap-3">
            <select value={merchantId} onChange={(e) => setMerchantId(Number(e.target.value))} className="bg-surface-2 text-sm rounded-full px-3 py-1.5 outline-none">
              {(shops.length ? shops : [{ id: merchantId, name: books?.name ?? "Shop" } as Merchant]).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <a href={`/kiosk?merchant=${merchantId}`} className="text-sm text-ink-2 px-3 py-1.5 rounded-full border border-line hover:text-ink">Kiosk</a>
          </div>
        </div>
      </header>

      <div className="max-w-[1280px] mx-auto px-8 py-10">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <div className="text-ink-3 text-sm">{books?.address || " "}</div>
            <h1 className="text-4xl font-semibold tracking-tight mt-1">{books?.name ?? "Loading…"}</h1>
            <div className="text-ink-3 text-sm mt-2">{s?.from ? `${dayTime(s.from)} to ${dayTime(s.to)}` : "No payments yet"}{offline ? " · can't reach the register" : ""}</div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <a href={base ? `${base}/merchants/${merchantId}/audit.csv` : undefined} className="px-4 py-2.5 rounded-full border border-line text-sm font-medium hover:border-ink-3">Download audit CSV</a>
            <a href={base ? `${base}/merchants/${merchantId}/tax.csv` : undefined} className="px-4 py-2.5 rounded-full border border-line text-sm font-medium hover:border-ink-3">Tax CSV</a>
            <button disabled={!books} onClick={() => setReport(true)} className="px-4 py-2.5 rounded-full bg-lime text-on-accent text-sm font-semibold disabled:opacity-40">Audit report</button>
          </div>
        </div>

        {s && (
          <>
            <section className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-x-10 gap-y-8">
              <Stat label="Gross sales" value={usd(s.gross_cents)} note={`${s.paid} paid · avg ${usd(s.avg_ticket_cents)}`} />
              <Stat label="Net to you" value={usd(s.net_cents)} note={`after the ${s.fee_bps / 100}% Settld fee (${usd(s.fee_cents)})`} accent />
              <Stat label="Sales tax collected" value={usd(s.tax_cents)} note={`on ${usd(s.sales_cents)} taxable`} />
              <Stat label="Stopped before charging" value={String(s.stopped)} note={s.stopped ? `${usd(s.stopped_cents)} never charged` : "no fraud at your register"} />
            </section>

            <section className="mt-12 grid lg:grid-cols-[1.4fr_1fr] gap-12">
              <div>
                <Label>Sales by hour</Label>
                <HourBars hours={s.by_hour} />
              </div>
              <div>
                <Label>Who paid</Label>
                <SourceSplit s={s} />
                <div className="mt-8"><Label>Top items</Label></div>
                <TopItems items={s.top_items.slice(0, 5)} />
              </div>
            </section>

            <Ask merchantId={merchantId} />

            <section className="mt-14">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <Label>Every payment · {s.on_chain} of {s.paid + s.stopped} verifiable on Solana</Label>
                <div className="flex items-center gap-2">
                  {(["all", "card", "agent", "stopped"] as Filter[]).map((f) => (
                    <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-full text-sm capitalize ${filter === f ? "bg-ink text-bg font-semibold" : "text-ink-2 hover:text-ink"}`}>{f}</button>
                  ))}
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search item, agent, order" className="ml-2 bg-surface-2 rounded-full px-4 py-1.5 text-sm outline-none w-56" />
                </div>
              </div>
              <Ledger rows={rows} />
            </section>
          </>
        )}
      </div>

      {report && books && <Report books={books} onClose={() => setReport(false)} />}
    </main>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs uppercase tracking-[0.14em] text-ink-3 font-medium">{children}</div>;
}

function Stat({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className={`text-4xl font-semibold tracking-tight mt-2 ${accent ? "text-lime" : ""}`}>{value}</div>
      <div className="text-sm text-ink-3 mt-1">{note}</div>
    </div>
  );
}

function HourBars({ hours, tall = 220 }: { hours: number[]; tall?: number }) {
  const active = hours.map((c, h) => ({ c, h })).filter((x) => x.c > 0);
  const lo = active.length ? Math.max(0, Math.min(...active.map((x) => x.h)) - 1) : 8;
  const hi = active.length ? Math.min(23, Math.max(...active.map((x) => x.h)) + 1) : 18;
  const span = hours.slice(lo, hi + 1);
  const max = Math.max(1, ...span);
  const best = active.length ? active.reduce((a, b) => (b.c > a.c ? b : a)) : null;
  return (
    <div className="mt-4">
      <div className="flex items-end gap-2" style={{ height: tall }}>
        {span.map((c, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
            {c > 0 && <div className="text-[11px] text-ink-3">{usd(c).replace(".00", "")}</div>}
            <div className={`w-full rounded-t-md ${best && best.h === lo + i ? "bg-lime" : "bg-surface-2"}`} style={{ height: `${(c / max) * 100}%`, minHeight: c ? 4 : 1 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-2">{span.map((_, i) => <div key={i} className="flex-1 text-center text-[11px] text-ink-3">{hourLabel(lo + i)}</div>)}</div>
      {best && <div className="text-sm text-ink-3 mt-3">Busiest hour: {hourLabel(best.h)} with {usd(best.c)}</div>}
    </div>
  );
}

function SourceSplit({ s }: { s: Books["summary"] }) {
  const total = Math.max(1, s.by_source.card.cents + s.by_source.agent.cents);
  const agentPct = Math.round((s.by_source.agent.cents / total) * 100);
  return (
    <div className="mt-4">
      <div className="h-3 rounded-full bg-surface-2 overflow-hidden flex">
        <div className="h-full bg-ink" style={{ width: `${100 - agentPct}%` }} />
        <div className="h-full bg-lime" style={{ width: `${agentPct}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-6">
        <div><div className="flex items-center gap-2 text-sm"><span className="w-2.5 h-2.5 rounded-full bg-ink" />Card at the counter</div><div className="text-2xl font-semibold mt-1">{usd(s.by_source.card.cents)}</div><div className="text-sm text-ink-3">{s.by_source.card.count} orders</div></div>
        <div><div className="flex items-center gap-2 text-sm"><span className="w-2.5 h-2.5 rounded-full bg-lime" />AI agents</div><div className="text-2xl font-semibold mt-1">{usd(s.by_source.agent.cents)}</div><div className="text-sm text-ink-3">{s.by_source.agent.count} orders · {agentPct}% of sales</div></div>
      </div>
    </div>
  );
}

function TopItems({ items }: { items: Books["summary"]["top_items"] }) {
  const max = Math.max(1, ...items.map((i) => i.cents));
  return (
    <ul className="mt-3 space-y-2.5">
      {items.length === 0 && <li className="text-sm text-ink-3">No sales yet.</li>}
      {items.map((i) => (
        <li key={i.item}>
          <div className="flex justify-between text-sm"><span className="truncate pr-4">{i.item}</span><span className="text-ink-2 shrink-0">{usd(i.cents)} · {i.count}</span></div>
          <div className="h-1.5 rounded-full bg-surface-2 mt-1 overflow-hidden"><div className="h-full rounded-full bg-ink-3" style={{ width: `${(i.cents / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function payer(r: BookRow) {
  return r.source === "agent" ? `${r.agent_name ?? "Agent"}${r.owner_name ? ` for ${r.owner_name}` : ""}` : `Card ${r.card.replace("**** ", "•••• ")}`;
}

function Ledger({ rows }: { rows: BookRow[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-3 border-b border-line">
            <th className="py-2.5 font-medium">Time</th><th className="font-medium">Order</th><th className="font-medium">Item</th><th className="font-medium">Paid by</th>
            <th className="font-medium text-right">Total</th><th className="font-medium text-right">Fee</th><th className="font-medium text-right">Net</th><th className="font-medium text-right">Status</th><th className="font-medium text-right">Proof</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={9} className="py-6 text-ink-3">Nothing matches.</td></tr>}
          {rows.map((r) => (
            <tr key={`${r.order}-${r.ts}`} className="border-b border-line/60">
              <td className="py-3 text-ink-2 whitespace-nowrap">{time(r.ts)}</td>
              <td className="text-ink-3">#{r.order}</td>
              <td className="max-w-[260px] truncate pr-4">{r.item}</td>
              <td className="pr-4"><span className={r.source === "agent" ? "text-lime" : "text-ink-2"}>{payer(r)}</span></td>
              <td className={`text-right ${r.status === "paid" ? "" : "line-through text-ink-3"}`}>{usd(r.total_cents)}</td>
              <td className="text-right text-ink-3">{r.fee_cents ? usd(r.fee_cents) : "—"}</td>
              <td className="text-right font-medium">{r.status === "paid" ? usd(r.net_cents) : "—"}</td>
              <td className={`text-right ${r.status === "paid" ? "text-up" : "text-warn"}`}>{r.status === "paid" ? "Paid" : `Stopped${r.reason ? ` · ${plain(r.reason)}` : ""}`}</td>
              <td className="text-right">{r.explorer ? <a href={r.explorer} target="_blank" rel="noreferrer" className="underline text-ink-2 hover:text-ink">Solana</a> : <span className="text-ink-3">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Ask({ merchantId }: { merchantId: number }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { setMsgs([]); }, [merchantId]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs, busy]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const history = msgs;
    setMsgs([...history, { role: "user", content: question }]);
    setText("");
    setBusy(true);
    try {
      const r = await api.askBooks(merchantId, question, history);
      setMsgs((m) => [...m, { role: "reply", content: r.answer ?? (typeof r.detail === "string" ? r.detail : "I couldn't answer that one.") }]);
    } catch {
      setMsgs((m) => [...m, { role: "reply", content: "Can't reach the register right now." }]);
    } finally { setBusy(false); }
  }

  return (
    <section className="mt-14 print:hidden">
      <Label>Ask about your books</Label>
      <div className="mt-4 rounded-2xl bg-surface p-6">
        {msgs.length === 0 ? (
          <div className="flex flex-wrap gap-2">
            {SUGGESTED.map((q) => <button key={q} onClick={() => send(q)} className="px-3.5 py-2 rounded-full border border-line text-sm text-ink-2 hover:text-ink hover:border-ink-3">{q}</button>)}
          </div>
        ) : (
          <div className="space-y-4 max-h-[360px] overflow-y-auto pr-2">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <div className={`max-w-[80%] whitespace-pre-wrap text-[15px] leading-relaxed ${m.role === "user" ? "bg-surface-2 rounded-2xl px-4 py-2.5" : "text-ink-2"}`}>{m.content}</div>
              </div>
            ))}
            {busy && <div className="text-ink-3 text-sm">Reading your ledger…</div>}
            <div ref={end} />
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="mt-5 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask anything about your sales, tax, agents or a specific order" className="flex-1 bg-surface-2 rounded-full px-5 py-3 text-[15px] outline-none focus:ring-1 focus:ring-lime" />
          <button disabled={!text.trim() || busy} className="px-5 py-3 rounded-full bg-ink text-bg text-sm font-semibold disabled:opacity-40">Ask</button>
        </form>
      </div>
    </section>
  );
}

function Report({ books, onClose }: { books: Books; onClose: () => void }) {
  const s = books.summary;
  const paid = books.rows.filter((r) => r.status === "paid");
  const slides: { key: string; body: React.ReactNode }[] = [
    { key: "cover", body: (
      <div className="h-full flex flex-col justify-center">
        <Label>Audit report</Label>
        <div className="text-6xl font-semibold tracking-tight mt-4">{books.name}</div>
        <div className="text-xl text-ink-3 mt-3">{dayTime(s.from)} to {dayTime(s.to)}</div>
        <div className="mt-14 grid grid-cols-3 gap-10">
          <Stat label="Gross sales" value={usd(s.gross_cents)} note={`${s.paid} paid orders`} />
          <Stat label="Net to the shop" value={usd(s.net_cents)} note={`after ${usd(s.fee_cents)} in fees`} accent />
          <Stat label="Verifiable on Solana" value={`${s.on_chain} of ${s.paid + s.stopped}`} note="every payment has a signature" />
        </div>
      </div>
    ) },
    { key: "recon", body: (
      <div className="h-full flex flex-col justify-center">
        <Label>Reconciliation</Label>
        <div className="text-4xl font-semibold tracking-tight mt-3">Where every dollar went</div>
        <div className="mt-10 max-w-[720px] text-xl">
          {[["Sales before tax", s.sales_cents], ["Sales tax collected", s.tax_cents], ["Tips", s.tips_cents], ["Gross charged", s.gross_cents], [`Settld fee (${s.fee_bps / 100}%)`, -s.fee_cents]].map(([k, v]) => (
            <div key={k as string} className="flex justify-between py-3 border-b border-line"><span className="text-ink-2">{k}</span><span>{(v as number) < 0 ? `−${usd(-(v as number))}` : usd(v as number)}</span></div>
          ))}
          <div className="flex justify-between py-4 text-2xl font-semibold"><span>Net to the shop</span><span className="text-lime">{usd(s.net_cents)}</span></div>
          <div className="text-base text-ink-3 mt-2">{s.stopped ? `${s.stopped} payment${s.stopped === 1 ? "" : "s"} for ${usd(s.stopped_cents)} stopped before charging; nothing to refund or charge back.` : "No payments were stopped. Nothing to refund or charge back."}</div>
        </div>
      </div>
    ) },
    { key: "hours", body: (
      <div className="h-full flex flex-col justify-center">
        <Label>Sales by hour</Label>
        <div className="text-4xl font-semibold tracking-tight mt-3 mb-6">When customers bought</div>
        <HourBars hours={s.by_hour} tall={360} />
      </div>
    ) },
    { key: "who", body: (
      <div className="h-full flex flex-col justify-center gap-12">
        <div>
          <Label>Who paid</Label>
          <div className="text-4xl font-semibold tracking-tight mt-3">Cards and agents</div>
          <div className="max-w-[760px]"><SourceSplit s={s} /></div>
        </div>
        <div className="max-w-[760px]"><Label>Top items</Label><TopItems items={s.top_items} /></div>
      </div>
    ) },
    { key: "ledger", body: (
      <div className="h-full flex flex-col">
        <Label>Ledger</Label>
        <div className="text-4xl font-semibold tracking-tight mt-3">Every paid order with its proof</div>
        <div className="mt-6 flex-1 overflow-y-auto report-ledger">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-ink-3 border-b border-line"><th className="py-2 font-medium">Time</th><th className="font-medium">Order</th><th className="font-medium">Item</th><th className="font-medium">Paid by</th><th className="font-medium text-right">Total</th><th className="font-medium text-right">Tax</th><th className="font-medium text-right">Net</th><th className="font-medium text-right pl-4">Solana signature</th></tr></thead>
            <tbody>
              {paid.map((r) => (
                <tr key={`${r.order}-${r.ts}`} className="border-b border-line/60">
                  <td className="py-2 whitespace-nowrap text-ink-2">{time(r.ts)}</td><td className="text-ink-3">#{r.order}</td><td className="truncate max-w-[220px] pr-3">{r.item}</td><td className="pr-3 text-ink-2">{payer(r)}</td>
                  <td className="text-right">{usd(r.total_cents)}</td><td className="text-right text-ink-3">{usd(r.tax_cents)}</td><td className="text-right">{usd(r.net_cents)}</td>
                  <td className="text-right pl-4 font-mono text-xs text-ink-3">{r.sig ? `${r.sig.slice(0, 10)}…${r.sig.slice(-6)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ) },
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") setI((n) => Math.min(slides.length - 1, n + 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length, onClose]);

  return (
    <div className="report fixed inset-0 z-50 bg-bg flex flex-col">
      <style>{`@media print { @page { size: landscape; margin: 0.5in; } body * { visibility: hidden !important; } .report, .report * { visibility: visible !important; } .report { position: absolute; inset: 0; height: auto; display: block; } .report .slide { display: block !important; height: auto !important; min-height: 6.5in; page-break-after: always; break-after: page; padding: 0 !important; } .report .report-ledger { overflow: visible !important; } .report .no-print { display: none !important; } }`}</style>
      <div className="no-print h-16 px-8 flex items-center justify-between border-b border-line">
        <span className="flex items-center gap-2.5"><RibbonS size={22} /><Wordmark className="text-lg" /><span className="text-ink-3 text-sm ml-1">Audit report</span></span>
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-3 mr-2">{i + 1} / {slides.length}</span>
          <button onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0} className="w-9 h-9 rounded-full border border-line disabled:opacity-30">‹</button>
          <button onClick={() => setI((n) => Math.min(slides.length - 1, n + 1))} disabled={i === slides.length - 1} className="w-9 h-9 rounded-full border border-line disabled:opacity-30">›</button>
          <button onClick={() => window.print()} className="ml-2 px-4 py-2 rounded-full bg-lime text-on-accent text-sm font-semibold">Save as PDF</button>
          <button onClick={onClose} className="px-4 py-2 rounded-full border border-line text-sm">Close</button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {slides.map((sl, n) => (
          <div key={sl.key} className={`slide h-full max-w-[1200px] mx-auto px-12 py-12 ${n === i ? "block" : "hidden"}`}>{sl.body}</div>
        ))}
      </div>
    </div>
  );
}
