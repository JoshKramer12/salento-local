"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function NoEmailSuccessWatcher({ locale }: { locale: "en" | "it" }) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => router.refresh(), 4000);
    const clock = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => { window.clearInterval(interval); window.clearInterval(clock); };
  }, [router]);
  return <div role="status" className="mt-6 text-[var(--foreground)]">
    <span aria-hidden="true" className="mx-auto block h-9 w-9 animate-spin rounded-full border-[3px] border-[rgba(42,98,87,0.2)] border-t-[var(--primary)] motion-reduce:animate-none" />
    <h2 className="mt-4 font-serif text-xl">{locale === "it" ? "Pagamento in elaborazione" : "Processing your payment"}</h2>
    <p className="mt-2 text-sm leading-6">{elapsed >= 20
      ? locale === "it" ? "La conferma del pagamento sta richiedendo un po' più di tempo. Tieni aperta questa pagina." : "Your payment is taking a little longer to confirm. Please keep this page open."
      : locale === "it" ? "Attendi mentre confermiamo il pagamento. Non chiudere questa pagina." : "Please wait while we confirm your payment. Do not close this page."}</p>
    {elapsed >= 120 ? <button type="button" onClick={() => router.refresh()} className="btn-secondary mt-4">{locale === "it" ? "Controlla lo stato del pagamento" : "Check payment status"}</button> : null}
  </div>;
}
