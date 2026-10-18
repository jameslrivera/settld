export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`bg-surface border border-line rounded-2xl p-5 ${className}`}>{children}</section>;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-ink-2 font-medium">{children}</div>;
}

export function Stat({ label, value, sub, tone = "" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className={`text-[28px] leading-tight font-semibold mt-1 ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-ink-3 mt-0.5">{sub}</div>}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <h2 className="text-lg font-semibold text-ink">{children}</h2>
      {right && <span className="text-sm text-ink-2">{right}</span>}
    </div>
  );
}

export function Pill({ active, children, onClick, tone = "lime" }: { active?: boolean; children: React.ReactNode; onClick?: () => void; tone?: "lime" | "down" }) {
  const on = tone === "lime" ? "bg-lime text-on-accent" : "bg-down text-white";
  return (
    <button onClick={onClick} className={`px-3 py-1 rounded-full text-xs font-semibold transition ${active ? on : "text-ink-2 hover:text-ink hover:bg-surface-2"}`}>
      {children}
    </button>
  );
}

export function Sparkline({ values, width = 80, height = 24, tone = "var(--chart)" }: { values: number[]; width?: number; height?: number; tone?: string }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - min) / span) * (height - 4)}`).join(" ");
  return (
    <svg width={width} height={height} className="block">
      <polyline points={pts} fill="none" stroke={tone} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
