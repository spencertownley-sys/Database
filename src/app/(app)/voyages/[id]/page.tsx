import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, CalendarDays, Moon, Ship as ShipIcon } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PromoStatusBadge } from "@/components/promotions/PromoStatusBadge";
import { VoyageAttributeEditor } from "@/components/voyages/VoyageAttributeEditor";
import {
  getVoyage,
  getPromosForVoyage,
  getVoyagePerformance,
} from "@/db/queries/voyages";
import { getCurrentProfile } from "@/lib/supabase/server";
import { USER_ROLES, type UserRole, OFFER_TYPE_LABELS, type OfferType } from "@/lib/constants";
import { formatDate, formatPercent, formatCurrency } from "@/lib/utils";
import type { CabinCategory, VoyageMetadata } from "@/types";

export const metadata: Metadata = { title: "Voyage" };
export const dynamic = "force-dynamic";

export default async function VoyageDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [voyage, promos, performance, profile] = await Promise.all([
    getVoyage(params.id),
    getPromosForVoyage(params.id),
    getVoyagePerformance(params.id),
    getCurrentProfile(),
  ]);
  if (!voyage) notFound();

  const role = (profile?.role && profile.role in USER_ROLES
    ? profile.role
    : "viewer") as UserRole;
  const canEdit = USER_ROLES[role].canCreate;
  const cabins = (voyage.cabinCategories ?? []) as CabinCategory[];

  return (
    <PageShell
      title={voyage.itineraryName}
      description={`${voyage.voyageCode} · ${voyage.ship?.name ?? ""}`}
      actions={
        <Button variant="ghost" size="sm" asChild>
          <Link href="/voyages">
            <ArrowLeft className="h-4 w-4" />
            Voyage catalog
          </Link>
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Key facts */}
          <Card>
            <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-center gap-2 text-sm">
                <ShipIcon className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Ship</p>
                  <p className="font-medium">{voyage.ship?.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Sails</p>
                  <p className="font-medium">
                    {formatDate(voyage.sailDate)} – {formatDate(voyage.returnDate)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Moon className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="font-medium">{voyage.durationNights} nights</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Region</p>
                  <p className="font-medium">{voyage.region?.name ?? "—"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Itinerary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[15px]">Itinerary</CardTitle>
              <CardDescription>
                {voyage.embarkPort} → {voyage.debarkPort} · status{" "}
                <Badge variant="outline" className="capitalize">{voyage.status}</Badge>{" "}
                · {formatPercent(voyage.occupancyPercent)} booked
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-wrap items-center gap-1.5 text-sm">
                <li className="rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary">
                  {voyage.embarkPort}
                </li>
                {(voyage.portsOfCall ?? []).map((port) => (
                  <li key={port} className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">→</span>
                    <span className="rounded-md bg-muted px-2 py-0.5">{port}</span>
                  </li>
                ))}
                <li className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">→</span>
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary">
                    {voyage.debarkPort}
                  </span>
                </li>
              </ol>
            </CardContent>
          </Card>

          {/* Promo history — the query the team could never run */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[15px]">
                All promotions on this voyage
              </CardTitle>
              <CardDescription>
                Every promotion — past, current, and future — ever linked to this
                sailing ({promos.length}).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {promos.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No promotion has ever been linked to this voyage.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Promotion</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Offer</TableHead>
                      <TableHead>Sell window</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {promos.map(({ promo, link }) => (
                      <TableRow key={link.id}>
                        <TableCell>
                          <Link
                            href={`/promotions/${promo.id}`}
                            className="font-medium hover:text-primary hover:underline"
                          >
                            {promo.promoName}
                          </Link>
                          {promo.promoCode && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {promo.promoCode}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <PromoStatusBadge status={promo.status} />
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <div className="flex flex-col">
                            <span className="truncate text-xs">
                              {link.overrideOfferValue ?? promo.offerValue}
                              {link.overrideOfferValue && (
                                <Badge variant="outline" className="ml-1 text-[10px]">
                                  override
                                </Badge>
                              )}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {OFFER_TYPE_LABELS[promo.offerType as OfferType] ?? promo.offerType}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {formatDate(promo.sellStartDate)} – {formatDate(promo.sellEndDate)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Voyage-level promo performance */}
          {performance.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-[15px]">Promo performance on this voyage</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Bookings</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Cancellations</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {performance.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs">
                          {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.bookings}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(p.revenue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.cancellations}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {/* Cabin categories */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[15px]">Cabin categories</CardTitle>
            </CardHeader>
            <CardContent>
              {cabins.length === 0 ? (
                <p className="text-sm text-muted-foreground">No cabin data.</p>
              ) : (
                <div className="space-y-2">
                  {cabins.map((c) => (
                    <div
                      key={c.category}
                      className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{c.category}</span>
                        <span className="text-xs text-muted-foreground">
                          {c.inventory} cabins
                        </span>
                      </div>
                      <span className="tabular-nums">{formatCurrency(c.base_price)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* PIM attribute editor */}
          <VoyageAttributeEditor
            voyageId={voyage.id}
            metadata={(voyage.metadata ?? {}) as VoyageMetadata}
            canEdit={canEdit}
          />
        </div>
      </div>
    </PageShell>
  );
}
