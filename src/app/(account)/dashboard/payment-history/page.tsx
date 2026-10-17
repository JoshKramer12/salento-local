import { IconFileDescription, IconReceipt } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { HardNavigationLink } from "@/components/hard-navigation-link";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type Status = "NOT_REQUIRED" | "PENDING_PAYMENT" | "AWAITING_BANK_TRANSFER" | "PAID" | "FAILED" | "REFUNDED";

const pageCopy = {
  en: {
    agreementDescription: "Your original signed membership agreement.", agreementMissing: "No signed membership agreement is available for this business.", agreementTitle: "Signed membership agreement", amount: "Amount", back: "Back to dashboard", documents: "Documents", empty: "There are no payments for this business yet.", historyDescription: "Your membership payments, newest first.", historyTitle: "Payment history", membershipDocument: "Membership document", method: "Payment method", noBusinessDescription: "Choose a business from your dashboard to view its payments and documents.", receiptDescription: "Official proof of payment.", receiptPending: "Available once payment is completed.", receiptTitle: "Payment receipt", signedOn: "Signed on", subtitle: "View your membership payments, receipts and signed agreement.", title: "Payments & Documents", view: "View", viewDocument: "View document",
  },
  it: {
    agreementDescription: "Il tuo accordo di adesione originale firmato.", agreementMissing: "Non è disponibile un accordo di adesione firmato per questa attività.", agreementTitle: "Accordo di adesione firmato", amount: "Importo", back: "Torna alla dashboard", documents: "Documenti", empty: "Non ci sono ancora pagamenti per questa attività.", historyDescription: "I tuoi pagamenti della membership, dal più recente.", historyTitle: "Storico pagamenti", membershipDocument: "Documento della membership", method: "Metodo di pagamento", noBusinessDescription: "Scegli un'attività dalla dashboard per visualizzare i suoi pagamenti e documenti.", receiptDescription: "Prova ufficiale di questo pagamento.", receiptPending: "Disponibile quando il pagamento sarà completato.", receiptTitle: "Ricevuta di pagamento", signedOn: "Firmato il", subtitle: "Visualizza i pagamenti della membership, le ricevute e l'accordo firmato.", title: "Pagamenti e documenti", view: "Visualizza", viewDocument: "Visualizza documento",
  },
} as const;

type PageCopy = Record<keyof typeof pageCopy.en, string>;

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
  const copy = pageCopy[locale];
  if (viewer.role !== "BUSINESS_OWNER") return <main className="shell px-4 py-12 sm:px-6" />;

  const businesses = await prisma.business.findMany({
    where: { OR: [{ ownerUserId: viewer.id }, { ownerAccesses: { some: { userId: viewer.id } } }] },
    orderBy: { name: "asc" }, select: { name: true, slug: true },
  });
  const requestedSlug = getSingleParam(params.business);
  const business = requestedSlug ? businesses.find((entry) => entry.slug === requestedSlug) : businesses.length === 1 ? businesses[0] : null;
  if (!business) return <BusinessPicker businesses={businesses} copy={copy} />;

  const payments = await prisma.payment.findMany({
    where: {
      OR: [
        { business: { is: { slug: business.slug } } },
        { businessId: null, businessSubmission: { is: { createdBusiness: { is: { slug: business.slug } } } } },
      ],
    },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    select: {
      amountCents: true, createdAt: true, currency: true, id: true, method: true, paidAt: true, purpose: true, status: true, refundRequestedAt: true, refundStatus: true, refundedAt: true, refundedAmountCents: true, stripeLivemode: true,
      businessSubmission: { select: { agreementSignature: true, businessTermsAcceptedAt: true, id: true, signedAt: true } },
    },
  });
  const agreementPayment = payments.find((payment) => payment.purpose === "INITIAL_MEMBERSHIP" && payment.businessSubmission.agreementSignature && (payment.businessSubmission.signedAt || payment.businessSubmission.businessTermsAcceptedAt));

  return <main className="shell px-4 py-8 sm:px-6 sm:py-12">
    <div className="mx-auto max-w-[920px]">
      <HardNavigationLink href="/dashboard" className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--foreground)] hover:text-[var(--primary)] hover:underline">← {copy.back}</HardNavigationLink>
      <header className="mt-4">
        <h1 className="font-serif text-4xl leading-tight text-[var(--foreground)] sm:text-5xl">{copy.title}</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)] sm:text-lg">{copy.subtitle}</p>
        <p className="mt-4 text-base font-semibold text-[var(--foreground)]">{business.name}</p>
      </header>

      {agreementPayment ? <section aria-labelledby="membership-document" className="mt-6 rounded-[1.25rem] border border-[rgba(42,98,87,0.2)] bg-[linear-gradient(135deg,rgba(237,248,242,0.82),rgba(250,253,250,0.72))] p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">{copy.membershipDocument}</p>
        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/70 text-[var(--primary)] sm:h-14 sm:w-14"><IconFileDescription size={28} aria-hidden="true" /></span><div className="min-w-0"><h2 id="membership-document" className="font-serif text-2xl text-[var(--foreground)]">{copy.agreementTitle}</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{copy.agreementDescription}</p><p className="mt-3 text-sm font-medium text-[var(--foreground)]">{copy.signedOn} {date(locale, agreementPayment.businessSubmission.signedAt ?? agreementPayment.businessSubmission.businessTermsAcceptedAt)}</p></div></div>
          <HardNavigationLink href={`/agreements/${encodeURIComponent(agreementPayment.businessSubmission.id)}`} className="btn-secondary min-h-12 shrink-0 justify-center px-5">{copy.viewDocument} →</HardNavigationLink>
        </div>
      </section> : <section aria-labelledby="membership-document" className="mt-6 border-l-2 border-[rgba(42,98,87,0.24)] pl-4 sm:pl-5"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--primary)]">{copy.membershipDocument}</p><h2 id="membership-document" className="mt-2 font-serif text-2xl text-[var(--foreground)]">{copy.agreementTitle}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">{copy.agreementMissing}</p></section>}

      <section aria-labelledby="payment-history" className="mt-10 sm:mt-12">
        <h2 id="payment-history" className="font-serif text-3xl text-[var(--foreground)] sm:text-4xl">{copy.historyTitle}</h2>
        <p className="mt-2 text-base leading-7 text-[var(--muted)]">{copy.historyDescription}</p>
        {payments.length ? <div className="mt-5 grid gap-3 sm:mt-6 sm:gap-4">{payments.map((payment) => <PaymentCard copy={copy} italian={italian} key={payment.id} locale={locale} payment={payment} />)}</div> : <p className="mt-5 border-y border-[var(--border)] py-5 text-sm leading-6 text-[var(--muted)]">{copy.empty}</p>}
      </section>
    </div>
  </main>;
}

function BusinessPicker({ businesses, copy }: { businesses: Array<{ name: string; slug: string }>; copy: PageCopy }) {
  return <main className="shell px-4 py-8 sm:px-6 sm:py-12"><div className="mx-auto max-w-[920px]"><HardNavigationLink href="/dashboard" className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--foreground)] hover:text-[var(--primary)] hover:underline">← {copy.back}</HardNavigationLink><header className="mt-4"><h1 className="font-serif text-4xl leading-tight text-[var(--foreground)] sm:text-5xl">{copy.title}</h1><p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)] sm:text-lg">{copy.noBusinessDescription}</p></header>{businesses.length ? <div className="mt-7 grid gap-3 sm:grid-cols-2">{businesses.map((business) => <HardNavigationLink className="btn-secondary min-h-12 justify-center px-5" href={`/dashboard/payment-history?business=${encodeURIComponent(business.slug)}`} key={business.slug}>{business.name}</HardNavigationLink>)}</div> : null}</div></main>;
}

type PaymentCardProps = { copy: PageCopy; italian: boolean; locale: "en" | "it"; payment: { amountCents: number; createdAt: Date; currency: string; id: string; method: "STRIPE_CHECKOUT" | "BANK_TRANSFER"; paidAt: Date | null; purpose: "INITIAL_MEMBERSHIP" | "ANNUAL_RENEWAL" | "REACTIVATION"; status: Status; refundRequestedAt: Date | null; refundStatus: string | null; refundedAt: Date | null; refundedAmountCents: number | null; stripeLivemode: boolean | null; businessSubmission: { agreementSignature: string | null; businessTermsAcceptedAt: Date | null; id: string; signedAt: Date | null } } };

function PaymentCard({ copy, italian, locale, payment }: PaymentCardProps) {
  const receiptAvailable = payment.status === "PAID" || payment.status === "REFUNDED";
  const agreementAvailable = payment.purpose === "INITIAL_MEMBERSHIP" && Boolean(payment.businessSubmission.agreementSignature && (payment.businessSubmission.signedAt || payment.businessSubmission.businessTermsAcceptedAt));
  return <article className="rounded-[1.2rem] border border-[var(--border)] bg-white p-5 shadow-[0_4px_14px_rgba(66,51,31,0.025)] sm:p-6"><div className="grid gap-6 md:grid-cols-[minmax(0,1.62fr)_minmax(16.5rem,1fr)] md:gap-6"><div className="min-w-0"><div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3"><div className="min-w-0"><h3 className="font-serif text-2xl leading-tight text-[var(--foreground)]">{purpose(payment.purpose, italian)}</h3>{payment.stripeLivemode === false ? <p className="mt-1 text-xs font-bold text-amber-800">{italian ? "TEST · Nessun addebito reale" : "TEST · No real charge"}</p> : payment.stripeLivemode === null ? <p className="mt-1 text-xs text-[var(--muted)]">{italian ? "Modalità di pagamento non verificata" : "Payment mode unverified"}</p> : null}<p className="mt-1 text-sm text-[var(--muted)]">{date(locale, payment.paidAt ?? payment.createdAt)}</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-bold tracking-[0.08em] ${statusClass(payment.status)}`}>{payment.status === "PAID" && payment.refundRequestedAt ? (payment.refundStatus === "support_closed" ? italian ? "PAGATO · RICHIESTA CHIUSA" : "PAID · REQUEST CLOSED" : payment.method === "BANK_TRANSFER" ? italian ? "RIMBORSO · ASSISTENZA" : "REFUND · PENDING SUPPORT" : payment.refundStatus === "requires_action" ? italian ? "DATI BANCARI NECESSARI" : "BANK DETAILS REQUIRED" : ["failed", "canceled"].includes(payment.refundStatus ?? "") ? italian ? "RIMBORSO NON RIUSCITO" : "REFUND FAILED" : italian ? "RIMBORSO IN ELABORAZIONE" : "REFUND PROCESSING") : status(payment.status, italian)}</span></div><dl className="mt-6 grid gap-4 border-t border-[var(--border)] pt-5 text-sm sm:grid-cols-2"><Detail label={copy.amount}>{amount(locale, payment.amountCents, payment.currency)}</Detail><Detail label={copy.method}>{method(payment.method, italian)}</Detail>{payment.status === "REFUNDED" && payment.refundedAmountCents !== null ? <Detail label={italian ? "Importo rimborsato" : "Refunded amount"}>{amount(locale, payment.refundedAmountCents, payment.currency)}{payment.refundedAt ? ` · ${date(locale, payment.refundedAt)}` : ""}</Detail> : null}</dl></div><section aria-label={copy.documents} className="min-w-0 border-t border-[var(--border)] pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{copy.documents}</p><div className="mt-4 grid gap-5"><DocumentRow action={receiptAvailable ? copy.view : null} description={receiptAvailable ? copy.receiptDescription : copy.receiptPending} href={receiptAvailable ? `/receipts/payment/${encodeURIComponent(payment.id)}` : null} icon={<IconReceipt size={24} aria-hidden="true" />} title={copy.receiptTitle} />{agreementAvailable ? <DocumentRow action={copy.view} description={copy.agreementDescription} href={`/agreements/${encodeURIComponent(payment.businessSubmission.id)}`} icon={<IconFileDescription size={24} aria-hidden="true" />} title={copy.agreementTitle} /> : null}</div></section></div></article>;
}

function Detail({ children, label }: { children: ReactNode; label: string }) {
  return <div><dt className="text-[var(--muted)]">{label}</dt><dd className="mt-1 font-semibold text-[var(--foreground)]">{children}</dd></div>;
}

function DocumentRow({ action, description, href, icon, title }: { action: string | null; description: string; href: string | null; icon: ReactNode; title: string }) {
  return <div className="flex min-w-0 items-start gap-3"><span className="mt-0.5 shrink-0 text-[var(--primary)]">{icon}</span><div className="min-w-0 flex-1"><h4 className="font-semibold text-[var(--foreground)]">{title}</h4><p className="mt-1 text-sm leading-5 text-[var(--muted)]">{description}</p>{action && href ? <HardNavigationLink className="btn-secondary mt-3 min-h-11 px-4" href={href}>{action} →</HardNavigationLink> : null}</div></div>;
}
