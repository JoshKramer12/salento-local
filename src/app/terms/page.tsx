import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { getTermsDocument, LEGAL_DOCUMENTS, formatLegalDate } from "@/lib/legal";
import { getCurrentLocale } from "@/lib/locale";

export default async function TermsPage() {
  const locale = await getCurrentLocale();
  const document = getTermsDocument(locale);

  return (
    <LegalDocumentPage
      locale={locale}
      sections={document.sections}
      summary={document.summary}
      title={document.title}
      updatedAt={formatLegalDate(locale, LEGAL_DOCUMENTS.platformTerms.lastUpdated)}
      version={document.version}
    />
  );
}
