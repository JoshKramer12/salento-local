import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { getPrivacyDocument, LEGAL_DOCUMENTS, formatLegalDate } from "@/lib/legal";
import { getCurrentLocale } from "@/lib/locale";

export default async function PrivacyPage() {
  const locale = await getCurrentLocale();
  const document = getPrivacyDocument(locale);

  return (
    <LegalDocumentPage
      locale={locale}
      sections={document.sections}
      summary={document.summary}
      title={document.title}
      updatedAt={formatLegalDate(locale, LEGAL_DOCUMENTS.privacyPolicy.lastUpdated)}
      version={document.version}
    />
  );
}
