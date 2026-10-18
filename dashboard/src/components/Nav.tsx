"use client";
import { useEffect, useState } from "react";
import { Pill } from "./Panel";
import { api } from "@/lib/api";
import { RibbonS, Wordmark } from "./Logo";

export function Nav({ connected, mode, setMode }: { connected: boolean; mode: string; setMode: (m: string) => void }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => { setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark"); }, []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("settld_theme", next); } catch {  }
  };
  return (
    <header className="sticky top-0 z-10 bg-bg/90 backdrop-blur border-b border-line">
      <div className="max-w-[1400px] mx-auto px-8 h-16 flex items-center gap-8">
        <div className="flex items-center gap-2.5">
          <RibbonS size={26} />
          <Wordmark className="text-[22px] leading-none" />
          <span className="text-ink-3 text-xs hidden xl:inline">Ask. Approve. Settld.</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1 bg-surface rounded-full p-1">
            <Pill active={mode === "live"} onClick={() => setMode("live")}>Live</Pill>
            <Pill active={mode === "test"} onClick={() => setMode("test")} tone="down">Test</Pill>
          </div>
          {mode === "test" && (
            <button onClick={() => { if (confirm("Forget every account and counter? Chain state stays.")) void api.reset(); }}
              className="text-xs text-ink-2 px-2.5 py-1 rounded-full border border-line hover:text-ink hover:border-ink-3">Reset demo</button>
          )}
          <button onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}
            className="w-8 h-8 rounded-full border border-line flex items-center justify-center text-ink-2 hover:text-ink hover:border-ink-3">
            {theme === "dark"
              ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>}
          </button>
          <span className="text-xs text-ink-2 px-2.5 py-1 rounded-full border border-line">Devnet</span>
          <span className={`flex items-center gap-2 text-xs font-medium ${connected ? "text-ink" : "text-down"}`}>
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-up" : "bg-down"}`} />
            {connected ? "LIVE" : "OFFLINE"}
          </span>
        </div>
      </div>
    </header>
  );
}
