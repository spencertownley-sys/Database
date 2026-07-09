import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import { AudienceManager } from "@/components/audiences/AudienceManager";
import { listAudienceSegmentsWithUsage } from "@/db/queries/audiences";
import { getCurrentProfile } from "@/lib/supabase/server";
import { USER_ROLES, type UserRole } from "@/lib/constants";

export const metadata: Metadata = { title: "Audiences" };
export const dynamic = "force-dynamic";

export default async function AudiencesPage() {
  const [rows, profile] = await Promise.all([
    listAudienceSegmentsWithUsage(),
    getCurrentProfile(),
  ]);
  const role = (profile?.role && profile.role in USER_ROLES
    ? profile.role
    : "viewer") as UserRole;

  return (
    <PageShell
      title="Audience segments"
      description="Targeting groups promotions can be aimed at."
    >
      <AudienceManager rows={rows} canEdit={USER_ROLES[role].canCreate} />
    </PageShell>
  );
}
