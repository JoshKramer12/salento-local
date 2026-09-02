import Link from "next/link";

import { PasswordResetForm } from "@/components/account/password-reset-forms";
import { getCurrentLocale } from "@/lib/locale";
import { resolvePasswordResetToken } from "@/lib/password-reset";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, locale] = await Promise.all([params, getCurrentLocale()]);
  const valid = await resolvePasswordResetToken(token);
  const copy = locale === "it" ? { expired: "Questo link non è valido o è scaduto.", request: "Richiedi un nuovo link", title: "Imposta una nuova password" } : { expired: "This link is invalid or has expired.", request: "Request a new link", title: "Set a new password" };
  return <main className="shell px-4 py-12 sm:px-6"><div className="mx-auto max-w-xl"><h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.title}</h1>{valid ? <div className="mt-7"><PasswordResetForm locale={locale} token={token} /></div> : <section className="mt-7 card p-6"><p className="text-[var(--muted)]">{copy.expired}</p><Link href="/forgot-password" className="btn-primary mt-5">{copy.request}</Link></section>}</div></main>;
}
