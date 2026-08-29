import { redirect } from "next/navigation";

import { SubmissionVerifyForm } from "@/components/account/submission-verify-form";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";

type PublishVerifyPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PublishVerifyPage({
  searchParams,
}: PublishVerifyPageProps) {
  const locale = await getCurrentLocale();
  const viewer = await requireCompletedViewer();
  const resolvedSearchParams = await searchParams;
  const submissionId = getSingleParam(resolvedSearchParams.submission);

  if (!submissionId) {
    redirect("/publish");
  }

  const submission = await prisma.businessSubmission.findUnique({
    where: {
      id: submissionId,
    },
    select: {
      businessName: true,
      id: true,
      ownerEmail: true,
      ownerPhone: true,
      userId: true,
      verificationChannel: true,
    },
  });

  if (!submission || submission.userId !== viewer.id) {
    redirect("/publish");
  }

  return (
    <main className="shell px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <section className="card p-8">
          <p className="section-kicker mb-3">
            {locale === "it" ? "Verifica proprieta" : "Ownership verification"}
          </p>
          <h1 className="font-serif text-4xl text-[var(--foreground)]">
            {locale === "it" ? "Conferma la tua attivita" : "Confirm your business"}
          </h1>
          <div className="mt-8">
            <SubmissionVerifyForm
              businessName={submission.businessName}
              contact={
                submission.verificationChannel === "EMAIL"
                  ? submission.ownerEmail
                  : submission.verificationChannel === "WHATSAPP"
                    ? submission.ownerPhone
                    : null
              }
              locale={locale}
              mode={submission.verificationChannel === "MANUAL" ? "manual" : "code"}
              submissionId={submission.id}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
