import Link from "next/link";

import { getAudienceTermsLink, getLegalLinks, type LegalAudience } from "@/lib/legal";
import type { Locale } from "@/lib/i18n";

type LegalLinkProps = {
  audience: LegalAudience;
  locale: Locale;
  targetBlank?: boolean;
  variant?: "acceptance" | "info";
};

function LegalAnchor({
  href,
  label,
  targetBlank = true,
}: {
  href: string;
  label: string;
  targetBlank?: boolean;
}) {
  return (
    <Link
      href={href}
      target={targetBlank ? "_blank" : undefined}
      rel={targetBlank ? "noopener noreferrer" : undefined}
      className="font-medium text-[var(--primary)] underline underline-offset-4"
    >
      {label}
    </Link>
  );
}

export function LegalConsentCopy({
  audience,
  locale,
  targetBlank = true,
  variant = "acceptance",
}: LegalLinkProps) {
  const termsLink = getAudienceTermsLink(locale, audience);
  const legalLinks = getLegalLinks(locale);

  if (locale === "it") {
    if (variant === "info") {
      return (
        <>
          Consulta{" "}
          <LegalAnchor
            href={termsLink.href}
            label={termsLink.label}
            targetBlank={targetBlank}
          />{" "}
          ,{" "}
          <LegalAnchor
            href={legalLinks.privacy.href}
            label={legalLinks.privacy.label}
            targetBlank={targetBlank}
          />{" "}
          e{" "}
          <LegalAnchor
            href={legalLinks.cookies.href}
            label={legalLinks.cookies.label}
            targetBlank={targetBlank}
          />{" "}
          prima di continuare.
        </>
      );
    }

    return audience === "partner" ? (
      <>
        Ho letto e accetto i{" "}
        <LegalAnchor href={termsLink.href} label={termsLink.label} targetBlank={targetBlank} /> e
        dichiaro di aver preso visione dell&apos;{" "}
        <LegalAnchor
          href={legalLinks.privacy.href}
          label={legalLinks.privacy.label}
          targetBlank={targetBlank}
        />{" "}
        e della{" "}
        <LegalAnchor
          href={legalLinks.cookies.href}
          label={legalLinks.cookies.label}
          targetBlank={targetBlank}
        />
        .
      </>
    ) : (
      <>
        Ho letto e accetto i{" "}
        <LegalAnchor href={termsLink.href} label={termsLink.label} targetBlank={targetBlank} /> e
        dichiaro di aver preso visione dell&apos;{" "}
        <LegalAnchor
          href={legalLinks.privacy.href}
          label={legalLinks.privacy.label}
          targetBlank={targetBlank}
        />{" "}
        e della{" "}
        <LegalAnchor
          href={legalLinks.cookies.href}
          label={legalLinks.cookies.label}
          targetBlank={targetBlank}
        />
        .
      </>
    );
  }

  if (variant === "info") {
    return (
      <>
        Read the{" "}
        <LegalAnchor href={termsLink.href} label={termsLink.label} targetBlank={targetBlank} />,{" "}
        <LegalAnchor
          href={legalLinks.privacy.href}
          label={legalLinks.privacy.label}
          targetBlank={targetBlank}
        />
        , and{" "}
        <LegalAnchor
          href={legalLinks.cookies.href}
          label={legalLinks.cookies.label}
          targetBlank={targetBlank}
        />{" "}
        before continuing.
      </>
    );
  }

  return audience === "partner" ? (
    <>
      I have read and agree to the{" "}
      <LegalAnchor href={termsLink.href} label={termsLink.label} targetBlank={targetBlank} /> and
      acknowledge the{" "}
      <LegalAnchor
        href={legalLinks.privacy.href}
        label={legalLinks.privacy.label}
        targetBlank={targetBlank}
      />{" "}
      and{" "}
      <LegalAnchor
        href={legalLinks.cookies.href}
        label={legalLinks.cookies.label}
        targetBlank={targetBlank}
      />
      .
    </>
  ) : (
    <>
      I have read and agree to the{" "}
      <LegalAnchor href={termsLink.href} label={termsLink.label} targetBlank={targetBlank} /> and
      acknowledge the{" "}
      <LegalAnchor
        href={legalLinks.privacy.href}
        label={legalLinks.privacy.label}
        targetBlank={targetBlank}
      />{" "}
      and{" "}
      <LegalAnchor
        href={legalLinks.cookies.href}
        label={legalLinks.cookies.label}
        targetBlank={targetBlank}
      />
      .
    </>
  );
}
