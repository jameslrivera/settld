"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, API_URL, type AgentOrder, type AgentSummary, type Artifact, type CardAccount, type Passport, type Person, type ThreadMessage } from "@/lib/api";
import { verifyEd25519, verifyChain, type ChainView } from "@/lib/kya";

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const short = (s: string | null | undefined, n = 6) => (s ? (s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s) : "—");
const when = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const addr = (k: string) => `https://explorer.solana.com/address/${k}?cluster=devnet`;

type Check = { label: string; ok: boolean | null; detail?: string; href?: string | null };

export default function Network() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [passport, setPassport] = useState<Passport | null>(null);
  const [chain, setChain] = useState<ChainView | null>(null);
  const [orders, setOrders] = useState<AgentOrder[]>([]);
  const [issuer, setIssuer] = useState<{ issuer?: string; issuer_b64?: string }>({});
  const [issuerOk, setIssuerOk] = useState<boolean | null>(null);
  const [orderOk, setOrderOk] = useState<boolean | null>(null);
  const [shopOk, setShopOk] = useState<boolean | null>(null);
  const [madeOk, setMadeOk] = useState<boolean | null>(null);
  const [deliveredOk, setDeliveredOk] = useState<boolean | null>(null);
  const [chainResult, setChainResult] = useState<{ ok: boolean; checked: number; brokenAt: number | null } | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [cards, setCards] = useState<CardAccount[]>([]);
  const [pickedPerson, setPickedPerson] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [fresh, setFresh] = useState<"account" | "new" | "tap" | "done" | null>(null);
  const seen = useRef<{ person: string | null; agent: string | null; newest: string | null; convos: number; done: number }>({ person: null, agent: null, newest: null, convos: 0, done: 0 });
  const bottom = useRef<HTMLDivElement>(null);

  const newest = people[0]?.id ?? null;
  const personId = pickedPerson && people.some((p) => p.id === pickedPerson) ? pickedPerson : newest;
  const person = people.find((p) => p.id === personId) ?? null;
  const mine = person ? agents.filter((a) => a.person_id === person.id) : agents;
  const agentId = (picked && mine.some((a) => a.id === picked) ? picked : null) ?? mine[0]?.id ?? null;
  const agent = agents.find((a) => a.id === agentId) ?? null;
  const myCards = useMemo(() => (person ? cards.filter((c) => c.person_id === person.id) : []), [cards, person]);
  const timeline = useMemo(() => {
    const out: ThreadMessage[] = [...thread];
    if (person) {
      out.push({ id: `p-${person.id}`, ts: person.created, role: "account", kind: "acct_open", text: `${person.name} opened an account`, data: { sig: person.wallet_sig ?? null, wallet: person.wallet ?? null } });
      for (const c of myCards) {
        out.push({ id: `c-${c.uid}`, ts: c.created, role: "account", kind: "acct_card", text: `Card •••• ${c.card_number.slice(-4)} issued on Solana`, data: { sig: c.register_sig } });
        c.history.forEach((h, i) => {
          const base = { id: `h-${c.uid}-${h.ts}-${i}`, ts: h.ts, role: "account", data: { sig: h.sig ?? null, ...h } as Record<string, unknown> };
          if (h.kind === "tap") out.push({ ...base, kind: "acct_tap", text: h.approved ? `Paid ${usd(h.amount_cents)} at ${h.merchant}${h.item ? ` for ${h.item}` : ""} with card •••• ${c.card_number.slice(-4)}` : `Declined at ${h.merchant}, ${usd(h.amount_cents)}` });
          else if (h.kind === "deposit") out.push({ ...base, kind: "acct_load", text: `Loaded ${usd(h.amount_cents)} onto card •••• ${c.card_number.slice(-4)}` });
          else if (h.kind === "withdraw") out.push({ ...base, kind: "acct_out", text: `Moved ${usd(h.amount_cents)} off the card` });
          else if (h.kind === "freeze" || h.kind === "unfreeze") out.push({ ...base, kind: "acct_freeze", text: h.kind === "freeze" ? "Card frozen" : "Card unfrozen" });
        });
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }, [thread, person, myCards]);
  const convos = useMemo(() => {
    const out: ThreadMessage[][] = [];
    for (const m of timeline) {
      if (m.role === "owner" || m.role === "contact" || m.kind === "acct_tap" || out.length === 0) out.push([]);
      out[out.length - 1].push(m);
    }
    return out;
  }, [timeline]);
  const current = viewing !== null && viewing < convos.length ? viewing : convos.length - 1;
  const live = current === convos.length - 1;
  const convo = convos[current] ?? [];
  const start = current > 0 ? convo[0]?.ts ?? 0 : 0;
  const end = convos[current + 1]?.[0]?.ts ?? Infinity;
  const doneCount = useMemo(() => timeline.filter((m) => m.kind === "task_done" || m.kind === "receipt" || (m.kind === "acct_tap" && m.data.approved)).length, [timeline]);
  const lastOrder = useMemo(() => orders.find((o) => o.agent === agentId && o.ts >= start && o.ts < end) ?? null, [orders, agentId, start, end]);

  useEffect(() => {
    const s = seen.current;
    const next = { person: personId, agent: agentId, newest, convos: convos.length, done: doneCount };
    if (s.newest && newest && newest !== s.newest) { setPickedPerson(null); setViewing(null); setFresh("account"); seen.current = next; return; }
    if (s.person !== personId || s.agent !== agentId) { seen.current = next; return; }
    if (convos.length > s.convos && s.convos > 0) { setViewing(null); setFresh(convos[convos.length - 1]?.[0]?.kind === "acct_tap" ? "tap" : "new"); }
    else if (doneCount > s.done && s.done > 0) setFresh("done");
    seen.current = next;
  }, [personId, agentId, newest, convos, doneCount]);

  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(null), 6000);
    return () => clearTimeout(t);
  }, [fresh]);

  useEffect(() => {
    if (fresh !== "done") return;
    void api.allAgentOrders().then(setOrders).catch(() => {});
  }, [fresh]);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const [list, iss, ord, ppl, cs] = await Promise.all([api.agents(), api.kyaIssuer(), api.allAgentOrders(), api.people(), api.cards()]);
        if (!live) return;
        setAgents(list.filter((a) => a.agent_pda && a.agent_pda !== "offline").sort((a, b) => b.created - a.created));
        setIssuer(iss);
        setOrders(ord);
        setPeople([...ppl].sort((a, b) => b.created - a.created));
        setCards(cs);
      } catch {}
    };
    void tick();
    const t = setInterval(tick, 2000);
    return () => { live = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    setThread([]);
    setPassport(null);
    setChain(null);
    if (!agentId) return;
    let live = true;
    const tick = async () => {
      try {
        const [th, pp, ch] = await Promise.all([api.thread(agentId), api.passport(agentId), api.chain(agentId)]);
        if (!live) return;
        setThread(th);
        setPassport(pp);
        setChain(ch);
      } catch {}
    };
    void tick();
    const t = setInterval(tick, 2000);
    return () => { live = false; clearInterval(t); };
  }, [agentId]);

  useEffect(() => {
    if (!passport?.signature || !issuer.issuer_b64) { setIssuerOk(null); return; }
    void verifyEd25519(issuer.issuer_b64, passport.canonical, passport.signature).then(setIssuerOk);
  }, [passport?.signature, passport?.canonical, issuer.issuer_b64]);

  useEffect(() => {
    const key = passport?.passport.agent_key_b64;
    if (!lastOrder?.signed || !lastOrder.signature || !key) { setOrderOk(null); return; }
    void verifyEd25519(key, lastOrder.signed, lastOrder.signature).then(setOrderOk);
  }, [lastOrder?.signature, lastOrder?.signed, passport?.passport.agent_key_b64]);

  useEffect(() => {
    const m = lastOrder?.merchant_accept;
    if (!m?.signature || !m.merchant_key_b64) { setShopOk(null); return; }
    void verifyEd25519(m.merchant_key_b64, m.signed, m.signature).then(setShopOk);
  }, [lastOrder?.merchant_accept?.signature]);

  useEffect(() => {
    const m = lastOrder?.made;
    if (!m?.signature || !m.merchant_key_b64) { setMadeOk(null); return; }
    void verifyEd25519(m.merchant_key_b64, m.signed, m.signature).then(setMadeOk);
  }, [lastOrder?.made?.signature]);

  useEffect(() => {
    const d = lastOrder?.delivered;
    if (!d?.signature || !d.merchant_key_b64) { setDeliveredOk(null); return; }
    void verifyEd25519(d.merchant_key_b64, d.signed, d.signature).then(setDeliveredOk);
  }, [lastOrder?.delivered?.signature]);

  useEffect(() => {
    if (!chain) { setChainResult(null); return; }
    void verifyChain(chain).then(setChainResult);
  }, [chain?.head, chain?.messages.length]);

  useEffect(() => { if (live) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [thread.length, live]);

  const pp = passport?.passport;
  const anchored = chain?.on_chain;
  const checks: Check[] = [
    { label: "Passport issued by Settld", ok: passport ? true : null, detail: pp ? `${pp.name} · for ${pp.owner_name}` : undefined },
    { label: "Issuer signature valid", ok: issuerOk, detail: issuer.issuer ? `key ${short(issuer.issuer)}` : undefined, href: issuer.issuer ? addr(issuer.issuer) : null },
    { label: "Agent account on Solana", ok: pp ? !pp.frozen : null, detail: pp ? `${pp.frozen ? "frozen" : "active"} · rules v${pp.policy_version} · ${short(pp.policy_hash, 5)}` : undefined, href: pp?.agent_pda ? addr(pp.agent_pda) : null },
    { label: "Order signed by the agent", ok: lastOrder ? orderOk : null, detail: lastOrder ? `${usd(lastOrder.amount_cents)} · ${lastOrder.order.item} · key ${short(lastOrder.agent_key, 4)}` : "no order in this conversation yet" },
    { label: "Shop's agent accepted, signed", ok: lastOrder?.merchant_accept ? (lastOrder.merchant_accept.decision === "accepted" && shopOk === true) : null, detail: lastOrder?.merchant_accept ? `${lastOrder.merchant_accept.checks.filter((c) => c.ok).length}/${lastOrder.merchant_accept.checks.length} checks · key ${short(lastOrder.merchant_accept.merchant_key, 4)}` : "no order yet", href: lastOrder?.merchant_accept?.merchant_key ? addr(lastOrder.merchant_accept.merchant_key) : null },
    { label: "Record recomputed", ok: chainResult?.ok ?? null, detail: chainResult ? `${chainResult.checked} entries hash to ${short(chain?.head, 5)}` : undefined },
    { label: "Record anchored on Solana", ok: anchored ? anchored.head === chain?.head || (anchored.length ?? 0) <= (chain?.length ?? 0) : null, detail: anchored ? `slot ${anchored.slot ?? "?"} · entry ${anchored.length}` : "not yet", href: anchored?.explorer ?? null },
    { label: "Payment settled", ok: lastOrder ? lastOrder.status === "paid" : null, detail: lastOrder ? (lastOrder.status === "paid" ? `${lastOrder.latency_ms.toFixed(0)} ms · USDC to the shop` : `stopped: ${lastOrder.reason}`) : undefined, href: lastOrder?.explorer ?? null },
    lastOrder?.shop_kind === "digital"
      ? { label: "Delivered, signed by the shop", ok: lastOrder.delivered ? deliveredOk : null, detail: lastOrder.delivered ? `${lastOrder.delivered.artifacts.map((x) => x.item ?? x.title).join(", ")} · ${when(lastOrder.delivered.ts)}` : "waiting for the shop's agent" }
      : { label: "Made, signed by the shop", ok: lastOrder?.made ? madeOk : null, detail: lastOrder?.made ? when(lastOrder.made.ts) : "waiting for the counter" },
  ];
  const good = checks.filter((c) => c.ok === true).length;

  return (
    <main className="min-h-screen bg-bg text-ink px-6 py-5">
      <header className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="text-xl font-semibold tracking-tight">Settld<span className="text-[#ff2fb6]">.</span></span>
          <span className="text-ink-3">/</span>
          <span className="text-ink-2">Network</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {people.length === 0 && <span className="text-sm text-ink-3">No accounts yet. Open one in the app.</span>}
          {people.map((p) => (
            <button key={p.id} onClick={() => { setPickedPerson(p.id === newest ? null : p.id); setPicked(null); setViewing(null); }} className={`px-3 py-1.5 rounded-full text-sm border ${p.id === personId ? "border-lime text-ink bg-surface-2" : "border-line text-ink-3 hover:text-ink"}`}>
              {p.name}{p.id === newest ? <span className="ml-2 text-[10px] tracking-widest text-[#ff2fb6]">NEWEST</span> : null}{agents.some((a) => a.person_id === p.id && a.running) ? <span className="ml-2 inline-block w-2 h-2 rounded-full bg-lime animate-pulse align-middle" /> : null}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)_400px] gap-5 items-start">
        <section className="space-y-4">
          <Card title="Account">
            {person ? (
              <>
                <div className="font-serif text-3xl leading-tight">{person.name}</div>
                <div className="text-ink-3 text-sm mb-3">opened {when(person.created)}</div>
                {person.wallet && <Row k="Wallet" v={short(person.wallet)} href={addr(person.wallet)} />}
                {myCards.length === 0 && <Row k="Card" v="waiting for a tap" />}
                {myCards.map((c) => (
                  <div key={c.uid}>
                    <Row k={`Card •••• ${c.card_number.slice(-4)}`} v={c.status === "blocked" ? "Frozen" : "Active"} href={c.card_pda && c.card_pda !== "offline" ? addr(c.card_pda) : null} tone={c.status === "blocked" ? "warn" : "up"} />
                    <Row k="Card balance" v={usd(c.balance_cents)} />
                  </div>
                ))}
                {agent && <Row k="Agent balance" v={usd(agent.balance_cents)} />}
              </>
            ) : <div className="text-ink-3 text-sm">Waiting for someone to open an account…</div>}
          </Card>
          {person && <Activity cards={myCards} orders={orders.filter((o) => mine.some((a) => a.id === o.agent))} />}
          <Card title="Know your agent">
            {pp ? (
              <>
                <div className="font-serif text-3xl leading-tight">{pp.name}</div>
                <div className="text-ink-3 text-sm mb-3">for {pp.owner_name}</div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <Stat label="Paid" value={String(pp.purchases)} />
                  <Stat label="Stopped" value={String(pp.stopped)} tone={pp.stopped ? "warn" : undefined} />
                  <Stat label="Rules" value={`v${pp.policy_version}`} />
                </div>
                <Row k="Agent account" v={short(pp.agent_pda)} href={pp.agent_pda ? addr(pp.agent_pda) : null} />
                <Row k="Signing key" v={short(pp.agent_key)} />
                <Row k="Rules hash" v={short(pp.policy_hash)} />
                <Row k="Owner wallet" v={short(pp.owner)} href={addr(pp.owner)} />
                <Row k="Status" v={pp.frozen ? "Frozen" : "Active"} tone={pp.frozen ? "warn" : "up"} />
                <div className="mt-3 pt-3 border-t border-line text-xs text-ink-3 leading-relaxed">{pp.policy_text}</div>
                <div className={`mt-3 flex items-center gap-2 text-sm ${issuerOk ? "text-lime" : issuerOk === false ? "text-down" : "text-ink-3"}`}>
                  <Dot ok={issuerOk} /> {issuerOk ? "Signed by Settld, verified in this browser" : issuerOk === false ? "Signature does not verify" : "Checking signature…"}
                </div>
                <div className="mt-1 font-mono text-[10px] text-ink-3 break-all">{passport?.signature?.slice(0, 64)}…</div>
              </>
            ) : <div className="text-ink-3 text-sm">Waiting for an agent…</div>}
          </Card>
          <Card title="Proof of history">
            {chain ? (
              <>
                <Row k="Entries" v={String(chain.length)} />
                <Row k="Head" v={short(chain.head, 8)} />
                <Row k="Recomputed" v={chainResult ? (chainResult.ok ? `${chainResult.checked} of ${chainResult.checked} match` : chainResult.brokenAt !== null ? `break at entry ${chainResult.brokenAt + 1}` : "head mismatch") : "…"} tone={chainResult?.ok ? "up" : chainResult ? "down" : undefined} />
                <Row k="On Solana" v={anchored ? `slot ${anchored.slot ?? "?"} · entry ${anchored.length}` : "not yet"} href={anchored?.explorer ?? null} tone={anchored ? "up" : undefined} />
                <div className="mt-3 text-xs text-ink-3 leading-relaxed">Every message, step, order and approval is hashed onto the one before it. The head is written to Solana in a memo after each payment and rules change, so the record cannot be rewritten after the fact.</div>
              </>
            ) : <div className="text-ink-3 text-sm">—</div>}
          </Card>
        </section>

        <section>
          <Card title={person ? `${person.name} · ${live ? "live" : "earlier"}` : "Live"} right={convos.length ? `conversation ${current + 1} of ${convos.length}` : undefined} className="xl:min-h-[70vh]">
            {fresh && (
              <div className={`mb-3 rounded-lg px-3 py-2 text-sm font-semibold ${fresh === "done" ? "bg-lime/10 text-lime border border-lime/30" : "bg-[#ff2fb6]/15 text-[#ff2fb6] border border-[#ff2fb6]/40"}`}>
                {fresh === "account" ? `New account opened · ${person?.name ?? ""}` : fresh === "new" ? "New conversation started" : fresh === "tap" ? "Card tapped at the counter" : "Transaction complete · checks refreshed"}
              </div>
            )}
            {convos.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                {convos.map((c, i) => i < convos.length - 6 && i !== current ? null : (
                  <button key={c[0]?.id ?? i} onClick={() => setViewing(i === convos.length - 1 ? null : i)} className={`px-2.5 py-1 rounded-full text-xs border ${i === current ? "border-lime text-ink bg-surface-2" : "border-line text-ink-3 hover:text-ink"}`}>
                    {i === convos.length - 1 ? "Live" : `#${i + 1}`}
                  </button>
                ))}
              </div>
            )}
            <div className="max-h-[60vh] xl:max-h-[78vh] overflow-y-auto pr-2 space-y-2">
              {current > 0 && start > 0 && <div className="text-center text-[10px] tracking-widest text-ink-3 uppercase">Started {when(start)}</div>}
              {convo.map((m) => m.role === "account" ? <AcctLine key={m.id} m={m} /> : <Line key={m.id} m={m} orders={orders} />)}
              {live && agent?.running && <div className="flex items-center gap-2 text-sm text-ink-3"><span className="inline-block w-2 h-2 rounded-full bg-lime animate-pulse" /> working…</div>}
              <div ref={bottom} />
            </div>
          </Card>
        </section>

        <section className="space-y-4">
          <Card title="What the shop checks" right={`${good}/${checks.length}`}>
            <ol className="space-y-3">
              {checks.map((c, i) => (
                <li key={c.label} className="flex items-start gap-3">
                  <div className="mt-0.5"><Dot ok={c.ok} /></div>
                  <div className="min-w-0">
                    <div className="text-sm">{i + 1}. {c.label}</div>
                    {c.detail && <div className="text-xs text-ink-3 truncate">{c.detail}{c.href && <> · <a className="underline" href={c.href} target="_blank" rel="noreferrer">explorer</a></>}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          {lastOrder && (
            <Card title="Latest signed order">
              <div className="text-sm mb-1">{lastOrder.order.item} · {usd(lastOrder.amount_cents)} · {lastOrder.status === "paid" ? "paid" : "stopped"}</div>
              <div className="text-xs text-ink-3 mb-2">{when(lastOrder.ts)} · nonce {lastOrder.id}</div>
              <pre className="font-mono text-[10px] leading-relaxed bg-surface-2 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all">{lastOrder.signed}</pre>
              <div className="mt-2 text-[10px] font-mono break-all text-ink-3">sig {lastOrder.signature}</div>
              <div className={`mt-2 text-sm flex items-center gap-2 ${orderOk ? "text-lime" : orderOk === false ? "text-down" : "text-ink-3"}`}><Dot ok={orderOk} />{orderOk ? "Agent signature verified against the passport key" : orderOk === false ? "Signature does not match" : "Checking…"}</div>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}

function Line({ m, orders }: { m: ThreadMessage; orders: AgentOrder[] }) {
  const d = m.data ?? {};
  const explorer = typeof d.explorer === "string" ? d.explorer : null;
  const intent = typeof d.intent === "string" ? d.intent : null;
  const order = intent ? orders.find((o) => o.id === intent) : null;
  const base = "rounded-xl px-3 py-2 text-sm";
  switch (m.kind) {
    case "text":
      return m.role === "owner"
        ? <div className="flex justify-end"><div className={`${base} bg-lime text-on-accent max-w-[80%]`}>{m.text}<Meta ts={m.ts} /></div></div>
        : <div className={`${base} bg-surface-2 max-w-[85%]`}>{m.text}<Meta ts={m.ts} /></div>;
    case "contact":
      return <Block tone="lime" title={`TEXT FROM ${String(d.from ?? "A CONTACT").toUpperCase()}`}>{m.text}<Meta ts={m.ts} /></Block>;
    case "status":
      return <div className="flex items-center gap-2 text-xs text-ink-3 pl-1"><span className="text-lime">✓</span>{typeof d.done === "string" ? d.done : m.text}</div>;
    case "plan":
      return <Block tone="lime" title="Plan">{m.text}</Block>;
    case "approval":
      return <Block tone="warn" title="Needs the owner">{m.text}</Block>;
    case "proposal":
      if (d.kind === "task") {
        const steps = Array.isArray(d.steps) ? (d.steps as string[]) : [];
        const shops = Array.isArray(d.shop_names) ? (d.shop_names as string[]).join(", ") : "";
        return (
          <Block tone="lime" title="Task for sign-off">
            <div className="font-semibold">{typeof d.goal === "string" ? d.goal : m.text}</div>
            {steps.length > 0 && <ol className="mt-1 list-decimal pl-5 text-xs text-ink-2">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
            <div className="mt-1 text-xs text-ink-2">
              Up to {typeof d.amount_cents === "number" ? usd(d.amount_cents) : "?"}
              {typeof d.estimate_cents === "number" ? ` · about ${usd(d.estimate_cents)}` : ""}{shops ? ` · ${shops}` : ""}
            </div>
          </Block>
        );
      }
      return <Block tone="lime" title={typeof d.kind === "string" && d.kind === "fund" ? "Load request" : "Rules change"}>{typeof d.summary === "string" ? d.summary : m.text}</Block>;
    case "confirm":
      return <Block tone="lime" title="Confirm with Face ID">{m.text}</Block>;
    case "task_done":
      return (
        <Block tone="up" title={d.status === "expired" ? "Task closed" : "Task done"}>
          {m.text}
          {typeof d.amount_cents === "number" && typeof d.budget_cents === "number" && <div className="mt-1 text-xs text-ink-2">Spent {usd(d.amount_cents)} of the {usd(d.budget_cents)} signed off</div>}
        </Block>
      );
    case "receipt":
      return (
        <Block tone="up" title="Paid">
          {m.text}
          {order?.signature && <div className="mt-1 font-mono text-[10px] text-ink-3 break-all">agent signature {order.signature.slice(0, 40)}…</div>}
          {explorer && <a className="block mt-1 text-xs underline text-ink-2" href={explorer} target="_blank" rel="noreferrer">transaction on Solana</a>}
        </Block>
      );
    case "decline":
      return <Block tone="warn" title="Stopped">{m.text}{explorer && <a className="block mt-1 text-xs underline text-ink-2" href={explorer} target="_blank" rel="noreferrer">decision on Solana</a>}</Block>;
    case "question":
      return <div className={`${base} bg-surface-2 border border-lime/40 max-w-[85%]`}>{m.text}<Meta ts={m.ts} /></div>;
    case "accept":
    case "merchant_decline":
    case "fulfilled":
    case "delivered": {
      const signed = typeof d.signature === "string" && d.signature.length > 0;
      const tone = m.kind === "merchant_decline" ? "text-warn" : "text-up";
      const art = m.kind === "delivered" && d.artifact && typeof d.artifact === "object" ? (d.artifact as Artifact) : null;
      return (
        <div className={`${base} bg-surface border border-line max-w-[85%]`}>
          <div className={`text-[10px] tracking-widest font-semibold ${tone}`}>{String(d.merchant ?? "SHOP").toUpperCase()} · AGENT{signed ? " · SIGNED" : ""}{m.kind === "delivered" ? " · DELIVERED" : ""}</div>
          <div className="mt-1">{m.text}</div>
          {art && <ArtifactView a={art} />}
          <Meta ts={m.ts} />
        </div>
      );
    }
    default: {
      const label = m.kind === "created" ? "Agent created on Solana" : m.kind === "policy" ? `Rules updated · v${typeof d.version === "number" ? d.version : ""}` : m.text;
      if (m.kind === "approved" && /face id/i.test(m.text)) return <div className="text-center text-xs font-semibold text-lime">✓ {m.text}</div>;
      return <div className="text-center text-xs text-ink-3">{label}{explorer && <> · <a className="underline" href={explorer} target="_blank" rel="noreferrer">tx</a></>}</div>;
    }
  }
}

function Meta({ ts }: { ts: number }) { return <div className="text-[10px] opacity-60 mt-1">{when(ts)}</div>; }

function ArtifactView({ a }: { a: Artifact }) {
  const href = a.url ? (a.url.startsWith("/") ? `${API_URL}${a.url}` : a.url) : null;
  if (a.type === "image" && href) {
    return (
      <div className="mt-2 rounded-xl bg-white p-2 inline-block">
        <img src={href} alt={a.title} width={168} height={168} className="block" />
      </div>
    );
  }
  if (a.type === "link" && href) {
    return (
      <div className="mt-2">
        {a.text && <div className="text-xs text-ink-3 mb-2 line-clamp-2">{a.text}</div>}
        <a href={href} target="_blank" rel="noreferrer" className="inline-block px-3 py-1.5 rounded-full bg-lime text-on-accent text-xs font-semibold">Open {a.title.split(":")[0]}</a>
      </div>
    );
  }
  return <pre className="mt-2 font-sans text-xs text-ink-2 whitespace-pre-wrap break-words bg-surface-2 rounded-lg p-2">{a.text}</pre>;
}

function Block({ tone, title, children }: { tone: "lime" | "warn" | "up"; title: string; children: React.ReactNode }) {
  const color = tone === "lime" ? "text-lime border-lime/40" : tone === "warn" ? "text-warn border-warn/40" : "text-up border-up/40";
  return (
    <div className={`rounded-xl border bg-surface px-3 py-2 ${color}`}>
      <div className="text-[10px] tracking-widest font-semibold">{title.toUpperCase()}</div>
      <div className="text-sm text-ink mt-1">{children}</div>
    </div>
  );
}

function Card({ title, right, className, children }: { title: string; right?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border border-line bg-surface p-4 ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] tracking-widest font-semibold text-ink-3">{title.toUpperCase()}</div>
        {right && <div className="text-xs text-ink-3">{right}</div>}
      </div>
      {children}
    </div>
  );
}

function Row({ k, v, href, tone }: { k: string; v: string; href?: string | null; tone?: "up" | "warn" | "down" }) {
  const color = tone === "up" ? "text-up" : tone === "warn" ? "text-warn" : tone === "down" ? "text-down" : "text-ink-2";
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-ink-3">{k}</span>
      <span className={`font-mono text-xs ${color}`}>{href ? <a className="underline" href={href} target="_blank" rel="noreferrer">{v}</a> : v}</span>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <div className="text-[10px] text-ink-3">{label}</div>
      <div className={`font-serif text-xl ${tone === "warn" ? "text-warn" : ""}`}>{value}</div>
    </div>
  );
}

function Dot({ ok }: { ok: boolean | null }) {
  const c = ok === true ? "bg-up" : ok === false ? "bg-down" : "bg-ink-3 animate-pulse";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${c}`} />;
}

type Tx = { key: string; ts: number; what: string; detail: string; cents: number; sign: "+" | "−" | ""; ok: boolean; sig: string | null };

function Activity({ cards, orders }: { cards: CardAccount[]; orders: AgentOrder[] }) {
  const rows: Tx[] = [];
  for (const c of cards) {
    const tail = `•••• ${c.card_number.slice(-4)}`;
    c.history.forEach((h, i) => {
      const base = { key: `${c.uid}-${i}`, ts: h.ts, cents: h.amount_cents, sig: h.sig ?? null, ok: h.approved !== false };
      if (h.kind === "deposit") rows.push({ ...base, what: "Money loaded", detail: `card ${tail}`, sign: "+" });
      else if (h.kind === "tap") rows.push({ ...base, what: h.approved === false ? "Card declined" : "Card payment", detail: `${h.item ?? "Purchase"} · ${h.merchant ?? "shop"}`, sign: "−" });
      else if (h.kind === "agent_fund") rows.push({ ...base, what: "Moved to agent", detail: `from card ${tail}`, sign: "−" });
      else if (h.kind === "withdraw") rows.push({ ...base, what: "Withdrawn", detail: "to wallet", sign: "−" });
      else if (h.kind === "freeze" || h.kind === "unfreeze") rows.push({ ...base, what: h.kind === "freeze" ? "Card locked" : "Card unlocked", detail: `card ${tail}`, cents: 0, sign: "" });
    });
  }
  for (const o of orders) {
    rows.push({ key: o.id, ts: o.ts, what: o.status === "paid" ? "Agent payment" : "Agent order stopped", detail: `${o.order.item} · ${o.agent_name}`, cents: o.amount_cents, sign: "−", ok: o.status === "paid", sig: o.sig });
  }
  rows.sort((a, b) => b.ts - a.ts);
  return (
    <Card title="All transactions" right={String(rows.length)}>
      {rows.length === 0 ? <div className="text-ink-3 text-sm">Nothing yet.</div> : (
        <ul className="divide-y divide-line -my-1">
          {rows.map((r) => (
            <li key={r.key} className="py-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={`text-sm font-medium ${r.ok ? "" : "text-warn"}`}>{r.what}</div>
                <div className="text-xs text-ink-3 truncate">{r.detail}</div>
                <div className="text-[10px] text-ink-3">{when(r.ts)}{r.sig && <> · <a className="underline" href={`https://explorer.solana.com/tx/${r.sig}?cluster=devnet`} target="_blank" rel="noreferrer">Solana</a></>}</div>
              </div>
              {r.cents > 0 && <div className={`text-sm font-semibold shrink-0 ${r.sign === "+" ? "text-up" : ""} ${r.ok ? "" : "line-through text-ink-3"}`}>{r.sign}{usd(r.cents)}</div>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AcctLine({ m }: { m: ThreadMessage }) {
  const sig = typeof m.data.sig === "string" && m.data.sig ? m.data.sig : null;
  const tone = m.kind === "acct_tap" ? (m.data.approved ? "up" : "warn") : "lime";
  const title = { acct_open: "Account opened", acct_card: "Card issued", acct_tap: m.data.approved ? "Card payment" : "Card declined", acct_load: "Money loaded", acct_out: "Money moved out", acct_freeze: "Card status" }[m.kind] ?? "Account";
  const ms = typeof m.data.latency_ms === "number" ? ` · settled in ${m.data.latency_ms.toFixed(0)} ms` : "";
  return (
    <Block tone={tone} title={title.toUpperCase()}>
      {m.text}{m.kind === "acct_tap" && m.data.approved ? ms : ""}
      <div className="text-[10px] opacity-60 mt-1">{when(m.ts)}{sig && <> · <a className="underline" href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`} target="_blank" rel="noreferrer">transaction on Solana</a></>}</div>
    </Block>
  );
}
