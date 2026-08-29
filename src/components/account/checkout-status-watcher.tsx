"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type CheckoutStatusWatcherProps = {
  copy: {
    paid: string;
    pending: string;
  };
  submissionId: string;
};

export function CheckoutStatusWatcher({
  copy,
  submissionId,
}: CheckoutStatusWatcherProps) {
  const router = useRouter();
  const hasSyncedPaidState = useRef(false);
  const [statusMessage, setStatusMessage] = useState(copy.pending);

  useEffect(() => {
    let cancelled = false;
    let intervalId = 0;

    async function pollStatus() {
      if (hasSyncedPaidState.current) {
        return;
      }

      try {
        const response = await fetch(
          `/api/stripe/checkout-status?submission=${encodeURIComponent(submissionId)}`,
          {
            cache: "no-store",
          },
        );

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as {
          paymentReceived?: boolean;
        };

        if (cancelled || !data.paymentReceived) {
          return;
        }

        hasSyncedPaidState.current = true;
        setStatusMessage(copy.paid);
        window.clearInterval(intervalId);
        startTransition(() => {
          router.refresh();
        });
      } catch {
        // Ignore transient polling failures and try again on the next interval.
      }
    }

    pollStatus();
    intervalId = window.setInterval(pollStatus, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [copy.paid, copy.pending, router, submissionId]);

  return (
    <p className="mt-4 text-sm leading-7 text-[var(--muted)]">
      {statusMessage}
    </p>
  );
}
