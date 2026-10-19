import { LEGAL_DOCUMENTS } from "@/lib/legal";
import { normalizeEmail, normalizePhoneNumber } from "@/lib/validation";

type SubmissionUser = {
  email: string | null;
  legalAcceptances: Array<{ documentType: string; documentVersion: string }>;
  localPartnerProfile: { fullName: string; phone: string; whatsapp: string | null } | null;
  role: string;
};

/** Only the submission's Partner may be shown, and contact fields require that Partner's current terms acceptance. */
export function getPartnerPublicationContact(user: SubmissionUser) {
  const name = user.role === "GETTER" ? user.localPartnerProfile?.fullName.trim() || null : null;
  if (!name) return { partnerName: null, partnerEmail: null, partnerPhone: null };

  const accepted = user.legalAcceptances.some((acceptance) =>
    acceptance.documentType === "PARTNER_TERMS" &&
    acceptance.documentVersion === LEGAL_DOCUMENTS.partnerTerms.version,
  );
  if (!accepted) return { partnerName: name, partnerEmail: null, partnerPhone: null };

  const email = normalizeEmail(user.email ?? "");
  const validEmail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
  const phone = normalizePhoneNumber(user.localPartnerProfile?.whatsapp) ??
    normalizePhoneNumber(user.localPartnerProfile?.phone);
  return { partnerName: name, partnerEmail: validEmail, partnerPhone: phone };
}
