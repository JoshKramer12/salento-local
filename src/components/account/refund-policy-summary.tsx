import Link from "next/link";
import { refundCopy } from "@/lib/refund-copy";
import type { Locale } from "@/lib/i18n";

export function RefundPolicySummary({ locale, bank = false }: { locale: Locale; bank?: boolean }) {
  const c = refundCopy(locale);
  return <section className="mb-5 max-w-2xl border-l-2 border-[var(--primary)] pl-4 text-sm leading-6 text-[var(--muted-strong)]"><h2 className="font-semibold text-[var(--foreground)]">{c.moneyBack}</h2><p className="mt-2">{c.checkout}</p><p className="mt-2">{c.checkoutSaved}</p>{bank ? <p className="mt-2">{c.checkoutBank}</p> : null}<Link className="mt-2 inline-flex min-h-11 items-center font-semibold text-[var(--primary)] underline" href="/terms#refunds">{c.terms}</Link></section>;
}
