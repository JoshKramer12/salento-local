import { IconReceipt } from "@tabler/icons-react";

import { HardNavigationLink } from "@/components/hard-navigation-link";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";

type PaymentHistoryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatDate(locale: "en" | "it", value: Date | null) {
  if (!value) return locale === "it" ? "Data non disponibile" : "Date unavailable";
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", { dateStyle: "medium" }).format(value);
}

function formatAmount(locale: "en" | "it", cents: number, currency: string) {
  return new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-US", {
    currency: currency.toUpperCase(),
    style: "currency",
  }).format(cents / 100);
}

export default async function PaymentHistoryPage({ searchParams }: PaymentHistoryPageProps) {
  const [locale, viewer, params] = await Promise.all([
    getCurrentLocale(),
    requireCompletedViewer(),
    searchParams,
  ]);
  const italian = locale === "it";
  const selectedBusiness = getSingleParam(params.business);

  if (viewer.role !== "BUSINESS_OWNER") {
    return <main className="shell px-4 py-12 sm:px-6" />;
  }

  const payments = await prisma.payment.findMany({
    where: {
      status: "PAID",
      OR: [
        {
          business: {
            is: {
              OR: [
                { ownerUserId: viewer.id },
                { ownerAccesses: { some: { userId: viewer.id } } },
              ],
            },
          },
        },
        {
          businessSubmission: {
            is: {
              createdBusiness: {
                is: {
                  OR: [
                    { ownerUserId: viewer.id },
                    { ownerAccesses: { some: { userId: viewer.id } } },
                  ],
                },
              },
            },
          },
        },
      ],
    },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    select: {
      amountCents: true,
      business: { select: { name: true, slug: true } },
      businessSubmission: { select: { businessName: true, id: true } },
      createdAt: true,
      currency: true,
      id: true,
      method: true,
      paidAt: true,
    },
  });
  const visiblePayments = selectedBusiness
    ? payments.filter((payment) => payment.business?.slug === selectedBusiness)
    : payments;

  return (
    <main className="shell px-4 py-8 sm:px-6 sm:py-12">
      <HardNavigationLink href="/dashboard" className="text-sm font-semibold text-[var(--primary)] hover:underline">
        ← {italian ? "Torna alla dashboard" : "Back to dashboard"}
      </HardNavigationLink>
      <section className="mt-5 max-w-4xl rounded-[1.6rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_10px_26px_rgba(66,51,31,0.05)] sm:p-7">
        <p className="section-kicker mb-2">{italian ? "AREA ACCOUNT" : "ACCOUNT AREA"}</p>
        <h1 className="font-serif text-4xl text-[var(--foreground)]">{italian ? "Storico pagamenti" : "Payment history"}</h1>
        <p className="mt-3 max-w-2xl leading-7 text-[var(--muted)]">{italian ? "Qui trovi solo i pagamenti completati per le attività a cui hai accesso." : "This page shows only completed payments for businesses you are authorised to manage."}</p>

        {visiblePayments.length ? <div className="mt-7 divide-y divide-[var(--border)]">{visiblePayments.map((payment) => <article key={payment.id} className="flex flex-col gap-4 py-5 first:pt-0 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[color:rgba(42,98,87,0.1)] text-[var(--primary)]"><IconReceipt size={21} /></span><div className="min-w-0"><h2 className="truncate font-serif text-2xl text-[var(--foreground)]">{payment.business?.name ?? payment.businessSubmission.businessName}</h2><p className="mt-1 text-sm text-[var(--muted)]">{formatDate(locale, payment.paidAt ?? payment.createdAt)} · {payment.method === "BANK_TRANSFER" ? (italian ? "Bonifico bancario" : "Bank transfer") : (italian ? "Pagamento online" : "Online payment")}</p></div></div><div className="flex items-center gap-4 sm:text-right"><strong className="font-serif text-2xl text-[var(--foreground)]">{formatAmount(locale, payment.amountCents, payment.currency)}</strong><HardNavigationLink href={`/receipts/${payment.businessSubmission.id}`} className="btn-secondary min-h-10 whitespace-nowrap">{italian ? "Ricevuta" : "Receipt"}</HardNavigationLink></div></article>)}</div> : <div className="mt-7 rounded-2xl bg-[color:rgba(247,244,239,0.7)] p-5 text-sm leading-6 text-[var(--muted)]">{italian ? "Non ci sono ancora pagamenti completati per questa attività." : "There are no completed payments for this business yet."}</div>}
      </section>
    </main>
  );
}
