"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import type { Account, AgentView, AuthEvent, Intent, Stats } from "@/lib/feed";
import { usd, mask, pctf } from "@/lib/format";
import { Card, SectionTitle } from "./Panel";
import { RiskScatter } from "./RiskScatter";
import { Waterfall } from "./Waterfall";
import { Ring } from "./Ring";
import { ManualTap } from "./ManualTap";

const AtlantaMap = dynamic(() => import("./AtlantaMap").then((m) => m.AtlantaMap), { ssr: false });
const RULE_FEATURES = new Set(["velocity_60s", "two_merchants_60s"]);
const MODEL = { roc: 0.986, pr: 0.79, ms: "0.04 ms" };

const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function Stat({ label, value, sub, tone = "", className = "" }: { label: string; value: string; sub?: string; tone?: string; className?: string }) {
  return (
    <div className={`bg-surface border border-line rounded-2xl px-4 py-2.5 ${className}`}>
      <div className="text-[13px] text-ink-2 font-medium">{label}</div>
      <div className={`text-[22px] leading-tight font-semibold ${tone}`}>{value}</div>
      {sub && <div className="text-[12px] text-ink-3">{sub}</div>}
    </div>
  );
}

function ExplorerLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" title="View on Solana" className="shrink-0 text-ink-2 hover:text-ink">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>
    </a>
  );
}

export function PlatformTab({ tape, declines, stats, accounts, agents, pendingIntents }: { tape: AuthEvent[]; declines: AuthEvent[]; stats: Stats; accounts: Record<string, Account>; agents: Record<string, AgentView>; pendingIntents: Record<string, Intent> }) {
  const agentList = Object.values(agents).sort((x, y) => y.last_used - x.last_used);
  const pendingCount = Object.keys(pendingIntents).length;
  const ownerOf = (a: AgentView) => Object.values(accounts).find((x) => x.person_id === a.person_id)?.name ?? "its owner";
  const floatValue = Math.round(stats.settledCents * 0.05 * (2 / 365));
  const onchain = tape.filter((e) => e.sig).slice(0, 5);
  const byRules = declines.filter((d) => d.reasons.some((r) => RULE_FEATURES.has(r.feature))).length;
  const modelOnly = declines.length - byRules;
  const accts = Object.values(accounts).length;
  const [audit, setAudit] = useState<Record<string, number | string> | null>(null);
  useEffect(() => {
    const load = () => api.audit().then(setAudit).catch(() => {});
    load(); const id = setInterval(load, 3000); return () => clearInterval(id);
  }, [tape.length, accts]);
  const holders = Object.values(accounts).sort((a, b) => b.created - a.created);

  return (
    <div className="h-[calc(100dvh-6.125rem)] min-h-[760px] grid grid-cols-1 grid-rows-[minmax(360px,1fr)_auto_auto_auto] gap-3">
      <div className="grid grid-cols-12 gap-3 min-h-0">
        <Card className="col-span-7 !p-3 flex flex-col min-h-0">
          <div className="flex items-baseline justify-between mb-2 px-1">
            <h2 className="text-lg font-semibold text-ink">Settld Transaction Map</h2>
            {stats.mode === "test" && <span className="text-sm text-ink-2">simulated</span>}
          </div>
          <div className="flex-1 min-h-0"><AtlantaMap events={tape} height="100%" /></div>
        </Card>

        <div className="col-span-5 flex flex-col gap-3 min-h-0">
          <Card className="!p-3 flex-1 min-h-0 flex flex-col">
            <SectionTitle right="newest first">Recent Transactions</SectionTitle>
            <ul className="divide-y divide-line overflow-y-auto min-h-0 flex-1 -mt-1">
              {tape.length === 0 && <li className="text-sm text-ink-2 py-2">Waiting for the first transaction.</li>}
              {tape.slice(0, 12).map((e) => (
                <li key={`${e.ts}-${e.seq}`} className="flex items-center gap-3 py-2">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${e.approved ? "bg-up" : "bg-shield"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate leading-tight flex items-center gap-1.5">
                      {e.kind === "agent" && <span className="text-[10px] font-semibold tracking-wide px-1.5 py-px rounded bg-lime/15 text-lime shrink-0">AGENT</span>}
                      <span className="truncate">{e.item ?? "Purchase"}</span>
                    </div>
                    <div className="text-[12px] text-ink-2 leading-tight truncate">{e.kind === "agent" ? `${e.agent?.name ?? "agent"} for ${e.agent?.owner_name ?? "owner"}` : mask(e.uid)} · score {e.score.toFixed(2)} · {e.latency_ms.toFixed(0)} ms · {clock(e.ts)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-sm font-semibold leading-tight ${e.approved ? "" : "text-shield line-through"}`}>{usd(e.amount_cents)}</div>
                    <div className={`text-[12px] font-medium leading-tight ${e.approved ? "text-up" : "text-shield"}`}>{e.approved ? "Settled" : "Protected"}</div>
                  </div>
                  {e.explorer && <ExplorerLink href={e.explorer} />}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="!p-3">
            <SectionTitle right="every one on Solana Explorer">Transactions on the Blockchain</SectionTitle>
            <ul className="divide-y divide-line -mt-1">
              {onchain.length === 0 && <li className="text-sm text-ink-2 py-1.5">No transactions yet.</li>}
              {onchain.map((e) => (
                <li key={`${e.ts}-${e.seq}`} className="py-1.5 text-[13px] flex items-center gap-3">
                  <span className={`shrink-0 w-2 h-2 rounded-full ${e.approved ? "bg-up" : "bg-shield"}`} />
                  <span className="text-ink-2 shrink-0 w-[140px]">{clock(e.ts)} · {usd(e.amount_cents)}</span>
                  <a className="font-mono text-ink underline truncate flex-1" href={e.explorer!} target="_blank" rel="noreferrer">{e.sig!.slice(0, 20)}…</a>
                  <ExplorerLink href={e.explorer!} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Settled to the shop" value={usd(stats.settledCents)} sub={`$0.00 waiting · a two-day hold would keep ${usd(floatValue)}`} tone="text-up" />
        <Stat label="Transactions per second" value={stats.tps.toFixed(1)} sub={`${stats.total.toLocaleString()} transaction${stats.total === 1 ? "" : "s"} · ${accts} cardholder${accts === 1 ? "" : "s"}`} />
        <Stat label="Settle time" value={`${stats.p50.toFixed(0)} ms`} sub={`95% under ${stats.p95.toFixed(0)} ms`} />
        <Stat label="Kept from fraud" value={usd(stats.blockedCents)} sub={`${stats.declined.toLocaleString()} of ${stats.total.toLocaleString()} stopped`} tone="text-shield" />
      </div>

      <div className="grid grid-cols-12 gap-3 h-[248px]">
        <Card className="col-span-3 !p-3 overflow-hidden">
          <SectionTitle right="amount against score">Risk scores</SectionTitle>
          <RiskScatter events={tape} height={118} />
        </Card>
        <Card className="col-span-2 !p-3 overflow-hidden">
          <SectionTitle right={MODEL.ms}>Fraud model</SectionTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Ring value={MODEL.roc} label="ROC-AUC" size={44} />
            <Ring value={MODEL.pr} label="PR-AUC" size={44} tone="var(--up)" />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="bg-surface-2 rounded-xl px-2.5 py-1.5">
              <div className="text-[12px] text-ink-2">stopped by rules</div>
              <div className="text-lg font-semibold leading-tight">{byRules}</div>
            </div>
            <div className="bg-surface-2 rounded-xl px-2.5 py-1.5">
              <div className="text-[12px] text-ink-2">stopped by model</div>
              <div className="text-lg font-semibold leading-tight text-shield">{modelOnly}</div>
            </div>
          </div>
        </Card>
        <Card className="col-span-3 !p-3 flex flex-col min-h-0">
          <SectionTitle>Why the last transaction was stopped</SectionTitle>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1"><Waterfall event={declines[0] ?? null} /></div>
        </Card>
        <Card className="col-span-2 !p-3 overflow-hidden flex flex-col min-h-0">
          <SectionTitle right={pendingCount ? `${pendingCount} waiting` : undefined}>Agents</SectionTitle>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-2">
            <div><div className="text-lg font-semibold leading-none">{agentList.length}</div><div className="text-[12px] text-ink-2">active</div></div>
            <div><div className="text-lg font-semibold leading-none text-lime">{stats.agentApproved}</div><div className="text-[12px] text-ink-2">paid · {usd(stats.agentCents)}</div></div>
          </div>
          <ul className="overflow-y-auto min-h-0 flex-1 space-y-2 pr-1">
            {agentList.length === 0 && <li className="text-sm text-ink-2">No agents yet.</li>}
            {agentList.slice(0, 4).map((a) => {
              const left = Math.max(0, a.policy.budget_cents - a.spent_total_cents);
              const pctLeft = a.policy.budget_cents ? Math.round((left / a.policy.budget_cents) * 100) : 0;
              return (
                <li key={a.id}>
                  <div className="flex items-center justify-between text-[12px] gap-2">
                    <span className="font-medium truncate">{a.name}{a.frozen && <span className="text-warn"> · frozen</span>}</span>
                    <span className="text-ink-2 shrink-0">{usd(left)} left</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-2 mt-1"><div className="h-1.5 rounded-full bg-lime" style={{ width: `${pctLeft}%` }} /></div>
                  <div className="text-[11px] text-ink-3 truncate">for {ownerOf(a)} · rules v{a.policy_version} · log {a.chain_head ? `${a.chain_head.slice(0, 8)} · ${a.chain_len ?? 0}` : "—"}</div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card className="col-span-2 !p-3 overflow-hidden">
          <SectionTitle>Today</SectionTitle>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {[["issued", "issued"], ["approved", "approved"], ["declined", "stopped"], ["settled", "settled"], ["frozen", "frozen"]].map(([k, l]) => (
              <div key={k}><div className="text-lg font-semibold leading-none">{Number(audit?.[k] ?? 0)}</div><div className="text-[12px] text-ink-2">{l}</div></div>
            ))}
          </div>
          {holders.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {holders.slice(0, 2).map((a) => (
                <button key={a.uid} onClick={() => { void api.freeze(a.uid, a.status !== "blocked"); }}
                  className={`text-[12px] px-2.5 py-1 rounded-full border ${a.status === "blocked" ? "border-warn text-warn" : "border-line text-ink-2 hover:text-ink hover:border-ink-3"}`}>
                  {a.status === "blocked" ? `Unfreeze ${a.name.split(" ")[0]}` : `Freeze ${a.name.split(" ")[0]}`}
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <ManualTap />
    </div>
  );
}
