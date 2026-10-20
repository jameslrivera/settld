"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Montserrat, Libre_Franklin, Anton, Lora, Rubik_Mono_One, Courier_Prime, Karla, Poppins, Lato } from "next/font/google";
import QRCode from "qrcode";
import { api, API_URL, WS_URL, type AgentOrder, type MenuItem, type Merchant } from "@/lib/api";
import { checkAgentOrder, type KyaCheck } from "@/lib/kya";
import type { AuthEvent } from "@/lib/feed";
import { usd, mask, plain } from "@/lib/format";

const montserrat = Montserrat({ weight: ["600", "700"], subsets: ["latin"] });
const franklin = Libre_Franklin({ weight: ["400", "600"], subsets: ["latin"] });
const anton = Anton({ weight: "400", subsets: ["latin"] });
const lora = Lora({ weight: ["400", "600"], subsets: ["latin"] });
const rubikMono = Rubik_Mono_One({ weight: "400", subsets: ["latin"] });
const courier = Courier_Prime({ weight: ["400", "700"], subsets: ["latin"] });
const karla = Karla({ weight: ["400", "700", "800"], subsets: ["latin"] });
const poppins = Poppins({ weight: ["500", "600", "700", "800"], subsets: ["latin"] });
const lato = Lato({ weight: ["400", "700"], subsets: ["latin"] });

const TAX_RATE = 0.089;
const TIPS = [0, 15, 18, 20];
const IDLE_RECEIPT_S = 60;
const AGENT_LANE_S = 45;

type Screen = "start" | "menu" | "tap" | "paid" | "stopped" | "shop" | "agent";
type Theme = {
  vars: Record<string, string>;
  headClass: string; bodyClass: string; upper: boolean;
  tagline: string; blurb: string;
  logo: string; logoDark?: boolean; logoAspect: number; short: string; hours?: string;
  bar?: { bg: string; ink: string }; barLogo?: string;
  motif: "none" | "polaroid" | "stitch" | "curve";
};

const THEMES: Record<number, Theme> = {
  1: {
    vars: { "--k-bg": "#ffffff", "--k-surface": "#ffffff", "--k-surface-2": "#f2f2ef", "--k-line": "#e2e2dd", "--k-ink": "#111111", "--k-ink-2": "#5f6460", "--k-accent": "#f37f60", "--k-accent-ink": "#ffffff", "--k-gold": "#111111", "--k-tile": "#ecebe6", "--k-radius": "0px" },
    headClass: montserrat.className, bodyClass: franklin.className, upper: true,
    tagline: "We are on an adventure to cultivate a community that does good.", blurb: "Drink Coffee. Do Good.®",
    logo: "/shops/loth.png", logoAspect: 360 / 199, short: "Land of a Thousand Hills", hours: "Mon–Fri 8am–4pm", motif: "none",
  },
  6: {
    vars: { "--k-bg": "#ffffff", "--k-surface": "#ffffff", "--k-surface-2": "#eef2f4", "--k-line": "#d9e1e5", "--k-ink": "#003349", "--k-ink-2": "#4a6470", "--k-accent": "#f0a08e", "--k-accent-ink": "#003349", "--k-gold": "#003349", "--k-tile": "#eef2f4", "--k-radius": "12px" },
    headClass: poppins.className, bodyClass: lato.className, upper: false,
    tagline: "Relationship coffee, roasted since 1994.", blurb: "Second floor, southwest corner.",
    logo: "/shops/kaldis.png", logoAspect: 720 / 451, short: "Kaldi's Coffee", hours: "Mon–Thu 7am–5pm · Fri 7am–4pm",
    bar: { bg: "#003349", ink: "#ffffff" }, barLogo: "/shops/kaldis-white.png", motif: "none",
  },
};

function Motif({ kind, theme }: { kind: Theme["motif"]; theme: Theme }) {
  if (kind === "stitch") return (
    <svg width="260" height="28" viewBox="0 0 260 28" aria-hidden="true">
      <path d="M4 14 Q130 -8 256 14" fill="none" stroke="#df2f26" strokeWidth="3" strokeLinecap="round" />
      {Array.from({ length: 11 }).map((_, i) => { const x = 20 + i * 22; const y = 14 - Math.sin((x / 260) * Math.PI) * 10; return <path key={i} d={`M${x - 5} ${y - 6} L${x + 5} ${y + 6}`} stroke="#df2f26" strokeWidth="2.5" strokeLinecap="round" />; })}
    </svg>
  );
  if (kind === "polaroid") return (
    <div className={`${theme.headClass} uppercase text-white text-[44px] leading-[0.95] px-8 py-6 shadow-xl`} style={{ background: "#da2621", transform: "rotate(-2deg)" }}>For students,<br />by students</div>
  );
  return null;
}

type Incoming = { type: string } & Record<string, unknown>;

function useEvents(url: string, onEvent: (msg: Incoming) => void, onStatus?: (up: boolean) => void) {
  const cb = useRef(onEvent); cb.current = onEvent;
  const st = useRef(onStatus); st.current = onStatus;
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      ws = new WebSocket(url);
      ws.onopen = () => st.current?.(true);
      ws.onmessage = (m) => { try { cb.current(JSON.parse(m.data)); } catch {  } };
      ws.onclose = () => { st.current?.(false); if (!closed) timer = setTimeout(connect, 1000); };
    };
    connect();
    return () => { closed = true; if (timer) clearTimeout(timer); ws?.close(); };
  }, [url]);
}

export default function KioskPage() {
  return <Suspense><Kiosk /></Suspense>;
}

function Kiosk() {
  const params = useSearchParams();
  const merchantId = Number(params.get("merchant") ?? 1);
  const theme = THEMES[merchantId] ?? THEMES[1];
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [shop, setShop] = useState<Merchant | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [screen, setScreen] = useState<Screen>("start");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [tipPct, setTipPct] = useState<number | null>(0);
  const [tipCustom, setTipCustom] = useState("");
  const [cat, setCat] = useState<string>("");
  const [detail, setDetail] = useState<MenuItem | null>(null);
  const [detailQty, setDetailQty] = useState(1);
  const [orderName, setOrderName] = useState("");
  const [saleId, setSaleId] = useState<string | null>(null);
  const [result, setResult] = useState<AuthEvent | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(IDLE_RECEIPT_S);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [agentOrders, setAgentOrders] = useState<AgentOrder[]>([]);
  const [activeAgent, setActiveAgent] = useState<AgentOrder | null>(null);
  const [made, setMade] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`settld_made_${merchantId}`) ?? "[]") as string[]); } catch { return new Set(); }
  });
  const [laneLeft, setLaneLeft] = useState<number | null>(null);
  const [agentQr, setAgentQr] = useState<string | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentNote, setAgentNote] = useState<string | null>(null);
  const [maxTicket, setMaxTicket] = useState("");
  const [serverTicket, setServerTicket] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const waiting = agentOrders.filter((o) => o.status === "paid" && !made.has(o.id));

  useEffect(() => {
    api.menu().then((rows) => { const mine = rows.filter((r) => r.merchant_id === merchantId); setMenu(mine); if (mine[0]) setCat(mine[0].category); }).catch(() => {});
    api.merchants().then((ms) => {
      const mine = ms.find((m) => m.id === merchantId && m.kind !== "digital") ?? null;
      setMerchant(mine);
      setUnknown(mine === null);
      if (mine) setServerTicket(mine.max_agent_ticket_cents ?? 0);
    }).catch(() => {});
    api.agentOrders(merchantId).then(setAgentOrders).catch(() => {});
  }, [merchantId]);

  useEffect(() => {
    if (screen !== "shop") return;
    let live = true;
    const load = () => api.merchants().then((ms) => { if (live) setShop(ms.find((m) => m.id === merchantId) ?? null); }).catch(() => {});
    load();
    const id = setInterval(load, 3000);
    return () => { live = false; clearInterval(id); };
  }, [screen, merchantId]);

  const categories = useMemo(() => Array.from(new Set(menu.map((m) => m.category))), [menu]);
  const byName = useMemo(() => Object.fromEntries(menu.map((m) => [m.item, m])), [menu]);
  const lines = useMemo(() => menu.filter((m) => cart[m.item] > 0).map((m) => ({ item: m.item, cents: m.cents, qty: cart[m.item] })), [menu, cart]);
  const subtotal = lines.reduce((s, l) => s + l.cents * l.qty, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const tip = tipPct === null ? Math.round(Number(tipCustom || 0) * 100) : Math.round(subtotal * tipPct / 100);
  const total = subtotal + tax + tip;
  const count = lines.reduce((s, l) => s + l.qty, 0);

  const add = (item: string, d: number) => setCart((c) => { const n = Math.max(0, (c[item] ?? 0) + d); const next = { ...c, [item]: n }; if (!n) delete next[item]; return next; });
  const openDetail = (m: MenuItem) => { setDetail(m); setDetailQty(cart[m.item] || 1); };
  const pickCat = (c: string) => { setCat(c); gridRef.current?.scrollTo({ top: 0 }); };

  function reset() {
    if (saleId) api.clearSale(merchantId).catch(() => {});
    setCart({}); setTipPct(0); setTipCustom(""); setOrderName(""); setDetail(null); setSaleId(null); setResult(null); setQr(null); setError(null); setScreen("start");
    if (categories[0]) setCat(categories[0]);
  }

  async function startTap() {
    setBusy(true); setError(null);
    try {
      const r = await api.setOrder(merchantId, lines, tax, tip, orderName || undefined);
      if (r.sale_id) { setSaleId(r.sale_id); setScreen("tap"); }
      else setError(r.error ?? "The register did not accept the order.");
    } catch {
      setError("Can't reach the register on the laptop. Check that both are on the same Wi-Fi.");
    } finally { setBusy(false); }
  }

  async function cancelTap() {
    await api.clearSale(merchantId).catch(() => {});
    setSaleId(null); setScreen("menu");
  }

  useEvents(WS_URL, (msg) => {
    if (msg.type === "agent_order" && msg.merchant_id === merchantId) {
      const o = msg as unknown as AgentOrder;
      setAgentOrders((list) => [o, ...list.filter((x) => x.id !== o.id)].slice(0, 50));
      if (screen === "start" || (screen === "agent" && laneLeft !== null)) { setActiveAgent(o); setScreen("agent"); setLaneLeft(AGENT_LANE_S); }
      return;
    }
    if (msg.type === "merchant" && msg.merchant_id === merchantId) {
      const patch = { accepts_agents: msg.accepts_agents as boolean, max_agent_ticket_cents: msg.max_agent_ticket_cents as number };
      setMerchant((cur) => (cur ? { ...cur, ...patch } : cur));
      setShop((cur) => (cur ? { ...cur, ...patch } : cur));
      setServerTicket(patch.max_agent_ticket_cents ?? 0);
      return;
    }
    if (msg.type !== "auth" || (screen !== "tap" && screen !== "stopped")) return;
    const ev = msg as unknown as AuthEvent;
    if (ev.merchant_id !== merchantId || ev.kind === "agent") return;
    if (saleId && ev.sale_id !== saleId) return;
    setResult(ev);
    setScreen(ev.approved ? "paid" : "stopped");
  }, setOnline);

  useEffect(() => {
    if (screen !== "agent" || laneLeft === null) return;
    const id = setInterval(() => setLaneLeft((c) => { if (c === null) return c; if (c <= 1) { clearInterval(id); setScreen("start"); return null; } return c - 1; }), 1000);
    return () => clearInterval(id);
  }, [screen, laneLeft === null]);

  useEffect(() => {
    if (!activeAgent?.explorer) { setAgentQr(null); return; }
    let live = true;
    QRCode.toDataURL(activeAgent.explorer, { margin: 1, width: 150, color: { dark: "#000000", light: "#ffffff" } }).then((d) => { if (live) setAgentQr(d); }).catch(() => { if (live) setAgentQr(null); });
    return () => { live = false; };
  }, [activeAgent]);

  useEffect(() => {
    if (serverTicket === null) return;
    setMaxTicket(serverTicket > 0 ? (serverTicket / 100).toFixed(2) : "");
  }, [serverTicket]);

  useEffect(() => {
    if (shop && shop.max_agent_ticket_cents !== null && shop.max_agent_ticket_cents !== serverTicket) setServerTicket(shop.max_agent_ticket_cents);
  }, [shop?.max_agent_ticket_cents]);

  function openLane(o?: AgentOrder | null) {
    setActiveAgent(o ?? waiting[waiting.length - 1] ?? agentOrders[0] ?? null);
    setLaneLeft(null);
    setScreen("agent");
  }

  function markMade(id: string) {
    const next = new Set(made); next.add(id); setMade(next);
    api.markMade(id).then((o) => setAgentOrders((list) => list.map((x) => (x.id === o.id ? o : x)))).catch(() => {});
    try { localStorage.setItem(`settld_made_${merchantId}`, JSON.stringify(Array.from(next).slice(-200))); } catch {  }
    const rest = agentOrders.filter((o) => o.status === "paid" && !next.has(o.id));
    if (rest.length) setActiveAgent(rest[rest.length - 1]); else { setActiveAgent(null); setLaneLeft(null); setScreen("start"); }
  }

  async function setAgentSwitch(on: boolean) {
    setAgentNote(null);
    const raw = maxTicket.trim();
    if (raw && !/^\d+(\.\d{1,2})?$/.test(raw)) { setAgentNote("The cap has to be a dollar amount like 25 or 12.50."); return; }
    const cents = raw ? Math.round(Number(raw) * 100) : 0;
    setAgentBusy(true);
    try {
      const r = await api.setMerchantAgentPolicy(merchantId, on, cents);
      if (r.accepts_agents === undefined) {
        const detail = typeof r.detail === "string" ? r.detail : r.error;
        setAgentNote(/not confirmed/i.test(detail ?? "") ? "Solana took longer than usual; the switch will update here on its own in a moment." : detail ?? "The register did not accept that. Open the kiosk once with ?shop=<token>.");
      }
    } catch { setAgentNote("Can't reach the register on the laptop."); }
    finally { setAgentBusy(false); }
  }

  useEffect(() => {
    if (screen !== "paid" || !result) return;
    const link = result.settle_explorer ?? result.explorer;
    if (link) QRCode.toDataURL(link, { margin: 1, width: 160, color: { dark: "#000000", light: "#ffffff" } }).then(setQr).catch(() => setQr(null));
    setCountdown(IDLE_RECEIPT_S);
    const id = setInterval(() => setCountdown((c) => { if (c <= 1) { clearInterval(id); reset(); return 0; } return c - 1; }), 1000);
    return () => clearInterval(id);
  }, [screen, result]);

  const shopName = merchant?.name ?? theme.short;
  const Logo = ({ h }: { h: number }) => (
    <span className={`inline-flex items-center justify-center rounded-xl ${theme.logoDark ? "bg-[#111] px-4 py-2" : ""}`} style={{ height: theme.logoDark ? h + 16 : h }}>
      <img src={theme.logo} alt={shopName} style={{ height: h, width: h * theme.logoAspect }} />
    </span>
  );
  const headline = `${theme.headClass} ${theme.upper ? "uppercase tracking-wide" : ""}`;
  const button = { borderRadius: "var(--k-radius)" } as React.CSSProperties;

  if (unknown) return (
    <main className={`${theme.bodyClass} h-screen w-screen flex flex-col items-center justify-center gap-3 bg-[var(--k-bg)] text-[var(--k-ink)]`} style={theme.vars as React.CSSProperties}>
      <div className={`${theme.headClass} text-4xl font-bold`}>No kiosk here</div>
      <div className="text-[var(--k-ink-2)]">Shop {merchantId} has no counter. Only pickup shops have a kiosk.</div>
    </main>
  );

  return (
    <main className={`${theme.bodyClass} h-[100dvh] w-screen overflow-hidden select-none bg-[var(--k-bg)] text-[var(--k-ink)]`} style={theme.vars as React.CSSProperties}>
      <style>{`@media print { body * { visibility: hidden !important; } #receipt, #receipt * { visibility: visible !important; } #receipt { position: fixed; inset: 0; width: 100%; margin: 0; padding: 24px; background: #fff !important; color: #000 !important; border: 0 !important; box-shadow: none !important; } #receipt .no-print { display: none !important; } }`}</style>

      {screen === "start" && (
        <div className="relative h-full w-full">
        <button onClick={() => setScreen("menu")} className="h-full w-full flex flex-col items-center text-center">
          {theme.motif === "curve" && (
            <div className="w-full flex items-center justify-center" style={{ background: theme.bar?.bg, height: "38%", borderBottomLeftRadius: "50% 30%", borderBottomRightRadius: "50% 30%" }}>
              <span className="inline-flex items-center justify-center rounded-2xl bg-[#f7f4ee] px-8 py-4"><img src={theme.logo} alt={shopName} style={{ height: 150, width: 150 * theme.logoAspect }} /></span>
            </div>
          )}
          <div className="flex-1 flex flex-col items-center justify-center gap-7 px-10">
            {theme.motif !== "curve" && (theme.motif === "polaroid" ? <div className="flex flex-col items-center gap-8"><Logo h={72} /><Motif kind="polaroid" theme={theme} /></div> : <Logo h={180} />)}
            <div className="flex flex-col items-center gap-3">
              {theme.motif === "stitch" && <Motif kind="stitch" theme={theme} />}
              <div className={`${headline} text-3xl font-bold max-w-3xl`} style={{ color: theme.motif === "stitch" ? "#df2f26" : theme.motif === "curve" ? "#4b657e" : "var(--k-ink)" }}>{theme.tagline}</div>
              <div className="text-[var(--k-ink-2)] text-lg">{theme.blurb}</div>
              <div className="text-[var(--k-ink-2)] text-sm">{merchant?.address}{theme.hours ? ` · ${theme.hours}` : ""}</div>
            </div>
            <div className={`${headline} mt-1 px-14 py-6 text-2xl font-semibold shadow-xl bg-[var(--k-accent)] text-[var(--k-accent-ink)]`} style={button}>Touch to start your order</div>
            <PoweredBy />
          </div>
        </button>
        <ShopButton side="right" onClick={() => setScreen("shop")} />
        {agentOrders.length > 0 && (
          <button onClick={() => openLane()} className="absolute bottom-4 left-4 z-10 flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold shadow-lg bg-[var(--k-surface-2)] text-[var(--k-ink)]">
            <span className="w-2 h-2 rounded-full" style={{ background: waiting.length ? "#ff2fb6" : "var(--k-ink-2)" }} />
            {waiting.length ? `${waiting.length} agent ${waiting.length === 1 ? "order" : "orders"} to make` : "Agent orders"}
          </button>
        )}
        </div>
      )}

      {screen === "agent" && (
        <div className="h-full grid grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex flex-col min-h-0">
            <header className="px-8 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Logo h={40} />
                <div>
                  <div className={`${headline} text-lg font-bold`}>Agent orders</div>
                  <div className="text-xs text-[var(--k-ink-2)]">Paid before they reach you · nothing to charge back</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {laneLeft !== null && <span className="text-xs text-[var(--k-ink-2)]">Back to start in {laneLeft}s</span>}
                <button onClick={() => { setLaneLeft(null); setScreen("start"); }} className="px-5 py-2.5 text-sm font-semibold bg-[var(--k-surface-2)]" style={button}>Back</button>
              </div>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto px-8 pb-8">
              {!activeAgent ? (
                <div className="h-full flex flex-col items-center justify-center text-[var(--k-ink-2)] gap-2">
                  <div className={`${headline} text-3xl font-bold text-[var(--k-ink)]`}>No agent orders yet</div>
                  <div>When someone&apos;s agent orders here, it shows up on this screen already paid.</div>
                </div>
              ) : (
                <AgentTicket o={activeAgent} shop={merchant} qr={agentQr} headClass={theme.headClass} upper={theme.upper} button={button} made={made.has(activeAgent.id)} onMade={() => markMade(activeAgent.id)} />
              )}
            </div>
          </div>
          <aside className="border-l flex flex-col min-h-0 bg-[var(--k-surface)]" style={{ borderColor: "var(--k-line)" }}>
            <div className="px-5 pt-6 pb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Recent</h2>
              <span className="text-[var(--k-ink-2)] text-sm">{agentOrders.length}</span>
            </div>
            <ul className="flex-1 overflow-y-auto divide-y" style={{ borderColor: "var(--k-line)" }}>
              {agentOrders.map((o) => (
                <li key={o.id}>
                  <button onClick={() => { setActiveAgent(o); setLaneLeft(null); }} className={`w-full text-left px-5 py-3 ${activeAgent?.id === o.id ? "bg-[var(--k-surface-2)]" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{o.order.item}</span>
                      <span className={`text-sm font-semibold ${o.status === "paid" ? "" : "line-through text-[var(--k-ink-2)]"}`}>{usd(o.amount_cents)}</span>
                    </div>
                    <div className="text-xs text-[var(--k-ink-2)] truncate">{o.agent_name} · for {o.owner_name} · {new Date(o.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{o.status === "paid" ? (made.has(o.id) ? " · made" : " · paid") : " · not charged"}</div>
                  </button>
                </li>
              ))}
              {agentOrders.length === 0 && <li className="px-5 py-3 text-sm text-[var(--k-ink-2)]">Nothing yet.</li>}
            </ul>
            <div className="px-5 py-4 border-t" style={{ borderColor: "var(--k-line)" }}><PoweredBy small /></div>
          </aside>
        </div>
      )}

      {screen === "shop" && (
        <div className="h-full overflow-y-auto px-10 py-8">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="text-[var(--k-ink-2)] text-sm">{merchant?.address}</div>
              <div className={`${headline} text-4xl font-bold mt-1`}>{shopName}</div>
            </div>
            <button onClick={() => setScreen("start")} className="px-5 py-3 text-base font-semibold bg-[var(--k-surface-2)]" style={button}>Back to kiosk</button>
          </div>

          {!shop ? <div className="text-[var(--k-ink-2)] mt-8">Loading…</div> : (
            <>
              <div className="mt-6 grid grid-cols-3 gap-4">
                <div className="bg-[var(--k-surface)] p-5" style={button}>
                  <div className="text-xs text-[var(--k-ink-2)]">In your account</div>
                  <div className="text-3xl font-bold mt-1">{shop.usdc != null ? Number(shop.usdc).toFixed(2) : "…"}<span className="text-sm text-[var(--k-ink-2)] ml-1">USDC</span></div>
                  <div className="text-xs text-[var(--k-ink-2)] mt-1">on Solana, spendable now</div>
                </div>
                <div className="bg-[var(--k-surface)] p-5" style={button}>
                  <div className="text-xs text-[var(--k-ink-2)]">Sales today</div>
                  <div className="text-3xl font-bold mt-1">{usd(shop.sales_cents)}</div>
                  <div className="text-xs text-[var(--k-ink-2)] mt-1">{shop.paid} paid tap{shop.paid === 1 ? "" : "s"}{shop.paid ? ` · avg ${usd(shop.sales_cents / shop.paid)}` : ""}</div>
                </div>
                <div className="bg-[var(--k-surface)] p-5" style={button}>
                  <div className="text-xs text-[var(--k-ink-2)]">Waiting on settlement</div>
                  <div className="text-3xl font-bold mt-1 text-[#1a9c4b]">{usd(0)}</div>
                  <div className="text-xs text-[var(--k-ink-2)] mt-1">nothing held for T+2</div>
                </div>
              </div>

              <a href={`/business?merchant=${merchantId}`} className="mt-4 bg-[var(--k-surface)] p-5 flex items-center justify-between" style={button}>
                <div>
                  <div className="font-semibold">Settld Business</div>
                  <div className="text-sm text-[var(--k-ink-2)] mt-0.5">Your books, ready for an audit: every payment with its Solana proof, charts, CSV exports, a printable report, and answers to any question about your sales.</div>
                </div>
                <span className="px-4 py-2.5 text-sm font-semibold bg-[var(--k-accent)] text-[var(--k-accent-ink)] shrink-0 ml-6" style={button}>Open books</span>
              </a>

              <div className="mt-4 bg-[var(--k-surface)] p-5 flex items-center justify-between" style={button}>
                <div>
                  <div className="font-semibold">Fraud protection</div>
                  <div className="text-sm text-[var(--k-ink-2)] mt-0.5">{shop.blocked === 0 ? "No suspicious taps at your register today." : `${shop.blocked} suspicious tap${shop.blocked === 1 ? "" : "s"} stopped before payment · ${usd(shop.blocked_cents)} you will never have to charge back.`}</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold">{shop.blocked} <span className="text-sm text-[var(--k-ink-2)] font-normal">of {shop.paid + shop.blocked}</span></div>
                  <div className="text-xs text-[var(--k-ink-2)]">taps screened out</div>
                </div>
              </div>

              <div className="mt-4 bg-[var(--k-surface)] p-5" style={button}>
                <div className="flex items-center justify-between gap-6">
                  <div>
                    <div className="font-semibold">Agent orders</div>
                    <div className="text-sm text-[var(--k-ink-2)] mt-0.5">{shop.accepts_agents === null ? "Checking the shop's settings on Solana…" : shop.accepts_agents ? "Agents may order here. Every agent order is paid before it reaches you, and names the person behind it." : "Agents cannot order here right now."}</div>
                    {agentNote && <div className="text-sm mt-1" style={{ color: "#b7791a" }}>{agentNote}</div>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <label className="text-xs text-[var(--k-ink-2)] flex items-center gap-2">Max ticket $
                      <input inputMode="decimal" value={maxTicket} onChange={(e) => setMaxTicket(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="no cap" className="w-20 rounded-lg px-2 py-1.5 text-sm outline-none bg-[var(--k-surface-2)]" />
                    </label>
                    <button disabled={agentBusy || shop.accepts_agents === null} onClick={() => setAgentSwitch(!shop.accepts_agents)} className={`px-4 py-2.5 text-sm font-semibold disabled:opacity-40 ${shop.accepts_agents ? "bg-[var(--k-surface-2)]" : "bg-[var(--k-accent)] text-[var(--k-accent-ink)]"}`} style={button}>{agentBusy ? "Saving…" : shop.accepts_agents ? "Stop agent orders" : "Accept agent orders"}</button>
                    {shop.accepts_agents && <button disabled={agentBusy} onClick={() => setAgentSwitch(true)} className="px-3 py-2.5 text-sm bg-[var(--k-surface-2)] disabled:opacity-40" style={button}>Save cap</button>}
                  </div>
                </div>
                <div className="mt-3 flex gap-6 text-sm">
                  <span><b>{agentOrders.filter((o) => o.status === "paid").length}</b> <span className="text-[var(--k-ink-2)]">paid</span></span>
                  <span><b>{agentOrders.filter((o) => o.status !== "paid").length}</b> <span className="text-[var(--k-ink-2)]">stopped</span></span>
                  <button onClick={() => openLane()} className="underline text-[var(--k-ink-2)]">open the agent lane</button>
                </div>
              </div>

              <div className="mt-4 bg-[var(--k-surface)] p-5" style={button}>
                <div className="flex items-center justify-between">
                  <div className="font-semibold">Today at the register</div>
                  <div className="flex gap-4 text-sm">
                    <a className="underline" href={`${API_URL}/merchants/${shop.id}/payments.csv`}>payment log</a>
                    <a className="underline" href={`${API_URL}/merchants/${shop.id}/tax.csv`}>tax log</a>
                  </div>
                </div>
                <ul className="mt-2 divide-y divide-[var(--k-line)]">
                  {shop.recent.length === 0 && <li className="text-sm text-[var(--k-ink-2)] py-2">Waiting for the first tap.</li>}
                  {shop.recent.slice(0, 10).map((e) => (
                    <li key={`${e.ts}-${e.seq}`} className={`flex items-center justify-between py-2.5 ${e.approved ? "" : "opacity-70"}`}>
                      <div>
                        <div className="font-medium">{e.item ?? "Purchase"} <span className="text-[var(--k-ink-2)] font-normal">· {mask(e.uid)}</span></div>
                        <div className="text-xs text-[var(--k-ink-2)]">{new Date(e.ts * 1000).toLocaleTimeString()}{e.approved ? ` · paid in ${e.latency_ms.toFixed(0)} ms` : " · stopped by fraud shield"}{e.explorer && <> · <a className="underline" href={e.explorer} target="_blank" rel="noreferrer">on Solana</a></>}</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-semibold ${e.approved ? "" : "line-through text-[var(--k-ink-2)]"}`}>{usd(e.amount_cents)}</div>
                        <div className={`text-xs font-medium ${e.approved ? "text-[#1a9c4b]" : "text-[var(--k-ink-2)]"}`}>{e.approved ? "Paid" : "Not charged"}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {shop.ata && <div className="mt-4 text-xs text-[var(--k-ink-2)]">Your USDC account on Solana: <a className="underline font-mono" href={`https://explorer.solana.com/address/${shop.ata}?cluster=devnet`} target="_blank" rel="noreferrer">{shop.ata}</a></div>}
            </>
          )}
        </div>
      )}

      {screen === "menu" && (
        <div className="h-full grid grid-cols-[minmax(0,1fr)_minmax(260px,32vw)] lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col min-h-0 min-w-0">
            <header className="px-7 py-3 flex items-center justify-between" style={theme.bar ? { background: theme.bar.bg, color: theme.bar.ink } : undefined}>
              {theme.bar ? (
                theme.barLogo ? <img src={theme.barLogo} alt={shopName} style={{ height: 40, width: 40 * theme.logoAspect }} /> : theme.logoDark ? <img src={theme.logo} alt={shopName} style={{ height: 28, width: 28 * theme.logoAspect }} /> : <span className="inline-flex items-center justify-center rounded-lg bg-[#f7f4ee] px-3 py-1"><img src={theme.logo} alt={shopName} style={{ height: 40, width: 40 * theme.logoAspect }} /></span>
              ) : <Logo h={56} />}
              <div className="text-right">
                <div className={`${headline} text-sm font-semibold`}>Order here</div>
                <button onClick={reset} className="text-xs opacity-70 hover:opacity-100">Cancel order</button>
              </div>
            </header>
            <nav className="px-7 flex gap-2 pb-3 overflow-x-auto">
              {categories.map((c) => (
                <button key={c} onClick={() => pickCat(c)} className={`${theme.upper ? "uppercase tracking-wide" : ""} px-4 py-2 text-[14px] font-semibold whitespace-nowrap ${cat === c ? "bg-[var(--k-accent)] text-[var(--k-accent-ink)]" : "bg-[var(--k-surface-2)] text-[var(--k-ink-2)]"}`} style={button}>{c}</button>
              ))}
            </nav>
            <div ref={gridRef} className="flex-1 overflow-y-auto px-4 lg:px-7 pb-10">
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 lg:gap-4">
                {menu.filter((m) => m.category === cat).map((m) => {
                  const q = cart[m.item] ?? 0;
                  return (
                    <div key={m.item} className="rounded-2xl overflow-hidden border bg-[var(--k-surface)] flex flex-col" style={{ borderColor: q ? "var(--k-accent)" : "var(--k-line)", boxShadow: q ? "0 0 0 2px var(--k-accent) inset" : "0 1px 2px rgba(0,0,0,0.04)" }}>
                      <button onClick={() => openDetail(m)} className="text-left">
                        <div className="aspect-[4/3] bg-[var(--k-tile)] overflow-hidden">{m.image && <img src={m.image} alt={m.item} className="w-full h-full object-cover" loading="lazy" />}</div>
                        <div className="px-4 pt-3">
                          <div className={`${theme.headClass} ${theme.upper ? "uppercase tracking-wide text-[14px]" : "text-[16px]"} font-semibold leading-tight`}>{m.item}</div>
                          {m.desc && <div className="text-[12px] text-[var(--k-ink-2)] mt-1 line-clamp-2">{m.desc}</div>}
                        </div>
                      </button>
                      <div className="px-4 pb-4 pt-3 mt-auto flex items-center justify-between">
                        <div className="font-semibold text-[var(--k-gold)]">{usd(m.cents)}</div>
                        {q ? (
                          <div className="flex items-center gap-2">
                            <button onClick={() => add(m.item, -1)} className="w-9 h-9 rounded-full text-lg bg-[var(--k-surface-2)]">−</button>
                            <span className="text-lg font-semibold w-5 text-center">{q}</span>
                            <button onClick={() => add(m.item, 1)} className="w-9 h-9 rounded-full text-lg bg-[var(--k-accent)] text-[var(--k-accent-ink)]">+</button>
                          </div>
                        ) : <button onClick={() => add(m.item, 1)} className="px-5 py-2 font-semibold text-sm bg-[var(--k-accent)] text-[var(--k-accent-ink)]" style={button}>Add</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <aside className="border-l flex flex-col min-h-0 min-w-0 bg-[var(--k-surface)]" style={{ borderColor: "var(--k-line)" }}>
            <div className="px-4 lg:px-6 pt-6 pb-3 flex items-baseline justify-between">
              <h2 className="text-xl font-semibold">Your order</h2>
              <span className="text-[var(--k-ink-2)] text-sm">{count} item{count === 1 ? "" : "s"}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 lg:px-6">
              {lines.length === 0 && <div className="text-[var(--k-ink-2)] mt-4 text-sm">Nothing yet. Tap an item to see it, or Add to put it in your order.</div>}
              {lines.map((l) => (
                <div key={l.item} className="py-3 border-b flex items-center gap-3" style={{ borderColor: "var(--k-line)" }}>
                  <div className="w-12 h-12 rounded-lg overflow-hidden bg-[var(--k-tile)] shrink-0">{byName[l.item]?.image && <img src={byName[l.item].image} alt="" className="w-full h-full object-cover" />}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{l.item}</div>
                    <div className="text-[var(--k-ink-2)] text-xs">{usd(l.cents)} each</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => add(l.item, -1)} className="w-8 h-8 rounded-full bg-[var(--k-surface-2)]">−</button>
                    <span className="w-5 text-center font-semibold text-sm">{l.qty}</span>
                    <button onClick={() => add(l.item, 1)} className="w-8 h-8 rounded-full bg-[var(--k-surface-2)]">+</button>
                  </div>
                  <div className="w-14 text-right font-semibold text-sm">{usd(l.cents * l.qty)}</div>
                </div>
              ))}
            </div>
            <div className="px-4 lg:px-6 py-4 border-t space-y-3" style={{ borderColor: "var(--k-line)" }}>
              <input value={orderName} onChange={(e) => setOrderName(e.target.value.slice(0, 40))} placeholder="Name for the order (optional)" className="w-full rounded-xl px-4 py-2.5 text-sm outline-none bg-[var(--k-surface-2)] placeholder:text-[var(--k-ink-2)]" />
              <div>
                <div className="text-xs text-[var(--k-ink-2)] mb-1.5">Add a tip</div>
                <div className="grid grid-cols-5 gap-1.5">
                  {TIPS.map((t) => <button key={t} onClick={() => setTipPct(t)} className={`py-2 rounded-lg text-sm font-medium ${tipPct === t ? "bg-[var(--k-accent)] text-[var(--k-accent-ink)]" : "bg-[var(--k-surface-2)]"}`}>{t ? `${t}%` : "None"}</button>)}
                  <button onClick={() => setTipPct(null)} className={`py-2 rounded-lg text-sm font-medium ${tipPct === null ? "bg-[var(--k-accent)] text-[var(--k-accent-ink)]" : "bg-[var(--k-surface-2)]"}`}>Other</button>
                </div>
                {tipPct === null && <input inputMode="decimal" value={tipCustom} onChange={(e) => setTipCustom(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Tip in dollars" className="mt-2 w-full rounded-lg px-4 py-2.5 text-sm outline-none bg-[var(--k-surface-2)]" />}
              </div>
              <Row k="Subtotal" v={usd(subtotal)} />
              <Row k={`Tax (${(TAX_RATE * 100).toFixed(1)}%)`} v={usd(tax)} />
              <Row k="Tip" v={usd(tip)} />
              <div className="flex items-baseline justify-between pt-1">
                <span className="text-base font-semibold">Total</span>
                <span className={`${theme.headClass} text-3xl font-extrabold`}>{usd(total)}</span>
              </div>
              {error && <div className="text-sm rounded-lg px-3 py-2" style={{ background: "rgba(245,181,63,0.18)", color: "var(--k-ink)" }}>{error}</div>}
              <button disabled={!lines.length || busy} onClick={startTap} className={`${headline} w-full py-4 text-lg font-semibold disabled:opacity-30 bg-[var(--k-accent)] text-[var(--k-accent-ink)]`} style={button}>{busy ? "One moment…" : "Pay with card"}</button>
              <PoweredBy small />
            </div>
          </aside>

          {detail && (
            <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50" onClick={() => setDetail(null)}>
              <div className="w-[720px] max-w-[92vw] max-h-[90dvh] rounded-3xl overflow-hidden bg-[var(--k-surface)] grid grid-cols-[minmax(0,40%)_minmax(0,1fr)]" onClick={(e) => e.stopPropagation()}>
                <div className="bg-[var(--k-tile)]">{detail.image && <img src={detail.image} alt={detail.item} className="w-full h-full object-cover" />}</div>
                <div className="p-7 flex flex-col">
                  <div className="text-xs font-semibold uppercase tracking-widest text-[var(--k-ink-2)]">{detail.category}</div>
                  <div className={`${headline} text-2xl font-extrabold mt-1 leading-tight`}>{detail.item}</div>
                  <div className="text-[var(--k-ink-2)] mt-3 leading-relaxed">{detail.desc || ""}</div>
                  <div className="mt-auto pt-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button onClick={() => setDetailQty((q) => Math.max(1, q - 1))} className="w-11 h-11 rounded-full text-xl bg-[var(--k-surface-2)]">−</button>
                      <span className="text-xl font-semibold w-6 text-center">{detailQty}</span>
                      <button onClick={() => setDetailQty((q) => q + 1)} className="w-11 h-11 rounded-full text-xl bg-[var(--k-surface-2)]">+</button>
                    </div>
                    <button onClick={() => { setCart((c) => ({ ...c, [detail.item]: detailQty })); setDetail(null); }} className="px-6 py-3.5 font-semibold bg-[var(--k-accent)] text-[var(--k-accent-ink)]" style={button}>{cart[detail.item] ? "Update" : "Add"} · {usd(detail.cents * detailQty)}</button>
                  </div>
                  <button onClick={() => setDetail(null)} className="mt-3 text-sm text-[var(--k-ink-2)] self-end">Close</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {screen === "tap" && (
        <div className="h-full flex flex-col items-center justify-center text-center gap-7">
          <Logo h={merchantId === 2 ? 36 : 64} />
          <div>
            <div className="text-[var(--k-ink-2)]">{count} item{count === 1 ? "" : "s"}{orderName ? ` · for ${orderName}` : ""}</div>
            <div className={`${theme.headClass} text-[88px] leading-none font-extrabold mt-1`}>{usd(total)}</div>
          </div>
          <div className="relative w-52 h-52 flex items-center justify-center">
            <span className="absolute inset-0 rounded-full border-2 animate-ping" style={{ borderColor: "var(--k-accent)", opacity: 0.5 }} />
            <span className="absolute inset-6 rounded-full border-2 animate-ping [animation-delay:300ms]" style={{ borderColor: "var(--k-accent)", opacity: 0.35 }} />
            <span className="absolute inset-12 rounded-full border-2 animate-ping [animation-delay:600ms]" style={{ borderColor: "var(--k-accent)", opacity: 0.25 }} />
            <div className="w-28 h-20 rounded-xl bg-gradient-to-br from-[#1e1e22] to-[#0d0d0f] border border-[#333] flex items-center justify-center"><span className="text-xl font-semibold tracking-[-0.04em] text-white">Settld<span className="text-[#ff2fb6]">.</span></span></div>
          </div>
          <div className={`${headline} text-4xl font-semibold`}>Tap your card</div>
          <div className="text-[var(--k-ink-2)] text-lg">Hold it on the reader until the screen changes</div>
          <div className="flex items-center gap-2 text-sm text-[var(--k-ink-2)]"><span className="w-2 h-2 rounded-full" style={{ background: online ? "#00c805" : "#f5b53f" }} />{online ? "Register connected · reader is waiting for this order" : "Reconnecting to the register…"}</div>
          <button onClick={cancelTap} className="mt-4 text-[var(--k-ink-2)] hover:text-[var(--k-ink)]">Cancel</button>
        </div>
      )}

      {screen === "paid" && result && (
        <div className="relative h-full flex items-center justify-center gap-16 px-10">
          <ShopButton side="left" onClick={() => setScreen("shop")} />
          <div className="text-center max-w-md">
            <div className="w-24 h-24 mx-auto rounded-full flex items-center justify-center" style={{ background: "rgba(0,200,5,0.15)" }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00c805" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            </div>
            <div className={`${theme.headClass} ${theme.upper ? "uppercase" : ""} text-[60px] leading-none font-extrabold mt-5`}>Paid</div>
            <div className="text-xl mt-3">{result.order?.customer_name ? `Thanks, ${result.order.customer_name}. ` : ""}Order #{String(result.seq).padStart(3, "0")} is being made.</div>
            <div className="text-[var(--k-ink-2)] mt-2">{usd(result.amount_cents)} settled to {theme.short} in {result.latency_ms.toFixed(0)} ms, as USDC on Solana, while you were standing here.</div>
            <div className="mt-8 flex flex-col gap-3 no-print">
              <button onClick={() => window.print()} className="py-4 text-lg font-semibold bg-[var(--k-accent)] text-[var(--k-accent-ink)]" style={button}>Print receipt</button>
              <button onClick={reset} className="py-4 text-lg font-medium bg-[var(--k-surface-2)]" style={button}>No receipt, I&apos;m done</button>
              <div className="text-[var(--k-ink-2)] text-sm">Back to start in {countdown}s</div>
            </div>
          </div>
          <Receipt shop={merchant} ev={result} qr={qr} headClass={theme.headClass} />
        </div>
      )}

      {screen === "stopped" && result && (
        <div className="h-full flex flex-col items-center justify-center text-center gap-6 px-10">
          <div className="w-24 h-24 rounded-full flex items-center justify-center" style={{ background: "rgba(245,181,63,0.18)" }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f5b53f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" /></svg>
          </div>
          <div className={`${theme.headClass} ${theme.upper ? "uppercase" : ""} text-[52px] leading-none font-extrabold`}>Payment protected</div>
          <div className="text-[var(--k-ink-2)] text-xl max-w-xl">{result.reasons[0] ? cap(plain(result.reasons[0].feature)) + "." : "Unusual activity stopped before payment."} Nothing was charged.</div>
          <div className="text-[var(--k-ink-2)]">Card {mask(result.uid)} · the cardholder can open their app for details</div>
          <div className="flex gap-3 mt-4">
            <button onClick={startTap} className="px-8 py-4 text-lg font-semibold bg-[var(--k-accent)] text-[var(--k-accent-ink)]" style={button}>Try another card</button>
            <button onClick={reset} className="px-8 py-4 text-lg font-medium bg-[var(--k-surface-2)]" style={button}>Start over</button>
          </div>
        </div>
      )}
    </main>
  );
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function ShopButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Shop" title="Shop"
      className={`absolute bottom-3 ${side === "left" ? "left-3" : "right-3"} z-10 w-11 h-11 rounded-full flex items-center justify-center text-[var(--k-ink-2)] opacity-25 hover:opacity-70`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l1-5h16l1 5M3 9v11h18V9M3 9h18M9 20v-6h6v6" /></svg>
    </button>
  );
}

function PoweredBy({ small = false }: { small?: boolean }) {
  return (
    <div className={`flex items-center justify-center gap-2 text-[var(--k-ink-2)] ${small ? "text-xs" : "text-sm"}`}>
      <span>Pay with</span><span className="font-semibold tracking-[-0.04em] text-[var(--k-ink)]">Settld<span className="text-[#ff2fb6]">.</span></span><span>· USDC, settled on Solana at the tap</span>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between text-sm"><span className="text-[var(--k-ink-2)]">{k}</span><span>{v}</span></div>;
}

function Receipt({ shop, ev, qr, headClass }: { shop: Merchant | null; ev: AuthEvent; qr: string | null; headClass: string }) {
  const o = ev.order;
  const when = new Date(ev.ts * 1000);
  const sig = ev.settle_sig ?? ev.sig;
  const link = ev.settle_explorer ?? ev.explorer;
  return (
    <div id="receipt" className="w-[360px] bg-white text-black rounded-sm p-6 font-mono text-[12px] leading-relaxed shadow-2xl">
      <div className="text-center">
        <div className={`${headClass} text-xl font-extrabold leading-tight`}>{shop?.name ?? "Settld"}</div>
        <div>{shop?.address}</div>
        <div className="mt-1">{when.toLocaleDateString()} {when.toLocaleTimeString()}</div>
        <div className="mt-1 font-bold">Order #{String(ev.seq).padStart(3, "0")}{o?.customer_name ? ` · ${o.customer_name}` : ""}</div>
      </div>
      <div className="my-3 border-t border-dashed border-black" />
      {(o?.lines ?? [{ item: ev.item ?? "Purchase", cents: ev.amount_cents, qty: 1 }]).map((l) => (
        <div key={l.item} className="flex justify-between"><span>{l.qty > 1 ? `${l.qty} × ` : ""}{l.item}</span><span>{usd(l.cents * l.qty)}</span></div>
      ))}
      <div className="my-3 border-t border-dashed border-black" />
      {o && <>
        <div className="flex justify-between"><span>Subtotal</span><span>{usd(o.subtotal_cents)}</span></div>
        <div className="flex justify-between"><span>Tax</span><span>{usd(o.tax_cents)}</span></div>
        <div className="flex justify-between"><span>Tip</span><span>{usd(o.tip_cents)}</span></div>
      </>}
      <div className="flex justify-between font-bold text-sm mt-1"><span>TOTAL</span><span>{usd(ev.amount_cents)}</span></div>
      <div className="my-3 border-t border-dashed border-black" />
      <div className="flex justify-between"><span>Settld card</span><span>{mask(ev.uid)}</span></div>
      <div className="flex justify-between"><span>Paid in</span><span>USDC on Solana</span></div>
      <div className="flex justify-between"><span>Settled in</span><span>{ev.latency_ms.toFixed(0)} ms</span></div>
      <div className="flex justify-between"><span>Risk score</span><span>{ev.score.toFixed(3)}</span></div>
      <div className="my-3 border-t border-dashed border-black" />
      <div className="font-bold">Transaction</div>
      <div className="break-all text-[10px]">{sig}</div>
      {qr && (
        <div className="mt-3 flex items-center gap-3">
          <img src={qr} alt="Scan to view the transaction on Solana" width={96} height={96} />
          <div className="text-[10px]">Scan to see this payment on the Solana explorer.<br />{link && <a href={link} target="_blank" rel="noreferrer" className="underline no-print">open on explorer</a>}</div>
        </div>
      )}
      <div className="mt-4 text-center">Thank you. No two-day hold, nothing to claw back.</div>
    </div>
  );
}

function AgentTicket({ o, shop, qr, headClass, upper, button, made, onMade }: { o: AgentOrder; shop: Merchant | null; qr: string | null; headClass: string; upper: boolean; button: React.CSSProperties; made: boolean; onMade: () => void }) {
  const paid = o.status === "paid";
  const first = (o.owner_name || "").split(" ")[0] || "the owner";
  const [kya, setKya] = useState<KyaCheck>({ status: "checking", issuerOk: false, orderOk: false });
  useEffect(() => {
    let live = true;
    setKya({ status: "checking", issuerOk: false, orderOk: false });
    checkAgentOrder(o).then((k) => { if (live) setKya(k); }).catch(() => { if (live) setKya({ status: "unverified", issuerOk: false, orderOk: false }); });
    return () => { live = false; };
  }, [o.id]);
  const pp = kya.passport;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-10 items-start">
      <div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold tracking-widest px-2 py-1 rounded" style={{ background: "rgba(255,47,182,0.14)", color: "#b4207f" }}>AGENT ORDER</span>
          <span className="text-sm text-[var(--k-ink-2)]">#{String(o.seq).padStart(3, "0")} · {new Date(o.ts * 1000).toLocaleTimeString()}</span>
        </div>
        <div className={`${headClass} ${upper ? "uppercase" : ""} text-[52px] leading-none font-extrabold mt-4`} style={{ color: paid ? "var(--k-ink)" : "var(--k-ink-2)" }}>{paid ? (made ? "Made" : "Paid, make it") : "Not charged"}</div>
        <div className="text-xl mt-3">For {first}. Ordered by <b>{o.agent_name}</b>, an agent of {o.owner_name}.</div>
        <div className="mt-2 flex items-center gap-2 text-sm flex-wrap">
          {kya.status === "known" && <span className="px-2 py-1 rounded font-semibold" style={{ background: "rgba(34,197,94,0.14)", color: "#15803d" }}>✓ Known agent</span>}
          {kya.status === "unverified" && <span className="px-2 py-1 rounded font-semibold" style={{ background: "rgba(239,68,68,0.14)", color: "#b91c1c" }}>Unverified agent</span>}
          {kya.status === "unsigned" && <span className="px-2 py-1 rounded font-semibold" style={{ background: "rgba(245,181,63,0.16)", color: "#a16207" }}>No passport</span>}
          {kya.status === "checking" && <span className="text-[var(--k-ink-2)]">Checking the agent…</span>}
          {pp && <span className="text-[var(--k-ink-2)]">rules v{pp.policy_version} · {pp.purchases} paid · {pp.stopped} stopped{kya.status === "known" ? " · the agent signed this order, Settld signed the agent" : ""}</span>}
        </div>
        {o.merchant_accept && (
          <div className="mt-2 text-sm text-[var(--k-ink-2)]">
            <span className="font-semibold" style={{ color: o.merchant_accept.decision === "accepted" ? "#15803d" : "#b91c1c" }}>Your agent {o.merchant_accept.decision}</span>
            {" · "}{o.merchant_accept.checks.filter((c) => c.ok).length}/{o.merchant_accept.checks.length} checks{o.merchant_accept.signature ? " · signed" : ""}{o.made?.signature ? " · made, signed" : ""}
          </div>
        )}
        {o.stated_reason && <div className="text-[var(--k-ink-2)] mt-1">&ldquo;{o.stated_reason}&rdquo;</div>}
        <ul className="mt-6 divide-y" style={{ borderColor: "var(--k-line)" }}>
          {o.order.lines.map((l) => (
            <li key={l.item} className="py-3 flex items-center justify-between text-lg"><span>{l.qty > 1 ? `${l.qty} × ` : ""}{l.item}</span><span>{usd(l.cents * l.qty)}</span></li>
          ))}
        </ul>
        <div className="mt-3 flex items-baseline justify-between"><span className="text-[var(--k-ink-2)]">Total with tax</span><span className={`${headClass} text-3xl font-extrabold ${paid ? "" : "line-through text-[var(--k-ink-2)]"}`}>{usd(o.amount_cents)}</span></div>
        <div className="text-[var(--k-ink-2)] mt-2">{paid ? `Settled to ${shop?.name ?? "you"} in ${o.latency_ms.toFixed(0)} ms, as USDC on Solana, before this screen lit up.` : `Stopped: ${cap(plain(o.reason ?? "policy"))}. Nothing was charged.`}</div>
        <div className="mt-6 flex gap-3">
          {paid && !made && <button onClick={onMade} className={`${headClass} px-8 py-4 text-lg font-semibold bg-[var(--k-accent)] text-[var(--k-accent-ink)]`} style={button}>Made it</button>}
          {o.explorer && <a href={o.explorer} target="_blank" rel="noreferrer" className="px-6 py-4 text-lg font-medium bg-[var(--k-surface-2)]" style={button}>See it on Solana</a>}
        </div>
      </div>
      <div className="w-[300px] bg-white text-black rounded-sm p-5 font-mono text-[12px] leading-relaxed shadow-2xl">
        <div className="text-center">
          <div className={`${headClass} text-lg font-extrabold leading-tight`}>{shop?.name ?? "Settld"}</div>
          <div className="mt-1 font-bold">Agent order #{String(o.seq).padStart(3, "0")}</div>
        </div>
        <div className="my-3 border-t border-dashed border-black" />
        <div className="flex justify-between"><span>Agent</span><span>{o.agent_name}</span></div>
        <div className="flex justify-between"><span>Owner</span><span>{o.owner_name}</span></div>
        <div className="flex justify-between"><span>Task card</span><span>•••• {o.card_number.slice(-4)}</span></div>
        <div className="flex justify-between"><span>Status</span><span>{paid ? "PAID" : "NOT CHARGED"}</span></div>
        {paid && <div className="flex justify-between"><span>Settled in</span><span>{o.latency_ms.toFixed(0)} ms</span></div>}
        <div className="flex justify-between"><span>Risk score</span><span>{o.score.toFixed(3)}</span></div>
        <div className="my-3 border-t border-dashed border-black" />
        {o.sig && <><div className="font-bold">Transaction</div><div className="break-all text-[10px]">{o.sig}</div></>}
        {o.signature && <><div className="font-bold mt-2">Agent signature</div><div className="break-all text-[10px]">{o.signature.slice(0, 44)}…</div></>}
        {o.agent_key && <div className="text-[10px] break-all">Signing key {o.agent_key}</div>}
        <div className="flex justify-between mt-2"><span>Passport</span><span>{kya.status === "known" ? "VERIFIED" : kya.status === "checking" ? "…" : "NOT VERIFIED"}</span></div>
        {o.merchant_accept?.signature && <><div className="font-bold mt-2">Shop agent</div><div className="text-[10px]">{o.merchant_accept.decision.toUpperCase()} · {o.merchant_accept.checks.filter((c) => c.ok).length}/{o.merchant_accept.checks.length} checks</div><div className="break-all text-[10px]">{o.merchant_accept.signature.slice(0, 44)}…</div></>}
        {o.made?.signature && <div className="flex justify-between"><span>Made</span><span>SIGNED</span></div>}
        {qr && <div className="mt-3 flex items-center gap-3"><img src={qr} alt="Scan to view on Solana" width={90} height={90} /><div className="text-[10px]">Scan to see this payment on the Solana explorer.</div></div>}
        {o.agent_pda && o.agent_pda !== "offline" && <div className="mt-3 text-[10px] break-all">Agent account {o.agent_pda}</div>}
      </div>
    </div>
  );
}
