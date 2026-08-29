"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { IconStar, IconStarFilled } from "@tabler/icons-react";

import type { Locale } from "@/lib/i18n";

type ReviewComposerProps = {
  businessId: string;
  businessName: string;
  embedded?: boolean;
  locale?: Locale;
};

export function ReviewComposer({
  businessId,
  businessName,
  embedded = false,
  locale = "it",
}: ReviewComposerProps) {
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [status, setStatus] = useState<"error" | "idle" | "submitting" | "success">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const copy =
    locale === "it"
      ? {
          body:
            "Condividi un commento breve e pratico per aiutare altri visitatori e residenti a capire meglio questo posto.",
          name: "Il tuo nome",
          placeholderBody:
            "Condividi dettagli pratici utili per un altro visitatore o residente.",
          placeholderName: "Maria",
          placeholderTitle: `Perche ${businessName} ti ha colpito?`,
          rating: "Valutazione",
          review: "Recensione",
          saveError: "Impossibile salvare la recensione in questo momento.",
          saving: "Salvataggio...",
          submit: "Invia recensione",
          success: `Grazie. La tua recensione per ${businessName} e stata salvata.`,
          title: "Lascia una recensione",
          titleField: "Titolo",
        }
      : {
          body:
            "Share a short, practical note to help other visitors and locals understand this place better.",
          name: "Your name",
          placeholderBody:
            "Share practical details that would help another visitor or local.",
          placeholderName: "Maria",
          placeholderTitle: `What stood out to you about ${businessName}?`,
          rating: "Rating",
          review: "Review",
          saveError: "Unable to save your review right now.",
          saving: "Saving...",
          submit: "Submit review",
          success: `Thanks. Your review for ${businessName} has been saved.`,
          title: "Leave a review",
          titleField: "Title",
        };

  const content = (
    <>
      <div className="space-y-2">
        {embedded ? null : <span className="section-kicker">{copy.title}</span>}
        <h3 className={`${embedded ? "text-2xl" : "text-3xl"} font-serif text-[var(--foreground)]`}>
          {copy.title}
        </h3>
        <p className="text-sm leading-7 text-[var(--muted)]">{copy.body}</p>
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
            const response = await fetch("/api/reviews", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                businessId,
                authorName: formData.get("name"),
                rating: Number(formData.get("rating") ?? 5),
                title: formData.get("title"),
                body: formData.get("body"),
              }),
            });

            const payload = (await response.json()) as { error?: string; ok?: boolean };

            if (!response.ok || !payload.ok) {
              throw new Error(payload.error ?? copy.saveError);
            }

            startTransition(() => {
              setStatus("success");
              setMessage(copy.success);
              setRating(5);
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
            <input name="name" required placeholder={copy.placeholderName} className="input-field" />
          </label>
          <div className="field-label">
            {copy.rating}
            <input type="hidden" name="rating" value={rating} />
            <div className="flex min-h-[3.5rem] items-center gap-1 rounded-[1.5rem] border border-[var(--border)] bg-[var(--card)] px-4">
              {Array.from({ length: 5 }, (_, index) => {
                const value = index + 1;
                const filled = value <= rating;
                const StarIcon = filled ? IconStarFilled : IconStar;

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRating(value)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-amber-500 transition-transform hover:scale-105"
                    aria-label={`${copy.rating}: ${value}`}
                    aria-pressed={filled}
                  >
                    <StarIcon size={22} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <label className="field-label">
          {copy.titleField}
          <input
            name="title"
            required
            placeholder={copy.placeholderTitle}
            className="input-field"
          />
        </label>

        <label className="field-label">
          {copy.review}
          <textarea
            name="body"
            required
            rows={5}
            placeholder={copy.placeholderBody}
            className="input-field resize-y"
          />
        </label>

        <button type="submit" className="btn-primary justify-center">
          {status === "submitting" ? copy.saving : copy.submit}
        </button>
      </form>

      {message ? (
        <div
          className={`mt-4 rounded-2xl px-4 py-3 text-sm text-[var(--foreground)] ${
            status === "error"
              ? "border border-[rgba(217,108,59,0.28)] bg-[rgba(217,108,59,0.1)]"
              : "border border-[rgba(111,143,78,0.25)] bg-[rgba(111,143,78,0.1)]"
          }`}
        >
          {message}
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return <div className="mt-8 border-t border-[var(--border)] pt-8">{content}</div>;
  }

  return (
    <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] sm:p-8">
      {content}
    </div>
  );
}
