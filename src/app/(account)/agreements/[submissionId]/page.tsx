import Link from "next/link";
import { IconFileDescription, IconInfoCircle } from "@tabler/icons-react";

import { DocumentActions } from "@/components/account/document-actions";
import { auth } from "@/lib/auth";
import { getCurrentLocale } from "@/lib/locale";
import { buildAgreementPageUrl, getSignedAgreementData } from "@/lib/receipts";

type PageProps = { params: Promise<{ submissionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
function one(value: string | string[] | undefined) { return typeof value === "string" ? value : null; }

export default async function SignedAgreementPage({ params, searchParams }: PageProps) {
  const [{ submissionId }, query, locale] = await Promise.all([params, searchParams, getCurrentLocale()]);
  const checkoutSessionId = one(query.session);
  const viewer = checkoutSessionId ? null : (await auth())?.user;
  const agreement = await getSignedAgreementData({
    allowInternal: Boolean(checkoutSessionId), checkoutSessionId, submissionId,
    viewerId: viewer?.id ?? null, viewerRole: viewer?.role ?? null,
  });
  const italian = locale === "it";
  if (!agreement) return <main className="shell px-4 py-12 sm:px-6"><section className="card mx-auto max-w-xl p-6 text-center sm:p-8"><IconInfoCircle className="mx-auto text-[var(--accent)]" size={34} /><h1 className="mt-4 font-serif text-3xl">{italian ? "Accordo non disponibile" : "Agreement unavailable"}</h1><p className="mt-3 leading-7 text-[var(--muted)]">{italian ? "Non hai l'accesso necessario a questo accordo." : "You do not have access to this agreement."}</p><Link href="/dashboard" className="btn-secondary mt-6">{italian ? "Torna alla dashboard" : "Back to dashboard"}</Link></section></main>;
  const apiUrl = `/api/agreements/${encodeURIComponent(submissionId)}${checkoutSessionId ? `?session=${encodeURIComponent(checkoutSessionId)}&locale=${locale}` : `?locale=${locale}`}`;
  return <main className="shell px-4 py-10 sm:px-6"><section className="card mx-auto max-w-xl p-6 sm:p-8"><IconFileDescription className="text-[var(--primary)]" size={34} /><p className="section-kicker mt-5">{italian ? "DOCUMENTI" : "DOCUMENTS"}</p><h1 className="mt-2 font-serif text-3xl text-[var(--foreground)]">{italian ? "Accordo di adesione firmato" : "Signed Membership Agreement"}</h1><p className="mt-3 leading-7 text-[var(--muted)]">{italian ? "I termini e l'accettazione originale della tua attività." : "Your business's original terms and acceptance record."}</p><div className="mt-6"><DocumentActions downloadUrl={`${apiUrl}${checkoutSessionId ? "&" : "?"}download=1`} locale={locale} shareUrl={buildAgreementPageUrl(submissionId)} title={italian ? "Accordo di adesione firmato Salento Local" : "Salento Local Signed Membership Agreement"} viewUrl={apiUrl} /></div></section></main>;
}
