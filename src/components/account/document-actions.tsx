"use client";

import { useState } from "react";
import { IconDownload, IconExternalLink, IconShare3 } from "@tabler/icons-react";

export function DocumentActions(props: {
  downloadUrl: string;
  locale: "en" | "it";
  shareUrl: string;
  title: string;
  viewUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = props.locale === "it"
    ? { copied: "Link copiato", download: "Scarica", share: "Condividi", view: "Visualizza" }
    : { copied: "Link copied", download: "Download", share: "Share", view: "View" };
  const share = async () => {
    const url = new URL(props.shareUrl, window.location.origin).toString();
    if (navigator.share) {
      try {
        await navigator.share({ title: props.title, url });
        return;
      } catch (error) {
        if ((error as DOMException).name === "AbortError") return;
      }
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
      return;
    }
    window.prompt(props.locale === "it" ? "Copia questo link protetto" : "Copy this protected link", url);
  };

  return <div className="grid gap-2 sm:grid-cols-3">
    <a href={props.viewUrl} target="_blank" rel="noreferrer" className="btn-secondary min-h-12 justify-center">
      <IconExternalLink size={18} /> {copy.view}
    </a>
    <a href={props.downloadUrl} className="btn-secondary min-h-12 justify-center">
      <IconDownload size={18} /> {copy.download}
    </a>
    <button type="button" onClick={share} className="btn-secondary min-h-12 justify-center">
      <IconShare3 size={18} /> {copied ? copy.copied : copy.share}
    </button>
  </div>;
}
