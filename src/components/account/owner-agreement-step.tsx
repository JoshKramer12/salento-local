"use client";

import Link from "next/link";
import {
  IconBuildingStore,
  IconCheck,
  IconChevronDown,
  IconFileText,
  IconMapPin,
} from "@tabler/icons-react";
import { useState } from "react";

import { refundCopy } from "@/lib/refund-copy";
import type { Locale } from "@/lib/i18n";

type OwnerAgreementStepProps = {
  accepted: boolean;
  businessName: string;
  firstYearPriceLabel: string;
  keyTerms: readonly string[];
  locale: Locale;
  onAcceptedChange: (accepted: boolean) => void;
  photoUrl?: string;
  privacyLink: { href: string; label: string };
  renewalPriceLabel: string;
  termsLink: { href: string; label: string };
  townName: string;
};

const agreementCopy = {
  en: {
    eyebrow: "Terms and authorisation",
    heading: "Confirm before signing",
    intro: "Review your membership and accept the terms to continue.",
    membership: "Membership",
    membershipDuration: "for 365 days",
    renewal: "Renewal",
    renewalFrequency: "/year",
    renewalMethod: "You'll choose your renewal method before payment.",
    keyTerms: "Key terms",
    keyTermsDescription: "Read a short summary of what you're agreeing to.",
    legalDocuments: "Legal documents",
    legalDocumentsDescription: "Read our full terms and privacy policy.",
    acceptancePrefix: "I have read and accept the",
    acceptanceSuffix: ".",
  },
  it: {
    eyebrow: "Termini e autorizzazione",
    heading: "Conferma prima di firmare",
    intro: "Rivedi l'adesione e accetta i termini per continuare.",
    membership: "Adesione",
    membershipDuration: "per 365 giorni",
    renewal: "Rinnovo",
    renewalFrequency: "/anno",
    renewalMethod: "Sceglierai come rinnovare prima del pagamento.",
    keyTerms: "Punti principali",
    keyTermsDescription: "Leggi un breve riepilogo di ciò che accetti.",
    legalDocuments: "Documenti legali",
    legalDocumentsDescription: "Leggi i termini completi e l'informativa sulla privacy.",
    acceptancePrefix: "Ho letto e accetto i",
    acceptanceSuffix: ".",
  },
} as const;

export function OwnerAgreementStep({
  accepted,
  businessName,
  firstYearPriceLabel,
  keyTerms,
  locale,
  onAcceptedChange,
  photoUrl,
  privacyLink,
  renewalPriceLabel,
  termsLink,
  townName,
}: OwnerAgreementStepProps) {
  const copy = agreementCopy[locale];
  const [keyTermsOpen, setKeyTermsOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);

  return (
    <div className="owner-agreement">
      <header className="owner-agreement__header">
        <p className="owner-agreement__eyebrow">{copy.eyebrow}</p>
        <h1>{copy.heading}</h1>
        <p>{copy.intro}</p>
      </header>

      <section className="owner-agreement__summary" aria-label={businessName}>
        <div className="owner-agreement__identity">
          {photoUrl ? (
            <img src={photoUrl} alt="" className="owner-agreement__photo" />
          ) : (
            <span className="owner-agreement__photo owner-agreement__photo--placeholder" aria-hidden="true">
              <IconBuildingStore size={27} strokeWidth={1.6} />
            </span>
          )}
          <div className="owner-agreement__business">
            <h2>{businessName}</h2>
            <p><IconMapPin size={18} aria-hidden="true" />{townName}</p>
          </div>
        </div>
        <dl className="owner-agreement__prices">
          <div><dt>{copy.membership}</dt><dd>{firstYearPriceLabel} {copy.membershipDuration}</dd></div>
          <div><dt>{copy.renewal}</dt><dd>{renewalPriceLabel}{copy.renewalFrequency}</dd></div>
        </dl>
        <p className="owner-agreement__renewal-note">{copy.renewalMethod}</p>
      </section>

      <section className="owner-agreement__disclosure">
        <button
          type="button"
          aria-controls="owner-agreement-key-terms"
          aria-expanded={keyTermsOpen}
          onClick={() => setKeyTermsOpen((open) => !open)}
          className="owner-agreement__disclosure-button"
        >
          <span className="owner-agreement__disclosure-icon" aria-hidden="true"><IconFileText size={24} /></span>
          <span className="owner-agreement__disclosure-heading"><strong>{copy.keyTerms}</strong><span>{copy.keyTermsDescription}</span></span>
          <IconChevronDown size={22} className={keyTermsOpen ? "owner-agreement__chevron owner-agreement__chevron--open" : "owner-agreement__chevron"} aria-hidden="true" />
        </button>
        <div id="owner-agreement-key-terms" hidden={!keyTermsOpen} className="owner-agreement__disclosure-body">
          <ul>{keyTerms.map((term) => <li key={term}><IconCheck size={18} aria-hidden="true" /><span>{term}</span></li>)}</ul>
          <div className="mt-4 border-t border-[var(--border)] pt-4"><h3 className="font-semibold">{refundCopy(locale).moneyBack}</h3><p className="mt-2 text-sm leading-6">{refundCopy(locale).agreement(firstYearPriceLabel)}</p><p className="mt-2 text-sm leading-6">{refundCopy(locale).agreementMethods}</p></div>
        </div>
      </section>

      <section className="owner-agreement__disclosure owner-agreement__disclosure--documents">
        <button
          type="button"
          aria-controls="owner-agreement-documents"
          aria-expanded={documentsOpen}
          onClick={() => setDocumentsOpen((open) => !open)}
          className="owner-agreement__disclosure-button"
        >
          <span className="owner-agreement__disclosure-icon" aria-hidden="true"><IconFileText size={24} /></span>
          <span className="owner-agreement__disclosure-heading"><strong>{copy.legalDocuments}</strong><span>{copy.legalDocumentsDescription}</span></span>
          <IconChevronDown size={22} className={documentsOpen ? "owner-agreement__chevron owner-agreement__chevron--open" : "owner-agreement__chevron"} aria-hidden="true" />
        </button>
        <div id="owner-agreement-documents" hidden={!documentsOpen} className="owner-agreement__disclosure-body owner-agreement__documents">
          <Link href={termsLink.href} target="_blank" rel="noopener noreferrer">{termsLink.label}</Link>
          <Link href={privacyLink.href} target="_blank" rel="noopener noreferrer">{privacyLink.label}</Link>
        </div>
      </section>

      <label className="owner-agreement__acceptance">
        <input type="checkbox" checked={accepted} onChange={(event) => onAcceptedChange(event.target.checked)} />
        <span>{copy.acceptancePrefix}{" "}{termsLink.label}{copy.acceptanceSuffix}</span>
      </label>
    </div>
  );
}
