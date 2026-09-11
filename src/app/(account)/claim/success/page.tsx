import Link from "next/link";
import { redirect } from "next/navigation";

import { requireCompletedViewer } from "@/lib/auth-guards";
import { canManageBusiness } from "@/lib/business-owner-access";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";

type ClaimSuccessPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClaimSuccessPage({
  searchParams,
}: ClaimSuccessPageProps) {
  const locale = await getCurrentLocale();
  const viewer = await requireCompletedViewer();
  const resolvedSearchParams = await searchParams;
  const businessSlug = getSingleParam(resolvedSearchParams.business);

  if (!businessSlug) {
    redirect("/dashboard/businesses");
  }

  const business = await prisma.business.findUnique({
    where: {
      slug: businessSlug,
    },
    select: {
      id: true,
      name: true,
      ownerUserId: true,
      slug: true,
    },
  });

  if (
    !business ||
    !(await canManageBusiness({ businessId: business.id, userId: viewer.id }))
  ) {
    redirect("/dashboard/businesses");
  }

  const copy =
    locale === "it"
      ? {
          body:
            "Complimenti. Questa attivita e ora collegata al tuo account e puoi iniziare a gestirne il profilo.",
          cta: "Vai alla pagina dell'attivita",
          edit: "Modifica profilo attivita",
          eyebrow: "Rivendicazione completata",
          title: `${business.name} ora e registrata a tuo nome`,
        }
      : {
          body:
            "Congratulations. This business is now connected to your account and you can start managing its profile.",
          cta: "Go to business page",
          edit: "Edit business profile",
          eyebrow: "Claim completed",
          title: `${business.name} is now registered to you`,
        };

  return (
    <main className="shell px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <section className="card p-8">
          <p className="section-kicker mb-3">{copy.eyebrow}</p>
          <h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.title}</h1>
          <p className="mt-4 max-w-2xl text-[var(--muted)]">{copy.body}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={`/businesses/${business.slug}`} className="btn-primary">
              {copy.cta}
            </Link>
            <Link href={`/businesses/${business.slug}/edit?step=business`} className="btn-secondary">
              {copy.edit}
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
