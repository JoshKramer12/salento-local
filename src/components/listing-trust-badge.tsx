import {
  IconAlertTriangle,
  IconCircleCheck,
  IconMap2,
  IconUserCheck,
} from "@tabler/icons-react";

import {
  formatVerificationDate,
  getVerificationMeta,
  getVerificationPillClass,
} from "@/lib/site";
import type { Locale } from "@/lib/i18n";

type ListingTrustBadgeProps = {
  verificationStatus:
    | "COMMUNITY_VERIFIED"
    | "OPEN_DATA"
    | "OWNER_VERIFIED"
    | "REPORTED_STALE"
    | "UNVERIFIED";
  sourceConfidence: number;
  isLikelyClosed?: boolean;
  lastVerifiedAt?: Date | null;
  compact?: boolean;
  locale?: Locale;
};

export function ListingTrustBadge({
  verificationStatus,
  sourceConfidence,
  isLikelyClosed = false,
  lastVerifiedAt,
  compact = false,
  locale = "en",
}: ListingTrustBadgeProps) {
  const meta = getVerificationMeta(
    verificationStatus,
    sourceConfidence,
    isLikelyClosed,
    locale,
  );

  const Icon =
    meta.tone === "warning"
      ? IconAlertTriangle
      : verificationStatus === "OWNER_VERIFIED"
        ? IconUserCheck
        : verificationStatus === "COMMUNITY_VERIFIED"
          ? IconCircleCheck
          : IconMap2;

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "items-start"}`}>
      <span className={getVerificationPillClass(meta.tone)}>
        <Icon size={14} />
        {meta.label}
      </span>
      {compact ? null : (
        <span className="pill-muted">
          {locale === "it" ? "Aggiornata" : "Updated"} {formatVerificationDate(lastVerifiedAt, locale)}
        </span>
      )}
    </div>
  );
}
