import Link from "next/link";
import { redirect } from "next/navigation";

import { activateOwnerAccessForCurrentUserAction } from "@/app/(account)/owner-access-actions";
import { signOutAction } from "@/app/(account)/sign-out-action";
import { OwnerAccountActivationForm, OwnerAccessRequestForm } from "@/components/account/owner-access-forms";
import { getViewer } from "@/lib/auth-guards";
import { getOwnerAccountPrefill, resolveOwnerAccessInvitation } from "@/lib/business-owner-access";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";

type OwnerAccessPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OwnerAccessPage({ params, searchParams }: OwnerAccessPageProps) {
  const [{ token }, locale, viewer, resolvedSearchParams] = await Promise.all([
    params,
    getCurrentLocale(),
    getViewer(),
    searchParams,
  ]);
  const resolved = await resolveOwnerAccessInvitation(token);
  const error = getSingleParam(resolvedSearchParams.error);
  const copy = locale === "it"
    ? { activate: "Attiva l'accesso", body: "Crea il tuo account per gestire informazioni, foto e orari in qualsiasi momento.", expired: "Questo link è scaduto", expiredBody: "Nessun problema: puoi richiedere un nuovo link sicuro con la tua email.", eyebrow: "La tua attività è pronta", login: "Accedi per continuare", title: "Gestisci la tua attività", used: "Questo link è già stato usato", usedBody: "Accedi al tuo account per gestire l'attività.", wrong: "Questo link è associato a un'altra email." }
    : { activate: "Activate access", body: "Create your account to manage information, photos, and opening hours whenever you need to.", expired: "This link has expired", expiredBody: "No problem: request a new secure link using your email address.", eyebrow: "Your business is ready", login: "Log in to continue", title: "Manage your business", used: "This link has already been used", usedBody: "Log in to your account to manage the business.", wrong: "This link belongs to a different email." };

  if (resolved.status === "active" && resolved.invitation) {
    const access = resolved.invitation.businessOwnerAccess;
    const ownerSubmission = access.sourceSubmissionId
      ? await prisma.businessSubmission.findUnique({
          where: { id: access.sourceSubmissionId },
          select: { ownerName: true },
        })
      : null;
    const prefill = getOwnerAccountPrefill({ email: access.email, ownerName: ownerSubmission?.ownerName });
    const contextCard = (
      <section className="mb-6 overflow-hidden rounded-[1.4rem] border border-[var(--border)] bg-[var(--secondary)]">
        <div className="flex gap-4 p-4 sm:p-5">
          {access.business.images[0]?.url ? <img src={access.business.images[0].url} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" /> : null}
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">{locale === "it" ? "La tua attività" : "Your business"}</p>
            <h2 className="mt-1 truncate font-serif text-2xl text-[var(--foreground)]">{access.business.name}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{[access.business.category.name, access.business.town.name, access.business.address].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
      </section>
    );
    if (viewer && viewer.email.trim().toLowerCase() === access.email) {
      return (
        <main className="shell px-4 py-12 sm:px-6"><section className="mx-auto max-w-xl card p-6 sm:p-8">
          <p className="section-kicker mb-3">{copy.eyebrow}</p><h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.title}</h1>
          <p className="mt-3 text-[var(--muted)]">{locale === "it" ? "Sei nell'account giusto. Conferma per aprire la gestione della tua attività." : "You are signed in to the correct account. Confirm to open your business management."}</p>
          <div className="mt-6">{contextCard}</div>
          <form action={activateOwnerAccessForCurrentUserAction}><input type="hidden" name="locale" value={locale} /><input type="hidden" name="token" value={token} /><button className="btn-primary w-full sm:w-auto">{copy.activate}</button></form>
        </section></main>
      );
    }
    if (viewer) {
      return (
        <main className="shell px-4 py-12 sm:px-6"><section className="mx-auto max-w-xl card p-6 sm:p-8"><h1 className="font-serif text-3xl text-[var(--foreground)]">{copy.title}</h1><p className="mt-4 text-[var(--accent)]">{error || copy.wrong}</p><p className="mt-4 text-[var(--muted)]">{locale === "it" ? "Esci e accedi con l'email a cui è stato inviato questo invito." : "Log out, then sign in with the email that received this invitation."}</p><form action={signOutAction} className="mt-6"><input type="hidden" name="redirectTo" value={`/owner-access/${token}`} /><button className="btn-primary">{locale === "it" ? "Esci e accedi" : "Log out and sign in"}</button></form></section></main>
      );
    }
    if (access.userId) {
      redirect(`/login?redirectTo=${encodeURIComponent(`/owner-access/${token}`)}`);
    }
    return (
      <main className="shell px-4 py-12 sm:px-6"><div className="mx-auto max-w-xl"><p className="section-kicker mb-3">{copy.eyebrow}</p><h1 className="font-serif text-4xl text-[var(--foreground)]">{locale === "it" ? "Benvenuto su Salento Local" : "Welcome to Salento Local"}</h1><p className="mt-2 font-serif text-2xl text-[var(--foreground)]">{locale === "it" ? "Crea il tuo account" : "Create your account"}</p><p className="mt-4 text-[var(--muted)]">{locale === "it" ? "La tua attività è già su Salento Local. Completa il tuo account per gestire e aggiornare la tua pagina." : copy.body}</p><div className="mt-6">{contextCard}</div><OwnerAccountActivationForm email={prefill.email} locale={locale} name={prefill.name} token={token} /></div></main>
    );
  }

  const isUsed = resolved.status === "used";
  const businessSlug = resolved.invitation?.businessOwnerAccess.business.slug;
  if (
    isUsed &&
    viewer &&
    resolved.invitation?.businessOwnerAccess.userId === viewer.id &&
    businessSlug
  ) {
    redirect(`/businesses/${encodeURIComponent(businessSlug)}/edit`);
  }
  return (
    <main className="shell px-4 py-12 sm:px-6"><div className="mx-auto max-w-xl"><section className="mb-6 card p-6 sm:p-8"><p className="section-kicker mb-3">{isUsed ? copy.used : copy.expired}</p><h1 className="font-serif text-4xl text-[var(--foreground)]">{isUsed ? copy.used : copy.expired}</h1><p className="mt-4 text-[var(--muted)]">{isUsed ? copy.usedBody : copy.expiredBody}</p>{isUsed && businessSlug ? <Link href={`/login?redirectTo=${encodeURIComponent(`/businesses/${businessSlug}/edit`)}`} className="btn-primary mt-6">{copy.login}</Link> : null}</section>{!isUsed ? <OwnerAccessRequestForm locale={locale} /> : null}</div></main>
  );
}
