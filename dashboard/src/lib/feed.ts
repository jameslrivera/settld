"use client";
import { useEffect, useRef, useState } from "react";
import { explorerTx } from "./format";

export type Reason = { feature: string; contribution: number };
export type OrderLine = { item: string; cents: number; qty: number };
export type Order = { lines: OrderLine[]; subtotal_cents: number; tax_cents: number; tip_cents: number; total_cents: number; source: string; customer_name?: string | null };

export type AgentRef = { id: string; name: string; agent_id: number; owner: string; owner_name: string; agent_pda?: string | null; card_number?: string; task_card?: string };
export type AgentPolicy = { budget_cents: number; per_txn_max_cents: number; daily_max_cents: number; allowed_merchants: number[]; hour_start: number; hour_end: number; approval_threshold_cents: number; max_txn_per_hour: number };
export type AgentView = {
  type: "agent"; id: string; person_id: string; owner: string; agent_id: number; name: string; uid: string; card_number: string; created: number; last_used: number;
  policy: AgentPolicy; policy_version: number; policy_hash: string | null; agent_pda: string | null; frozen: boolean;
  balance_cents: number; spent_total_cents: number; spent_today_cents: number; txn_this_hour: number; open_tasks: number;
  tasks: { uid: string; budget_cents: number; opened: number; closed: number | null; state?: string }[];
  purchases: { ts: number; merchant: string; item: string; amount_cents: number; approved: boolean; reason: string | null; sig: string | null; explorer: string | null }[];
  thread_len: number; chain_head?: string | null; chain_len?: number; agent_key?: string | null; running?: boolean;
};
export type Intent = { type: "intent"; id: string; agent: string; agent_name: string; person_id: string; merchant_id: number; merchant: string; amount_cents: number; reason: string; status: string; created: number; expires: number; explorer?: string | null };

export type AuthEvent = {
  type: "auth"; seq: number; ts: number; uid: string; kind?: string; agent?: AgentRef; intent?: string;
  merchant_id: number; merchant: string; category: string; lat?: number; lng?: number;
  item?: string | null; amount_cents: number; score: number; approved: boolean; reasons: Reason[];
  sig: string | null; explorer: string | null; latency_ms: number;
  simulated?: boolean; balance_cents?: number; on_chain?: boolean; settled?: boolean;
  settle_sig?: string | null; settle_explorer?: string | null; merchant_usdc?: string | null;
  sale_id?: string; order?: Order;
};

export type HistoryItem = { kind: "deposit" | "tap" | "freeze" | "unfreeze" | "withdraw" | "agent_fund" | "agent_clawback"; source?: string; from_wallet?: string; to_wallet?: string; by?: string; amount_cents: number; ts: number; sig: string; merchant?: string; merchant_id?: number; item?: string | null; approved?: boolean; score?: number; latency_ms?: number; reasons?: Reason[]; settle_sig?: string | null; order?: Order | null };
export type Account = {
  type: "account"; uid: string; card_number: string; name: string; person_id?: string | null;
  balance_cents: number; daily_limit_cents: number; spent_today_cents: number; status: string;
  card_pda: string | null; register_sig: string | null; created: number; history: HistoryItem[];
};

export type Notice = { id: number; kind: "approved" | "blocked" | "issued" | "deposit" | "frozen" | "screened" | "withdraw" | "closed" | "agent" | "approval"; title: string; detail: string; ts: number; href?: string | null };
export type Point = { t: number; settled: number; auths: number; declined: number };
export type MerchantStat = { n: number; declined: number; settled: number; blocked: number; category: string; series: number[] };
export type Stats = {
  connected: boolean; mode: string; total: number; approved: number; declined: number;
  settledCents: number; blockedCents: number; tps: number; p50: number; p95: number;
  agentTotal: number; agentApproved: number; agentCents: number;
  byMerchant: Record<string, MerchantStat>; series: Point[]; scoreHist: number[]; reasonTotals: Record<string, number>;
};

const TAPE = 300;
const WINDOW_MS = 5000;
const SERIES_MAX = 900;
const HIST_BINS = 20;
const NOTICE_MS = 7000;

const pct = (sorted: number[], q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

export function useFeed(url: string) {
  const [tape, setTape] = useState<AuthEvent[]>([]);
  const [declines, setDeclines] = useState<AuthEvent[]>([]);
  const [accounts, setAccounts] = useState<Record<string, Account>>({});
  const [cardSeen, setCardSeen] = useState<{ uid: string; ts: number } | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [sales, setSales] = useState<Record<number, { item: string; cents: number }>>({});
  const [agents, setAgents] = useState<Record<string, AgentView>>({});
  const [pendingIntents, setPendingIntents] = useState<Record<string, Intent>>({});
  const noticeId = useRef(0);
  const known = useRef<Record<string, number>>({});
  const pushNotice = (n: Omit<Notice, "id" | "ts">) => {
    const id = ++noticeId.current;
    setNotices((list) => [{ id, ts: Date.now(), ...n }, ...list].slice(0, 5));
    setTimeout(() => setNotices((list) => list.filter((x) => x.id !== id)), NOTICE_MS);
  };
  const [stats, setStats] = useState<Stats>({
    connected: false, mode: "live", total: 0, approved: 0, declined: 0, settledCents: 0, blockedCents: 0,
    tps: 0, p50: 0, p95: 0, agentTotal: 0, agentApproved: 0, agentCents: 0, byMerchant: {}, series: [], scoreHist: new Array(HIST_BINS).fill(0), reasonTotals: {},
  });
  const acc = useRef({
    total: 0, approved: 0, declined: 0, settledCents: 0, blockedCents: 0, agentTotal: 0, agentApproved: 0, agentCents: 0,
    byMerchant: {} as Record<string, MerchantStat>, recent: [] as { ts: number; latency: number }[],
    series: [] as Point[], lastBucket: 0, scoreHist: new Array(HIST_BINS).fill(0) as number[],
    reasonTotals: {} as Record<string, number>, mode: "live",
  });

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const reset = () => {
      const a = acc.current;
      a.total = 0; a.approved = 0; a.declined = 0; a.settledCents = 0; a.blockedCents = 0; a.agentTotal = 0; a.agentApproved = 0; a.agentCents = 0; a.byMerchant = {}; a.recent = []; a.series = []; a.scoreHist.fill(0); a.reasonTotals = {};
      setTape([]); setDeclines([]); setAccounts({}); setCardSeen(null); setNotices([]); setAgents({}); setPendingIntents({}); known.current = {};
    };

    const onAccount = (a: Account) => {
      const prev = known.current[a.uid];
      if (prev === undefined) {
        if (a.history.length === 0) pushNotice({ kind: "issued", title: "Card issued", detail: `${a.name} · •••• ${a.card_number.slice(-4)}`, href: a.register_sig ? explorerTx(a.register_sig) : null });
      } else if (a.balance_cents > prev && a.history[0]?.kind === "deposit") {
        const h = a.history[0];
        pushNotice({ kind: "deposit", title: h.source === "wallet" ? "Funded from wallet" : "Money added", detail: `${a.name} · +${money(a.balance_cents - prev)} USDC${h.from_wallet ? ` from ${short(h.from_wallet)}` : ""}`, href: explorerTx(h.sig) });
      }
      known.current[a.uid] = a.balance_cents;
      setAccounts((m) => ({ ...m, [a.uid]: a }));
      setCardSeen((c) => (c && c.uid === a.uid ? null : c));
    };

    const onAuth = (ev: AuthEvent) => {
      const a = acc.current;
      if (!ev.simulated) {
        const amt = money(ev.amount_cents);
        if (ev.kind === "agent") {
          const who = `${ev.agent?.name ?? "agent"} for ${ev.agent?.owner_name ?? "its owner"}`;
          if (ev.approved) pushNotice({ kind: "agent", title: "Agent order paid", detail: `${who} · ${amt} · ${ev.item ?? "purchase"} at ${ev.merchant}`, href: ev.explorer });
          else pushNotice({ kind: "blocked", title: "Agent order stopped", detail: `${who} · ${amt} at ${ev.merchant} · ${ev.reasons?.[0]?.feature ?? "policy"}`, href: ev.explorer });
        } else if (ev.approved) pushNotice({ kind: "approved", title: "Card approved", detail: `${amt} · ${ev.item ?? "purchase"} at ${ev.merchant}`, href: ev.explorer });
        else pushNotice({ kind: "blocked", title: "Fraud shield", detail: `${amt} saved at ${ev.merchant} · ${ev.reasons?.[0]?.feature ?? "unusual pattern"}`, href: ev.explorer });
      }
      if (ev.kind === "agent") { a.agentTotal++; if (ev.approved) { a.agentApproved++; a.agentCents += ev.amount_cents; } }
      a.total++;
      if (ev.approved) { a.approved++; a.settledCents += ev.amount_cents; } else { a.declined++; a.blockedCents += ev.amount_cents; }
      const m = (a.byMerchant[ev.merchant] ??= { n: 0, declined: 0, settled: 0, blocked: 0, category: ev.category, series: [] });
      m.n++;
      if (ev.approved) m.settled += ev.amount_cents; else { m.declined++; m.blocked += ev.amount_cents; }
      a.recent.push({ ts: Date.now(), latency: ev.latency_ms });
      a.scoreHist[Math.min(HIST_BINS - 1, Math.floor(ev.score * HIST_BINS))]++;
      for (const r of ev.reasons ?? []) a.reasonTotals[r.feature] = (a.reasonTotals[r.feature] ?? 0) + r.contribution;
      setTape((t) => [ev, ...t].slice(0, TAPE));
      if (!ev.approved) setDeclines((d) => [ev, ...d].slice(0, TAPE));
    };

    function connect() {
      ws = new WebSocket(url);
      ws.onopen = () => setStats((s) => ({ ...s, connected: true }));
      ws.onclose = () => { setStats((s) => ({ ...s, connected: false })); if (!closed) timer = setTimeout(connect, 1000); };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        switch (msg.type) {
          case "mode": acc.current.mode = msg.mode; return;
          case "account": return onAccount(msg as Account);
          case "auth": return onAuth(msg as AuthEvent);
          case "card_seen": return setCardSeen({ uid: msg.uid, ts: msg.ts });
          case "sale": return setSales((x) => ({ ...x, [msg.merchant_id]: { item: msg.item, cents: msg.cents } }));
          case "sale_cleared": return setSales((x) => { const n = { ...x }; delete n[msg.merchant_id]; return n; });
          case "status": return pushNotice({ kind: "frozen", title: `${msg.status === "blocked" ? "Card locked" : "Card unlocked"} ${msg.by === "cardholder" ? "by cardholder" : "by issuer"}`, detail: `${msg.name} · written on chain`, href: msg.sig ? explorerTx(msg.sig) : null });
          case "withdraw": return pushNotice({ kind: "withdraw", title: "Withdrawn to wallet", detail: `${msg.name} · ${money(msg.amount_cents)} USDC → ${short(String(msg.to_wallet))}`, href: msg.sig ? explorerTx(msg.sig) : null });
          case "account_removed":
            setAccounts((m) => { const n = { ...m }; delete n[msg.uid]; return n; });
            delete known.current[msg.uid];
            return pushNotice({ kind: "closed", title: "Account closed", detail: `${msg.name} · card frozen on chain${msg.balance_left_cents ? `, ${money(msg.balance_left_cents)} stays on the card` : ""}`, href: msg.sig ? explorerTx(msg.sig) : null });
          case "screened": return pushNotice({ kind: "screened", title: "Registration screened out", detail: `${msg.name || "unknown"} · ${msg.reason}` });
          case "agent": return setAgents((m) => ({ ...m, [msg.id]: msg as AgentView }));
          case "agent_removed": return setAgents((m) => { const n = { ...m }; delete n[msg.agent]; return n; });
          case "intent": {
            const i = msg as Intent;
            return setPendingIntents((m) => { const n = { ...m }; if (i.status === "pending") n[i.id] = i; else delete n[i.id]; return n; });
          }
          case "intent_pending": {
            const i = msg as Intent;
            setPendingIntents((m) => ({ ...m, [i.id]: i }));
            return pushNotice({ kind: "approval", title: "Waiting for the owner", detail: `${i.agent_name} wants ${money(i.amount_cents)} at ${i.merchant} · the owner's phone is asking` });
          }
          case "task_card": return pushNotice({ kind: "agent", title: msg.action === "opened" ? "Task card opened" : "Task card closed", detail: msg.action === "opened" ? `${msg.agent_name} · ${money(msg.budget_cents)} for ${msg.merchant}` : `${msg.agent_name} · ${money(msg.returned_cents ?? 0)} returned`, href: msg.explorer });
          case "agent_order": return;
          case "agent_message": return;
          case "merchant": return;
          case "reset": return reset();
        }
      };
    }
    connect();

    const tick = setInterval(() => {
      const a = acc.current;
      const now = Date.now();
      a.recent = a.recent.filter((r) => r.ts >= now - WINDOW_MS);
      const lat = a.recent.map((r) => r.latency).sort((x, y) => x - y);
      const bucket = Math.floor(now / 1000);
      if (bucket !== a.lastBucket) {
        a.lastBucket = bucket;
        a.series.push({ t: bucket * 1000, settled: a.settledCents, auths: a.total, declined: a.declined });
        if (a.series.length > SERIES_MAX) a.series.shift();
        for (const m of Object.values(a.byMerchant)) { m.series.push(m.settled); if (m.series.length > 60) m.series.shift(); }
      }
      setPendingIntents((m) => {
        const now = Date.now() / 1000;
        const live = Object.fromEntries(Object.entries(m).filter(([, i]) => i.expires > now));
        return Object.keys(live).length === Object.keys(m).length ? m : live;
      });
      setStats((s) => ({
        ...s, mode: a.mode, total: a.total, approved: a.approved, declined: a.declined, settledCents: a.settledCents, blockedCents: a.blockedCents,
        agentTotal: a.agentTotal, agentApproved: a.agentApproved, agentCents: a.agentCents,
        tps: a.recent.length / (WINDOW_MS / 1000), p50: pct(lat, 0.5), p95: pct(lat, 0.95),
        byMerchant: { ...a.byMerchant }, series: a.series.slice(), scoreHist: a.scoreHist.slice(), reasonTotals: { ...a.reasonTotals },
      }));
    }, 500);

    return () => { closed = true; if (timer) clearTimeout(timer); clearInterval(tick); ws?.close(); };
  }, [url]);

  return { tape, declines, stats, accounts, cardSeen, notices, sales, agents, pendingIntents, clearCardSeen: () => setCardSeen(null) };
}
