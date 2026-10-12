import { redirect } from "next/navigation";
import { PartnerCashoutConfirmation } from "@/components/account/partner-cashout-confirmation";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { getPartnerWithdrawalDashboard } from "@/lib/partner-withdrawal-dashboard";

export default async function CashoutConfirmationPage() {
  const viewer = await requireCompletedViewer();
  if (viewer.role !== "GETTER") redirect("/dashboard");
  const [locale, data] = await Promise.all([getCurrentLocale(), getPartnerWithdrawalDashboard(viewer.id)]);
  return <PartnerCashoutConfirmation locale={locale} initialData={data} />;
}
