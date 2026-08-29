"use client";

import { IconAlertCircle } from "@tabler/icons-react";
import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import type { Locale } from "@/lib/i18n";

type BusinessReportClosedCardProps = {
  businessId: string;
  businessName: string;
  locale?: Locale;
};

export function BusinessReportClosedCard({
  businessId,
  businessName,
  locale = "it",
}: BusinessReportClosedCardProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"error" | "idle" | "submitting" | "success">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const copy =
    locale === "it"
      ? {
          body:
            `Se hai notato che ${businessName} ha chiuso o sembra non essere piu aggiornata, faccelo sapere.`,
          button: "Segnala chiuso",
          email: "Email",
          message: "Messaggio",
          name: "Nome",
          placeholderBody:
            "Condividi quello che hai visto, ad esempio un'insegna chiusa o un trasferimento.",
          placeholderName: "Giulia",
          saveError: "Impossibile inviare la segnalazione in questo momento.",
          saving: "Invio in corso...",
          success:
            `Grazie. ${businessName} e stata segnalata per un controllo di aggiornamento.`,
          title: "Questo posto e chiuso?",
        }
      : {
          body:
            `If you noticed ${businessName} has closed or seems outdated, send a quick note so it can be reviewed.`,
          button: "Report closed",
          email: "Email",
          message: "Message",
          name: "Name",
          placeholderBody:
            "Share what you noticed, such as a closed sign or a move to a new address.",
          placeholderName: "Giulia",
          saveError: "Unable to send your report right now.",
          saving: "Sending...",
          success: `Thanks. ${businessName} has been flagged for an update check.`,
          title: "Is this place closed?",
        };

  return (
    <section className="rounded-[2rem] border border-[rgba(191,91,42,0.16)] bg-[linear-gradient(145deg,rgba(255,251,247,0.96),rgba(255,255,255,0.98))] p-6 shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(191,91,42,0.1)] text-[var(--accent)]">
          <IconAlertCircle size={20} />
        </span>
        <div>
          <p className="section-kicker">{copy.title}</p>
          <h2 className="mt-2 font-serif text-2xl text-[var(--foreground)]">{copy.title}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">{copy.body}</p>
        </div>
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
                message: formData.get("message"),
                senderEmail: formData.get("senderEmail"),
                senderName: formData.get("senderName"),
                type: "REPORT_CLOSED",
              }),
            });

            const payload = (await response.json()) as { error?: string; ok?: boolean };

            if (!response.ok || !payload.ok) {
              throw new Error(payload.error ?? copy.saveError);
            }

            startTransition(() => {
              setStatus("success");
              setMessage(copy.success);
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
            rows={4}
            maxLength={1500}
            placeholder={copy.placeholderBody}
            className="input-field resize-y"
          />
        </label>

        <div className="flex justify-start">
          <button
            type="submit"
            disabled={status === "submitting"}
            className="btn-secondary min-h-[3rem] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {status === "submitting" ? copy.saving : copy.button}
          </button>
        </div>
      </form>

      {message ? (
        <div
          className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
            status === "error"
              ? "border border-[rgba(217,108,59,0.28)] bg-[rgba(217,108,59,0.1)] text-[var(--foreground)]"
              : "border border-[rgba(42,98,87,0.24)] bg-[rgba(42,98,87,0.08)] text-[var(--foreground)]"
          }`}
        >
          {message}
        </div>
      ) : null}
    </section>
  );
}
