import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";

import { requireCompletedViewer } from "@/lib/auth-guards";
import { canManageBusiness } from "@/lib/business-owner-access";
import { getCurrentLocale } from "@/lib/locale";
import { ensureMembershipRenewalBankTransferIntent } from "@/lib/membership-renewal-checkout";
import { getSingleParam } from "@/lib/site";
import { isStripeSandboxMode } from "@/lib/stripe";

export default async function MembershipBankTransferPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireCompletedViewer();
  const locale = await getCurrentLocale();
  const it = locale === "it";
  const businessId = getSingleParam((await searchParams).business)?.trim();
  if (!businessId || !(await canManageBusiness({ businessId, userId: viewer.id }))) redirect("/dashboard");
  const transfer = await ensureMembershipRenewalBankTransferIntent({ businessId, userId: viewer.id });
  if (!transfer) redirect("/dashboard?membership=unavailable");
  const instructions = transfer.instructions;
  const qr = instructions?.hostedInstructionsUrl
    ? await QRCode.toDataURL(instructions.hostedInstructionsUrl, { margin: 1, width: 240 }) : null;

  return <main className="shell px-4 py-12 sm:px-6"><section className="card mx-auto max-w-2xl p-6 sm:p-8">
    <p className="section-kicker">{it ? "Pagamento manuale della membership" : "Manual membership payment"}</p>
    <h1 className="mt-3 font-serif text-4xl text-[var(--foreground)]">{it ? "Completa il bonifico" : "Complete your bank transfer"}</h1>
    <p className="mt-4 leading-7 text-[var(--muted)]">{it
      ? "La scheda manterrà il suo stato attuale finché Stripe non confermerà il bonifico. Il rinnovo automatico è disponibile solo con carta."
      : "Your Business Page stays in its current lifecycle state until Stripe confirms the transfer. Automatic renewal is available by card only."}</p>
    {isStripeSandboxMode() ? <p className="mt-4 text-sm text-[var(--muted)]">{it
      ? "Durante questa anteprima i pagamenti sono simulati: non inviare denaro reale."
      : "During this preview, payments are simulated: do not send real money."}</p> : null}
    {instructions ? <div className="mt-6 rounded-2xl border border-[var(--border)] p-5 text-sm">
      <p><strong>{it ? "Importo" : "Amount"}:</strong> {new Intl.NumberFormat(it ? "it-IT" : "en-IE", { style: "currency", currency: "EUR" }).format(instructions.amountRemainingCents / 100)}</p>
      <p className="mt-2"><strong>{it ? "Beneficiario" : "Account holder"}:</strong> {instructions.accountHolderName}</p>
      <p className="mt-2 break-all"><strong>IBAN:</strong> {instructions.iban}</p>
      <p className="mt-2"><strong>BIC:</strong> {instructions.bic}</p>
      <p className="mt-2 break-all"><strong>{it ? "Riferimento" : "Reference"}:</strong> {instructions.reference}</p>
      {qr ? <img src={qr} alt={it ? "QR delle istruzioni per il bonifico" : "Bank transfer instructions QR"} className="mt-5 h-40 w-40 rounded-xl bg-white p-2" /> : null}
      <a className="btn-primary mt-5" href={instructions.hostedInstructionsUrl} rel="noreferrer" target="_blank">{it ? "Apri le istruzioni Stripe" : "Open Stripe payment instructions"}</a>
    </div> : <p className="mt-6 rounded-2xl bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">{it
      ? "Stripe sta preparando le istruzioni per il bonifico. Aggiorna questa pagina tra poco."
      : "Stripe is preparing your bank transfer instructions. Please refresh this page shortly."}</p>}
    <Link className="btn-secondary mt-6" href="/dashboard">{it ? "Torna alla dashboard" : "Back to dashboard"}</Link>
  </section></main>;
}
