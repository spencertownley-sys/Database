"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { createPromotion, updatePromotion } from "@/app/actions/promotions";
import {
  OFFER_TYPES,
  OFFER_TYPE_LABELS,
  MARKETS,
  BOOKING_CHANNELS,
  BOOKING_CHANNEL_LABELS,
  PROMO_SOURCES,
  PROMO_SOURCE_LABELS,
  PROMO_PRIORITIES,
  type OfferType,
} from "@/lib/constants";
import type { Promotion, OfferDetails, PromoContent } from "@/types";

interface PromoFormProps {
  promo?: Promotion;
}

interface FormState {
  promoName: string;
  promoCode: string;
  description: string;
  offerType: string;
  offerValue: string;
  offerDetails: OfferDetails;
  sellStartDate: string;
  sellEndDate: string;
  sailStartDate: string;
  sailEndDate: string;
  market: string[];
  bookingChannels: string[];
  isCombinable: boolean;
  source: string;
  priority: string;
  notes: string;
  tags: string;
  headline: string;
  termsSummary: string;
  content: PromoContent;
}

function initialState(promo?: Promotion): FormState {
  return {
    promoName: promo?.promoName ?? "",
    promoCode: promo?.promoCode ?? "",
    description: promo?.description ?? "",
    offerType: promo?.offerType ?? "percentage_discount",
    offerValue: promo?.offerValue ?? "",
    offerDetails: (promo?.offerDetails as OfferDetails) ?? {},
    sellStartDate: promo?.sellStartDate ?? "",
    sellEndDate: promo?.sellEndDate ?? "",
    sailStartDate: promo?.sailStartDate ?? "",
    sailEndDate: promo?.sailEndDate ?? "",
    market: promo?.market ?? [],
    bookingChannels: promo?.bookingChannels ?? [],
    isCombinable: promo?.isCombinable ?? false,
    source: promo?.source ?? "",
    priority: promo?.priority ?? "normal",
    notes: promo?.notes ?? "",
    tags: (promo?.tags ?? []).join(", "),
    headline: promo?.headline ?? "",
    termsSummary: promo?.termsSummary ?? "",
    content: (promo?.content as PromoContent) ?? {},
  };
}

function toPayload(state: FormState) {
  return {
    promoName: state.promoName,
    promoCode: state.promoCode || null,
    description: state.description || null,
    offerType: state.offerType,
    offerValue: state.offerValue,
    offerDetails: state.offerDetails,
    sellStartDate: state.sellStartDate,
    sellEndDate: state.sellEndDate,
    sailStartDate: state.sailStartDate || null,
    sailEndDate: state.sailEndDate || null,
    market: state.market,
    bookingChannels: state.bookingChannels,
    isCombinable: state.isCombinable,
    source: state.source || null,
    priority: state.priority,
    notes: state.notes || null,
    tags: state.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    headline: state.headline || null,
    termsSummary: state.termsSummary || null,
    content: state.content,
  };
}

/** Offer-type specific structured inputs. */
function OfferDetailsFields({
  offerType,
  details,
  onChange,
}: {
  offerType: string;
  details: OfferDetails;
  onChange: (d: OfferDetails) => void;
}) {
  switch (offerType as OfferType) {
    case "percentage_discount":
    case "flash_sale":
    case "companion_discount":
      return (
        <div className="space-y-2">
          <Label>Discount percent</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={100}
              className="w-28"
              value={details.discount_percent ?? ""}
              onChange={(e) =>
                onChange({ ...details, discount_percent: Number(e.target.value) || undefined })
              }
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>
      );
    case "fixed_discount":
      return (
        <div className="space-y-2">
          <Label>Discount amount</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              min={1}
              className="w-32"
              value={details.discount_amount ?? ""}
              onChange={(e) =>
                onChange({ ...details, discount_amount: Number(e.target.value) || undefined })
              }
            />
          </div>
        </div>
      );
    case "onboard_credit":
      return (
        <div className="space-y-2">
          <Label>OBC amount (per stateroom)</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              min={1}
              className="w-32"
              value={details.obc_amount ?? ""}
              onChange={(e) =>
                onChange({ ...details, obc_amount: Number(e.target.value) || undefined })
              }
            />
          </div>
        </div>
      );
    case "reduced_deposit":
      return (
        <div className="flex gap-4">
          <div className="space-y-2">
            <Label>Reduced deposit</Label>
            <Input
              type="number"
              className="w-32"
              value={details.deposit_amount ?? ""}
              onChange={(e) =>
                onChange({ ...details, deposit_amount: Number(e.target.value) || undefined })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Standard deposit</Label>
            <Input
              type="number"
              className="w-32"
              value={details.standard_deposit ?? ""}
              onChange={(e) =>
                onChange({ ...details, standard_deposit: Number(e.target.value) || undefined })
              }
            />
          </div>
        </div>
      );
    case "upgrade":
      return (
        <div className="flex gap-4">
          <div className="space-y-2">
            <Label>Upgrade from</Label>
            <Input
              className="w-40"
              placeholder="Interior"
              value={details.upgrade_from ?? ""}
              onChange={(e) => onChange({ ...details, upgrade_from: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Upgrade to</Label>
            <Input
              className="w-40"
              placeholder="Balcony"
              value={details.upgrade_to ?? ""}
              onChange={(e) => onChange({ ...details, upgrade_to: e.target.value })}
            />
          </div>
        </div>
      );
    case "free_perk":
    case "bundle":
      return (
        <div className="space-y-2">
          <Label>Included perks (comma-separated)</Label>
          <Input
            placeholder="Classic Drinks Package, Wi-Fi Package"
            value={(details.included_perks ?? []).join(", ")}
            onChange={(e) =>
              onChange({
                ...details,
                included_perks: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
      );
    default:
      return null;
  }
}

function MultiCheck({
  options,
  values,
  onChange,
  labels,
}: {
  options: readonly string[];
  values: string[];
  onChange: (v: string[]) => void;
  labels?: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map((opt) => (
        <label key={opt} className="flex cursor-pointer items-center gap-1.5 text-sm">
          <Checkbox
            checked={values.includes(opt)}
            onCheckedChange={(checked) =>
              onChange(checked ? [...values, opt] : values.filter((v) => v !== opt))
            }
          />
          {labels?.[opt] ?? opt}
        </label>
      ))}
    </div>
  );
}

export function PromoForm({ promo }: PromoFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = useState<FormState>(() => initialState(promo));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const isEdit = !!promo;
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
  }, []);

  // Auto-save draft on field change (edit mode only), debounced.
  useEffect(() => {
    if (!isEdit) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      const s = stateRef.current;
      if (!s.promoName || !s.offerValue || !s.sellStartDate || !s.sellEndDate) return;
      setSaving(true);
      const result = await updatePromotion(promo!.id, toPayload(s));
      setSaving(false);
      if (result.ok) setSavedAt(new Date());
    }, 1200);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, isEdit]);

  async function handleCreate() {
    setSaving(true);
    const result = await createPromotion(toPayload(state));
    setSaving(false);
    if (result.ok && result.data) {
      toast({ title: "Promotion created", description: state.promoName });
      router.push(`/promotions/${result.data.id}`);
    } else if (!result.ok) {
      toast({ title: "Could not create promotion", description: result.error, variant: "destructive" });
    }
  }

  const updateContent = (channel: keyof PromoContent, field: string, value: string) => {
    set("content", {
      ...state.content,
      [channel]: { ...(state.content[channel] as object), [field]: value },
    });
  };

  return (
    <div className="space-y-4">
      {isEdit && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          {saving ? (
            <Badge variant="secondary">Saving…</Badge>
          ) : savedAt ? (
            <Badge variant="secondary">
              Auto-saved {savedAt.toLocaleTimeString()}
            </Badge>
          ) : (
            <span>Changes save automatically</span>
          )}
        </div>
      )}

      {/* Basic Info */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px]">Basic info</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="promoName">Promotion name *</Label>
            <Input
              id="promoName"
              value={state.promoName}
              onChange={(e) => set("promoName", e.target.value)}
              placeholder="Wave Season Kickoff 2027"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="promoCode">Promo code</Label>
            <Input
              id="promoCode"
              value={state.promoCode}
              onChange={(e) => set("promoCode", e.target.value)}
              placeholder="WSK2701"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={2}
              value={state.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Internal description of this promotion's purpose"
            />
          </div>
          <div className="space-y-2">
            <Label>Source</Label>
            <Select value={state.source || undefined} onValueChange={(v) => set("source", v)}>
              <SelectTrigger>
                <SelectValue placeholder="What triggered this promo?" />
              </SelectTrigger>
              <SelectContent>
                {PROMO_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {PROMO_SOURCE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <Select value={state.priority} onValueChange={(v) => set("priority", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROMO_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p} className="capitalize">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Offer Details */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px]">Offer details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Offer type *</Label>
              <Select
                value={state.offerType}
                onValueChange={(v) => set("offerType", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OFFER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {OFFER_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="offerValue">Offer value (display text) *</Label>
              <Input
                id="offerValue"
                value={state.offerValue}
                onChange={(e) => set("offerValue", e.target.value)}
                placeholder='e.g. "20% off cruise fare" or "$200 onboard credit"'
              />
            </div>
          </div>
          <OfferDetailsFields
            offerType={state.offerType}
            details={state.offerDetails}
            onChange={(d) => set("offerDetails", d)}
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={state.isCombinable}
              onCheckedChange={(c) => set("isCombinable", !!c)}
            />
            Combinable with other offers
          </label>
        </CardContent>
      </Card>

      {/* Timing */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px]">Timing</CardTitle>
          <CardDescription>
            Sell window is when the promo is bookable; sail window optionally
            restricts which departures qualify.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label>Sell start *</Label>
            <Input
              type="date"
              value={state.sellStartDate}
              onChange={(e) => set("sellStartDate", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Sell end *</Label>
            <Input
              type="date"
              value={state.sellEndDate}
              onChange={(e) => set("sellEndDate", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Sail start</Label>
            <Input
              type="date"
              value={state.sailStartDate}
              onChange={(e) => set("sailStartDate", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Sail end</Label>
            <Input
              type="date"
              value={state.sailEndDate}
              onChange={(e) => set("sailEndDate", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Targeting */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px]">Targeting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Markets</Label>
            <MultiCheck
              options={MARKETS}
              values={state.market}
              onChange={(v) => set("market", v)}
            />
          </div>
          <div className="space-y-2">
            <Label>Booking channels</Label>
            <MultiCheck
              options={BOOKING_CHANNELS}
              values={state.bookingChannels}
              onChange={(v) => set("bookingChannels", v)}
              labels={BOOKING_CHANNEL_LABELS}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              value={state.tags}
              onChange={(e) => set("tags", e.target.value)}
              placeholder="wave-season, obc, early-bird"
            />
          </div>
        </CardContent>
      </Card>

      {/* Content (PIM) */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px]">Marketing content</CardTitle>
          <CardDescription>
            Channel-specific copy distributed to web, email, and the TA portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="headline">Headline</Label>
              <Input
                id="headline"
                value={state.headline}
                onChange={(e) => set("headline", e.target.value)}
                placeholder="Marketing headline for distribution"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="termsSummary">Terms summary</Label>
              <Input
                id="termsSummary"
                value={state.termsSummary}
                onChange={(e) => set("termsSummary", e.target.value)}
                placeholder="Plain-language summary of terms"
              />
            </div>
          </div>
          <Tabs defaultValue="web">
            <TabsList>
              <TabsTrigger value="web">Web</TabsTrigger>
              <TabsTrigger value="email">Email</TabsTrigger>
              <TabsTrigger value="ta_portal">TA Portal</TabsTrigger>
            </TabsList>
            <TabsContent value="web" className="space-y-3">
              <Input
                placeholder="Web title"
                value={state.content.web?.title ?? ""}
                onChange={(e) => updateContent("web", "title", e.target.value)}
              />
              <Textarea
                placeholder="Web body copy"
                rows={3}
                value={state.content.web?.body ?? ""}
                onChange={(e) => updateContent("web", "body", e.target.value)}
              />
              <Input
                placeholder="CTA label (e.g. Book Now)"
                value={state.content.web?.cta ?? ""}
                onChange={(e) => updateContent("web", "cta", e.target.value)}
              />
            </TabsContent>
            <TabsContent value="email" className="space-y-3">
              <Input
                placeholder="Email subject"
                value={state.content.email?.subject ?? ""}
                onChange={(e) => updateContent("email", "subject", e.target.value)}
              />
              <Textarea
                placeholder="Email body"
                rows={3}
                value={state.content.email?.body ?? ""}
                onChange={(e) => updateContent("email", "body", e.target.value)}
              />
            </TabsContent>
            <TabsContent value="ta_portal" className="space-y-3">
              <Textarea
                placeholder="TA portal description"
                rows={3}
                value={state.content.ta_portal?.description ?? ""}
                onChange={(e) => updateContent("ta_portal", "description", e.target.value)}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px]">Internal notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={3}
            value={state.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Free-text notes for the promo team"
          />
        </CardContent>
      </Card>

      {!isEdit && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create promotion"}
          </Button>
        </div>
      )}
    </div>
  );
}
