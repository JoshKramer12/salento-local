import Link from "next/link";

import { getCurrentLocale } from "@/lib/locale";
import { getSingleParam } from "@/lib/site";

type PublishPaymentCancelPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PublishPaymentCancelPage({
  searchParams,
}: PublishPaymentCancelPageProps) {
  const locale = await getCurrentLocale();
  const resolvedSearchParams = await searchParams;
  const submissionId = getSingleParam(resolvedSearchParams.submission);
  const retryHref = submissionId
    ? `/publish/payment?submission=${encodeURIComponent(submissionId)}`
    : "/dashboard";

  return (
    <main className="shell px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <section className="card p-8">
          <p className="section-kicker mb-3">
            {locale === "it" ? "Pagamento annullato" : "Payment canceled"}
          </p>
          <h1 className="font-serif text-4xl text-[var(--foreground)]">
            {locale === "it" ? "Nessun addebito completato" : "No charge was completed"}
          </h1>
          <p className="mt-4 text-[var(--muted)]">
            {locale === "it"
              ? "Puoi tornare al passaggio pagamento e scegliere di riprovare quando vuoi."
              : "You can return to the payment step and try again whenever you are ready."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={retryHref} className="btn-primary">
              {locale === "it" ? "Torna al pagamento" : "Back to payment"}
            </Link>
            <Link href="/dashboard" className="btn-secondary">
              {locale === "it" ? "Vai alla dashboard" : "Go to dashboard"}
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
