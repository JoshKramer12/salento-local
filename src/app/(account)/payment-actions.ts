"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireCompletedViewer } from "@/lib/auth-guards";
import { ensureStripeCheckoutSession } from "@/lib/stripe-checkout";
import { prisma } from "@/lib/prisma";
import { getReceiptData, sendReceiptEmail } from "@/lib/receipts";
import { getOriginFromHeaders } from "@/lib/request-origin";
import { syncStripePaymentForSubmission } from "@/lib/stripe-payment-sync";
import { canUseStripeBankTransferTestSimulation, getStripe } from "@/lib/stripe";
import { getStringValue } from "@/lib/validation";

export async function startStripeCheckoutAction(formData: FormData) {
  const viewer = await requireCompletedViewer();
  const requestHeaders = await headers();
  const appUrl = getOriginFromHeaders(requestHeaders);
  const submissionId = getStringValue(formData.get("submissionId")).trim();

  if (!submissionId) {
    redirect("/dashboard");
  }

  const submission = await prisma.businessSubmission.findUnique({
    where: {
      id: submissionId,
    },
    select: {
      amountOwedCents: true,
      automaticRenewalAtAcceptance: true,
      businessName: true,
      createdBusinessId: true,
      id: true,
      paymentMethod: true,
      paymentStatus: true,
      ownerEmail: true,
      user: {
        select: {
          id: true,
          role: true,
        },
      },
      userId: true,
      email: true,
    },
  });

  if (!submission || submission.userId !== viewer.id) {
    redirect("/dashboard");
  }

  if (submission.paymentMethod !== "ONLINE" || submission.paymentStatus === "PAID") {
    redirect(`/publish/payment?submission=${encodeURIComponent(submission.id)}`);
  }

  const checkoutSession = await ensureStripeCheckoutSession({
    appUrl,
    submission: {
      amountOwedCents: submission.amountOwedCents,
      automaticRenewalAtAcceptance: submission.automaticRenewalAtAcceptance,
      businessName: submission.businessName,
      createdBusinessId: submission.createdBusinessId,
      email: submission.email,
      id: submission.id,
      ownerEmail: submission.ownerEmail,
      userId: submission.userId,
    },
    viewer: {
      email: viewer.email,
      id: submission.user.id,
      role: submission.user.role,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/businesses");

  if (!checkoutSession.url) {
    redirect(`/publish/payment?submission=${encodeURIComponent(submission.id)}`);
  }

  redirect(checkoutSession.url);
}

export async function emailReceiptAction(formData: FormData) {
  const viewer = await requireCompletedViewer();
  const requestHeaders = await headers();
  const appUrl = getOriginFromHeaders(requestHeaders);
  const submissionId = getStringValue(formData.get("submissionId")).trim();

  if (!submissionId) {
    redirect("/dashboard");
  }

  const receipt = await getReceiptData({
    appUrl,
    submissionId,
    viewerId: viewer.id,
  });

  if (!receipt?.recipientEmail) {
    redirect(`/publish/payment?submission=${encodeURIComponent(submissionId)}&receiptEmail=unavailable`);
  }

  let sent = false;
  try {
    sent = await sendReceiptEmail({
      locale: "it",
      receipt,
    });
  } catch {
    redirect(`/publish/payment?submission=${encodeURIComponent(submissionId)}&receiptEmail=failed`);
  }

  redirect(
    `/publish/payment?submission=${encodeURIComponent(submissionId)}&receiptEmail=${sent ? "sent" : "failed"}`,
  );
}

export async function simulateStripeBankTransferAction(formData: FormData) {
  const viewer = await requireCompletedViewer();
  const submissionId = getStringValue(formData.get("submissionId")).trim();

  if (!submissionId) {
    redirect("/dashboard");
  }

  if (!canUseStripeBankTransferTestSimulation()) {
    redirect(
      `/publish/payment?submission=${encodeURIComponent(submissionId)}&bankTransferTest=unavailable`,
    );
  }

  const submission = await prisma.businessSubmission.findUnique({
    where: {
      id: submissionId,
    },
    select: {
      amountOwedCents: true,
      bankTransferReference: true,
      id: true,
      paymentMethod: true,
      paymentStatus: true,
      payments: {
        orderBy: {
          createdAt: "desc",
        },
        select: {
          stripePaymentIntentId: true,
        },
        take: 1,
      },
      userId: true,
    },
  });

  if (!submission || submission.userId !== viewer.id) {
    redirect("/dashboard");
  }

  if (submission.paymentMethod !== "BANK_TRANSFER" || submission.paymentStatus === "PAID") {
    redirect(`/publish/payment?submission=${encodeURIComponent(submission.id)}`);
  }

  const paymentIntentId = submission.payments[0]?.stripePaymentIntentId?.trim();

  if (!paymentIntentId) {
    redirect(
      `/publish/payment?submission=${encodeURIComponent(submission.id)}&bankTransferTest=failed`,
    );
  }

  const stripe = getStripe();

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const customerId =
      typeof paymentIntent.customer === "string" ? paymentIntent.customer : paymentIntent.customer?.id;

    if (!customerId) {
      redirect(
        `/publish/payment?submission=${encodeURIComponent(submission.id)}&bankTransferTest=failed`,
      );
    }

    await stripe.testHelpers.customers.fundCashBalance(customerId, {
      amount: submission.amountOwedCents,
      currency: "eur",
      reference: submission.bankTransferReference || undefined,
    });

    await stripe.paymentIntents.applyCustomerBalance(paymentIntentId);

    await syncStripePaymentForSubmission({
      submissionId: submission.id,
      userId: viewer.id,
    });
  } catch {
    redirect(
      `/publish/payment?submission=${encodeURIComponent(submission.id)}&bankTransferTest=failed`,
    );
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/businesses");
  redirect(`/publish/payment?submission=${encodeURIComponent(submission.id)}&bankTransferTest=success`);
}
