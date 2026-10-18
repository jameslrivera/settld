"use client";
import { useMemo } from "react";
import type { AuthEvent } from "@/lib/feed";
import { usd } from "@/lib/format";

const THRESHOLD = 0.8;
const MIN = 100, MAX = 100_000;

export function RiskScatter({ events, height = 240 }: { events: AuthEvent[]; height?: number }) {
  const W = 1000, H = height, P = { l: 34, r: 10, t: 10, b: 22 };
  const now = Date.now() / 1000;
  const pts = useMemo(() => events.slice(0, 240).map((e, i) => {
    const lx = (Math.log(Math.min(MAX, Math.max(MIN, e.amount_cents))) - Math.log(MIN)) / (Math.log(MAX) - Math.log(MIN));
    return { e, x: P.l + lx * (W - P.l - P.r), y: P.t + (1 - e.score) * (H - P.t - P.b), op: Math.max(0.18, 1 - Math.max(0, now - e.ts) / 90), fresh: i === 0 };
  }), [events, H, now]);
  const ty = P.t + (1 - THRESHOLD) * (H - P.t - P.b);

  return (
    <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full block">
        <rect x={P.l} y={P.t} width={W - P.l - P.r} height={ty - P.t} fill="var(--down)" opacity={0.06} />
        {[0.25, 0.5].map((f) => { const y = P.t + (1 - f) * (H - P.t - P.b); return <line key={f} x1={P.l} x2={W - P.r} y1={y} y2={y} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />; })}
        <line x1={P.l} x2={W - P.r} y1={ty} y2={ty} stroke="var(--down)" strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
        {pts.map(({ e, x, y, op, fresh }) => (
          <g key={`${e.ts}-${e.seq}`} opacity={op}>
            {fresh && <circle cx={x} cy={y} r={14} fill={e.approved ? "var(--chart)" : "var(--down)"} opacity={0.25} />}
            <circle cx={x} cy={y} r={fresh ? 7 : 5} fill={e.approved ? "var(--chart)" : "var(--down)"} stroke="var(--surface)" strokeWidth={2} vectorEffect="non-scaling-stroke">
              <title>{`${e.merchant} · ${usd(e.amount_cents)} · score ${e.score.toFixed(3)} · ${e.approved ? "approved" : "stopped"}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="absolute left-0 text-[11px] text-ink-3" style={{ top: 4 }}>1.00</div>
      <div className="absolute left-0 text-[11px] text-ink-3" style={{ top: `${(ty / H) * 100}%`, transform: "translateY(-50%)" }}>0.80</div>
      <div className="absolute left-0 bottom-5 text-[11px] text-ink-3">0.00</div>
      <div className="absolute bottom-0 left-9 right-2 flex justify-between text-[11px] text-ink-3">{[1, 10, 100, 1000].map((t) => <span key={t}>${t.toLocaleString()}</span>)}</div>
      <div className="absolute right-2 text-[11px] text-down font-medium" style={{ top: `calc(${(ty / H) * 100}% - 14px)` }}>stop threshold</div>
    </div>
  );
}
