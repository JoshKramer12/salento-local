export type PartnerOnboardingProfile = {
  completedAt: Date | null;
  partnerOnboardingCompletedAt: Date | null;
};

export function getPartnerNextRoute(
  profile: PartnerOnboardingProfile | null | undefined,
) {
  if (!profile?.completedAt) {
    return "/onboarding/partner";
  }

  if (!profile.partnerOnboardingCompletedAt) {
    return "/partner/onboarding";
  }

  return "/dashboard";
}

export function hasCompletedPartnerOnboarding(
  profile: PartnerOnboardingProfile | null | undefined,
) {
  return Boolean(profile?.partnerOnboardingCompletedAt);
}

export function getPartnerPayoutSetupSkipDestination(returnTo: string) {
  if (!returnTo.startsWith("/publish")) {
    return returnTo;
  }

  const destination = new URL(returnTo, "https://salentolocal.invalid");
  destination.searchParams.set("skipPayoutSetup", "1");

  return `${destination.pathname}${destination.search}${destination.hash}`;
}
