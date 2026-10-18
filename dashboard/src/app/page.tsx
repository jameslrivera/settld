"use client";
import { useFeed } from "@/lib/feed";
import { api, WS_URL } from "@/lib/api";
import { Nav } from "@/components/Nav";
import { PlatformTab } from "@/components/PlatformTab";
import { Notifications } from "@/components/Notifications";

export default function Home() {
  const { tape, declines, stats, accounts, notices, agents, pendingIntents } = useFeed(WS_URL);

  return (
    <>
      <Nav connected={stats.connected} mode={stats.mode} setMode={(m) => { void api.setMode(m); }} />
      <main className="max-w-[1600px] mx-auto px-6 py-4">
        <PlatformTab tape={tape} declines={declines} stats={stats} accounts={accounts} agents={agents} pendingIntents={pendingIntents} />
      </main>
      <Notifications notices={notices} />
    </>
  );
}
