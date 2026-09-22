import { IconFileDescription, IconReceipt } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { HardNavigationLink } from "@/components/hard-navigation-link";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type Status = "NOT_REQUIRED" | "PENDING_PAYMENT" | "AWAITING_BANK_TRANSFER" | "PAID" | "FAILED" | "REFUNDED";

function date(locale: "en" | "it", value: Date | null) {
  return value ? new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", { dateStyle: "medium" }).format(value) : locale === "it" ? "Data non disponibile" : "Date unavailable";
}

function amount(locale: "en" | "it", cents: number, currency: string) {
  return new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-US", { currency: currency.toUpperCase(), style: "currency" }).format(cents / 100);
}

function purpose(value: "INITIAL_MEMBERSHIP" | "ANNUAL_RENEWAL" | "REACTIVATION", italian: boolean) {
  return italian ? { INITIAL_MEMBERSHIP: "Membership iniziale", ANNUAL_RENEWAL: "Rinnovo annuale", REACTIVATION: "Riattivazione della membership" }[value] : { INITIAL_MEMBERSHIP: "Initial membership", ANNUAL_RENEWAL: "Annual renewal", REACTIVATION: "Membership reactivation" }[value];
}

function method(value: "STRIPE_CHECKOUT" | "BANK_TRANSFER", italian: boolean) {
  return value === "BANK_TRANSFER" ? italian ? "Bonifico bancario" : "Bank transfer" : italian ? "Pagamento online" : "Online payment";
}

function status(value: Status, italian: boolean) {
  return italian ? { NOT_REQUIRED: "NON RICHIESTO", PENDING_PAYMENT: "IN ATTESA", AWAITING_BANK_TRANSFER: "IN ATTESA DI BONIFICO", PAID: "PAGATO", FAILED: "NON RIUSCITO", REFUNDED: "RIMBORSATO" }[value] : { NOT_REQUIRED: "NOT REQUIRED", PENDING_PAYMENT: "PENDING", AWAITING_BANK_TRANSFER: "AWAITING TRANSFER", PAID: "PAID", FAILED: "FAILED", REFUNDED: "REFUNDED" }[value];
}

function statusClass(value: Status) {
  return value === "PAID" ? "bg-[#dff3e4] text-[#17644f]" : value === "REFUNDED" || value === "FAILED" ? "bg-[#f7e3df] text-[#973f36]" : "bg-[#fff0cc] text-[#805100]";
}

export default async function PaymentHistoryPage({ searchParams }: PageProps) {
  const [locale, viewer, params] = await Promise.all([getCurrentLocale(), requireCompletedViewer(), searchParams]);
  const italian = locale === "it";
  if (viewer.role !== "BUSINESS_OWNER") return <main className="shell px-4 py-12 sm:px-6" />;

  const businesses = await prisma.business.findMany({
    where: { OR: [{ ownerUserId: viewer.id }, { ownerAccesses: { some: { userId: viewer.id } } }] },
    orderBy: { name: "asc" }, select: { name: true, slug: true },
  });
  const requestedSlug = getSingleParam(params.business);
  const business = requestedSlug ? businesses.find((entry) => entry.slug === requestedSlug) : businesses.length === 1 ? businesses[0] : null;

  if (!business) return <BusinessPicker businesses={businesses} italian={italian} />;

  const payments = await prisma.payment.findMany({
    where: {
      OR: [
        { business: { is: { slug: business.slug } } },
        { businessId: null, businessSubmission: { is: { createdBusiness: { is: { slug: business.slug } } } } },
      ],
    },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    select: {
      amountCents: true, createdAt: true, currency: true, id: true, method: true, paidAt: true, purpose: true, status: true,
      businessSubmission: { select: { agreementSignature: true, businessTermsAcceptedAt: true, id: true, signedAt: true } },
    },
  });
  const agreementPayment = payments.find((payment) => payment.purpose === "INITIAL_MEMBERSHIP" && payment.businessSubmission.agreementSignature && (payment.businessSubmission.signedAt || payment.businessSubmission.businessTermsAcceptedAt));

  return <main className="shell px-4 py-8 sm:px-6 sm:py-12">
    <HardNavigationLink href="/dashboard" className="text-sm font-semibold text-[var(--primary)] hover:underline">← {italian ? "Torna alla dashboard" : "Back to dashboard"}</HardNavigationLink>
    <section className="mt-5 max-w-4xl rounded-[1.6rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_10px_26px_rgba(66,51,31,0.05)] sm:p-7">
      <p className="section-kicker">{italian ? "AREA ACCOUNT" : "ACCOUNT AREA"}</p>
      <h1 className="mt-2 font-serif text-4xl text-[var(--foreground)]">{italian ? "Pagamenti e documenti" : "Payments & Documents"}</h1>
      <p className="mt-3 max-w-2xl leading-7 text-[var(--muted)]">{italian ? "Visualizza i pagamenti della membership, le ricevute e gli accordi firmati." : "View your membership payments, receipts and signed agreements."}</p>
      <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">{business.name}</p>

      <section aria-labelledby="membership-documents" className="mt-8 rounded-[1.35rem] border border-[rgba(42,98,87,0.18)] bg-[rgba(237,248,242,0.5)] p-4 sm:p-5">
        <p className="section-kicker">{italian ? "DOCUMENTI DELLA MEMBERSHIP" : "MEMBERSHIP DOCUMENTS"}</p>
        <h2 id="membership-documents" className="mt-1 font-serif text-2xl text-[var(--foreground)]">{italian ? "Documenti permanenti" : "Permanent documents"}</h2>
        {agreementPayment ? <article className="mt-4 flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgba(42,98,87,0.1)] text-[var(--primary)]"><IconFileDescription size={21} aria-hidden="true" /></span><div><h3 className="font-semibold text-[var(--foreground)]">{italian ? "Accordo di adesione firmato" : "Signed membership agreement"}</h3><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{italian ? "Il tuo accordo di adesione originale firmato con Salento Local." : "Your original signed Salento Local membership agreement."}</p><p className="mt-2 text-sm font-medium text-[var(--foreground)]">{italian ? "Firmato" : "Signed"} {date(locale, agreementPayment.businessSubmission.signedAt ?? agreementPayment.businessSubmission.businessTermsAcceptedAt)}</p></div></div><HardNavigationLink href={`/agreements/${encodeURIComponent(agreementPayment.businessSubmission.id)}`} className="btn-secondary min-h-11 shrink-0 justify-center">{italian ? "Visualizza accordo" : "View agreement"}</HardNavigationLink></article> : <p className="mt-4 rounded-2xl bg-white/80 p-4 text-sm leading-6 text-[var(--muted)]">{italian ? "Non è disponibile un accordo di adesione firmato per questa attività." : "No signed membership agreement is available for this business."}</p>}
      </section>

      <section aria-labelledby="payment-history" className="mt-8">
        <p className="section-kicker">{italian ? "STORICO PAGAMENTI" : "PAYMENT HISTORY"}</p>
        <h2 id="payment-history" className="mt-1 font-serif text-3xl text-[var(--foreground)]">{italian ? "Pagamenti della membership" : "Membership payments"}</h2>
        {payments.length ? <div className="mt-5 grid gap-3">{payments.map((payment) => <PaymentCard italian={italian} key={payment.id} locale={locale} payment={payment} />)}</div> : <div className="mt-5 rounded-2xl bg-[color:rgba(247,244,239,0.7)] p-5 text-sm leading-6 text-[var(--muted)]">{italian ? "Non ci sono ancora pagamenti per questa attività." : "There are no payments for this business yet."}</div>}
      </section>
    </section>
  </main>;
}

function BusinessPicker({ businesses, italian }: { businesses: Array<{ name: string; slug: string }>; italian: boolean }) {
  return <main className="shell px-4 py-8 sm:px-6 sm:py-12"><HardNavigationLink href="/dashboard" className="text-sm font-semibold text-[var(--primary)] hover:underline">← {italian ? "Torna alla dashboard" : "Back to dashboard"}</HardNavigationLink><section className="mt-5 max-w-4xl rounded-[1.6rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_10px_26px_rgba(66,51,31,0.05)] sm:p-7"><p className="section-kicker">{italian ? "AREA ACCOUNT" : "ACCOUNT AREA"}</p><h1 className="mt-2 font-serif text-4xl text-[var(--foreground)]">{italian ? "Pagamenti e documenti" : "Payments & Documents"}</h1><p className="mt-3 max-w-2xl leading-7 text-[var(--muted)]">{italian ? "Scegli un'attività dalla dashboard per visualizzare i suoi pagamenti e documenti." : "Choose a business from your dashboard to view its payments and documents."}</p>{businesses.length ? <div className="mt-6 grid gap-3 sm:grid-cols-2">{businesses.map((business) => <HardNavigationLink className="btn-secondary min-h-12 justify-center" href={`/dashboard/payment-history?business=${encodeURIComponent(business.slug)}`} key={business.slug}>{business.name}</HardNavigationLink>)}</div> : null}</section></main>;
}

type PaymentCardProps = { italian: boolean; locale: "en" | "it"; payment: { amountCents: number; createdAt: Date; currency: string; id: string; method: "STRIPE_CHECKOUT" | "BANK_TRANSFER"; paidAt: Date | null; purpose: "INITIAL_MEMBERSHIP" | "ANNUAL_RENEWAL" | "REACTIVATION"; status: Status; businessSubmission: { agreementSignature: string | null; businessTermsAcceptedAt: Date | null; id: string; signedAt: Date | null } } };

function PaymentCard({ italian, locale, payment }: PaymentCardProps) {
  const receiptAvailable = payment.status === "PAID" || payment.status === "REFUNDED";
  const agreementAvailable = payment.purpose === "INITIAL_MEMBERSHIP" && Boolean(payment.businessSubmission.agreementSignature && (payment.businessSubmission.signedAt || payment.businessSubmission.businessTermsAcceptedAt));
  return <article className="rounded-[1.35rem] border border-[var(--border)] bg-white p-4 shadow-[0_6px_18px_rgba(66,51,31,0.035)] sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-serif text-2xl text-[var(--foreground)]">{purpose(payment.purpose, italian)}</h3><p className="mt-1 text-sm text-[var(--muted)]">{date(locale, payment.paidAt ?? payment.createdAt)}</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-bold tracking-[0.08em] ${statusClass(payment.status)}`}>{status(payment.status, italian)}</span></div><div className="mt-5 grid gap-3 border-y border-[var(--border)] py-4 text-sm sm:grid-cols-2"><div><p className="text-[var(--muted)]">{italian ? "Importo" : "Amount"}</p><p className="mt-1 font-semibold text-[var(--foreground)]">{amount(locale, payment.amountCents, payment.currency)}</p></div><div><p className="text-[var(--muted)]">{italian ? "Metodo di pagamento" : "Payment method"}</p><p className="mt-1 font-semibold text-[var(--foreground)]">{method(payment.method, italian)}</p></div></div><div className="mt-4"><p className="section-kicker">{italian ? "DOCUMENTI" : "DOCUMENTS"}</p><div className="mt-3 grid gap-3">{receiptAvailable ? <DocumentRow icon={<IconReceipt size={20} aria-hidden="true" />} title={italian ? "Ricevuta di pagamento" : "Payment receipt"} description={italian ? "Prova ufficiale di questo pagamento." : "Official proof of payment."} action={italian ? "Visualizza" : "View"} href={`/receipts/payment/${encodeURIComponent(payment.id)}`} /> : <p className="text-sm leading-6 text-[var(--muted)]">{italian ? "La ricevuta sarà disponibile quando il pagamento sarà completato." : "A receipt will be available when this payment is completed."}</p>}{agreementAvailable ? <DocumentRow icon={<IconFileDescription size={20} aria-hidden="true" />} title={italian ? "Accordo di adesione firmato" : "Signed membership agreement"} description={italian ? "I termini della membership da te firmati." : "Your signed membership terms."} action={italian ? "Visualizza" : "View"} href={`/agreements/${encodeURIComponent(payment.businessSubmission.id)}`} /> : null}</div></div></article>;
}

function DocumentRow({ action, description, href, icon, title }: { action: string; description: string; href: string; icon: ReactNode; title: string }) {
  return <div className="flex flex-col gap-3 rounded-xl bg-[rgba(247,244,239,0.66)] p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-start gap-3"><span className="mt-0.5 shrink-0 text-[var(--primary)]">{icon}</span><div><h4 className="font-semibold text-[var(--foreground)]">{title}</h4><p className="mt-1 text-sm leading-5 text-[var(--muted)]">{description}</p></div></div><HardNavigationLink className="btn-secondary min-h-11 shrink-0 justify-center" href={href}>{action} →</HardNavigationLink></div>;
}
