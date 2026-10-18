import { api, type AgentOrder, type PassportDoc } from "./api";

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export async function verifyEd25519(keyB64: string, message: string, signatureB64: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", bytes(keyB64), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, bytes(signatureB64), new TextEncoder().encode(message));
  } catch {
    return false;
  }
}

export type KyaCheck = { status: "checking" | "known" | "unverified" | "unsigned"; passport?: PassportDoc; issuerOk: boolean; orderOk: boolean };

export async function checkAgentOrder(o: AgentOrder): Promise<KyaCheck> {
  const [pp, iss] = await Promise.all([api.passport(o.agent), api.kyaIssuer()]);
  if (!pp?.signature || !iss?.issuer_b64) return { status: "unsigned", passport: pp?.passport, issuerOk: false, orderOk: false };
  const pinned = process.env.NEXT_PUBLIC_ISSUER;
  const issuerOk = (!pinned || pinned === iss.issuer) && pp.passport.agent === o.agent && (await verifyEd25519(iss.issuer_b64, pp.canonical, pp.signature));
  const orderOk = !!(o.signed && o.signature && pp.passport.agent_key_b64) && (await verifyEd25519(pp.passport.agent_key_b64 as string, o.signed as string, o.signature as string));
  return { status: issuerOk && orderOk ? "known" : "unverified", passport: pp.passport, issuerOk, orderOk };
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.keys(o).sort().reduce((acc, k) => { acc[k] = sortDeep(o[k]); return acc; }, {} as Record<string, unknown>);
  }
  return v;
}

export function canonical(v: unknown): string {
  return JSON.stringify(sortDeep(v));
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type ChainMessage = { id: string; ts: number; role: string; kind: string; text: string; data: Record<string, unknown>; hash: string };
export type ChainView = { agent: string; head: string | null; length: number; anchor: string; messages: ChainMessage[]; on_chain: { head: string | null; length: number | null; sig: string | null; explorer: string | null; slot: number | null; ts: number | null } | null };

export async function verifyChain(c: ChainView): Promise<{ ok: boolean; checked: number; brokenAt: number | null }> {
  let prev = c.anchor;
  for (let i = 0; i < c.messages.length; i++) {
    const m = c.messages[i];
    const body: Record<string, unknown> = { ...m };
    delete body.hash;
    const h = await sha256Hex(prev + canonical(body));
    if (h !== m.hash) return { ok: false, checked: i, brokenAt: i };
    prev = h;
  }
  return { ok: c.messages.length > 0 && prev === c.head, checked: c.messages.length, brokenAt: null };
}
