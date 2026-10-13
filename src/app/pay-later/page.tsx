import type { Metadata } from "next";
import { getCurrentLocale } from "@/lib/locale";
import { PayLaterInvitationShell } from "@/components/account/pay-later-invitation-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PayLaterPage() {
  const locale = await getCurrentLocale();
  return <PayLaterInvitationShell locale={locale} />;
}
