import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import { DisclaimerLibrary } from "@/components/disclaimers/DisclaimerLibrary";
import { listDisclaimers } from "@/db/queries/disclaimers";
import { getCurrentProfile } from "@/lib/supabase/server";
import { USER_ROLES, type UserRole } from "@/lib/constants";

export const metadata: Metadata = { title: "Disclaimers" };
export const dynamic = "force-dynamic";

export default async function DisclaimersPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const [rows, profile] = await Promise.all([
    listDisclaimers(searchParams.q),
    getCurrentProfile(),
  ]);
  const role = (profile?.role && profile.role in USER_ROLES
    ? profile.role
    : "viewer") as UserRole;

  return (
    <PageShell
      title="Disclaimer library"
      description="Reusable, versioned legal language for promotions."
    >
      <DisclaimerLibrary
        rows={rows}
        canEdit={USER_ROLES[role].canCreate}
        canApprove={USER_ROLES[role].canApprove}
        highlightId={searchParams.highlight}
      />
    </PageShell>
  );
}
