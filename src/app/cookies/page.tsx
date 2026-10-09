import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { getCookieDocument, LEGAL_DOCUMENTS, formatLegalDate } from "@/lib/legal";
import { getCurrentLocale } from "@/lib/locale";
import { publicUrl } from "@/lib/seo";

export const metadata: Metadata = { alternates: { canonical: publicUrl("/cookies") } };

export default async function CookiesPage() {
  const locale = await getCurrentLocale();
  const document = getCookieDocument(locale);

  return (
    <LegalDocumentPage
      cookieTable={document.cookieTable}
      locale={locale}
      sections={document.sections}
      summary={document.summary}
      title={document.title}
      updatedAt={formatLegalDate(locale, LEGAL_DOCUMENTS.cookiePolicy.lastUpdated)}
      version={document.version}
    />
  );
}
