import Link from "next/link";
import { redirect } from "next/navigation";
import { IconArrowRight, IconBuildingStore, IconRosetteDiscountCheck } from "@tabler/icons-react";

import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";

export default async function BusinessOnboardingPage() {
  const locale = await getCurrentLocale();
  const viewer = await requireCompletedViewer();

  if (viewer.role !== "BUSINESS_OWNER" && viewer.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const copy =
    locale === "it"
      ? {
          addBody:
            "Crea la tua scheda, verifica la proprieta e poi completa il pagamento nel flusso normale.",
          addCta: "Aggiungi la tua attivita",
          addTitle: "Inserisci una nuova attivita",
          body:
            "Puoi aggiungere una nuova attivita oppure rivendicare una scheda gia presente nella directory.",
          claimBody:
            "Se la tua attivita e gia online, collega la scheda al tuo account con la verifica guidata.",
          claimCta: "Rivendica una scheda esistente",
          claimTitle: "Rivendica un'attivita gia presente",
          eyebrow: "Benvenuto",
          title: "Come vuoi iniziare come attivita?",
        }
      : {
          addBody:
            "Create your listing, verify ownership, and then complete payment through the normal flow.",
          addCta: "Add your business",
          addTitle: "List a new business",
          body:
            "You can add a new business or claim a listing that is already in the directory.",
          claimBody:
            "If your business is already live, connect the listing to your account with guided verification.",
          claimCta: "Claim an existing listing",
          claimTitle: "Claim a business already listed",
          eyebrow: "Welcome",
          title: "How would you like to get started as a business owner?",
        };

  return (
    <main className="shell px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-[2rem] border border-[var(--border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(237,232,223,0.86))] p-8 shadow-[var(--shadow-soft)] sm:p-10">
          <p className="section-kicker mb-3">{copy.eyebrow}</p>
          <h1 className="max-w-3xl font-serif text-4xl text-[var(--foreground)] sm:text-5xl">
            {copy.title}
          </h1>
          <p className="mt-4 max-w-2xl text-[var(--muted)]">{copy.body}</p>
        </section>

        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          <article className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] sm:p-7">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:rgba(42,98,87,0.1)] text-[var(--primary)]">
              <IconBuildingStore size={22} />
            </div>
            <h2 className="mt-5 font-serif text-3xl text-[var(--foreground)]">{copy.addTitle}</h2>
            <p className="mt-3 text-[var(--muted)]">{copy.addBody}</p>
            <Link href="/publish" className="btn-primary mt-6 w-full sm:w-auto">
              {copy.addCta}
              <IconArrowRight size={16} />
            </Link>
          </article>

          <article className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] sm:p-7">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:rgba(191,91,42,0.1)] text-[var(--accent)]">
              <IconRosetteDiscountCheck size={22} />
            </div>
            <h2 className="mt-5 font-serif text-3xl text-[var(--foreground)]">{copy.claimTitle}</h2>
            <p className="mt-3 text-[var(--muted)]">{copy.claimBody}</p>
            <Link href="/claim" className="btn-secondary mt-6 w-full sm:w-auto">
              {copy.claimCta}
            </Link>
          </article>
        </section>
      </div>
    </main>
  );
}
