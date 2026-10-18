"use client";
import type { Notice } from "@/lib/feed";
import { plain } from "@/lib/format";

const TONE: Record<Notice["kind"], { dot: string; ring: string }> = {
  agent: { dot: "bg-lime", ring: "border-lime/40" },
  approval: { dot: "bg-shield", ring: "border-shield/40" },
  approved: { dot: "bg-up", ring: "border-up/40" },
  blocked: { dot: "bg-shield", ring: "border-shield/40" },
  issued: { dot: "bg-lime", ring: "border-lime/40" },
  deposit: { dot: "bg-up", ring: "border-line" },
  frozen: { dot: "bg-warn", ring: "border-warn/40" },
  screened: { dot: "bg-warn", ring: "border-warn/40" },
  withdraw: { dot: "bg-lime", ring: "border-lime/40" },
  closed: { dot: "bg-ink-3", ring: "border-line" },
};

export function Notifications({ notices }: { notices: Notice[] }) {
  if (!notices.length) return null;
  return (
    <div className="fixed right-4 bottom-4 z-50 w-80 space-y-2 pointer-events-none">
      {notices.map((n) => {
        const t = TONE[n.kind];
        const detail = n.kind === "blocked" ? n.detail.replace(/·\s*(\w+)$/, (_, f) => `· ${plain(f)}`) : n.detail;
        return (
          <div key={n.id} className={`pointer-events-auto bg-surface border ${t.ring} rounded-2xl px-4 py-3 shadow-lg animate-[notice-in_.25s_ease-out]`}>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${t.dot}`} />
              <span className="text-sm font-semibold">{n.title}</span>
              <span className="ml-auto text-[12px] text-ink-3">{new Date(n.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            </div>
            <div className="text-xs text-ink-2 mt-1 truncate">{detail}</div>
            {n.href && <a href={n.href} target="_blank" rel="noreferrer" className="text-[12px] text-ink-3 underline">view on Solana</a>}
          </div>
        );
      })}
      <style>{`@keyframes notice-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}
