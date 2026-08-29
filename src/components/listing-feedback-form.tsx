"use client";

import {
  IconBuildingStore,
  IconFlag3,
  IconPencil,
} from "@tabler/icons-react";
import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import type { Locale } from "@/lib/i18n";

type ListingFeedbackFormProps = {
  businessId: string;
  businessName: string;
  locale?: Locale;
};

export function ListingFeedbackForm({
  businessId,
  businessName,
  locale = "it",
}: ListingFeedbackFormProps) {
  const router = useRouter();
  const feedbackOptions = [
    {
      type: "SUGGEST_EDIT",
      label: locale === "it" ? "Suggerisci una modifica" : "Suggest an edit",
      description:
        locale === "it"
          ? "Correggi indirizzo, contatti, orari o altre informazioni."
          : "Correct the address, contacts, hours, or other details.",
      icon: IconPencil,
    },
    {
      type: "REPORT_CLOSED",
      label: locale === "it" ? "Segnala chiuso" : "Report closed",
      description:
        locale === "it"
          ? "Indica un luogo che sembra chiuso o molto datato."
          : "Flag a place that seems closed or badly outdated.",
      icon: IconFlag3,
    },
    {
      type: "CLAIM_LISTING",
      label: locale === "it" ? "Rivendica scheda" : "Claim listing",
      description:
        locale === "it"
          ? "I proprietari possono chiedere una futura verifica diretta."
          : "Owners can ask for a future direct verification flow.",
      icon: IconBuildingStore,
    },
  ] as const;
  const [selectedType, setSelectedType] =
    useState<(typeof feedbackOptions)[number]["type"]>("SUGGEST_EDIT");
  const [status, setStatus] = useState<"error" | "idle" | "submitting" | "success">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const copy =
    locale === "it"
      ? {
          body:
            "Salento Local funziona meglio quando residenti, visitatori e proprietari aiutano a confermare i dettagli nel tempo.",
          email: "Email",
          message: "Messaggio",
          name: "Nome",
          placeholderMessage:
            "Condividi il dettaglio da aggiornare, confermare o controllare.",
          placeholderName: "Giulia",
          saveError: "Impossibile salvare l'aggiornamento in questo momento.",
          saving: "Salvataggio...",
          section: "Mantieni accurata questa scheda",
          submit: "Invia aggiornamento",
          successClosed:
            "Grazie. Questa scheda e stata segnalata per un controllo di aggiornamento.",
          successUpdate:
            "Grazie. Il tuo aggiornamento e stato salvato e puo migliorare questa scheda.",
          title: `Suggerisci un aggiornamento per ${businessName}`,
        }
      : {
          body:
            "Salento Local works better when locals, visitors, and owners help confirm details over time.",
          email: "Email",
          message: "Message",
          name: "Name",
          placeholderMessage:
            "Share the detail that should be updated, confirmed, or checked.",
          placeholderName: "Giulia",
          saveError: "Unable to save your update right now.",
          saving: "Saving...",
          section: "Keep this listing accurate",
          submit: "Send update",
          successClosed:
            "Thanks. This listing has been flagged for an update check.",
          successUpdate:
            "Thanks. Your update has been saved and can help improve this listing.",
          title: `Suggest an update for ${businessName}`,
        };

  return (
    <div id="listing-feedback" className="card p-6">
      <span className="section-kicker">{copy.section}</span>
      <h2 className="mt-3 text-2xl font-semibold text-[var(--color-charcoal)]">
        {copy.title}
      </h2>
      <p className="mt-3 text-sm leading-7 text-[var(--color-muted)]">
        {copy.body}
      </p>

      <div className="mt-5 grid gap-3">
        {feedbackOptions.map((option) => {
          const Icon = option.icon;
          const selected = option.type === selectedType;

          return (
            <button
              key={option.type}
              type="button"
              onClick={() => setSelectedType(option.type)}
              className={`rounded-[1.35rem] border px-4 py-4 text-left transition ${
                selected
                  ? "border-[rgba(30,111,140,0.35)] bg-[rgba(30,111,140,0.08)]"
                  : "border-[var(--color-border)] bg-white"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-[var(--color-blue)]">
                  <Icon size={18} />
                </span>
                <div>
                  <div className="font-semibold text-[var(--color-charcoal)]">
                    {option.label}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">
                    {option.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <form
        className="mt-5 grid gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const formData = new FormData(form);

          setStatus("submitting");
          setMessage("");

          try {
            const response = await fetch("/api/listing-feedback", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                businessId,
                type: selectedType,
                senderName: formData.get("senderName"),
                senderEmail: formData.get("senderEmail"),
                message: formData.get("message"),
              }),
            });

            const payload = (await response.json()) as { error?: string; ok?: boolean };

            if (!response.ok || !payload.ok) {
              throw new Error(payload.error ?? copy.saveError);
            }

            startTransition(() => {
              setStatus("success");
              setMessage(
                selectedType === "REPORT_CLOSED"
                  ? copy.successClosed
                  : copy.successUpdate,
              );
              router.refresh();
            });

            form.reset();
          } catch (error) {
            setStatus("error");
            setMessage(error instanceof Error ? error.message : copy.saveError);
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field-label">
            {copy.name}
            <input
              name="senderName"
              placeholder={copy.placeholderName}
              className="input-field"
              maxLength={80}
            />
          </label>
          <label className="field-label">
            {copy.email}
            <input
              name="senderEmail"
              type="email"
              placeholder="you@example.com"
              className="input-field"
              maxLength={120}
            />
          </label>
        </div>

        <label className="field-label">
          {copy.message}
          <textarea
            name="message"
            required
            rows={5}
            maxLength={1500}
            placeholder={copy.placeholderMessage}
            className="input-field resize-y"
          />
        </label>

        <button
          type="submit"
          disabled={status === "submitting"}
          className="btn-primary justify-center disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === "submitting" ? copy.saving : copy.submit}
        </button>
      </form>

      {message ? (
        <div
          className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
            status === "error"
              ? "border border-[rgba(217,108,59,0.28)] bg-[rgba(217,108,59,0.1)] text-[var(--color-charcoal)]"
              : "border border-[rgba(111,143,78,0.25)] bg-[rgba(111,143,78,0.12)] text-[var(--color-charcoal)]"
          }`}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
