"use client";
import { useMemo, useState } from "react";
import type { Point } from "@/lib/feed";

type Props = { points: Point[]; height?: number; format: (v: number) => string; windowMs?: number };

export function LineChart({ points: all, height = 220, format, windowMs }: Props) {
  const W = 1000, H = height, PAD = { l: 8, r: 8, t: 12, b: 8 };
  const [hover, setHover] = useState<number | null>(null);

  const points = useMemo(() => {
    if (!windowMs || !all.length) return all;
    const cutoff = all[all.length - 1].t - windowMs;
    return all.filter((p) => p.t >= cutoff);
  }, [all, windowMs]);

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const xs = points.map((p) => p.t), ys = points.map((p) => p.settled);
    const x0 = xs[0], x1 = xs[xs.length - 1];
    const yMin = Math.min(...ys), yMax = Math.max(yMin + 1, ...ys);
    const pad = (yMax - yMin) * 0.08;
    const lo = Math.max(0, yMin - pad), hi = yMax + pad;
    const sx = (x: number) => PAD.l + ((x - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r);
    const sy = (y: number) => PAD.t + (1 - (y - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const path = points.map((p, i) => `${i ? "L" : "M"}${sx(p.t).toFixed(1)},${sy(p.settled).toFixed(1)}`).join(" ");
    const area = `${path} L${sx(x1).toFixed(1)},${(H - PAD.b).toFixed(1)} L${sx(x0).toFixed(1)},${(H - PAD.b).toFixed(1)} Z`;
    const grid = [0.25, 0.5, 0.75].map((f) => ({ y: sy(lo + f * (hi - lo)), v: lo + f * (hi - lo) }));
    return { sx, sy, path, area, grid, last: points[points.length - 1] };
  }, [points, H]);

  if (!geo) return <div style={{ height }} className="flex items-center justify-center text-ink-3 text-sm">Waiting for data…</div>;
  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full block"
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1)); setHover(Math.max(0, Math.min(points.length - 1, i))); }}
        onMouseLeave={() => setHover(null)}>
        {geo.grid.map((g) => <line key={g.y} x1={PAD.l} x2={W - PAD.r} y1={g.y} y2={g.y} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
        <path d={geo.area} fill="var(--chart)" opacity={0.12} />
        <path d={geo.path} fill="none" stroke="var(--chart)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hp && <line x1={geo.sx(hp.t)} x2={geo.sx(hp.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink-3)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {geo.grid.map((g) => <div key={g.y} className="absolute right-0 text-[10px] text-ink-3 pr-1 -translate-y-full" style={{ top: `${(g.y / H) * 100}%` }}>{format(g.v)}</div>)}
      <Dot x={geo.sx(geo.last.t) / W} y={geo.sy(geo.last.settled) / H} pulse />
      {hp && <Dot x={geo.sx(hp.t) / W} y={geo.sy(hp.settled) / H} />}
      {hp && (
        <div className="absolute top-0 text-xs text-ink-2 bg-surface-2 border border-line rounded-md px-2 py-1 pointer-events-none whitespace-nowrap" style={{ left: `calc(${(geo.sx(hp.t) / W) * 100}% + 8px)` }}>
          <div className="text-ink font-medium">{format(hp.settled)}</div>
          <div>{new Date(hp.t).toLocaleTimeString()} · {hp.auths.toLocaleString()} transactions · {hp.declined} stopped</div>
        </div>
      )}
    </div>
  );
}

function Dot({ x, y, pulse = false }: { x: number; y: number; pulse?: boolean }) {
  return (
    <div className="absolute pointer-events-none" style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: "translate(-50%,-50%)" }}>
      {pulse && <div className="absolute inset-0 rounded-full bg-chart/40 animate-ping" style={{ width: 16, height: 16, margin: -4 }} />}
      <div className="rounded-full bg-chart" style={{ width: 8, height: 8, boxShadow: "0 0 0 2px var(--surface)" }} />
    </div>
  );
}
