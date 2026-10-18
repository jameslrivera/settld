"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AuthEvent } from "@/lib/feed";
import { usd, mask } from "@/lib/format";

const CENTER: [number, number] = [33.7548, -84.3865];
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const HOLD_MS = 7000;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function AtlantaMap({ events, height = 210 }: { events: AuthEvent[]; height?: number | string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const seen = useRef<number>(0);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: CENTER, zoom: 16, zoomControl: true, scrollWheelZoom: true });
    L.tileLayer(TILE_URL, { attribution: ATTR, maxZoom: 19, className: "osm-tiles" }).addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !events.length) return;
    const fresh = events.filter((e) => e.seq > seen.current && e.lat && e.lng).reverse();
    seen.current = Math.max(seen.current, events[0].seq);
    for (const e of fresh) {
      const ok = e.approved;
      const when = new Date(e.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const html = `
        <div class="tap-card ${ok ? "ok" : "bad"}">
          <div class="tap-head"><span class="tap-dot"></span><span class="tap-status">${ok ? "Settled" : "Protected"}</span><span class="tap-time">${when}</span></div>
          <div class="tap-merchant">${esc(e.merchant)}</div>
          ${e.item ? `<div class="tap-item">${esc(e.item)}</div>` : ""}
          <div class="tap-row"><span class="tap-amount">${usd(e.amount_cents)}</span><span class="tap-meta">${mask(e.uid)} · score ${e.score.toFixed(2)} · ${e.latency_ms.toFixed(0)} ms</span></div>
          ${e.explorer ? `<a class="tap-link" href="${e.explorer}" target="_blank" rel="noreferrer">view on Solana Explorer</a>` : ""}
        </div>`;
      const icon = L.divIcon({ html, className: "tap-wrap", iconSize: [220, 0], iconAnchor: [110, 0] });
      const marker = L.marker([e.lat!, e.lng!], { icon, zIndexOffset: 1000 }).addTo(m);
      m.panInside([e.lat!, e.lng!], { padding: [130, 150], animate: true });
      const tone = ok ? "var(--chart)" : "var(--shield)";
      const ring = L.circleMarker([e.lat!, e.lng!], { radius: 5, color: tone, weight: 2, fill: false, opacity: 0.9, interactive: false }).addTo(m);
      let r = 5, t = 0;
      const pulse = setInterval(() => {
        r += 3; t += 1;
        ring.setRadius(r); ring.setStyle({ opacity: Math.max(0, 0.9 - t / 16) });
        if (t >= 16) { clearInterval(pulse); m.removeLayer(ring); }
      }, 50);
      const pin = L.circleMarker([e.lat!, e.lng!], { radius: 5, color: "var(--surface)", fillColor: tone, fillOpacity: 1, weight: 2, interactive: false }).addTo(m);
      setTimeout(() => {
        marker.getElement()?.classList.add("tap-fade");
        setTimeout(() => { m.removeLayer(marker); m.removeLayer(pin); }, 600);
      }, HOLD_MS);
    }
  }, [events]);

  return (
    <div className="relative rounded-xl overflow-hidden" style={{ height }}>
      <div ref={el} className="absolute inset-0" />
      <style>{`
        .leaflet-container { background: var(--surface-2); font-family: inherit; }
        :root:not([data-theme="light"]) .osm-tiles { filter: invert(1) hue-rotate(180deg) brightness(0.62) contrast(1.05) saturate(0.25); }
        :root[data-theme="light"] .osm-tiles { filter: saturate(0.35) contrast(1.02); }
        .leaflet-control-attribution { background: transparent !important; color: var(--ink-3) !important; font-size: 9px; }
        .leaflet-control-attribution a { color: var(--ink-3) !important; }
        .leaflet-bar { border: 1px solid var(--line) !important; box-shadow: none !important; }
        .leaflet-bar a { background: var(--surface) !important; color: var(--ink) !important; border-bottom-color: var(--line) !important; }
        .tap-wrap { background: transparent; border: 0; }
        .tap-card { position: relative; top: 10px; width: 220px; background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; padding: 8px 10px; font-size: 11px; line-height: 1.35; box-shadow: 0 6px 20px rgba(0,0,0,.35); animation: tap-in .25s ease-out; }
        .tap-card::before { content: ""; position: absolute; left: 50%; top: -6px; width: 10px; height: 10px; background: var(--surface); border-left: 1px solid var(--line); border-top: 1px solid var(--line); transform: translateX(-50%) rotate(45deg); }
        .tap-head { display: flex; align-items: center; gap: 6px; }
        .tap-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--up); }
        .bad .tap-dot { background: var(--shield); }
        .tap-status { font-weight: 600; color: var(--up); }
        .bad .tap-status { color: var(--shield); }
        .tap-time { margin-left: auto; color: var(--ink-3); font-variant-numeric: tabular-nums; }
        .tap-merchant { font-weight: 600; font-size: 12px; margin-top: 3px; }
        .tap-item { color: var(--ink-2); }
        .tap-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-top: 4px; }
        .tap-amount { font-weight: 700; font-size: 15px; }
        .bad .tap-amount { color: var(--shield); text-decoration: line-through; }
        .tap-meta { color: var(--ink-3); font-size: 10px; text-align: right; }
        .tap-link { display: inline-block; margin-top: 4px; color: var(--ink-3); text-decoration: underline; font-size: 10px; }
        .tap-fade { transition: opacity .6s; opacity: 0; }
        @keyframes tap-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}
