export function buildPublishDraftStorageKey({
  adminMode,
  newIntentId,
  role,
  submissionId,
  viewerId,
}: {
  adminMode: boolean;
  newIntentId?: string;
  role: string;
  submissionId?: string;
  viewerId?: string;
}) {
  const draftIdentity = submissionId || `new:${newIntentId ?? "direct"}`;
  return `salento-local:publish-draft:${adminMode ? "admin" : "standard"}:${viewerId ?? role}:${draftIdentity}`;
}

export function canRestorePublishLocalDraft(
  snapshot: { id?: string; updatedAt?: string },
  { newIntentId, submissionId, submissionUpdatedAt }: {
    newIntentId?: string;
    submissionId?: string;
    submissionUpdatedAt?: string;
  },
) {
  if (submissionId) {
    if (snapshot.id !== submissionId) return false;
  } else if (!newIntentId || snapshot.id) {
    return false;
  }

  return !submissionUpdatedAt || Boolean(
    snapshot.updatedAt && Date.parse(snapshot.updatedAt) > Date.parse(submissionUpdatedAt),
  );
}

export function replaceNewPublishIntentWithSubmission(
  history: History,
  currentHref: string,
  newIntentId: string,
  submissionId: string,
) {
  const url = new URL(currentHref);
  if (url.pathname !== "/publish" || url.searchParams.get("new") !== newIntentId) return false;

  url.searchParams.delete("new");
  url.searchParams.set("submission", submissionId);
  history.replaceState(history.state, "", url);
  return true;
}
