import Link from "next/link";
import { redirect } from "next/navigation";

import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";

export default async function RecoveryUnavailablePage() {
  const [viewer, locale] = await Promise.all([requireCompletedViewer(), getCurrentLocale()]);
  if (viewer.role !== "BUSINESS_OWNER") redirect("/dashboard");
  const it = locale === "it";
  return <main className="shell px-4 py-12 sm:px-6"><section className="card mx-auto max-w-xl p-6 sm:p-8">
    <h1 className="font-serif text-3xl text-[var(--foreground)]">{it ? "Rinnovo da verificare" : "Renewal needs review"}</h1>
    <p className="mt-4 leading-7 text-[var(--muted-strong)]">{it
      ? "Non possiamo aprire in sicurezza la fattura del rinnovo in questo momento. Non avviare un secondo pagamento. Torna alla dashboard e riprova più tardi, oppure contatta l’assistenza."
      : "We can't safely open your existing renewal invoice right now. Please don't start a second payment. Return to your dashboard and try later, or contact support."}</p>
    <Link className="btn-primary mt-6" href="/dashboard">{it ? "Torna alla dashboard" : "Return to dashboard"}</Link>
  </section></main>;
}
