import { redirect } from "next/navigation";

import { OwnedBusinessEditForm } from "@/components/account/owned-business-edit-form";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";

type EditBusinessPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function EditBusinessPage({ params }: EditBusinessPageProps) {
  const locale = await getCurrentLocale();
  const viewer = await requireCompletedViewer();
  const { slug } = await params;

  const business = await prisma.business.findUnique({
    where: {
      slug,
    },
    select: {
      address: true,
      description: true,
      email: true,
      id: true,
      name: true,
      openingHoursText: true,
      ownerUserId: true,
      phone: true,
      shortDescription: true,
      website: true,
      submissions: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        select: {
          ownerEmail: true,
          ownerName: true,
          ownerPhone: true,
        },
      },
    },
  });

  if (!business) {
    redirect("/dashboard/businesses");
  }

  if (business.ownerUserId !== viewer.id && viewer.role !== "ADMIN") {
    redirect(`/businesses/${slug}`);
  }

  const latestSubmission = business.submissions[0];

  return (
    <main className="shell px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="section-kicker mb-2">
            {locale === "it" ? "Gestione attivita" : "Business management"}
          </p>
          <h1 className="font-serif text-4xl text-[var(--foreground)]">
            {locale === "it" ? "Modifica profilo attivita" : "Edit business profile"}
          </h1>
        </div>

        <section className="card p-8">
          <OwnedBusinessEditForm
            business={{
              address: business.address,
              description: business.description,
              email: business.email ?? "",
              id: business.id,
              name: business.name,
              openingHoursText: business.openingHoursText ?? "",
              ownerEmail: latestSubmission?.ownerEmail ?? "",
              ownerName: latestSubmission?.ownerName ?? "",
              ownerPhone: latestSubmission?.ownerPhone ?? "",
              phone: business.phone ?? "",
              shortDescription: business.shortDescription,
              website: business.website ?? "",
            }}
            locale={locale}
          />
        </section>
      </div>
    </main>
  );
}
