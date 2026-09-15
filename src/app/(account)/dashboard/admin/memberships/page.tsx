import Link from "next/link";

import { requireAdminViewer } from "@/lib/auth-guards";
import { getBusinessMembershipStatus } from "@/lib/business-membership";
import { prisma } from "@/lib/prisma";

const formatDate = (value: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(value);

export default async function AdminMembershipsPage() {
  await requireAdminViewer();
  const memberships = await prisma.businessMembership.findMany({
    orderBy: { currentPeriodEnd: "asc" },
    take: 250,
    include: { business: { select: { id: true, name: true, slug: true } } },
  });
  const now = new Date();
  const counts = { ACTIVE: 0, GRACE: 0, EXPIRED: 0, autoOn: 0, autoOff: 0, pastDue: 0, upcoming: 0 };
  for (const membership of memberships) {
    counts[getBusinessMembershipStatus({ ...membership, now })] += 1;
    if (membership.automaticRenewal) counts.autoOn += 1;
    else counts.autoOff += 1;
    if (membership.stripeSubscriptionStatus === "past_due") counts.pastDue += 1;
    if (membership.currentPeriodEnd > now && membership.currentPeriodEnd.getTime() - now.getTime() <= 30 * 86_400_000) counts.upcoming += 1;
  }
  return <main className="shell px-4 py-10 sm:px-6"><div className="flex items-center justify-between gap-4"><div><p className="section-kicker">Admin · read only</p><h1 className="mt-2 font-serif text-4xl text-[var(--foreground)]">Membership operations</h1></div><Link className="btn-secondary" href="/dashboard">Back to dashboard</Link></div><section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(counts).map(([label, value]) => <article className="card p-4" key={label}><p className="text-sm text-[var(--muted)]">{label.replace(/([A-Z])/g, " $1")}</p><p className="mt-2 font-serif text-3xl">{value}</p></article>)}</section><section className="card mt-7 overflow-x-auto p-0"><table className="min-w-full text-left text-sm"><thead className="border-b border-[var(--border)] text-[var(--muted)]"><tr><th className="p-4">Business</th><th>Status</th><th>Term end</th><th>Auto</th><th>Stripe</th><th /></tr></thead><tbody>{memberships.map((membership) => <tr className="border-b border-[var(--border)] last:border-0" key={membership.id}><td className="p-4 font-medium">{membership.business.name}</td><td>{getBusinessMembershipStatus({ ...membership, now })}</td><td>{formatDate(membership.currentPeriodEnd)}</td><td>{membership.automaticRenewal ? "ON" : "OFF"}</td><td>{membership.stripeSubscriptionStatus ?? "—"}</td><td className="p-4"><Link className="text-[var(--primary)]" href={`/dashboard/admin/memberships/${membership.business.id}`}>Inspect</Link></td></tr>)}</tbody></table></section></main>;
}
