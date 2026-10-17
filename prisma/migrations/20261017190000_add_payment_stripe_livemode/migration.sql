-- Existing payments remain unclassified. A future payout requires an
-- explicitly verified live Stripe payment; no historical row is backfilled.
ALTER TABLE "Payment" ADD COLUMN "stripeLivemode" BOOLEAN;
