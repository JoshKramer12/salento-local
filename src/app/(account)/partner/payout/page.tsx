import Image from "next/image";
import { redirect } from "next/navigation";

import { HardNavigationLink } from "@/components/hard-navigation-link";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { getSafeInternalRedirect } from "@/lib/redirects";
import { getSingleParam } from "@/lib/site";
import { prisma } from "@/lib/prisma";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const options = [
  { method: "stripe", logo: "/payout-methods/stripe.svg", en: ["Automatic payouts", "Secure bank setup"], it: ["Pagamenti automatici", "Setup bancario sicuro"] },
  { method: "paypal", logo: "/payout-methods/paypal.svg", en: ["PayPal email payout", "EUR supported in Italy"], it: ["Pagamento all'email PayPal", "EUR supportato in Italia"] },
  { method: "postepay", logo: "/payout-methods/postepay.svg", en: ["Eligible IBAN account", "SEPA transfer destination"], it: ["Conto IBAN idoneo", "Destinazione bonifico SEPA"] },
  { method: "hype", logo: "/payout-methods/hype.svg", en: ["Eligible IBAN account", "SEPA transfer destination"], it: ["Conto IBAN idoneo", "Destinazione bonifico SEPA"] },
] as const;

export default async function PartnerPayoutPage({ searchParams }: PageProps) {
  const viewer = await requireCompletedViewer();
  if (viewer.role !== "GETTER") redirect("/dashboard");
  const profile = await prisma.localPartnerProfile.findUnique({ where: { userId: viewer.id }, select: { completedAt: true, partnerOnboardingCompletedAt: true } });
  if (!profile?.completedAt) redirect("/onboarding/partner");
  if (!profile.partnerOnboardingCompletedAt) redirect("/partner/onboarding");
  const locale = await getCurrentLocale();
  const params = await searchParams;
  const returnTo = getSafeInternalRedirect(getSingleParam(params.returnTo)) ?? "/dashboard";
  const italian = locale === "it";

  return <main className="shell px-4 py-10 sm:px-6 sm:py-14">
    <section className="card mx-auto max-w-5xl p-5 sm:p-8 lg:p-10">
      <p className="section-kicker mb-3">{italian ? "PAGAMENTI PARTNER" : "PARTNER PAYOUTS"}</p>
      <h1 className="max-w-2xl font-serif text-4xl text-[var(--foreground)] sm:text-5xl">{italian ? "Come preferisci ricevere i pagamenti?" : "How would you like to get paid?"}</h1>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--muted)] sm:text-base">{italian ? "Scegli dove ricevere i tuoi guadagni Partner. Puoi cambiare o completare la configurazione più tardi." : "Choose where you’d like to receive your Partner earnings. You can change or finish this later."}</p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {options.map((option) => <HardNavigationLink key={option.method} href={`/partner/payout/${option.method}?returnTo=${encodeURIComponent(returnTo)}`} className="group rounded-[1.5rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.56)] p-5 transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]">
          <Image src={option.logo} alt="" width={160} height={48} className="h-12 w-40 object-contain object-left" />
          <div className="mt-4 grid gap-1 text-sm leading-6 text-[var(--muted)]">{(italian ? option.it : option.en).map((benefit) => <span key={benefit}>• {benefit}</span>)}</div>
        </HardNavigationLink>)}
      </div>
      <HardNavigationLink href={returnTo} className="btn-secondary mt-6 inline-flex w-full justify-center sm:w-auto">{italian ? "Configura più tardi" : "Set up later"}</HardNavigationLink>
    </section>
  </main>;
}
