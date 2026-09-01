import type { PaymentMethod, PaymentStatus } from "@prisma/client";

import {
  confirmBankTransferReceivedAction,
  publishSubmissionAction,
} from "@/app/(account)/actions";
import { DraftDeleteButton } from "@/components/account/draft-delete-button";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import {
  getSubmissionPaymentSummary,
  getSubmissionStatusLabel,
  getSubmissionStatusTone,
  isDraftLikeSubmission,
} from "@/lib/account";
import type { Locale } from "@/lib/i18n";

type SubmissionListItem = {
  amountOwedCents: number;
  amountPaidCents: number;
  businessName: string;
  bankTransferReference?: string | null;
  categoryName: string;
  createdAt: Date;
  createdBusinessSlug?: string | null;
  id: string;
  paymentMethod?: PaymentMethod | null;
  paymentStatus: PaymentStatus;
  status: Parameters<typeof getSubmissionStatusLabel>[0];
  townName: string;
  userName?: string;
};

type SubmissionListProps = {
  isAdmin?: boolean;
  locale: Locale;
  role?: "ADMIN" | "BUSINESS_OWNER" | "GETTER" | "USER";
  returnPath?: string;
  submissions: SubmissionListItem[];
  showOwner?: boolean;
};

export function SubmissionList({
  isAdmin = false,
  locale,
  role = "USER",
  returnPath = "/dashboard",
  submissions,
  showOwner = false,
}: SubmissionListProps) {
  const copy =
    locale === "it"
      ? {
          continue: "Continua",
          continueEditing: "Continua modifica",
          continuePayment: "Vai al pagamento",
          date: "Data",
          empty: "Non ci sono ancora segnalazioni da mostrare.",
          markCommissionPaid: "Segna commissione come pagata",
          method: "Metodo",
          markReceived: "Segna bonifico come ricevuto",
          paid: "Pagato",
          paymentStatus: "Pagamento",
          receipt: "Apri ricevuta",
          publish: "Pubblica scheda",
          publicPage: "Pagina pubblica",
          reference: "Riferimento",
          reviewBlocked:
            "Questa scheda non puo essere pubblicata finche il pagamento non risulta confermato.",
          status: "Stato",
          town: "Comune",
        }
      : {
          continue: "Continue",
          continueEditing: "Continue editing",
          continuePayment: "Go to payment",
          date: "Date",
          empty: "There are no submissions to show yet.",
          markCommissionPaid: "Mark commission as paid",
          method: "Method",
          markReceived: "Mark bank transfer as received",
          paid: "Paid",
          paymentStatus: "Payment",
          receipt: "Open receipt",
          publish: "Publish listing",
          publicPage: "View Page",
          reference: "Reference",
          reviewBlocked:
            "This listing cannot be published until the payment has been confirmed.",
          status: "Status",
          town: "Town",
        };

  if (!submissions.length) {
    return (
      <div className="card p-6 text-sm text-[var(--muted)]">
        {copy.empty}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {submissions.map((submission) => {
        const isDraft = isDraftLikeSubmission(submission);
        const paymentSummary = getSubmissionPaymentSummary(submission, locale);
        const canContinueEditing =
          isDraft || (!isAdmin && !(role === "GETTER" && submission.status === "PUBLISHED"));
        const continueHref = isDraft
          ? `/publish?submission=${submission.id}`
          : submission.paymentMethod && submission.paymentStatus !== "PAID"
            ? `/publish/payment?submission=${submission.id}`
            : `/publish?submission=${submission.id}`;

        return (
          <article key={submission.id} className="card grid min-w-0 gap-3 p-4 sm:gap-4 sm:p-5">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-words font-serif text-2xl leading-tight text-[var(--foreground)]">
                  {submission.businessName}
                </h3>
                <p className="mt-1 break-words text-sm text-[var(--muted)]">
                  {submission.categoryName} · {copy.town}: {submission.townName}
                  {showOwner && submission.userName ? ` · ${submission.userName}` : ""}
                </p>
              </div>
              <span
                className={`${getSubmissionStatusTone(isDraft ? "DRAFT" : submission.status)} max-w-[48%] shrink-0 self-start text-center`}
              >
                {getSubmissionStatusLabel(isDraft ? "DRAFT" : submission.status, locale)}
              </span>
            </div>

            <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm text-[var(--muted)] sm:grid-cols-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                  {copy.method}
                </p>
                <p className="mt-1 break-words font-medium leading-5 text-[var(--foreground)]">
                  {paymentSummary.method}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                  {copy.paymentStatus}
                </p>
                <p className="mt-1 break-words font-medium leading-5 text-[var(--foreground)]">
                  {paymentSummary.payment}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                  {copy.paid}
                </p>
                <p className="mt-1 break-words font-medium leading-5 text-[var(--foreground)]">
                  {paymentSummary.paid}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                  {copy.date}
                </p>
                <p className="mt-1 break-words font-medium leading-5 text-[var(--foreground)]">
                  {new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
                    dateStyle: "medium",
                  }).format(submission.createdAt)}
                </p>
              </div>
            </div>

            {submission.bankTransferReference ? (
              <div className="grid gap-3 text-sm text-[var(--muted)]">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                    {copy.reference}
                  </p>
                  <p className="mt-1 font-medium text-[var(--foreground)]">
                    {submission.bankTransferReference}
                  </p>
                </div>
              </div>
            ) : null}

            {isAdmin &&
            !isDraft &&
            submission.status !== "PUBLISHED" &&
            submission.paymentStatus !== "PAID" ? (
              <div className="rounded-2xl border border-[color:rgba(191,91,42,0.18)] bg-[color:rgba(191,91,42,0.08)] px-4 py-4 text-sm text-[var(--foreground)]">
                {copy.reviewBlocked}
              </div>
            ) : null}

            <div className="flex min-w-0 flex-wrap gap-2 sm:gap-3">
              {canContinueEditing ? (
                <HardNavigationLink
                  href={continueHref}
                  className="btn-secondary"
                >
                  {isDraft
                    ? copy.continueEditing
                    : submission.paymentMethod && submission.paymentStatus !== "PAID"
                      ? copy.continuePayment
                      : copy.continue}
                </HardNavigationLink>
              ) : null}
              {isDraft ? (
                <DraftDeleteButton
                  businessName={submission.businessName}
                  locale={locale}
                  submissionId={submission.id}
                />
              ) : null}
              {submission.paymentStatus === "PAID" ? (
                <HardNavigationLink
                  href={`/receipts/${encodeURIComponent(submission.id)}`}
                  className="btn-secondary"
                >
                  {copy.receipt}
                </HardNavigationLink>
              ) : null}
              {isAdmin &&
              submission.paymentMethod === "BANK_TRANSFER" &&
              submission.paymentStatus === "AWAITING_BANK_TRANSFER" ? (
                <form action={confirmBankTransferReceivedAction}>
                  <input type="hidden" name="submissionId" value={submission.id} />
                  <input type="hidden" name="returnPath" value={returnPath} />
                  <button type="submit" className="btn-secondary">
                    {copy.markReceived}
                  </button>
                </form>
              ) : null}
              {isAdmin &&
              submission.status !== "PUBLISHED" &&
              submission.paymentStatus === "PAID" ? (
                <form action={publishSubmissionAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="submissionId" value={submission.id} />
                  <input type="hidden" name="returnPath" value={returnPath} />
                  <button type="submit" className="btn-primary">
                    {copy.publish}
                  </button>
                </form>
              ) : null}
              {submission.createdBusinessSlug ? (
                <HardNavigationLink
                  href={`/businesses/${submission.createdBusinessSlug}`}
                  className="btn-primary"
                >
                  {copy.publicPage}
                </HardNavigationLink>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
