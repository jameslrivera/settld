export function Ring({ value, label, size = 84, tone = "var(--chart)" }: { value: number; label: string; size?: number; tone?: string }) {
  const r = (size - 10) / 2, c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} className="shrink-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={8} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={8} strokeLinecap="round" strokeDasharray={`${c * value} ${c}`} style={{ transition: "stroke-dasharray 1s" }} />
      </svg>
      <div>
        <div className="text-2xl font-semibold leading-none">{value.toFixed(3)}</div>
        <div className="text-xs text-ink-3 mt-1">{label}</div>
      </div>
    </div>
  );
}
