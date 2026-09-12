import Link from "next/link";
import { redirect } from "next/navigation";

import { BusinessClaimForm } from "@/components/account/business-claim-form";
import { getViewer } from "@/lib/auth-guards";
import {
  getBusinessClaimVerificationEmail,
  isBusinessAlreadyManaged,
} from "@/lib/business-claim";
import { maskVerificationRecipient } from "@/lib/business-claim-verification";
import { getCurrentLocale } from "@/lib/locale";
import { hasAcceptedCurrentLegalDocuments } from "@/lib/legal-consent";
import { prisma } from "@/lib/prisma";
import { buildBusinessPhoto, getCategoryLabel, getSingleParam } from "@/lib/site";

type ClaimPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClaimPage({ searchParams }: ClaimPageProps) {
  const locale = await getCurrentLocale();
  const viewer = await getViewer();
  const requestedBusinessSlug = getSingleParam((await searchParams).business);
  const claimRedirectTo = requestedBusinessSlug
    ? `/claim?business=${encodeURIComponent(requestedBusinessSlug)}`
    : "/claim";

  if (!viewer) {
    redirect(`/login?redirectTo=${encodeURIComponent(claimRedirectTo)}`);
  }

  if (!viewer.profileCompleted) {
    redirect(`/complete-profile?redirectTo=${encodeURIComponent(claimRedirectTo)}`);
  }

  if (viewer.role !== "BUSINESS_OWNER") {
    redirect(`/login?redirectTo=${encodeURIComponent(claimRedirectTo)}`);
  }

  const hasAcceptedBusinessLegalDocuments = await hasAcceptedCurrentLegalDocuments({
    audience: "business",
    userId: viewer.id,
  });

  const business = requestedBusinessSlug
    ? await prisma.business.findUnique({
        where: { slug: requestedBusinessSlug },
        select: {
          address: true,
          category: { select: { name: true, slug: true } },
          email: true,
          heroImageSeed: true,
          id: true,
          images: { orderBy: { sortOrder: "asc" }, select: { url: true }, take: 1 },
          locality: { select: { name: true } },
          name: true,
          ownerAccesses: { select: { userId: true } },
          ownerUserId: true,
          slug: true,
          submissions: {
            orderBy: { createdAt: "desc" },
            select: { ownerEmail: true, ownerHasNoEmail: true },
            take: 1,
          },
          town: { select: { name: true } },
        },
      })
    : null;

  const copy = locale === "it"
    ? {
        alreadyManaged: "Questa attività è già gestita su Salento Local.",
        back: "Torna alla pagina dell'attività",
        noEmail: "Questa attività non può ancora essere rivendicata online",
        noEmailBody: "Non abbiamo un indirizzo email registrato che possa verificare la proprietà. Per ora, per rivendicare una scheda è necessario poter accedere all'email dell'attività registrata.",
      }
    : {
        alreadyManaged: "This business is already managed on Salento Local.",
        back: "Back to business page",
        noEmail: "This business can't be claimed online yet",
        noEmailBody: "We don't have an email address on file that can verify ownership. For now, access to the registered business email is required to claim a listing.",
      };

  if (business) {
    const verificationEmail = getBusinessClaimVerificationEmail({
      ownerEmail: business.submissions[0]?.ownerEmail,
      ownerHasNoEmail: business.submissions[0]?.ownerHasNoEmail ?? true,
    });
    const backLink = <Link className="btn-secondary mt-6 min-h-12 w-full sm:w-auto" href={`/businesses/${business.slug}`}>{copy.back}</Link>;

    if (isBusinessAlreadyManaged({
      ownerAccessUserIds: business.ownerAccesses.map((access) => access.userId),
      ownerUserId: business.ownerUserId,
    })) {
      return <main className="shell px-4 py-14 sm:px-6"><section className="card mx-auto max-w-2xl p-7 sm:p-9"><p className="section-kicker mb-3">{locale === "it" ? "Attività gestita" : "Business managed"}</p><h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.alreadyManaged}</h1>{backLink}</section></main>;
    }

    if (!verificationEmail) {
      return <main className="shell px-4 py-14 sm:px-6"><section className="card mx-auto max-w-2xl p-7 sm:p-9"><p className="section-kicker mb-3">{locale === "it" ? "Verifica email richiesta" : "Email verification required"}</p><h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.noEmail}</h1><p className="mt-4 leading-7 text-[var(--muted)]">{copy.noEmailBody}</p>{backLink}</section></main>;
    }

    return (
      <main className="shell px-4 py-12 sm:px-6">
        <section className="card mx-auto max-w-3xl p-6 sm:p-8">
          <BusinessClaimForm
            initialBusiness={{
              address: business.address,
              category: getCategoryLabel(business.category.slug, business.category.name, locale),
              email: maskVerificationRecipient("EMAIL", verificationEmail) ?? "",
              id: business.id,
              imageUrl: buildBusinessPhoto(business.images[0]?.url, 480, { label: business.name, seed: business.heroImageSeed }),
              locality: business.locality?.name ?? null,
              name: business.name,
              slug: business.slug,
              town: business.town.name,
            }}
            locale={locale}
            requiresLegalAcceptance={!hasAcceptedBusinessLegalDocuments}
          />
        </section>
      </main>
    );
  }

  return <main className="shell px-4 py-12 sm:px-6"><section className="card mx-auto max-w-3xl p-6 sm:p-8"><BusinessClaimForm locale={locale} /></section></main>;
}
