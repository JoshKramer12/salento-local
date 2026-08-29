import Link from "next/link";
import { redirect } from "next/navigation";
import { IconFileDescription, IconInfoCircle } from "@tabler/icons-react";

import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { getReceiptData } from "@/lib/receipts";
import { getStripeHostedReceiptUrl } from "@/lib/stripe-receipts";

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

  const stripeReceiptUrl = await getStripeHostedReceiptUrl(receipt.payment);

  if (stripeReceiptUrl) redirect(stripeReceiptUrl);

  return (
    <main className="shell px-4 py-12 sm:px-6">
      <section className="card mx-auto max-w-xl p-6 text-center sm:p-8">
        <IconFileDescription className="mx-auto text-[var(--primary)]" size={34} />
        <h1 className="mt-4 font-serif text-3xl text-[var(--foreground)]">
          {locale === "it" ? "Ricevuta Salento Local" : "Salento Local receipt"}
        </h1>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          {locale === "it"
            ? "Stripe non ha una ricevuta ospitata per questo pagamento. Puoi aprire la ricevuta Salento Local conservata in modo sicuro."
            : "Stripe does not have a hosted receipt for this payment. You can open the securely retained Salento Local receipt."}
        </p>
        <a href={`/api/receipts/${encodeURIComponent(submissionId)}`} className="btn-primary mt-6">
          <IconFileDescription size={19} /> {locale === "it" ? "Apri ricevuta PDF" : "Open PDF receipt"}
        </a>
      </section>
    </main>
  );
}
