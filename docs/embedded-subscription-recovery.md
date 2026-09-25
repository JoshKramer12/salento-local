# Embedded initial subscription recovery

The initial `Payment` row is the durable setup record. Its ID is
`initial-element:<submission ID>`. Before creating a Stripe Product, Customer,
or Subscription, the server stores `stripeSetupOperation` and
`stripeSetupStartedAt`. It then stores the returned Stripe ID and clears the
operation marker in one database update. The subscription update also stores
the initial invoice and PaymentIntent IDs.

Retries within 23 hours replay the same deterministic Stripe idempotency key.
Once that window passes, an unresolved marker blocks new Stripe creation. This
protects against Stripe pruning a key after 24 hours. An operator must locate
the exact Stripe object from the original request and call
`reconcileEmbeddedSubscriptionOperation` with the Payment ID, operation, and
Stripe object ID. The helper verifies immutable Payment metadata, the saved
Customer/Product associations, the real owner email, and the annual €100
subscription price before saving the ID. It does not use Stripe Search. Never
clear an old marker just to make the QR work; if the external result cannot be
established, leave setup blocked for investigation.

After the invoice association is stored, subsequent QR requests retrieve the
same Subscription and invoice directly by ID, regardless of elapsed time. A
terminal `incomplete_expired` subscription is replaced only after Stripe
confirms its invoice was not paid. The generation counter gives the replacement
a new idempotency key while retaining the same initial Payment ID.

`invoice.paid` finalizes an embedded initial purchase only when the invoice ID
matches this Payment and the invoice, Customer, Subscription, PaymentIntent,
amount, currency, and annual price all verify. The existing renewal handler
continues to process later subscription invoices. Historical Checkout initial
invoices continue through their existing path.
