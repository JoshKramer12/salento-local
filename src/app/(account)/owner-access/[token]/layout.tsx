import type { Metadata } from "next";

export const metadata: Metadata = { referrer: "no-referrer" };

export default function OwnerAccessLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
