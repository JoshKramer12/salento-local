"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { Locale } from "@/lib/i18n";

type DeleteResult = {
  error?: string;
};

type DraftDeleteControlProps = {
  businessName: string;
  locale: Locale;
  onDelete: () => Promise<DeleteResult>;
  onDeleted: () => void;
};

export function DraftDeleteControl({
  businessName,
  locale,
  onDelete,
  onDeleted,
}: DraftDeleteControlProps) {
  const [error, setError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const hasOpenedRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogDescriptionId = useId();
  const dialogTitleId = useId();
  const italian = locale === "it";
  const copy = italian
    ? {
        cancel: "Annulla",
        confirm: "Elimina bozza",
        deleting: "Eliminazione...",
        description: "Sei sicuro di voler eliminare questa bozza? L'operazione non può essere annullata.",
        error: "Non siamo riusciti a eliminare la bozza. Riprova tra un momento.",
        title: "Eliminare questa bozza?",
        trigger: "Elimina bozza",
      }
    : {
        cancel: "Cancel",
        confirm: "Delete draft",
        deleting: "Deleting...",
        description: "Are you sure you want to delete this draft? This cannot be undone.",
        error: "We couldn't delete the draft. Please try again in a moment.",
        title: "Delete this draft?",
        trigger: "Delete draft",
      };

  useEffect(() => {
    if (isOpen) {
      hasOpenedRef.current = true;
      cancelButtonRef.current?.focus();
    } else if (hasOpenedRef.current) {
      triggerRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);

  function close() {
    if (!isDeleting) {
      setError("");
      setIsOpen(false);
    }
  }

  async function confirmDeletion() {
    setError("");
    setIsDeleting(true);

    try {
      const result = await onDelete();

      if (result.error) {
        setError(result.error);
        return;
      }

      setIsOpen(false);
      onDeleted();
    } catch {
      setError(copy.error);
    } finally {
      setIsDeleting(false);
    }
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLButtonElement>(
      "button:not([disabled])",
    );
    if (!focusable?.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn-secondary"
        onClick={() => setIsOpen(true)}
      >
        {copy.trigger}
      </button>
      {isOpen ? createPortal(
        <div
          className="fixed inset-0 z-[100] grid place-items-center overscroll-contain bg-[rgba(36,50,58,0.45)] p-4"
          role="presentation"
        >
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogDescriptionId}
            className="max-h-[calc(100dvh-2rem)] w-full min-w-0 max-w-md overflow-y-auto rounded-[1.75rem] border border-[var(--border)] bg-white p-5 shadow-[0_24px_46px_rgba(36,50,58,0.22)] sm:p-6"
            onKeyDown={handleDialogKeyDown}
          >
            <h2 id={dialogTitleId} className="font-serif text-2xl text-[var(--foreground)]">
              {copy.title}
            </h2>
            <p id={dialogDescriptionId} className="mt-3 text-sm leading-6 text-[var(--muted)]">
              {copy.description}
            </p>
            <p className="mt-2 break-words text-sm font-medium text-[var(--foreground)]">{businessName}</p>
            {error ? (
              <p role="alert" className="mt-4 rounded-xl bg-[rgba(191,91,42,0.1)] p-3 text-sm text-[var(--foreground)]">
                {error}
              </p>
            ) : null}
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                ref={cancelButtonRef}
                type="button"
                className="btn-secondary min-h-12 w-full"
                disabled={isDeleting}
                onClick={close}
              >
                {copy.cancel}
              </button>
              <button
                type="button"
                className="btn-primary min-h-12 w-full"
                disabled={isDeleting}
                onClick={() => void confirmDeletion()}
              >
                {isDeleting ? copy.deleting : copy.confirm}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
