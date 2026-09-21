import Link from "next/link";
import { redirect } from "next/navigation";
import { IconInfoCircle } from "@tabler/icons-react";

import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { buildPaymentReceiptPageUrl, getReceiptData } from "@/lib/receipts";

type ReceiptPageProps = {
  params: Promise<{
    submissionId: string;
  }>;
};

export default async function ReceiptPage({ params }: ReceiptPageProps) {
  const [locale, viewer, { submissionId }] = await Promise.all([
    getCurrentLocale(),
    requireCompletedViewer(),
    params,
  ]);
  const receipt = await getReceiptData({
    submissionId,
    viewerId: viewer.id,
    viewerRole: viewer.role,
  });

  if (!receipt) {
    return (
      <main className="shell px-4 py-12 sm:px-6">
        <section className="card mx-auto max-w-xl p-6 text-center sm:p-8">
          <IconInfoCircle className="mx-auto text-[var(--accent)]" size={34} />
          <h1 className="mt-4 font-serif text-3xl text-[var(--foreground)]">
            {locale === "it" ? "Ricevuta non disponibile" : "Receipt unavailable"}
          </h1>
          <p className="mt-3 leading-7 text-[var(--muted)]">
            {locale === "it"
              ? "Non è disponibile una ricevuta per questa scheda oppure non hai l'accesso necessario."
              : "There is no receipt available for this listing, or you do not have access to it."}
          </p>
          <Link href="/dashboard" className="btn-secondary mt-6">
            {locale === "it" ? "Torna alla dashboard" : "Back to dashboard"}
          </Link>
        </section>
      </main>
    );
  }

  if (receipt) redirect(buildPaymentReceiptPageUrl(receipt.payment.id));

  return (
    <main className="shell px-4 py-12 sm:px-6">
      <section className="card mx-auto max-w-xl p-6 text-center sm:p-8">
        <h1 className="mt-4 font-serif text-3xl text-[var(--foreground)]">
          {locale === "it" ? "Ricevuta non disponibile" : "Receipt unavailable"}
        </h1>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          {locale === "it"
            ? "Questo link storico non identifica in modo univoco una ricevuta. Apri lo storico pagamenti per scegliere la transazione corretta."
            : "This historical link does not uniquely identify a receipt. Open payment history and choose the correct transaction."}
        </p>
        <Link href="/dashboard/payment-history" className="btn-primary mt-6">{locale === "it" ? "Apri storico pagamenti" : "Open payment history"}</Link>
      </section>
    </main>
  );
}
