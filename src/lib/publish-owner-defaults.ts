type AccountContact = { name: string | null; email: string | null; phone: string | null };
export type OwnerContactDefaults = { ownerName: string; ownerEmail: string; ownerPhone: string };
type EstablishedContact = {
  email: string | null;
  phone: string | null;
  businessId: string;
  source: { createdBusinessId: string | null; ownerName: string; ownerEmail: string; ownerPhone: string } | null;
};

/** Only contacts bound to the authenticated Owner qualify; location fields never do. */
export function buildOwnerContactDefaults(account: AccountContact, contacts: EstablishedContact[]): OwnerContactDefaults {
  const normalized = (value: string | null) => value?.trim().toLowerCase() ?? "";
  const phoneKey = (value: string | null) => value?.replace(/\D/g, "") ?? "";
  const trustedSources = contacts.flatMap(({ businessId, email, phone, source }) => {
    if (!source || source.createdBusinessId !== businessId) return [];
    // A claimed listing's historical submitter may have entered another person's details.
    const sameContact = normalized(email)
      ? normalized(email) === normalized(source.ownerEmail)
      : Boolean(phoneKey(phone) && phoneKey(phone) === phoneKey(source.ownerPhone));
    return sameContact ? [source] : [];
  });
  const uniqueValue = (values: Array<string | null>) => {
    const present = [...new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))];
    return present.length === 1 ? present[0] : "";
  };
  return {
    ownerName: account.name?.trim() || uniqueValue(trustedSources.map((source) => source.ownerName)),
    ownerEmail: account.email?.trim() || uniqueValue(contacts.map((contact) => contact.email)),
    ownerPhone: account.phone?.trim() || uniqueValue([
      ...contacts.map((contact) => contact.phone),
      ...trustedSources.map((source) => source.ownerPhone),
    ]),
  };
}

export function initializeOwnerContact<T extends { ownerName: string; ownerEmail: string; ownerPhone: string; ownerHasNoEmail: boolean }>(
  draft: T, defaults: OwnerContactDefaults,
): T {
  return {
    ...draft,
    ownerName: draft.ownerName.trim() ? draft.ownerName : defaults.ownerName,
    ownerPhone: draft.ownerPhone.trim() ? draft.ownerPhone : defaults.ownerPhone,
    ownerEmail: draft.ownerHasNoEmail ? "" : draft.ownerEmail.trim() ? draft.ownerEmail : defaults.ownerEmail,
  };
}
