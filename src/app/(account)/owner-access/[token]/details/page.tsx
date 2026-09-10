import { redirect } from "next/navigation";

import { LocalPartnerOnboardingForm } from "@/components/account/local-partner-onboarding-form";
import { getPendingOwnerAccessSignupForPage } from "@/app/(account)/owner-access-actions";
import { getViewer } from "@/lib/auth-guards";
import { getOwnerAccountPrefill, resolveOwnerAccessInvitation } from "@/lib/business-owner-access";
import { getCurrentLocale } from "@/lib/locale";
import { buildPhoneCountryOptions } from "@/lib/phone-country-options";
import { prisma } from "@/lib/prisma";

type OwnerAccessDetailsPageProps = {
  params: Promise<{ token: string }>;
};

export default async function OwnerAccessDetailsPage({ params }: OwnerAccessDetailsPageProps) {
  const [{ token }, locale, viewer, towns, resolved, pendingSignup] = await Promise.all([
    params,
    getCurrentLocale(),
    getViewer(),
    prisma.town.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    params.then(({ token: value }) => resolveOwnerAccessInvitation(value)),
    params.then(({ token: value }) => getPendingOwnerAccessSignupForPage(value)),
  ]);

  if (resolved.status !== "active" || !resolved.invitation) {
    redirect(`/owner-access/${encodeURIComponent(token)}`);
  }
  if (!pendingSignup) redirect(`/owner-access/${encodeURIComponent(token)}`);

  const access = resolved.invitation.businessOwnerAccess;
  const viewerMatches = access.email
    ? Boolean(viewer?.email && viewer.email.trim().toLowerCase() === access.email)
    : Boolean(access.phone && viewer?.phone === access.phone);
  if (viewerMatches) redirect(`/owner-access/${encodeURIComponent(token)}/complete`);
  if (viewer) redirect(`/owner-access/${encodeURIComponent(token)}`);
  if (access.userId) redirect(`/owner-access/${encodeURIComponent(token)}/login`);

  const submission = access.sourceSubmissionId
    ? await prisma.businessSubmission.findUnique({
        where: { id: access.sourceSubmissionId },
        select: { ownerName: true, ownerPhone: true },
      })
    : null;
  const prefill = getOwnerAccountPrefill({
    email: access.email,
    ownerName: submission?.ownerName,
    phone: access.phone ?? submission?.ownerPhone,
  });
  const copy = locale === "it"
    ? { body: "Completa questi dettagli per iniziare a gestire la tua attività.", title: "Dati business" }
    : { body: "Complete these details to start managing your business.", title: "Business details" };

  return (
    <main className="shell px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <p className="section-kicker mb-3">{locale === "it" ? "Passaggio 2 di 2" : "Step 2 of 2"}</p>
        <h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.title}</h1>
        <p className="mt-4 text-[var(--muted)]">{copy.body}</p>
        <section className="mt-6 overflow-hidden rounded-[1.4rem] border border-[var(--border)] bg-[var(--secondary)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">{locale === "it" ? "La tua attività" : "Your business"}</p>
          <p className="mt-1 font-serif text-2xl text-[var(--foreground)]">{access.business.name}</p>
        </section>
        <div className="mt-6">
          <LocalPartnerOnboardingForm
            activationToken={token}
            backHref={`/owner-access/${encodeURIComponent(token)}`}
            locale={locale}
            lockedPhone={Boolean(access.phone)}
            needsDetails
            phoneCountryOptions={buildPhoneCountryOptions(locale)}
            profile={{ phone: prefill.phone }}
            returnTo="/dashboard"
            signupAudience="owner"
            signupMode
            towns={towns}
          />
        </div>
      </div>
    </main>
  );
}
