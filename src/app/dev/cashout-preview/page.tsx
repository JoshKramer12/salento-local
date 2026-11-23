import Link from "next/link";
import { notFound } from "next/navigation";
import { PartnerCashoutPanel } from "@/components/account/partner-cashout-panel";
import { PartnerDashboard } from "@/components/account/partner-dashboard";
import { cashoutPreviewFixture, cashoutPreviewScenarios, type CashoutPreviewScenario } from "@/lib/partner-cashout-fixtures";
import { projectRecentTransactions } from "@/lib/partner-recent-transactions";

export default async function CashoutPreviewPage({ searchParams }: {
  searchParams: Promise<{ scenario?: string; locale?: string; surface?: string }>;
}) {
  if (process.env.NODE_ENV === "production" || process.env.PARTNER_CASHOUT_PREVIEW_ENABLED !== "true") notFound();
  const params = await searchParams;
  const scenario = cashoutPreviewScenarios.includes(params.scenario as CashoutPreviewScenario)
    ? params.scenario as CashoutPreviewScenario : "one-seventy-five";
  const locale = params.locale === "it" ? "it" : "en";
  const view = cashoutPreviewFixture(scenario);
  if (params.surface === "dashboard") {
    const pending = scenario === "pending" ? [{
      id: "synthetic-pending", amountCents: 5000, sourceKey: "synthetic-pending", status: "PENDING", type: "COMMISSION",
      business: { name: "Synthetic business" }, businessId: null, businessSubmission: null, businessSubmissionId: null,
      createdAt: new Date("2026-11-20T12:00:00Z"), earnedAt: new Date("2026-11-20T12:00:00Z"), eligibleAt: new Date("2026-12-04T12:00:00Z"), reversedAt: null, currency: "eur",
      payment: { paidAt: new Date("2026-11-20T12:00:00Z"), purpose: "INITIAL_MEMBERSHIP" as const, status: "PAID" as const,
        refundRequestedAt: null, refundStatus: null, stripeLivemode: true },
    }] : [];
    const recentTransactions = projectRecentTransactions({ commissions: pending, reversals: [],
      withdrawals: [], statusEvents: [], payableIds: new Set(), paymentLivemode: true, locale });
    return <PartnerDashboard now="2026-11-20T12:00:00Z" cashoutView={view} commissionLedger={pending} holdDays={14} locale={locale} preview recentTransactions={recentTransactions} setup={{ setupState: view.destinationReady ? "ready" : "setup-not-started", payoutsEnabled: view.destinationReady }} submissions={[]} totals={{ drafts: 0 }} username="Partner" />;
  }
  return <main className="shell min-h-screen space-y-6 px-4 py-8 sm:px-6">
    <div><p className="section-kicker">Synthetic local preview</p><h1 className="mt-2 font-serif text-3xl">Partner Cash Out</h1><p className="mt-2 text-sm text-[var(--muted)]">No customer data or provider calls are used here.</p></div>
    <nav className="flex flex-wrap gap-2" aria-label="Preview scenarios">{cashoutPreviewScenarios.map((item) => <Link key={item} href={`/dev/cashout-preview?scenario=${item}&locale=${locale}`} className={`rounded-full border px-3 py-2 text-sm ${item === scenario ? "border-[var(--primary)] text-[var(--primary)]" : "border-[var(--border)]"}`}>{item}</Link>)}<Link href={`/dev/cashout-preview?scenario=${scenario}&locale=${locale === "it" ? "en" : "it"}`} className="rounded-full border border-[var(--border)] px-3 py-2 text-sm">{locale === "it" ? "English" : "Italiano"}</Link></nav>
    <PartnerCashoutPanel view={view} locale={locale} preview />
  </main>;
}
