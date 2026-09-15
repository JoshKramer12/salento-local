import Link from "next/link";
import { redirect } from "next/navigation";

import { requireCompletedViewer } from "@/lib/auth-guards";
import { canManageBusiness } from "@/lib/business-owner-access";
import { ensureMembershipRenewalBankTransferIntent } from "@/lib/membership-renewal-checkout";
import { getSingleParam } from "@/lib/site";

export default async function MembershipBankTransferPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireCompletedViewer();
  const businessId = getSingleParam((await searchParams).business)?.trim();
  if (!businessId || !(await canManageBusiness({ businessId, userId: viewer.id }))) redirect("/dashboard");
  const transfer = await ensureMembershipRenewalBankTransferIntent({ businessId, userId: viewer.id });
  if (!transfer) redirect("/dashboard?membership=unavailable");
  const instructions = transfer.instructions;
  return <main className="shell px-4 py-12 sm:px-6"><section className="card mx-auto max-w-2xl p-6 sm:p-8"><p className="section-kicker">Manual membership payment</p><h1 className="mt-3 font-serif text-4xl text-[var(--foreground)]">Renew by bank transfer</h1><p className="mt-4 leading-7 text-[var(--muted)]">Your Business Page stays in its current lifecycle state until Stripe confirms the transfer. Automatic renewal is available by card only.</p>{instructions ? <div className="mt-6 rounded-2xl border border-[var(--border)] p-5 text-sm"><p><strong>Amount:</strong> €{(instructions.amountRemainingCents / 100).toFixed(2)}</p><p className="mt-2"><strong>Account holder:</strong> {instructions.accountHolderName}</p><p className="mt-2"><strong>IBAN:</strong> {instructions.iban}</p><p className="mt-2"><strong>BIC:</strong> {instructions.bic}</p><p className="mt-2"><strong>Reference:</strong> {instructions.reference}</p><a className="btn-primary mt-5" href={instructions.hostedInstructionsUrl} rel="noreferrer" target="_blank">Open Stripe payment instructions</a></div> : <p className="mt-6 rounded-2xl bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">Stripe is preparing your bank-transfer instructions. Please refresh this page shortly.</p>}<Link className="btn-secondary mt-6" href="/dashboard">Back to dashboard</Link></section></main>;
}
