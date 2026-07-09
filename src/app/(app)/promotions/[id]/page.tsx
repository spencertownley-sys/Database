import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Anchor, ArrowLeft } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { PromoForm } from "@/components/promotions/PromoForm";
import { StatusWorkflow } from "@/components/shared/StatusWorkflow";
import { PromoTimeline } from "@/components/promotions/PromoTimeline";
import {
  DisclaimerLinkPanel,
  AudienceLinkPanel,
} from "@/components/promotions/LinkPanels";
import { DeletePromoButton } from "@/components/promotions/DeletePromoButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getPromotion,
  listApprovedDisclaimers,
  listAudienceSegments,
} from "@/db/queries/promotions";
import { activityForEntity } from "@/db/queries/reports";
import { getCurrentProfile } from "@/lib/supabase/server";
import { USER_ROLES, type UserRole } from "@/lib/constants";
import type { Disclaimer, AudienceSegment } from "@/types";

export const metadata: Metadata = { title: "Promotion" };
export const dynamic = "force-dynamic";

export default async function PromotionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [promo, disclaimerLibrary, segments, profile] = await Promise.all([
    getPromotion(params.id),
    listApprovedDisclaimers(),
    listAudienceSegments(),
    getCurrentProfile(),
  ]);
  if (!promo) notFound();

  const activity = await activityForEntity("promotion", promo.id, 30);
  const role = (profile?.role && profile.role in USER_ROLES
    ? profile.role
    : "viewer") as UserRole;
  const canEdit = USER_ROLES[role].canCreate;
  const canApprove = USER_ROLES[role].canApprove;
  const canDelete = USER_ROLES[role].canDelete;

  const linkedDisclaimers = promo.promoDisclaimers.map(
    (pd) => pd.disclaimer
  ) as Disclaimer[];
  const linkedAudiences = promo.promoAudiences.map(
    (pa) => pa.segment
  ) as AudienceSegment[];

  const warnings: string[] = [];
  if (linkedDisclaimers.length === 0) warnings.push("No disclaimer is linked yet.");
  if (promo.voyageCount === 0) warnings.push("No voyages are linked yet.");
  if (linkedAudiences.length === 0) warnings.push("No audience segment is linked yet.");

  return (
    <PageShell
      title={promo.promoName}
      description={
        promo.promoCode
          ? `Code ${promo.promoCode} · owned by ${promo.owner?.fullName ?? "unassigned"}`
          : `Owned by ${promo.owner?.fullName ?? "unassigned"}`
      }
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/promotions">
              <ArrowLeft className="h-4 w-4" />
              All promotions
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/promotions/${promo.id}/voyages`}>
              <Anchor className="h-4 w-4" />
              Manage voyages
              <Badge variant="secondary" className="ml-1">
                {promo.voyageCount}
              </Badge>
            </Link>
          </Button>
          {canDelete && <DeletePromoButton promoId={promo.id} promoName={promo.promoName} />}
        </div>
      }
    >
      <div className="space-y-4">
        <StatusWorkflow
          promoId={promo.id}
          status={promo.status}
          canApprove={canApprove}
          canEdit={canEdit}
          warnings={warnings}
        />

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PromoForm promo={promo} />
          </div>
          <div className="space-y-4">
            <DisclaimerLinkPanel
              promoId={promo.id}
              linked={linkedDisclaimers}
              library={disclaimerLibrary}
              canEdit={canEdit}
            />
            <AudienceLinkPanel
              promoId={promo.id}
              linked={linkedAudiences}
              segments={segments}
              canEdit={canEdit}
            />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-[15px]">Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <PromoTimeline entries={activity} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
