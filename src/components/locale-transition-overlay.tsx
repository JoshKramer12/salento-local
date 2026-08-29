"use client";

import { useEffect, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n";

const LOCALE_SWITCH_START_EVENT = "salento:locale-switch-start";
const LOCALE_SWITCH_COMPLETE_EVENT = "salento:locale-switch-complete";
const LOCALE_SWITCH_FAILSAFE_MS = 4000;

function getOverlayCopy(locale: Locale) {
  return locale === "it" ? "Cambio lingua..." : "Switching language...";
}

export function dispatchLocaleSwitchStart() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(LOCALE_SWITCH_START_EVENT));
}

export function dispatchLocaleSwitchComplete() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(LOCALE_SWITCH_COMPLETE_EVENT));
}

export function LocaleTransitionOverlay({ locale }: { locale: Locale }) {
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const failsafeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    function clearTimers() {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      if (failsafeTimerRef.current !== null) {
        window.clearTimeout(failsafeTimerRef.current);
        failsafeTimerRef.current = null;
      }
    }

    function handleStart() {
      clearTimers();
      setVisible(true);
      document.documentElement.dataset.localeSwitching = "true";
      failsafeTimerRef.current = window.setTimeout(() => {
        document.documentElement.removeAttribute("data-locale-switching");
        setVisible(false);
        failsafeTimerRef.current = null;
      }, LOCALE_SWITCH_FAILSAFE_MS);
    }

    function handleComplete() {
      clearTimers();
      hideTimerRef.current = window.setTimeout(() => {
        document.documentElement.removeAttribute("data-locale-switching");
        setVisible(false);
        hideTimerRef.current = null;
      }, 120);
    }

    window.addEventListener(LOCALE_SWITCH_START_EVENT, handleStart);
    window.addEventListener(LOCALE_SWITCH_COMPLETE_EVENT, handleComplete);

    return () => {
      clearTimers();
      document.documentElement.removeAttribute("data-locale-switching");
      window.removeEventListener(LOCALE_SWITCH_START_EVENT, handleStart);
      window.removeEventListener(LOCALE_SWITCH_COMPLETE_EVENT, handleComplete);
    };
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      style={{
        alignItems: "center",
        backdropFilter: "blur(14px)",
        background:
          "linear-gradient(135deg, rgba(255,248,239,0.84), rgba(255,255,255,0.94))",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        pointerEvents: "auto",
        position: "fixed",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "rgba(255,255,255,0.92)",
          border: "1px solid rgba(232, 222, 208, 0.95)",
          borderRadius: "999px",
          boxShadow: "0 18px 40px rgba(36, 50, 58, 0.08)",
          color: "#24323a",
          fontFamily:
            "\"Avenir Next\", \"Segoe UI\", -apple-system, BlinkMacSystemFont, sans-serif",
          fontSize: "0.95rem",
          fontWeight: 700,
          letterSpacing: "0.01em",
          padding: "0.95rem 1.35rem",
        }}
      >
        {getOverlayCopy(locale)}
      </div>
    </div>
  );
}
