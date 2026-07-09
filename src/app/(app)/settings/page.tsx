import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserRoleTable } from "@/components/settings/UserRoleTable";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { asc } from "drizzle-orm";
import { getCurrentProfile } from "@/lib/supabase/server";
import { USER_ROLES, type UserRole } from "@/lib/constants";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [profile, allProfiles] = await Promise.all([
    getCurrentProfile(),
    db.select().from(profiles).orderBy(asc(profiles.fullName)),
  ]);

  const role = (profile?.role && profile.role in USER_ROLES
    ? profile.role
    : "viewer") as UserRole;
  const perms = USER_ROLES[role];

  return (
    <PageShell title="Settings" description="Your account and workspace administration.">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Your account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="font-medium">{profile?.fullName ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="font-medium">{profile?.email ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Role</p>
              <Badge variant="secondary" className="mt-0.5">{perms.label}</Badge>
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Permissions</p>
              <ul className="space-y-0.5 text-xs">
                <li>{perms.canCreate ? "✓" : "✗"} Create & edit promotions</li>
                <li>{perms.canApprove ? "✓" : "✗"} Approve & launch promotions</li>
                <li>{perms.canDelete ? "✓" : "✗"} Delete promotions</li>
                <li>{perms.canViewReports ? "✓" : "✗"} View reports</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">Users</CardTitle>
            <CardDescription>
              {role === "admin"
                ? "Manage workspace roles. New signups start as viewers."
                : "Workspace members. Only admins can change roles."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UserRoleTable
              users={allProfiles}
              canManage={role === "admin"}
              selfId={profile?.id ?? ""}
            />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
