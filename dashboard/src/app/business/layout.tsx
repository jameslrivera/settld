import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settld Business" };

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
