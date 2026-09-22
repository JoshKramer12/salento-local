import { isHealthyAutomaticRenewal } from "@/lib/membership-reminders";
import type { Locale } from "@/lib/i18n";
import { getBusinessPhotoUrls } from "@/lib/business-photos";
import { getWebsiteDisplayLabel, normalizeUrlInput } from "@/lib/business-links";
import { buildBusinessImage, buildBusinessPhoto } from "@/lib/site";
import { BusinessOwnerAccountNav } from "@/components/account/business-owner-account-nav";

import {
  BusinessOwnerDashboardClient,
  type DashboardBusiness,
} from "@/components/account/business-owner-dashboard-client";

type OwnerDashboardBusiness = Omit<DashboardBusiness, "images" | "membership" | "websiteLabel"> & {
  category: { name: string; slug: string };
  heroImageSeed: string;
  images: Array<{ alt: string; id: string; url: string }>;
  submissions: Array<{ photoUrls: unknown }>;
  membership: Omit<NonNullable<DashboardBusiness["membership"]>, "automaticRenewalHealthy"> | null;
};

type BusinessOwnerDashboardProps = {
  businesses: OwnerDashboardBusiness[];
  draftCount: number;
  firstName: string;
  locale: Locale;
};

/** Keeps lifecycle and Stripe-health decisions on the server. Selection only
 * changes which authorised business is presented; it cannot change a term. */
export function BusinessOwnerDashboard({ businesses, draftCount, firstName, locale }: BusinessOwnerDashboardProps) {
  const dashboardBusinesses: DashboardBusiness[] = businesses.map((business) => {
    const fallbackImage = buildBusinessImage({ heroImageSeed: business.heroImageSeed, name: business.name }, business.category.slug, 1500);
    const images = getBusinessPhotoUrls(business.images, business.submissions[0]?.photoUrls).map((url, index) => {
      const stored = business.images.find((image) => image.url === url);
      return {
        alt: stored?.alt || `${business.name} ${index + 1}`,
        id: stored?.id || `submission-photo-${index}`,
        url: buildBusinessPhoto(url, 1500, { label: business.name, seed: business.heroImageSeed, type: business.category.slug === "beaches" ? "beach" : "business" }) ?? fallbackImage,
      };
    });

    return {
      ...business,
      images,
      website: normalizeUrlInput(business.website) ?? null,
      websiteLabel: getWebsiteDisplayLabel(business.website),
      membership: business.membership ? {
        ...business.membership,
        automaticRenewalHealthy: isHealthyAutomaticRenewal(business.membership),
      } : null,
    };
  });

  return <BusinessOwnerDashboardClient accountNavigation={<BusinessOwnerAccountNav active="businesses" draftCount={draftCount} locale={locale} />} businesses={dashboardBusinesses} firstName={firstName} locale={locale} />;
}
