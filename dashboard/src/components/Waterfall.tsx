"use client";
import type { AuthEvent } from "@/lib/feed";
import { usd, mask, plain } from "@/lib/format";

const BASE = 0.03;

export function Waterfall({ event }: { event: AuthEvent | null }) {
  if (!event) return <div className="text-sm text-ink-3 h-full flex items-center">Nothing stopped yet.</div>;
  const total = BASE + event.reasons.reduce((s, r) => s + r.contribution, 0);
  const scale = Math.min(1, event.score / Math.max(total, 0.01));
  const segs = [{ feature: "base", contribution: BASE }, ...event.reasons];
  let acc = 0;
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-medium truncate">{event.item ? `${event.item} · ` : ""}{event.merchant} <span className="text-ink-3 font-normal">· {mask(event.uid)}</span></div>
        <div className="text-sm font-semibold text-shield line-through">{usd(event.amount_cents)}</div>
      </div>
      <div className="text-xs text-ink-2 mt-1">Stopped before payment, not charged: {event.reasons.length ? event.reasons.slice(0, 2).map((r) => plain(r.feature)).join(", ") : "unusual pattern"}.</div>
      <div className="mt-3 h-3 rounded-full bg-surface-2 overflow-hidden flex">
        {segs.map((s) => { const w = s.contribution * scale * 100; const el = <div key={s.feature} className={`h-full transition-all duration-700 ${s.feature === "base" ? "bg-ink-3" : "bg-down"}`} style={{ width: `${w}%`, marginLeft: acc ? 2 : 0 }} />; acc += w; return el; })}
      </div>
      <div className="flex justify-between text-[11px] text-ink-3 mt-1"><span>0.00</span><span className="text-down">0.80 threshold</span><span>1.00</span></div>
      <ul className="mt-3 space-y-1.5 text-xs flex-1">
        <li className="flex justify-between text-ink-3"><span>Typical card, no signals</span><span>{BASE.toFixed(2)}</span></li>
        {event.reasons.map((r) => (
          <li key={r.feature} className="flex justify-between gap-3">
            <span className="flex items-center gap-2 min-w-0"><span className="w-2 h-2 rounded-sm bg-down inline-block shrink-0" /><span className="truncate">{plain(r.feature)}</span></span>
            <span className="text-down font-medium shrink-0">+{r.contribution.toFixed(2)}</span>
          </li>
        ))}
        <li className="flex justify-between border-t border-line pt-1.5 font-semibold"><span>Risk score</span><span className="text-down">{event.score.toFixed(2)} · over the 0.80 line</span></li>
      </ul>
    </div>
  );
}
