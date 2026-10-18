import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Settld Kiosk" };
export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1, maximumScale: 1 };

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
