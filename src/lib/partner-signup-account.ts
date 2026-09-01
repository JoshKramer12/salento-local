import type { Locale } from "@/lib/i18n";

export type CompletePartnerSignupInput = {
  baseTownOrArea: string;
  birthDate: string;
  email: string;
  firstName: string;
  heardAbout: string;
  lastName: string;
  locale: Locale;
  passwordHash: string;
  phone: string;
  username: string;
  whatsapp?: string;
};

type PartnerSignupPersistence = {
  createProfile: (data: {
    baseTownOrArea: string;
    billingAddress: string;
    birthDate: Date;
    completedAt: Date;
    fullName: string;
    heardAbout: string;
    legalFullName: string;
    phone: string;
    preferredLanguage: string;
    taxIdOrVatNumber: string;
    understandsDirectPayment: boolean;
    understandsNoCash: boolean;
    understandsNoNegotiation: boolean;
    understandsNoPricing: boolean;
    userId: string;
    whatsapp: string | null;
  }) => Promise<unknown>;
  createUser: (data: {
    email: string;
    name: string;
    passwordHash: string;
    profileCompleted: boolean;
    role: "GETTER";
    username: string;
  }) => Promise<{ id: string }>;
  recordLegalAcceptance: (userId: string) => Promise<unknown>;
};

export async function createCompletePartnerSignup(
  input: CompletePartnerSignupInput,
  persistence: PartnerSignupPersistence,
) {
  const fullName = `${input.firstName} ${input.lastName}`.trim();
  const user = await persistence.createUser({
    email: input.email,
    name: fullName,
    passwordHash: input.passwordHash,
    profileCompleted: true,
    role: "GETTER",
    username: input.username,
  });

  await persistence.createProfile({
    baseTownOrArea: input.baseTownOrArea,
    billingAddress: "",
    birthDate: new Date(input.birthDate),
    completedAt: new Date(),
    fullName,
    heardAbout: input.heardAbout,
    legalFullName: fullName,
    phone: input.phone,
    preferredLanguage: input.locale,
    taxIdOrVatNumber: "",
    understandsDirectPayment: true,
    understandsNoCash: true,
    understandsNoNegotiation: true,
    understandsNoPricing: true,
    userId: user.id,
    whatsapp: input.whatsapp?.trim() || null,
  });

  await persistence.recordLegalAcceptance(user.id);

  return user;
}
