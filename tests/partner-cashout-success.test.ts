import assert from "node:assert/strict";
import test from "node:test";
import { cashoutSuccessCopy, withdrawalConfirmationKind } from "@/lib/partner-cashout-confirmation";

test("only confirmed withdrawal states produce a success outcome", () => {
  for (const status of ["REQUESTED", "READY_FOR_PROCESSING", "PROCESSING", "PAID"]) {
    assert.equal(withdrawalConfirmationKind(status), "submitted", status);
  }
  for (const status of ["OUTCOME_UNKNOWN", "ACTION_REQUIRED"]) {
    assert.equal(withdrawalConfirmationKind(status), "uncertain", status);
  }
  for (const status of ["CANCELED", "INVALIDATED", "FAILED_CONFIRMED", "unexpected"]) {
    assert.equal(withdrawalConfirmationKind(status), "changed", status);
  }
});

test("accepted request copy uses the actual amount and locale", () => {
  const en = cashoutSuccessCopy(12345, "REQUESTED", "en", false);
  assert.equal(en.title, "Cash Out request successful!");
  assert.match(en.description, /€123\.45 withdrawal has been requested/);
  assert.match(en.explanation, /being processed/);
  assert.equal(en.view, "View withdrawal");
  assert.equal(en.back, "Back to dashboard");

  const it = cashoutSuccessCopy(12345, "PROCESSING", "it", false);
  assert.equal(it.title, "Richiesta di prelievo inviata!");
  assert.match(it.description, /123,45\s*€/);
  assert.match(it.explanation, /in elaborazione/);
  assert.equal(it.view, "Visualizza prelievo");
  assert.equal(it.back, "Torna alla dashboard");
});

test("verified paid and simulated outcomes do not promise a new bank deposit", () => {
  const paid = cashoutSuccessCopy(10000, "PAID", "en", false);
  assert.match(paid.description, /confirmed by the payout provider/);
  assert.match(paid.explanation, /Bank arrival may take more time/);

  for (const locale of ["en", "it"] as const) {
    const simulated = cashoutSuccessCopy(10000, "PAID", locale, true);
    assert.match(simulated.description, /100/);
    assert.doesNotMatch(simulated.description, /on its way|in arrivo/);
    assert.match(simulated.explanation, /No money was sent|Nessun denaro è stato inviato/);
  }
});
