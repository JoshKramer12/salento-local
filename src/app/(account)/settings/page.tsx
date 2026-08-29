import {
  deleteAccountAction,
} from "@/app/(account)/auth-actions";
import {
  grantAdminRoleAction,
  removeAdminRoleAction,
} from "@/app/(account)/actions";
import { signOutAction } from "@/app/(account)/sign-out-action";
import { DashboardNav } from "@/components/account/dashboard-nav";
import { isAdminViewer, isPrimaryAdminUsername } from "@/lib/admin";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";
import { buildDraftLikeSubmissionWhere } from "@/lib/submission-drafts";

type SettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getAdminFeedback(value: string | null, locale: "it" | "en") {
  if (!value) {
    return null;
  }

  if (value === "missing-username") {
    return locale === "it"
      ? "Inserisci uno username prima di salvare."
      : "Enter a username before saving.";
  }

  if (value === "user-not-found") {
    return locale === "it"
      ? "Nessun utente trovato con questo username."
      : "No user was found with that username.";
  }

  if (value === "primary-locked") {
    return locale === "it"
      ? "L'admin principale Josh non puo essere rimosso."
      : "Primary admin Josh cannot be removed.";
  }

  if (value.startsWith("added:")) {
    const username = value.slice("added:".length);
    return locale === "it"
      ? `Admin aggiunto: ${username}`
      : `Admin added: ${username}`;
  }

  if (value.startsWith("removed:")) {
    const username = value.slice("removed:".length);
    return locale === "it"
      ? `Admin rimosso: ${username}`
      : `Admin removed: ${username}`;
  }

  return null;
}

function getRoleLabel(role: string, locale: "it" | "en") {
  if (role === "ADMIN") {
    return "Admin";
  }

  if (role === "BUSINESS_OWNER") {
    return locale === "it" ? "Proprietario attivita" : "Business owner";
  }

  if (role === "GETTER") {
    return locale === "it" ? "Partner locale" : "Local Partner";
  }

  return locale === "it" ? "Utente" : "User";
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const locale = await getCurrentLocale();
  const viewer = await requireCompletedViewer();
  const resolvedSearchParams = await searchParams;
  const adminState = getSingleParam(resolvedSearchParams.admin);
  const adminFeedback = getAdminFeedback(adminState, locale);
  const adminAccess = isAdminViewer(viewer);
  const [user, adminUsers, draftCount] = await Promise.all([
    prisma.user.findUnique({
      where: {
        id: viewer.id,
      },
      select: {
        createdAt: true,
        email: true,
        role: true,
        username: true,
      },
    }),
    adminAccess
      ? prisma.user.findMany({
          where: {
            role: "ADMIN",
          },
          orderBy: {
            username: "asc",
          },
          select: {
            email: true,
            role: true,
            username: true,
          },
        })
      : Promise.resolve([]),
    prisma.businessSubmission.count({
      where: buildDraftLikeSubmissionWhere(viewer.id),
    }),
  ]);

  if (!user) {
    return null;
  }

  const joinedDate = new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    dateStyle: "medium",
  }).format(user.createdAt);

  return (
    <main className="shell px-4 py-12 sm:px-6">
      <div className="mb-8">
        <p className="section-kicker mb-2">
          {locale === "it" ? "Impostazioni account" : "Account settings"}
        </p>
        <h1 className="font-serif text-4xl text-[var(--foreground)]">
          {locale === "it" ? "Il tuo profilo" : "Your profile"}
        </h1>
        <p className="mt-4 max-w-2xl text-[var(--muted)]">
          {locale === "it"
            ? "Controlla i dati del tuo account e gestisci la sessione attiva."
            : "Review your account details and manage your current session."}
        </p>
      </div>

      <div className="dashboard-nav-shell mb-8">
        <DashboardNav
          active="dashboard"
          draftCount={draftCount}
          isAdmin={viewer.role === "ADMIN"}
          locale={locale}
          role={viewer.role}
        />
      </div>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="card p-6">
          <h2 className="font-serif text-2xl text-[var(--foreground)]">
            {locale === "it" ? "Dettagli account" : "Account details"}
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                {locale === "it" ? "Username" : "Username"}
              </p>
              <p className="mt-2 text-base font-medium text-[var(--foreground)]">
                {user.username}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                Email
              </p>
              <p className="mt-2 text-base font-medium text-[var(--foreground)]">
                {user.email}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                {locale === "it" ? "Ruolo" : "Role"}
              </p>
              <p className="mt-2 text-base font-medium text-[var(--foreground)]">
                {getRoleLabel(user.role, locale)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                {locale === "it" ? "Iscritto dal" : "Member since"}
              </p>
              <p className="mt-2 text-base font-medium text-[var(--foreground)]">
                {joinedDate}
              </p>
            </div>
          </div>
        </article>

        <article className="card p-6">
          <h2 className="font-serif text-2xl text-[var(--foreground)]">
            {locale === "it" ? "Sessione" : "Session"}
          </h2>
          <p className="mt-4 text-[var(--muted)]">
            {locale === "it"
              ? "Il tuo accesso resta attivo anche dopo la chiusura del browser, finche non scegli di uscire."
              : "Your login stays active even after closing the browser until you choose to sign out."}
          </p>
          <form action={signOutAction} className="mt-6">
            <button type="submit" className="btn-secondary">
              {locale === "it" ? "Esci dal tuo account" : "Log out of your account"}
            </button>
          </form>
        </article>
      </section>

      <section className="mt-6">
        <article className="card border-[color:rgba(191,91,42,0.28)] p-6">
          <h2 className="font-serif text-2xl text-[var(--foreground)]">
            {locale === "it" ? "Elimina account" : "Delete account"}
          </h2>
          <p className="mt-4 max-w-3xl text-[var(--muted)]">
            {locale === "it"
              ? "Questa operazione elimina definitivamente il tuo profilo, la sessione e tutti i dati dell'account. Le schede attivita gia pubblicate rimarranno nella directory senza essere collegate al tuo account. Non potrai annullare l'operazione."
              : "This permanently deletes your profile, session, and all account data. Any business listings already published will remain in the directory without being linked to your account. This action cannot be undone."}
          </p>
          <form action={deleteAccountAction} className="mt-6 grid max-w-2xl gap-4">
            <label className="flex items-start gap-3 rounded-[1.35rem] border border-[color:rgba(191,91,42,0.24)] bg-[color:rgba(191,91,42,0.05)] p-4 text-sm leading-6 text-[var(--foreground)]">
              <input
                type="checkbox"
                name="confirmation"
                value="delete-account"
                required
                className="mt-1 h-4 w-4 accent-[var(--accent)]"
              />
              <span>
                {locale === "it"
                  ? "Capisco che il mio account e i relativi dati saranno eliminati definitivamente."
                  : "I understand that my account and its associated data will be permanently deleted."}
              </span>
            </label>
            <button
              type="submit"
              className="w-fit rounded-full border border-[var(--accent)] bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              {locale === "it" ? "Elimina definitivamente il mio account" : "Permanently delete my account"}
            </button>
          </form>
        </article>
      </section>

      {adminAccess ? (
        <section className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <article className="card p-6">
            <h2 className="font-serif text-2xl text-[var(--foreground)]">
              {locale === "it" ? "Aggiungi admin" : "Add admin"}
            </h2>
            <p className="mt-4 text-[var(--muted)]">
              {locale === "it"
                ? "Promuovi un utente per username. L'account admin puo aggiungere attivita in modalita admin e cancellare schede pubbliche."
                : "Promote a user by username. Admin accounts can add businesses in admin mode and delete live business pages."}
            </p>
            {adminFeedback ? (
              <div className="mt-4 rounded-2xl border border-[color:rgba(42,98,87,0.14)] bg-[color:rgba(42,98,87,0.06)] px-4 py-3 text-sm text-[var(--foreground)]">
                {adminFeedback}
              </div>
            ) : null}
            <form action={grantAdminRoleAction} className="mt-6 grid gap-3">
              <label className="field-label">
                <span className="text-sm font-medium text-[var(--foreground)]">
                  {locale === "it" ? "Username" : "Username"}
                </span>
                <input
                  name="username"
                  className="input-field"
                  placeholder={locale === "it" ? "es. mario" : "e.g. mario"}
                />
              </label>
              <button type="submit" className="btn-primary w-full sm:w-auto">
                {locale === "it" ? "Rendi admin" : "Make admin"}
              </button>
            </form>
          </article>

          <article className="card p-6">
            <h2 className="font-serif text-2xl text-[var(--foreground)]">
              {locale === "it" ? "Admin attivi" : "Current admins"}
            </h2>
            <div className="mt-6 grid gap-3">
              {adminUsers.map((adminUser) => (
                <div
                  key={adminUser.username}
                  className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[color:rgba(247,244,239,0.55)] p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-[var(--foreground)]">{adminUser.username}</p>
                    <p className="text-sm text-[var(--muted)]">{adminUser.email}</p>
                  </div>
                  {isPrimaryAdminUsername(adminUser.username) ? (
                    <span className="pill-success">
                      {locale === "it" ? "Admin principale" : "Primary admin"}
                    </span>
                  ) : (
                    <form action={removeAdminRoleAction}>
                      <input type="hidden" name="username" value={adminUser.username} />
                      <button type="submit" className="btn-secondary">
                        {locale === "it" ? "Rimuovi admin" : "Remove admin"}
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : null}
    </main>
  );
}
