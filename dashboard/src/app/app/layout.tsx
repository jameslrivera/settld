import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Settld",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Settld" },
};
export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1, maximumScale: 1 };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
