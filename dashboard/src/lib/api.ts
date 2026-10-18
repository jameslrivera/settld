export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? `http://${typeof window !== "undefined" ? window.location.hostname : "127.0.0.1"}:8000`;
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? `ws://${typeof window !== "undefined" ? window.location.hostname : "127.0.0.1"}:8000/ws`;

export function adminHeaders(): Record<string, string> {
  try {
    const q = new URLSearchParams(window.location.search).get("admin");
    if (q) localStorage.setItem("settld_admin", q);
    const t = localStorage.getItem("settld_admin");
    return t ? { "x-admin-token": t } : {};
  } catch { return {}; }
}

export function shopHeaders(): Record<string, string> {
  try {
    const q = new URLSearchParams(window.location.search).get("shop");
    if (q) localStorage.setItem("settld_shop", q);
    const t = localStorage.getItem("settld_shop");
    return t ? { "x-shop-token": t } : {};
  } catch { return {}; }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...adminHeaders(), ...shopHeaders() }, body: JSON.stringify(body) });
  return r.json();
}
const get = async <T,>(path: string): Promise<T> => (await fetch(`${API_URL}${path}`)).json();
const del = async <T,>(path: string): Promise<T> => (await fetch(`${API_URL}${path}`, { method: "DELETE", headers: adminHeaders() })).json();

export type Reason = { feature: string; contribution: number };
export type TapResult = { approved: boolean; score: number; sig: string | null; explorer: string | null; latency_ms: number; balance_cents?: number; reasons: Reason[]; settle_explorer?: string | null; reason?: string };

export const api = {
  register: (name: string, uid?: string) => post<{ uid: string; error?: string; reason?: string }>("/accounts", { name, uid }),
  deposit: (uid: string, amount_cents: number) => post<{ error?: string }>("/deposit", { uid, amount_cents }),
  tap: (uid: string, amount_cents: number, merchant_id: number, item?: string) => post<TapResult>("/tap", { uid, amount_cents, merchant_id, item }),
  setMode: (mode: string) => post("/mode", { mode }),
  reset: () => post<{ ok: boolean }>("/reset", {}),
  setSale: (merchant_id: number, item: string, cents: number) => post<{ ok: boolean }>("/sale", { merchant_id, item, cents }),
  setOrder: (merchant_id: number, lines: { item: string; cents: number; qty: number }[], tax_cents: number, tip_cents: number, customer_name?: string) =>
    post<{ ok?: boolean; sale_id?: string; cents?: number; error?: string }>("/sale", { merchant_id, lines, tax_cents, tip_cents, source: "kiosk", customer_name }),
  clearSale: (merchant_id: number) => del<{ ok: boolean }>(`/sale/${merchant_id}`),
  getSale: (merchant_id: number) => get<{ item?: string; cents?: number }>(`/sale/${merchant_id}`),
  closeAccount: (uid: string) => del<{ ok?: boolean; balance_left_cents?: number; sig?: string | null; error?: string }>(`/accounts/${uid}`),
  freeze: (uid: string, blocked: boolean, by: "issuer" | "cardholder" = "issuer") => post<{ uid?: string; error?: string }>("/freeze", { uid, blocked, by }),
  fund: (uid: string, amount_cents: number) => post<{ reference?: string; url?: string; recipient?: string; error?: string }>("/fund", { uid, amount_cents }),
  fundStatus: (reference: string) => get<{ status: "pending" | "confirmed"; sig?: string; explorer?: string; amount_cents?: number; from_wallet?: string; error?: string }>(`/fund/${reference}`),
  withdraw: (uid: string, amount_cents: number, to_wallet: string) => post<{ ok?: boolean; sig?: string; explorer?: string; wallet_usdc?: string | null; balance_cents?: number; error?: string }>("/withdraw", { uid, amount_cents, to_wallet }),
  merchants: () => get<Merchant[]>("/merchants"),
  menu: () => get<MenuItem[]>("/menu"),
  audit: () => get<Record<string, number | string>>("/audit"),
  agentOrders: (merchant_id: number) => get<AgentOrder[]>(`/agent_orders/${merchant_id}`),
  allAgentOrders: () => get<AgentOrder[]>("/agent_orders"),
  passport: (agent: string) => get<Passport>(`/agents/${agent}/passport`),
  markMade: (order_id: string) => post<AgentOrder>(`/agent_orders/${order_id}/made`, {}),
  thread: (agent: string) => get<ThreadMessage[]>(`/agents/${agent}/thread`),
  chain: (agent: string) => get<import("./kya").ChainView>(`/agents/${agent}/chain`),
  agents: () => get<AgentSummary[]>("/agents"),
  people: () => get<Person[]>("/people"),
  cards: () => get<CardAccount[]>("/accounts"),
  books: (merchant_id: number) => get<Books>(`/merchants/${merchant_id}/books`),
  askBooks: (merchant_id: number, question: string, history: { role: string; content: string }[]) =>
    post<{ answer?: string; detail?: string }>(`/merchants/${merchant_id}/ask`, { question, history }),
  kyaIssuer: () => get<{ issuer?: string; issuer_b64?: string }>("/kya/issuer"),
  setMerchantAgentPolicy: (merchant_id: number, accepts_agents: boolean, max_agent_ticket_cents: number) =>
    post<{ accepts_agents?: boolean; max_agent_ticket_cents?: number; detail?: string | unknown[]; error?: string }>(`/merchants/${merchant_id}/agent_policy`, { accepts_agents, max_agent_ticket_cents }),
};

export type BookRow = {
  ts: number; order: number; item: string; source: "card" | "agent"; agent_name: string | null; owner_name: string | null; card: string; status: "paid" | "stopped"; reason: string | null;
  subtotal_cents: number; tax_cents: number; tip_cents: number; total_cents: number; fee_cents: number; net_cents: number; risk: number; latency_ms: number | null; sig: string | null; explorer: string | null;
};
export type BookSummary = {
  from: number | null; to: number | null; paid: number; stopped: number; stopped_cents: number; gross_cents: number; sales_cents: number; tax_cents: number; tips_cents: number;
  fee_cents: number; net_cents: number; fee_bps: number; avg_ticket_cents: number; avg_latency_ms: number | null; on_chain: number;
  by_source: Record<"card" | "agent", { count: number; cents: number }>; by_hour: number[]; top_items: { item: string; count: number; cents: number }[];
};
export type Books = { merchant_id: number; name: string; category: string; address: string; summary: BookSummary; rows: BookRow[] };

export type AgentOrder = {
  id: string; merchant_id: number; agent: string; agent_name: string; owner_name: string; owner: string; agent_pda: string | null; card_number: string;
  order: { item: string; lines: { item: string; cents: number; qty: number }[]; subtotal_cents: number; tax_cents: number; tip_cents: number; total_cents: number; source: string; customer_name?: string | null; reason?: string };
  amount_cents: number; status: "paid" | "declined"; reason: string | null; stated_reason: string; score: number; latency_ms: number; sig: string | null; explorer: string | null; seq: number; ts: number;
  signed?: string | null; signature?: string | null; agent_key?: string | null; agent_key_b64?: string | null;
  merchant_accept?: MerchantAccept | null; made?: ShopSigned | null; delivered?: (ShopSigned & { artifacts: Artifact[] }) | null; shop_kind?: "pickup" | "digital";
};
export type ShopSigned = { signed: string; signature: string | null; merchant_key: string | null; merchant_key_b64: string | null; ts: number };
export type Artifact = { type: "text" | "image" | "link"; title: string; text: string; url: string | null; sha256?: string; item?: string; summary?: string };
export type MerchantAccept = { merchant_id: number; merchant: string; decision: "accepted" | "declined"; reason: string | null; text: string; checks: { check: string; ok: boolean }[]; first_visit: boolean; signed: string; signature: string | null; merchant_key: string | null; merchant_key_b64: string | null; ts: number };

export type PassportDoc = {
  v: number; issuer: string; agent: string; name: string; owner_name: string; owner: string; agent_pda: string | null; agent_key: string | null; agent_key_b64: string | null;
  policy_text: string; policy_version: number; policy_hash: string | null; created: number; purchases: number; stopped: number; spent_total_cents: number;
  frozen: boolean; chain_head: string | null; chain_len: number; issued_at: number; expires_at: number;
};
export type Passport = { passport: PassportDoc; canonical: string; signature: string | null; issuer_key: string | null; issuer_key_b64: string | null; alg: string };

export type MenuItem = { merchant_id: number; merchant: string; category: string; item: string; cents: number; desc?: string; image?: string; kind?: "pickup" | "digital"; fulfillment?: "pickup" | "text" | "file" | "qr" };
export type RecentTap = { seq: number; ts: number; uid: string; item: string | null; amount_cents: number; approved: boolean; score: number; latency_ms: number; sig: string | null; explorer: string | null };
export type Merchant = { id: number; name: string; category: string; kind: "pickup" | "digital"; address: string; lat: number; lng: number; usdc: string | null; wallet: string | null; ata: string | null; accepts_agents: boolean | null; max_agent_ticket_cents: number | null; sales_cents: number; paid: number; blocked_cents: number; blocked: number; recent: RecentTap[] };

export type Person = { id: string; name: string; created: number; cards: string[]; wallet?: string; wallet_sig?: string | null };
export type CardEvent = { kind: string; amount_cents: number; ts: number; sig?: string | null; merchant?: string; item?: string | null; approved?: boolean; latency_ms?: number; source?: string; reasons?: Reason[] };
export type CardAccount = { uid: string; card_number: string; name: string; person_id: string | null; balance_cents: number; status: string; created: number; register_sig: string | null; card_pda: string | null; history: CardEvent[] };
export type ThreadMessage ={ id: string; ts: number; role: string; kind: string; text: string; data: Record<string, unknown>; hash?: string };
export type AgentSummary = { id: string; name: string; person_id: string; owner: string; agent_pda: string | null; last_used: number; created: number; frozen: boolean; running?: boolean; policy_version: number; chain_head?: string | null; chain_len?: number; anchor_sig?: string | null; anchor_slot?: number | null; anchor_len?: number | null; balance_cents: number; spent_total_cents: number; policy: { budget_cents: number; approval_threshold_cents: number; per_txn_max_cents: number } };
