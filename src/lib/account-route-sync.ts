import { after } from "next/server";

import { syncPartnerStripeAccountStatus } from "@/lib/partner-connect";
import { syncPendingPartnerCommissionsForUser } from "@/lib/partner-ledger";
import { syncPendingStripePaymentsForUser } from "@/lib/stripe-payment-sync";

type ViewerRole = "ADMIN" | "BUSINESS_OWNER" | "GETTER" | "USER";

export function scheduleAccountRouteSync(userId: string, role: ViewerRole) {
  after(async () => {
    await syncPendingStripePaymentsForUser(userId);

    if (role !== "GETTER") {
      return;
    }

    await Promise.all([
      syncPendingPartnerCommissionsForUser(userId),
      syncPartnerStripeAccountStatus(userId),
    ]);
  });
}
