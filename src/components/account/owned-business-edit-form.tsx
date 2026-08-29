"use client";

import { useActionState } from "react";

import {
  updateOwnedBusinessProfileAction,
  type FormState,
} from "@/app/(account)/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};

type OwnedBusinessEditFormProps = {
  business: {
    address: string;
    description: string;
    email: string;
    id: string;
    name: string;
    openingHoursText: string;
    ownerEmail: string;
    ownerName: string;
    ownerPhone: string;
    phone: string;
    shortDescription: string;
    website: string;
  };
  locale: Locale;
};

export function OwnedBusinessEditForm({
  business,
  locale,
}: OwnedBusinessEditFormProps) {
  const [state, action] = useActionState(updateOwnedBusinessProfileAction, initialState);
  const copy =
    locale === "it"
      ? {
          address: "Indirizzo",
          body:
            "Aggiorna i dettagli principali della tua attivita. Le modifiche saranno visibili subito sulla pagina pubblica.",
          cta: "Salva modifiche",
          description: "Descrizione completa",
          email: "Email pubblica",
          hours: "Orari di apertura",
          name: "Nome attivita",
          ownerEmail: "Email privata proprietario o manager",
          ownerName: "Nome proprietario o manager",
          ownerPhone: "Telefono privato proprietario o manager",
          pending: "Salvataggio in corso...",
          phone: "Telefono pubblico",
          shortDescription: "Descrizione breve",
          website: "Sito web",
        }
      : {
          address: "Address",
          body:
            "Update the main details for your business. Changes will appear on the public page right away.",
          cta: "Save changes",
          description: "Full description",
          email: "Public email",
          hours: "Opening hours",
          name: "Business name",
          ownerEmail: "Private owner or manager email",
          ownerName: "Owner or manager name",
          ownerPhone: "Private owner or manager phone",
          pending: "Saving changes...",
          phone: "Public phone",
          shortDescription: "Short description",
          website: "Website",
        };

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="businessId" value={business.id} />

      <div className="rounded-[1.75rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] p-5">
        <p className="text-sm leading-7 text-[var(--muted)]">{copy.body}</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="field-label">
          <span>{copy.name}</span>
          <input name="businessName" defaultValue={business.name} className="input-field" />
          {state.fieldErrors?.businessName ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.businessName}</span>
          ) : null}
        </label>
        <label className="field-label">
          <span>{copy.shortDescription}</span>
          <input
            name="shortDescription"
            defaultValue={business.shortDescription}
            className="input-field"
          />
          {state.fieldErrors?.shortDescription ? (
            <span className="text-sm text-[var(--accent)]">
              {state.fieldErrors.shortDescription}
            </span>
          ) : null}
        </label>
      </div>

      <label className="field-label">
        <span>{copy.description}</span>
        <textarea
          name="description"
          defaultValue={business.description}
          className="input-field min-h-[12rem]"
        />
        {state.fieldErrors?.description ? (
          <span className="text-sm text-[var(--accent)]">{state.fieldErrors.description}</span>
        ) : null}
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="field-label">
          <span>{copy.address}</span>
          <input name="address" defaultValue={business.address} className="input-field" />
          {state.fieldErrors?.address ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.address}</span>
          ) : null}
        </label>
        <label className="field-label">
          <span>{copy.hours}</span>
          <input
            name="openingHoursText"
            defaultValue={business.openingHoursText}
            className="input-field"
          />
          {state.fieldErrors?.openingHoursText ? (
            <span className="text-sm text-[var(--accent)]">
              {state.fieldErrors.openingHoursText}
            </span>
          ) : null}
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <label className="field-label">
          <span>{copy.phone}</span>
          <input name="phone" defaultValue={business.phone} className="input-field" />
          {state.fieldErrors?.phone ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.phone}</span>
          ) : null}
        </label>
        <label className="field-label">
          <span>{copy.email}</span>
          <input name="email" defaultValue={business.email} className="input-field" />
          {state.fieldErrors?.email ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.email}</span>
          ) : null}
        </label>
        <label className="field-label">
          <span>{copy.website}</span>
          <input name="website" defaultValue={business.website} className="input-field" />
          {state.fieldErrors?.website ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.website}</span>
          ) : null}
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <label className="field-label">
          <span>{copy.ownerName}</span>
          <input name="ownerName" defaultValue={business.ownerName} className="input-field" />
          {state.fieldErrors?.ownerName ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.ownerName}</span>
          ) : null}
        </label>
        <label className="field-label">
          <span>{copy.ownerPhone}</span>
          <input name="ownerPhone" defaultValue={business.ownerPhone} className="input-field" />
          {state.fieldErrors?.ownerPhone ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.ownerPhone}</span>
          ) : null}
        </label>
        <label className="field-label">
          <span>{copy.ownerEmail}</span>
          <input name="ownerEmail" defaultValue={business.ownerEmail} className="input-field" />
          {state.fieldErrors?.ownerEmail ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.ownerEmail}</span>
          ) : null}
        </label>
      </div>

      {state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}

      <FormSubmitButton className="btn-primary w-full sm:w-auto" pendingLabel={copy.pending}>
        {copy.cta}
      </FormSubmitButton>
    </form>
  );
}
