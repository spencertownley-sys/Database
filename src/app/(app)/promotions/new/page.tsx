import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/layout/PageShell";
import { PromoForm } from "@/components/promotions/PromoForm";
import { getCurrentProfile } from "@/lib/supabase/server";
import { USER_ROLES, type UserRole } from "@/lib/constants";

export const metadata: Metadata = { title: "New Promotion" };
export const dynamic = "force-dynamic";

export default async function NewPromotionPage() {
  const profile = await getCurrentProfile();
  const role = (profile?.role && profile.role in USER_ROLES
    ? profile.role
    : "viewer") as UserRole;
  if (!USER_ROLES[role].canCreate) {
    redirect("/promotions");
  }

  return (
    <PageShell
      title="New promotion"
      description="Drafts start unpublished; you can link voyages, disclaimers, and audiences after creating."
    >
      <div className="mx-auto max-w-3xl">
        <PromoForm />
      </div>
    </PageShell>
  );
}
