import Image from "next/image";
import { notFound, redirect } from "next/navigation";

import { PartnerPayoutMethodForm } from "@/components/account/partner-payout-method-form";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { getSafeInternalRedirect } from "@/lib/redirects";
import { getSingleParam } from "@/lib/site";
import { prisma } from "@/lib/prisma";

type PageProps = { params: Promise<{ method: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const details = {
  paypal: { logo: "/payout-methods/paypal.svg", method: "PAYPAL" as const, en: ["Enter the email on your PayPal account.", "Payments are sent by PayPal when your earnings are eligible."], it: ["Inserisci l'email del tuo conto PayPal.", "Quando i guadagni sono idonei, il pagamento viene inviato da PayPal."] },
  postepay: { logo: "/payout-methods/postepay.svg", method: "POSTEPAY" as const, en: ["Use an eligible Postepay IBAN account.", "We never ask for card details, PINs, or passwords."], it: ["Usa un conto Postepay con IBAN idoneo.", "Non chiediamo mai dati carta, PIN o password."] },
  hype: { logo: "/payout-methods/hype.svg", method: "HYPE" as const, en: ["Use the IBAN for your eligible HYPE account.", "We never ask for card details, PINs, or passwords."], it: ["Usa l'IBAN del tuo conto HYPE idoneo.", "Non chiediamo mai dati carta, PIN o password."] },
} as const;

export default async function PayoutMethodSetupPage({ params, searchParams }: PageProps) {
  const viewer = await requireCompletedViewer();
  if (viewer.role !== "GETTER") redirect("/dashboard");
  const { method } = await params;
  if (method === "stripe") {
    const locale = await getCurrentLocale();
    const query = await searchParams;
    const returnTo = getSafeInternalRedirect(getSingleParam(query.returnTo)) ?? "/dashboard";
    redirect(`/api/stripe/connect/onboarding/start?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`);
  }
  const selected = details[method as keyof typeof details];
  if (!selected) notFound();
  const profile = await prisma.localPartnerProfile.findUnique({ where: { userId: viewer.id }, select: { completedAt: true, partnerOnboardingCompletedAt: true, user: { select: { email: true } } } });
  if (!profile?.completedAt) redirect("/onboarding/partner");
  if (!profile.partnerOnboardingCompletedAt) redirect("/partner/onboarding");
  const locale = await getCurrentLocale();
  const query = await searchParams;
  const returnTo = getSafeInternalRedirect(getSingleParam(query.returnTo)) ?? "/dashboard";
  const italian = locale === "it";
  return <main className="shell px-4 py-10 sm:px-6 sm:py-14"><section className="card mx-auto max-w-xl p-6 sm:p-9">
    <HardNavigationLink href={`/partner/payout?returnTo=${encodeURIComponent(returnTo)}`} className="text-sm text-[var(--primary)] hover:underline">← {italian ? "Tutti i metodi" : "All methods"}</HardNavigationLink>
    <Image src={selected.logo} alt="" width={160} height={48} className="mt-7 h-12 w-40 object-contain object-left" />
    <h1 className="mt-5 font-serif text-4xl text-[var(--foreground)]">{italian ? "Imposta il tuo pagamento" : "Set up your payout"}</h1>
    <div className="mt-4 grid gap-1 text-sm leading-6 text-[var(--muted)]">{(italian ? selected.it : selected.en).map((item) => <p key={item}>{item}</p>)}</div>
    <div className="mt-7"><PartnerPayoutMethodForm locale={locale} method={selected.method} returnTo={returnTo} defaultPaypalEmail={profile.user.email} /></div>
  </section></main>;
}
