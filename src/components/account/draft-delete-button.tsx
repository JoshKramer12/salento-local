"use client";

import { useRouter } from "next/navigation";

import {
  deleteDraftSubmissionAction,
  type DeleteDraftSubmissionResult,
} from "@/app/(account)/actions";
import { DraftDeleteControl } from "@/components/account/draft-delete-control";
import type { Locale } from "@/lib/i18n";

type DraftDeleteButtonProps = {
  businessName: string;
  locale: Locale;
  submissionId: string;
};

export function DraftDeleteButton({
  businessName,
  locale,
  submissionId,
}: DraftDeleteButtonProps) {
  const router = useRouter();

  async function deleteDraft(): Promise<DeleteDraftSubmissionResult> {
    const formData = new FormData();
    formData.set("locale", locale);
    formData.set("submissionId", submissionId);
    return deleteDraftSubmissionAction(formData);
  }

  return (
    <DraftDeleteControl
      businessName={businessName}
      locale={locale}
      onDelete={deleteDraft}
      onDeleted={() => router.refresh()}
    />
  );
}
