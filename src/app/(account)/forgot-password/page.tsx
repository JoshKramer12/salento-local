import Link from "next/link";

import { PasswordResetRequestForm } from "@/components/account/password-reset-forms";
import { getCurrentLocale } from "@/lib/locale";
import { getOwnerAccessLoginContext } from "@/lib/owner-access-login";

export default async function ForgotPasswordPage() {
  const [locale, ownerAccess] = await Promise.all([getCurrentLocale(), getOwnerAccessLoginContext()]);
  const copy = locale === "it" ? { back: "Torna all'accesso", body: "Ti invieremo un link sicuro per impostare una nuova password.", eyebrow: "Recupera accesso", title: "Password dimenticata?" } : { back: "Back to login", body: "We will send you a secure link to set a new password.", eyebrow: "Recover access", title: "Forgot your password?" };
  return <main className="shell px-4 py-12 sm:px-6"><div className="mx-auto max-w-xl"><p className="section-kicker mb-3">{copy.eyebrow}</p><h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.title}</h1><p className="mt-4 mb-7 text-[var(--muted)]">{ownerAccess ? (locale === "it" ? `Dopo aver impostato la password, potrai gestire ${ownerAccess.businessName}.` : `After setting your password, you can manage ${ownerAccess.businessName}.`) : copy.body}</p><PasswordResetRequestForm email={ownerAccess?.email} locale={locale} lockedEmail={Boolean(ownerAccess)} /><Link href="/login" className="mt-5 inline-block text-sm font-medium text-[var(--primary)]">{copy.back}</Link></div></main>;
}
