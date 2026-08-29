"use client";

import { useEffect } from "react";

export function PayoutSetupSkipCleanup() {
  useEffect(() => {
    const url = new URL(window.location.href);

    if (!url.searchParams.has("skipPayoutSetup")) {
      return;
    }

    url.searchParams.delete("skipPayoutSetup");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return null;
}
